// Fetch past emails (SF-128 research.md §1-§7, data-model.md). One `past_email_fetches` row per Gmail connection.
// - startPastFetch: the press; one transaction holding the connection row, a conditional upsert (never two at once).
// - runPastFetchPart: one part under a lease column (no lock across Google calls): the 12-month window walked backwards
//   in 7-day slices with threads.list, each thread read as metadata and decided by the pure planPastThread, each
//   message to copy read in full and stored by SF-118's storeMessage (one transaction each, counting new conversations),
//   the cursor saved after every thread. At most PART_THREADS threads or PART_BUDGET_MS of work per part.
// - runPastFetchPartFor: the Settings page's part (the user's own connection); runPastFetches: the 15-minute check's.
// No Google call inside sql.begin(). Gmail's slow-downs set wait_until (no part before it); "can't be reached" keeps
// the cursor; a refused key marks the connection needs_reconnect (the fetch waits, still running); a disconnect or a
// deactivation deletes the row (forgetGmailInTx), which stops a running part at its next cursor save.
import { sql, type Sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import {
  getMessage,
  getThreadMessages,
  GmailSlowDown,
  GoogleKeyRefused,
  GoogleUnavailable,
  listThreads,
  PageTokenRefused,
  refreshAccessToken,
} from "@/server/gmail/google-api";
import { pastWindow, planPastThread, readMessage } from "@/server/gmail/rules";
import { storeMessage } from "@/server/gmail/sync";

const PART_BUDGET_MS = 20_000;
const PART_THREADS = 100;
const LEASE_MS = 90_000;
const SLICE_MS = 7 * 24 * 60 * 60 * 1000;
const MARGIN_MS = 24 * 60 * 60 * 1000;
const UNREACHABLE_RETRY_S = 30;
const BUSY_RETRY_S = 5;

let partForTests: { threads?: number; budgetMs?: number } | null = null;

// Tests only: a smaller part ("a part size of 10 in tests"). Throws outside APP_ENV=test.
export function setPastFetchPartForTests(o: { threads?: number; budgetMs?: number } | null): void {
  if (process.env.APP_ENV !== "test") throw new Error("setPastFetchPartForTests is for tests only.");
  partForTests = o;
}

export type StartOutcome = "started" | "running" | "not_working";

// The press (data-model.md § State changes): only on a working connection; a running (or paused) fetch is left as it
// is, an ended one is replaced by a fresh fetch whose window ends now.
export async function startPastFetch(userId: number, now: Date): Promise<StartOutcome> {
  if (gmailConfig().mode === "off") return "not_working";
  const { start, end } = pastWindow(now);
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [conn] = await db<{ id: string; state: string }[]>`
      select id::text as id, state from gmail_connections where user_id = ${userId} for update`;
    if (!conn || conn.state !== "working") return "not_working" as const;
    const sliceEnd = new Date(end.getTime() + MARGIN_MS);
    const started = await db`
      insert into past_email_fetches (connection_id, state, window_start, window_end, slice_end, started_at)
      values (${conn.id}, 'running', ${start}, ${end}, ${sliceEnd}, ${now})
      on conflict (connection_id) do update set
        state = 'running', window_start = excluded.window_start, window_end = excluded.window_end,
        slice_end = excluded.slice_end, page_token = null, page_offset = 0, copied = 0, problem = null, wait_until = null,
        lease_until = null, started_at = excluded.started_at, ended_at = null, updated_at = now()
      where past_email_fetches.state = 'ended'
      returning id`;
    return started.length > 0 ? ("started" as const) : ("running" as const);
  });
}

export type PartOutcome = { next: "again" } | { next: "wait"; seconds: number } | { next: "ended" } | { next: "idle" };

type Leased = { id: number; windowStart: Date; windowEnd: Date; sliceEnd: Date; pageToken: string | null; pageOffset: number; leaseUntil: Date };

async function takeLease(connectionId: number, now: Date): Promise<Leased | null> {
  const [row] = await sql<{ id: string; window_start: Date; window_end: Date; slice_end: Date; page_token: string | null; page_offset: number; lease_until: Date }[]>`
    update past_email_fetches f set lease_until = ${new Date(now.getTime() + LEASE_MS)}
    from gmail_connections c
    where f.connection_id = ${connectionId} and c.id = f.connection_id and c.state = 'working' and f.state = 'running'
      and (f.lease_until is null or f.lease_until < ${now}) and (f.wait_until is null or f.wait_until <= ${now})
    returning f.id::text as id, f.window_start, f.window_end, f.slice_end, f.page_token, f.page_offset, f.lease_until`;
  if (!row) return null;
  return {
    id: Number(row.id),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    sliceEnd: row.slice_end,
    pageToken: row.page_token,
    pageOffset: row.page_offset,
    leaseUntil: row.lease_until,
  };
}

