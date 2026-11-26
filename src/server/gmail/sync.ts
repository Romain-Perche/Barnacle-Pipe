// Copying Gmail conversations with CRM people (SF-118 research.md §7-§8, data-model.md § Copy rules, FR-009 to FR-012).
// syncConnection: one run at a time per connection through a lease column (no lock across network calls, no session
// state), Gmail's history since history_id (or, when Gmail no longer has it, a listing since the last sync), the pure
// decideCopy, then one transaction per stored message. Unique indexes keep every message once per account.
// runGmailCheck: the 15-minute job (/cron/gmail): every working connection, then the daily watch renewal; SF-124: then
// its calendar sync and the daily renewal of its Calendar notice channel (runCalendarCheck); SF-128: then the running
// past-email fetches (runPastFetches).
import { sql, type Sql } from "@/server/db";
import { gmailConfig } from "@/server/env";
import { loadKey, markNeedsReconnect } from "@/server/gmail/connections";
import {
  getMessage,
  getProfile,
  GoogleKeyRefused,
  GoogleUnavailable,
  HistoryGone,
  listHistory,
  listMessages,
  refreshAccessToken,
  watch,
} from "@/server/gmail/google-api";
import { decideCopy, readMessage, type ReadMessage } from "@/server/gmail/rules";
import { runCalendarCheck } from "@/server/calendar/sync";
import { runPastFetches } from "@/server/gmail/past";

const LEASE_MS = 2 * 60 * 1000;
export const MAX_GETS_PER_RUN = 300;
const BATCH = 50;
const CATCH_UP_MARGIN_MS = 60 * 60 * 1000;
const RENEW_AFTER_MS = 20 * 60 * 60 * 1000;
const CHECK_BUDGET_MS = 240 * 1000;
const MAX_ROUNDS = 5;

export type SyncResult = { copied: number } | { skipped: "busy" | "not_working" | "needs_reconnect" | "unavailable" };

type Leased = { userId: number; connectedAt: Date; historyId: string | null; lastSyncedAt: Date | null };

async function takeLease(connectionId: number, now: Date): Promise<Leased | null> {
  const [row] = await sql<{ user_id: string; connected_at: Date; history_id: string | null; last_synced_at: Date | null }[]>`
    update gmail_connections set sync_lease_until = ${new Date(now.getTime() + LEASE_MS)}, sync_again = false
    where id = ${connectionId} and state = 'working' and (sync_lease_until is null or sync_lease_until < ${now})
    returning user_id::text as user_id, connected_at, history_id::text as history_id, last_synced_at`;
  return row ? { userId: Number(row.user_id), connectedAt: row.connected_at, historyId: row.history_id, lastSyncedAt: row.last_synced_at } : null;
}

const releaseLease = (connectionId: number) => sql`update gmail_connections set sync_lease_until = null where id = ${connectionId}`;

// The ids Gmail reports since the last sync, oldest first, each with how far history goes once it is handled.
type Reported = { ids: { id: string; history: string | null }[]; historyId: string | null; catchUp: boolean };

async function reported(access: string, lease: Leased): Promise<Reported> {
  if (lease.historyId !== null) {
    try {
      const ids: { id: string; history: string | null }[] = [];
      let page: string | undefined;
      let last = lease.historyId;
      do {
        const r = await listHistory(access, lease.historyId, page);
        for (const e of r.entries) ids.push({ id: e.messageId, history: e.historyId });
        last = r.historyId;
        page = r.nextPageToken ?? undefined;
      } while (page);
      return { ids, historyId: last, catchUp: false };
    } catch (e) {
      if (!(e instanceof HistoryGone)) throw e;
    }
  }
  // Gmail's history is gone (edge case "Large catch-up"): its current history id first, then every message since the
  // last successful sync (or the connection) minus an hour, oldest first.
  const profile = await getProfile(access);
  const since = (lease.lastSyncedAt ?? lease.connectedAt).getTime() - CATCH_UP_MARGIN_MS;
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const r = await listMessages(access, `after:${Math.floor(since / 1000)}`, page);
    ids.push(...r.ids);
    page = r.nextPageToken ?? undefined;
  } while (page);
  return { ids: ids.reverse().map((id) => ({ id, history: null })), historyId: profile.historyId, catchUp: true };
}

