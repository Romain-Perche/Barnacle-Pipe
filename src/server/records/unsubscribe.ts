// SF-121: unsubscribing through a person's unsubscribe link (the page's button or the mail app's one-click), the
// page's read-only state, and the links campaign sending puts in each email.
//
// These are the only `persons` reads and writes without `visiblePerson()` (plan.md Complexity Tracking): there is no
// viewer, the unguessable token is the authority, and archived and private people must be unsubscribable too (FR-010).
// They return only consent or the token, never a shown CRM value. The timeline line they write is read through
// `readTimeline`, so it follows the person's visibility as usual.
import { sql, type Sql } from "@/server/db";
import { appBaseUrl, isPreview } from "@/server/env";
import { recordEvent } from "@/server/records/timeline";
import { isTokenShape, unsubscribeLinks, type UnsubscribeLinks, type UnsubscribeVia } from "@/server/records/unsubscribe-rules";

export type UnsubscribeResult = "done" | "not_found";
export type UnsubscribePageState = "ready" | "done" | "not_found" | "error";

// Safe to repeat and to run twice at once: the conditional update writes at most one line per actual change (a second
// update waits for the first's row lock, then re-checks `consent = 'subscribed'`). Never bumps `version` (an open edit
// form still saves; its Consent is kept: FR-019) and tells nobody (FR-018). A database error is thrown.
export async function unsubscribeByToken(token: string, via: UnsubscribeVia): Promise<UnsubscribeResult> {
  if (!isTokenShape(token)) return "not_found";
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [changed] = await db<{ id: number }[]>`
      update persons set consent = 'unsubscribed'
      where unsubscribe_token = ${token} and consent = 'subscribed'
      returning id::int as id`;
    if (changed) {
      await recordEvent(db, { personId: changed.id, kind: via === "link" ? "unsubscribed_link" : "unsubscribed_mail_app", actorId: null });
      return "done" as const;
    }
    const [exists] = await db`select 1 from persons where unsubscribe_token = ${token}`;
    return exists ? ("done" as const) : ("not_found" as const);
  });
}

// What /unsubscribe/<token> shows. Read-only (a GET never writes: FR-004); a database error is "error".
export async function unsubscribePageState(token: string): Promise<UnsubscribePageState> {
  if (isPreview()) return "error";
  if (!isTokenShape(token)) return "not_found";
  try {
    const [row] = await sql<{ consent: string }[]>`select consent from persons where unsubscribe_token = ${token}`;
    if (!row) return "not_found";
    return row.consent === "subscribed" ? "ready" : "done";
  } catch {
    return "error";
  }
}

// The one function campaign sending uses (FR-012): the person's page link and the List-Unsubscribe /
// List-Unsubscribe-Post headers, on APP_URL. null when there is no such person.
export async function unsubscribeLinksFor(personId: number): Promise<UnsubscribeLinks | null> {
  const [row] = await sql<{ t: string }[]>`select unsubscribe_token as t from persons where id = ${personId}`;
  return row ? unsubscribeLinks(appBaseUrl(), row.t) : null;
}

// Every person's links, for /dev/unsubscribe-links only (called after isFakeAllowed()).
export async function listUnsubscribeLinks(): Promise<{ id: number; name: string; links: UnsubscribeLinks }[]> {
  const rows = await sql<{ id: number; name: string; t: string }[]>`
    select id::int as id, btrim(first_name || ' ' || last_name) as name, unsubscribe_token as t
    from persons order by lower(last_name), lower(first_name), id`;
  const base = appBaseUrl();
  return rows.map((r) => ({ id: r.id, name: r.name, links: unsubscribeLinks(base, r.t) }));
}
