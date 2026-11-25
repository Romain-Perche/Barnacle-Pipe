// A user's Gmail connection (SF-118 data-model.md § State changes, research.md §3, §4, §11). One row per user in
// gmail_connections, kept after a disconnect or a deactivation so its conversations stay. The refresh token is sealed
// with GMAIL_TOKEN_KEY (src/server/crypto/seal.ts, purpose "gmail-token"); loadKey() is the only reader of token_cipher,
// and pages get the address, state, times and count only. Every change is one transaction with no Google call inside:
// Google is called before (connect) or after commit (watch, stop, revoke).
import { sql, type Sql } from "@/server/db";
import { openToken, sealToken, TokenUnreadable } from "@/server/crypto/seal";
import { gmailConfig } from "@/server/env";
import { exchangeGmailCode, getProfile, GoogleUnavailable, refreshAccessToken, revokeToken, stopWatch, watch } from "@/server/gmail/google-api";
import { hasAllScopes } from "@/server/gmail/rules";

export type GmailCardState = "not_connected" | "working" | "needs_reconnect";
export type GmailSettings = {
  mode: "real" | "fake" | "off";
  state: GmailCardState;
  email: string | null;
  lastSyncedAt: Date | null;
  connectedAt: Date | null;
  conversations: number;
};

// What Settings shows: never the cipher.
export async function gmailSettings(userId: number): Promise<GmailSettings> {
  const mode = gmailConfig().mode;
  const [row] = await sql<{ email: string; state: string; last_synced_at: Date | null; connected_at: Date; conversations: number }[]>`
    select c.email, c.state, c.last_synced_at, c.connected_at,
           (select count(*)::int from email_threads t where t.connection_id = c.id) as conversations
    from gmail_connections c where c.user_id = ${userId}`;
  if (!row || row.state === "disconnected") return { mode, state: "not_connected", email: null, lastSyncedAt: null, connectedAt: null, conversations: 0 };
  return {
    mode,
    state: row.state as GmailCardState,
    email: row.email,
    lastSyncedAt: row.last_synced_at,
    connectedAt: row.connected_at,
    conversations: row.conversations,
  };
}

// The orange "!" on the sidebar's Settings link.
export async function gmailNeedsReconnect(userId: number): Promise<boolean> {
  const [row] = await sql<{ yes: boolean }[]>`
    select exists (select 1 from gmail_connections where user_id = ${userId} and state = 'needs_reconnect') as yes`;
  return row.yes;
}

// The opened refresh token of a connection, in memory only; null when there is none or it can't be opened (Gmail off,
// another key, another user's row). The only place token_cipher is read.
export async function loadKey(connectionId: number, db: Sql = sql): Promise<string | null> {
  const cfg = gmailConfig();
  if (cfg.mode === "off") return null;
  const [row] = await db<{ user_id: string; token_cipher: Buffer | null }[]>`
    select user_id::text as user_id, token_cipher from gmail_connections where id = ${connectionId}`;
  if (!row?.token_cipher) return null;
  try {
    return openToken(cfg.tokenKey, "gmail-token", Number(row.user_id), row.token_cipher);
  } catch (e) {
    if (e instanceof TokenUnreadable) return null;
    throw e;
  }
}

// Google no longer accepts the key: only a working connection changes, so a disconnect in between is never undone.
export async function markNeedsReconnect(connectionId: number): Promise<void> {
  await sql`
    update gmail_connections set state = 'needs_reconnect', sync_lease_until = null, sync_again = false, updated_at = now()
    where id = ${connectionId} and state = 'working'`;
}

export type ConnectInput = { refreshToken: string; accessToken: string; scope: string; profile: { emailAddress: string; historyId: string } };

// Stores the checked key (research.md §3 steps 1-7 are done by the callback first) and starts Gmail's notices.
// - no row / disconnected → working, connected_at = now, history from the profile: "connected";
// - needs_reconnect → working, keeping connected_at, history_id and last_synced_at: "reconnected";
// - working (a second tab) → the new key replaces the old one, revoked after commit: "connected".
export async function finishConnect(userId: number, input: ConnectInput, now = new Date()): Promise<"connected" | "reconnected"> {
  const cfg = gmailConfig();
  if (cfg.mode === "off") throw new GoogleUnavailable("off");
  const sealed = sealToken(cfg.tokenKey, "gmail-token", userId, input.refreshToken);
  const email = input.profile.emailAddress.trim().toLowerCase();
  const { id, outcome, oldToken } = await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [row] = await db<{ id: string; state: string }[]>`
      select id::text as id, state from gmail_connections where user_id = ${userId} for update`;
    if (!row) {
      const [made] = await db<{ id: string }[]>`
        insert into gmail_connections (user_id, email, state, token_cipher, scopes, connected_at, history_id)
        values (${userId}, ${email}, 'working', ${sealed}, ${input.scope}, ${now}, ${input.profile.historyId})
        returning id::text as id`;
      return { id: Number(made.id), outcome: "connected" as const, oldToken: null };
    }
    const connId = Number(row.id);
    if (row.state === "needs_reconnect") {
      await db`
        update gmail_connections set state = 'working', email = ${email}, token_cipher = ${sealed}, scopes = ${input.scope},
          sync_lease_until = null, sync_again = false, updated_at = now()
        where id = ${connId}`;
      return { id: connId, outcome: "reconnected" as const, oldToken: null };
    }
    if (row.state === "working") {
      const oldToken = await loadKey(connId, db);
      await db`
        update gmail_connections set email = ${email}, token_cipher = ${sealed}, scopes = ${input.scope}, updated_at = now()
        where id = ${connId}`;
      return { id: connId, outcome: "connected" as const, oldToken };
    }
    await db`
      update gmail_connections set state = 'working', email = ${email}, token_cipher = ${sealed}, scopes = ${input.scope},
        connected_at = ${now}, history_id = ${input.profile.historyId}, last_synced_at = null, sync_again = false,
        updated_at = now()
      where id = ${connId}`;
    return { id: connId, outcome: "connected" as const, oldToken: null };
  });
  if (oldToken && oldToken !== input.refreshToken) await revokeToken(oldToken).catch(() => {});
  try {
    const w = await watch(input.accessToken, cfg.topic);
    await sql`
      update gmail_connections set watch_renewed_at = ${now}, watch_expires_at = ${w.expiration}
      where id = ${id} and state = 'working'`;
  } catch {
    // The connection stays working; the next 15-minute check renews the watch (watch_renewed_at is still null or old).
  }
  return outcome;
}