// One part of a connection's running fetch. `idle`: nothing was done (no running fetch, connection not working, another
// part holds the lease, Gmail's wait not over). `deadline` (ms since 1970, real clock): the 15-minute check's end.
export async function runPastFetchPart(connectionId: number, o: { now: Date; deadline?: number }): Promise<PartOutcome> {
  if (gmailConfig().mode === "off") return { next: "idle" };
  const lease = await takeLease(connectionId, o.now);
  if (!lease) return { next: "idle" };
  const began = Date.now();
  const budget = partForTests?.budgetMs ?? PART_BUDGET_MS;
  const maxThreads = partForTests?.threads ?? PART_THREADS;
  const timeUp = () => Date.now() - began >= budget || (o.deadline !== undefined && Date.now() >= o.deadline);
  let released = false;
  // Saves the cursor while this part still holds the lease; false when the lease is lost or the row is gone.
  const save = async (c: { sliceEnd: Date; pageToken: string | null; pageOffset: number }) => {
    const r = await sql`
      update past_email_fetches set slice_end = ${c.sliceEnd}, page_token = ${c.pageToken}, page_offset = ${c.pageOffset},
        problem = null, updated_at = now()
      where id = ${lease.id} and lease_until = ${lease.leaseUntil}`;
    return r.count > 0;
  };
  try {
    const key = await loadKey(connectionId);
    if (!key) throw new GoogleKeyRefused(0, "unreadable");
    const access = await refreshAccessToken(key);
    let { sliceEnd, pageToken, pageOffset } = lease;
    const floor = lease.windowStart.getTime() - MARGIN_MS;
    let handled = 0;
    for (;;) {
      if (handled >= maxThreads || timeUp()) return { next: "again" };
      const lower = Math.max(sliceEnd.getTime() - SLICE_MS, floor);
      // One second wider on each side than the slice, so a message on a slice's edge is listed whatever Gmail's
      // reading of after:/before: (re-examining a thread adds and counts nothing).
      const q = `after:${Math.floor(lower / 1000) - 1} before:${Math.ceil(sliceEnd.getTime() / 1000) + 1}`;
      let page: { ids: string[]; nextPageToken: string | null };
      try {
        page = await listThreads(access, q, pageToken);
      } catch (e) {
        if (!(e instanceof PageTokenRefused)) throw e;
        pageToken = null;
        pageOffset = 0;
        if (!(await save({ sliceEnd, pageToken, pageOffset }))) return { next: "idle" };
        continue;
      }
      for (const threadId of page.ids.slice(pageOffset)) {
        if (handled >= maxThreads || timeUp()) return { next: "again" };
        await handleThread(connectionId, lease, access, threadId);
        pageOffset += 1;
        handled += 1;
        if (!(await save({ sliceEnd, pageToken, pageOffset }))) return { next: "idle" };
      }
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        pageOffset = 0;
      } else if (lower <= floor) {
        const r = await sql`
          update past_email_fetches set state = 'ended', ended_at = ${o.now}, lease_until = null, wait_until = null,
            problem = null, page_token = null, page_offset = 0, updated_at = now()
          where id = ${lease.id} and lease_until = ${lease.leaseUntil}`;
        released = true;
        return r.count > 0 ? { next: "ended" } : { next: "idle" };
      } else {
        sliceEnd = new Date(lower);
        pageToken = null;
        pageOffset = 0;
      }
      if (!(await save({ sliceEnd, pageToken, pageOffset }))) return { next: "idle" };
    }
  } catch (e) {
    if (e instanceof GmailSlowDown) {
      await sql`
        update past_email_fetches set wait_until = ${new Date(o.now.getTime() + e.seconds * 1000)}, problem = null, updated_at = now()
        where id = ${lease.id} and lease_until = ${lease.leaseUntil}`;
      return { next: "wait", seconds: e.seconds };
    }
    if (e instanceof GoogleKeyRefused) {
      await markNeedsReconnect(connectionId);
      return { next: "idle" };
    }
    if (e instanceof GoogleUnavailable) {
      await sql`
        update past_email_fetches set problem = 'unavailable', updated_at = now()
        where id = ${lease.id} and lease_until = ${lease.leaseUntil}`;
      return { next: "wait", seconds: UNREACHABLE_RETRY_S };
    }
    throw e;
  } finally {
    if (!released) await sql`update past_email_fetches set lease_until = null where id = ${lease.id} and lease_until = ${lease.leaseUntil}`;
  }
}