// One message in one transaction. SF-128 (research.md §3): with a past-email fetch's id, the fetch's `copied` rises by 1
// in the same transaction when this message created the conversation (whoever creates the thread row first owns it,
// decided by the unique index), so a count is never lost nor repeated. The live sync passes no fetch.
export async function storeMessage(connectionId: number, m: ReadMessage, opts: { fetchId?: number } = {}): Promise<boolean> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const created = await db`
      insert into email_threads (connection_id, gmail_thread_id, subject) values (${connectionId}, ${m.gmailThreadId}, ${m.subject})
      on conflict (connection_id, gmail_thread_id) do nothing
      returning id`;
    if (created.length > 0 && opts.fetchId !== undefined) {
      await db`
        update past_email_fetches set copied = copied + 1, updated_at = now()
        where id = ${opts.fetchId} and state = 'running'`;
    }
    const [thread] = await db<{ id: string }[]>`
      select id::text as id from email_threads where connection_id = ${connectionId} and gmail_thread_id = ${m.gmailThreadId}`;
    const [msg] = await db<{ id: string }[]>`
      insert into email_messages (connection_id, thread_id, gmail_message_id, rfc_message_id, direction, from_address, from_name,
                                  to_list, cc_list, bcc_list, subject, sent_at, received_at, text_body, html_body)
      values (${connectionId}, ${thread.id}, ${m.gmailMessageId}, ${m.rfcMessageId}, ${m.direction}, ${m.from?.email ?? null},
              ${m.from?.name ?? null}, ${db.json(m.to)}, ${db.json(m.cc)}, ${db.json(m.bcc)}, ${m.subject}, ${m.sentAt},
              ${m.receivedAt}, ${m.textBody}, ${m.htmlBody})
      on conflict (connection_id, gmail_message_id) do nothing
      returning id::text as id`;
    if (!msg) return false;
    for (const [position, a] of m.attachments.entries()) {
      await db`
        insert into email_attachments (message_id, position, name, content_type, size)
        values (${msg.id}, ${position}, ${a.name}, ${a.contentType}, ${a.size})`;
    }
    return true;
  });
}

// One pass: what Gmail reported, minus what is stored, at most MAX_GETS_PER_RUN messages fetched.
async function runOnce(connectionId: number, lease: Leased, now: Date): Promise<number> {
  const key = await loadKey(connectionId);
  if (!key) throw new GoogleKeyRefused(0, "unreadable");
  const access = await refreshAccessToken(key);
  const report = await reported(access, lease);
  const seen = new Set<string>();
  const unique = report.ids.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  const stored = new Set(
    unique.length === 0
      ? []
      : (
          await sql<{ id: string }[]>`
            select gmail_message_id as id from email_messages
            where connection_id = ${connectionId} and gmail_message_id = any(${unique.map((x) => x.id)})`
        ).map((r) => r.id),
  );
  const todo = unique.filter((x) => !stored.has(x.id));
  const batch = todo.slice(0, MAX_GETS_PER_RUN);
  const capped = todo.length > batch.length;
  let copied = 0;
  let lastDate: Date | null = null;
  const knownThreads = new Set<string>();
  for (let i = 0; i < batch.length; i += BATCH) {
    const fetched: ReadMessage[] = [];
    for (const { id } of batch.slice(i, i + BATCH)) {
      const g = await getMessage(access, id);
      if (g) fetched.push(readMessage(g));
    }
    const addresses = [...new Set(fetched.flatMap((m) => m.addresses))];
    const crm = new Set(
      addresses.length === 0
        ? []
        : (await sql<{ email: string }[]>`select email from person_emails where email = any(${addresses})`).map((r) => r.email),
    );
    const threadIds = [...new Set(fetched.map((m) => m.gmailThreadId))];
    for (const r of threadIds.length === 0
      ? []
      : await sql<{ id: string }[]>`select gmail_thread_id as id from email_threads where connection_id = ${connectionId} and gmail_thread_id = any(${threadIds})`) {
      knownThreads.add(r.id);
    }
    for (const m of fetched) {
      const decision = decideCopy({
        labelIds: m.labelIds,
        internalDate: m.receivedAt,
        connectedAt: lease.connectedAt,
        threadKnown: knownThreads.has(m.gmailThreadId),
        addresses: m.addresses,
        crmAddresses: crm,
      });
      if (decision === "copy") {
        if (await storeMessage(connectionId, m)) copied += 1;
        knownThreads.add(m.gmailThreadId);
      }
      if (!Number.isNaN(m.receivedAt.getTime()) && (!lastDate || m.receivedAt > lastDate)) lastDate = m.receivedAt;
    }
  }
  if (!capped) {
    // Done: history moves on (never back), "Last sync" is now.
    await sql`
      update gmail_connections
      set history_id = greatest(coalesce(history_id, 0), ${report.historyId}::numeric), last_synced_at = ${now}, sync_lease_until = null
      where id = ${connectionId} and state = 'working'`;
  } else if (!report.catchUp) {
    // More to do: history moves on to the last record handled; the next notice or check carries on from there.
    const upTo = batch[batch.length - 1].history;
    if (upTo) await sql`update gmail_connections set history_id = greatest(coalesce(history_id, 0), ${upTo}::numeric) where id = ${connectionId}`;
  } else if (lastDate) {
    // A capped catch-up: the next listing starts from the newest message handled (history is still gone).
    await sql`
      update gmail_connections set last_synced_at = greatest(coalesce(last_synced_at, ${lastDate}), ${lastDate})
      where id = ${connectionId} and state = 'working'`;
  }
  return copied;
}

