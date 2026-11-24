// SF-118 test helpers: connect a user through the real start action, the fake consent screen's grant and the real
// callback route; read a connection; put mail in the fake mailbox. The test file mocks next/headers (cookie jar) and
// next/navigation (redirect throws { to }) before importing this.
import { NextRequest } from "next/server";
import { GET as callback } from "@/app/(app)/settings/gmail/callback/route";
import * as actions from "@/app/(app)/settings/actions";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { sql } from "@/server/db";
import type { GmailFake } from "../fakes/gmail";

export const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const SEND = "https://www.googleapis.com/auth/gmail.send";

export async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const to = (e as { to?: string }).to;
    if (to) return to;
    throw e;
  }
  throw new Error("no redirect");
}

export async function signInAs(jar: Map<string, string>, userId: number) {
  jar.set(SESSION_COOKIE, (await createSession(userId)).token);
}

// [ CONNECT GMAIL ]: the consent address the action sends the browser to (the cookie is now in the jar).
export async function startConnect(): Promise<URL> {
  return new URL(await redirectOf(actions.startGmailConnect()));
}

// What the fake consent screen does, then Google's redirect to the callback route; returns where the callback sends
// the browser (/settings or /settings?gmail=<code>).
export async function consentAndReturn(
  fake: GmailFake,
  consent: URL,
  o: { email?: string; scopes?: string[]; deny?: boolean; state?: string } = {},
): Promise<string> {
  const p = consent.searchParams;
  const back = new URL(p.get("redirect_uri")!);
  back.searchParams.set("state", o.state ?? p.get("state")!);
  if (o.deny) back.searchParams.set("error", "access_denied");
  else {
    const code = fake.consent({
      email: o.email ?? p.get("login_hint")!,
      scopes: o.scopes ?? [MODIFY, SEND],
      codeChallenge: p.get("code_challenge")!,
      redirectUri: p.get("redirect_uri")!,
      clientId: p.get("client_id")!,
      offline: p.get("access_type") === "offline",
    });
    back.searchParams.set("code", code);
  }
  const res = await callback(new NextRequest(back));
  if (res.status !== 303) throw new Error(`callback answered ${res.status}`);
  const to = new URL(res.headers.get("location")!);
  return `${to.pathname}${to.search}`;
}

export async function connectGmail(fake: GmailFake, o: Parameters<typeof consentAndReturn>[2] = {}): Promise<string> {
  return consentAndReturn(fake, await startConnect(), o);
}

export type ConnectionRow = {
  id: number;
  user_id: number;
  email: string;
  state: string;
  has_key: boolean;
  scopes: string;
  connected_at: Date;
  history_id: string | null;
  last_synced_at: Date | null;
  watch_renewed_at: Date | null;
  watch_expires_at: Date | null;
  sync_lease_until: Date | null;
  sync_again: boolean;
};

export async function connectionOf(userId: number): Promise<ConnectionRow | undefined> {
  const [row] = await sql<ConnectionRow[]>`
    select id::int as id, user_id::int as user_id, email, state, token_cipher is not null as has_key, scopes, connected_at,
           history_id::text as history_id, last_synced_at, watch_renewed_at, watch_expires_at, sync_lease_until, sync_again
    from gmail_connections where user_id = ${userId}`;
  return row;
}

export async function conversations(userId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from email_threads t join gmail_connections c on c.id = t.connection_id where c.user_id = ${userId}`;
  return row.n;
}

export async function storedMessages(userId: number) {
  return sql<{ gmail_message_id: string; direction: string; subject: string; rfc_message_id: string | null; text_body: string | null; html_body: string | null }[]>`
    select m.gmail_message_id, m.direction, m.subject, m.rfc_message_id, m.text_body, m.html_body
    from email_messages m join gmail_connections c on c.id = m.connection_id where c.user_id = ${userId} order by m.id`;
}

export async function attachmentsOf(userId: number) {
  return sql<{ name: string; content_type: string; size: string }[]>`
    select a.name, a.content_type, a.size::text as size
    from email_attachments a join email_messages m on m.id = a.message_id join gmail_connections c on c.id = m.connection_id
    where c.user_id = ${userId} order by a.message_id, a.position`;
}
