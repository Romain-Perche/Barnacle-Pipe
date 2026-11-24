// A user's Pipedrive connection (SF-117 US1, research.md §3–§4): one row per user in pipedrive_connections, the token
// sealed with PIPEDRIVE_TOKEN_KEY. The only place a token is opened: tokenFor(), for imports.ts. Pages get the user
// name, company and date only. Nothing is written before Pipedrive accepts a token, so an earlier one stays in place on
// any failure. Every query names its user: nobody, admins included, reads or uses another user's token.
import { sql, type Sql } from "@/server/db";
import { pipedriveConfig } from "@/server/env";
import { PipedriveRefused, whoAmI } from "@/server/pipedrive/api";
import { openToken, sealToken, TokenUnreadable } from "@/server/pipedrive/crypto";

export const MAX_TOKEN = 200;

export type ConnectionView = { userName: string; companyName: string; companyId: number; savedAt: Date };
export type ConnectionState = { ready: false } | { ready: true; connection: ConnectionView | null };
export type SaveError = "pipedrive_not_set_up" | "pipedrive_token_required" | "pipedrive_token_refused" | "pipedrive_unreachable";

export async function getConnection(userId: number): Promise<ConnectionState> {
  if (!pipedriveConfig().key) return { ready: false };
  const [row] = await sql<{ user_name: string; company_name: string; company_id: string; saved_at: Date }[]>`
    select pipedrive_user_name as user_name, company_name, company_id::text as company_id, saved_at
    from pipedrive_connections where user_id = ${userId}`;
  return { ready: true, connection: row ? { userName: row.user_name, companyName: row.company_name, companyId: Number(row.company_id), savedAt: row.saved_at } : null };
}

export async function saveToken(userId: number, raw: string): Promise<{ ok: true } | { error: SaveError }> {
  const key = pipedriveConfig().key;
  if (!key) return { error: "pipedrive_not_set_up" };
  const token = (raw ?? "").trim();
  if (token === "") return { error: "pipedrive_token_required" };
  if (token.length > MAX_TOKEN) return { error: "pipedrive_token_refused" };
  let me;
  try {
    me = await whoAmI(token);
  } catch (e) {
    // Refused → the token is wrong; anything else (unreachable, 429, 5xx, time-out) → try again later.
    return { error: e instanceof PipedriveRefused ? "pipedrive_token_refused" : "pipedrive_unreachable" };
  }
  const sealed = sealToken(key, userId, token);
  await sql`
    insert into pipedrive_connections (user_id, token, pipedrive_user_id, pipedrive_user_name, company_id, company_name)
    values (${userId}, ${sealed}, ${me.id}, ${me.name.slice(0, 255)}, ${me.companyId}, ${me.companyName.slice(0, 255)})
    on conflict (user_id) do update set token = excluded.token, pipedrive_user_id = excluded.pipedrive_user_id,
      pipedrive_user_name = excluded.pipedrive_user_name, company_id = excluded.company_id, company_name = excluded.company_name,
      saved_at = now()`;
  return { ok: true };
}

export async function removeToken(userId: number): Promise<void> {
  await deleteConnection(sql, userId);
}

// Used by deactivate() inside its transaction (FR-003: users are never deleted, so their token is).
export async function deleteConnection(db: Sql, userId: number): Promise<void> {
  await db`delete from pipedrive_connections where user_id = ${userId}`;
}

// The opened token and its company, for the user's own import only; null when there is none, no key, or it can't be
// opened (another key, another user's row).
export async function tokenFor(userId: number): Promise<{ token: string; companyId: number } | null> {
  const key = pipedriveConfig().key;
  if (!key) return null;
  const [row] = await sql<{ token: Buffer; company_id: string }[]>`
    select token, company_id::text as company_id from pipedrive_connections where user_id = ${userId}`;
  if (!row) return null;
  try {
    return { token: openToken(key, userId, row.token), companyId: Number(row.company_id) };
  } catch (e) {
    if (e instanceof TokenUnreadable) return null;
    throw e;
  }
}