// Inside a caller's transaction (disconnect, users.deactivate): forgets the key, stops sync, keeps what was copied.
// Returns the opened refresh token, for afterGmailForgotten() once the transaction is committed; null when none.
export async function forgetGmailInTx(db: Sql, userId: number): Promise<string | null> {
  const [row] = await db<{ id: string; state: string }[]>`
    select id::text as id, state from gmail_connections where user_id = ${userId} for update`;
  if (!row || row.state === "disconnected") return null;
  const token = await loadKey(Number(row.id), db);
  await db`
    update gmail_connections set state = 'disconnected', token_cipher = null, watch_renewed_at = null, watch_expires_at = null,
      sync_lease_until = null, sync_again = false, updated_at = now()
    where id = ${row.id}`;
  return token;
}

// After commit, best effort (FR-005): stop Gmail's notices, then ask Google to cancel the key. Errors are ignored: the
// key is already forgotten.
export async function afterGmailForgotten(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await stopWatch(await refreshAccessToken(token));
  } catch {
    // Google can't be reached, or the key was already refused.
  }
  await revokeToken(token).catch(() => {});
}

export async function disconnect(userId: number): Promise<void> {
  const token = await sql.begin((tx) => forgetGmailInTx(tx as unknown as Sql, userId));
  await afterGmailForgotten(token);
}

// The cookie startGmailConnect sets for the callback (research.md §3): the request this user started.
export const GMAIL_OAUTH_COOKIE = "crm_gmail_oauth";
export const GMAIL_OAUTH_PATH = "/settings/gmail";

export type CallbackOutcome = "connected" | "reconnected" | "not_connected" | "wrong_account" | "missing_scopes" | "unavailable";

function readOAuthCookie(raw: string | undefined): { state: string; verifier: string; userId: number } | null {
  try {
    const v = JSON.parse(raw ?? "") as { state?: unknown; verifier?: unknown; userId?: unknown };
    return typeof v.state === "string" && v.state !== "" && typeof v.verifier === "string" && typeof v.userId === "number" ? { state: v.state, verifier: v.verifier, userId: v.userId } : null;
  } catch {
    return null;
  }
}

// The return from Google's consent screen (research.md §3), for the signed-in `user`:
// 2. the cookie of the request this user started (same state, same user), 3. no error from Google, 4. the code
// exchanged with the verifier, 5. both scopes, 6. the account is the user's sign-in address, 7. a refresh token.
// Any refusal after the exchange cancels the new key at Google (best effort) and stores nothing.
export async function connectFromCallback(user: { id: number; email: string }, cookie: string | undefined, params: URLSearchParams): Promise<CallbackOutcome> {
  if (gmailConfig().mode === "off") return "unavailable";
  const oauth = readOAuthCookie(cookie);
  const code = params.get("code");
  if (!oauth || oauth.userId !== user.id || params.get("state") !== oauth.state || params.get("error") || !code) return "not_connected";
  let tokens;
  try {
    tokens = await exchangeGmailCode(code, oauth.verifier);
  } catch {
    return "not_connected";
  }
  const cancel = async () => {
    await revokeToken(tokens.refreshToken ?? tokens.accessToken).catch(() => {});
  };
  if (!hasAllScopes(tokens.scope)) {
    await cancel();
    return "missing_scopes";
  }
  let profile;
  try {
    profile = await getProfile(tokens.accessToken);
  } catch {
    await cancel();
    return "not_connected";
  }
  if (profile.emailAddress.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    await cancel();
    return "wrong_account";
  }
  if (!tokens.refreshToken) {
    await cancel();
    return "not_connected";
  }
  try {
    return await finishConnect(user.id, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, scope: tokens.scope, profile });
  } catch {
    await cancel();
    return "not_connected";
  }
}