export async function syncConnection(connectionId: number, now = new Date()): Promise<SyncResult> {
  let copied = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lease = await takeLease(connectionId, now);
    if (!lease) {
      if (round > 0) return { copied };
      // Someone else holds the lease: ask them to go once more, so this notice's changes are not missed.
      const [busy] = await sql`update gmail_connections set sync_again = true where id = ${connectionId} and state = 'working' returning id`;
      return { skipped: busy ? "busy" : "not_working" };
    }
    try {
      copied += await runOnce(connectionId, lease, now);
    } catch (e) {
      if (e instanceof GoogleKeyRefused) {
        await markNeedsReconnect(connectionId);
        return { skipped: "needs_reconnect" };
      }
      await releaseLease(connectionId);
      if (e instanceof GoogleUnavailable) return { skipped: "unavailable" };
      throw e;
    }
    const [row] = await sql<{ again: boolean }[]>`
      update gmail_connections set sync_lease_until = null where id = ${connectionId} returning sync_again as again`;
    if (!row?.again) break;
  }
  return { copied };
}

// Renews Gmail's notices for a working connection (FR-007). A refused key → needs_reconnect; any other failure leaves
// watch_renewed_at as it was, so the next check tries again.
export async function renewWatch(connectionId: number, now = new Date()): Promise<"renewed" | "needs_reconnect" | "unavailable"> {
  const cfg = gmailConfig();
  if (cfg.mode === "off") return "unavailable";
  try {
    const key = await loadKey(connectionId);
    if (!key) throw new GoogleKeyRefused(0, "unreadable");
    const w = await watch(await refreshAccessToken(key), cfg.topic);
    await sql`
      update gmail_connections set watch_renewed_at = ${now}, watch_expires_at = ${w.expiration}
      where id = ${connectionId} and state = 'working'`;
    return "renewed";
  } catch (e) {
    if (e instanceof GoogleKeyRefused) {
      await markNeedsReconnect(connectionId);
      return "needs_reconnect";
    }
    if (e instanceof GoogleUnavailable) return "unavailable";
    throw e;
  }
}

// The 15-minute check: every working connection, the least recently synced first, then the watch renewal once a day.
// Stops starting new connections after 240 s (the function may run 300 s).
export async function runGmailCheck(now = new Date()): Promise<void> {
  if (gmailConfig().mode === "off") return;
  const started = Date.now();
  const rows = await sql<{ id: string }[]>`
    select id::text as id from gmail_connections where state = 'working' order by last_synced_at asc nulls first, id`;
  for (const { id } of rows) {
    if (Date.now() - started > CHECK_BUDGET_MS) break;
    const connectionId = Number(id);
    try {
      await syncConnection(connectionId, now);
      const [row] = await sql<{ due: boolean }[]>`
        select (watch_renewed_at is null or watch_renewed_at < ${new Date(now.getTime() - RENEW_AFTER_MS)}) as due
        from gmail_connections where id = ${connectionId} and state = 'working'`;
      if (row?.due) await renewWatch(connectionId, now);
      await runCalendarCheck(connectionId, now);
    } catch {
      // One connection's failure never stops the others; the next check tries again.
    }
  }
  // SF-128 (research.md §6): running past-email fetches carry on with what is left of the check's time.
  await runPastFetches(now, started + CHECK_BUDGET_MS);
}