// One thread (research.md §2): its metadata, the CRM addresses among its addresses and its messages already stored at
// this moment, the pure decision, then each message to copy read in full and stored (one transaction each).
async function handleThread(connectionId: number, lease: Leased, access: string, threadId: string): Promise<void> {
  const metas = await getThreadMessages(access, threadId);
  if (!metas || metas.length === 0) return;
  const read = metas.map(readMessage);
  const addresses = [...new Set(read.flatMap((m) => m.addresses))];
  const crm = new Set(
    addresses.length === 0 ? [] : (await sql<{ email: string }[]>`select email from person_emails where email = any(${addresses})`).map((r) => r.email),
  );
  const ids = read.map((m) => m.gmailMessageId);
  const stored = new Set(
    (
      await sql<{ id: string }[]>`
        select gmail_message_id as id from email_messages where connection_id = ${connectionId} and gmail_message_id = any(${ids})`
    ).map((r) => r.id),
  );
  const todo = planPastThread({
    messages: read.map((m) => ({ id: m.gmailMessageId, labelIds: m.labelIds, internalDate: m.receivedAt, addresses: m.addresses })),
    windowStart: lease.windowStart,
    windowEnd: lease.windowEnd,
    crmAddresses: crm,
    stored,
  });
  for (const id of todo) {
    const g = await getMessage(access, id);
    if (g) await storeMessage(connectionId, readMessage(g), { fetchId: lease.id });
  }
}

export type PageAnswer = { next: "again" } | { next: "wait"; seconds: number } | { next: "stop" };

// The Settings page's part (contracts/routes.md § Server actions): the user's own connection only.
export async function runPastFetchPartFor(userId: number, o: { now: Date }): Promise<PageAnswer> {
  if (gmailConfig().mode === "off") return { next: "stop" };
  const [row] = await sql<{ connection_id: string; cstate: string; state: string; wait_until: Date | null; lease_until: Date | null }[]>`
    select c.id::text as connection_id, c.state as cstate, f.state, f.wait_until, f.lease_until
    from gmail_connections c join past_email_fetches f on f.connection_id = c.id where c.user_id = ${userId}`;
  if (!row || row.state !== "running" || row.cstate !== "working") return { next: "stop" };
  const left = (d: Date | null) => (d && d > o.now ? Math.max(1, Math.ceil((d.getTime() - o.now.getTime()) / 1000)) : 0);
  if (left(row.wait_until) > 0) return { next: "wait", seconds: left(row.wait_until) };
  const r = await runPastFetchPart(Number(row.connection_id), { now: o.now });
  if (r.next === "again" || r.next === "wait") return r;
  if (r.next === "ended") return { next: "stop" };
  // Nothing done: another part holds the lease (ask again soon), or the fetch is gone, ended or paused.
  const [after] = await sql<{ state: string; cstate: string; wait_until: Date | null }[]>`
    select f.state, c.state as cstate, f.wait_until from past_email_fetches f join gmail_connections c on c.id = f.connection_id
    where c.id = ${row.connection_id}`;
  if (!after || after.state !== "running" || after.cstate !== "working") return { next: "stop" };
  return { next: "wait", seconds: left(after.wait_until) || BUSY_RETRY_S };
}

// The 15-minute check's part (research.md §6): every running fetch on a working connection whose wait is over, the
// oldest first, parts back to back until `deadline` (ms since 1970). One fetch's failure never stops the others.
export async function runPastFetches(now: Date, deadline: number): Promise<void> {
  if (gmailConfig().mode === "off") return;
  const rows = await sql<{ id: string }[]>`
    select f.connection_id::text as id from past_email_fetches f join gmail_connections c on c.id = f.connection_id
    where f.state = 'running' and c.state = 'working' and (f.wait_until is null or f.wait_until <= ${now})
    order by f.started_at, f.id`;
  for (const { id } of rows) {
    try {
      while (Date.now() < deadline) {
        const r = await runPastFetchPart(Number(id), { now, deadline });
        if (r.next !== "again") break;
      }
    } catch {
      // The next check tries again.
    }
  }
}
