// Database sessions (research.md §4). The cookie holds a random token; the table stores only its SHA-256.
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { randomToken } from "@/server/auth/google";
import { isSafeNext } from "@/server/auth/rules";
import { sql } from "@/server/db";
import { appBaseUrl, isPreview } from "@/server/env";

import { SESSION_COOKIE, SESSION_DAYS, sessionCookieOptions } from "@/server/auth/cookie";

export { SESSION_COOKIE };

export type User = { id: number; email: string; name: string; role: "admin" | "user"; status: "active" | "deactivated" };
export type Lookup = { ok: true; user: User } | { ok: false; reason: "expired" | "removed" };

type Db = typeof sql;

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function createSession(userId: number, db: Db = sql): Promise<{ token: string }> {
  const token = randomToken();
  await db`insert into sessions (token_hash, user_id, expires_at)
           values (${hashToken(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return { token };
}

export async function lookupSession(token: string): Promise<Lookup> {
  const [row] = await sql<(User & { expired: boolean; revoked: boolean; stale: boolean; session_id: number })[]>`
    select s.id::int as session_id, u.id::int as id, u.email, u.name, u.role, u.status,
           s.expires_at <= now() as expired, s.revoked_at is not null as revoked,
           s.last_seen_at < now() - interval '1 hour' as stale
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}`;
  if (!row || row.expired) return { ok: false, reason: "expired" };
  if (row.revoked || row.status !== "active") return { ok: false, reason: "removed" };
  if (row.stale) {
    await sql`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS})
              where id = ${row.session_id}`;
  }
  const { id, email, name, role, status } = row;
  return { ok: true, user: { id, email, name, role, status } };
}

export async function endSession(token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

export async function revokeAllSessions(userId: number, db: Db = sql): Promise<void> {
  await db`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}

// --- Next.js request helpers -------------------------------------------------------------------

async function isHttps(): Promise<boolean> {
  return (await headers()).get("x-forwarded-proto") === "https";
}

// Route handlers and server actions only (server components cannot set cookies).
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(await isHttps()));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// One lookup per request, shared by the layout and the page.
const lookupOnce = cache((token: string) => lookupSession(token));

export async function currentPath(): Promise<string> {
  return isSafeNext((await headers()).get("x-pathname"), appBaseUrl());
}

// Every signed-in page and server action calls this first. Role and status are read fresh (FR-017).
export async function requireUser(): Promise<User> {
  if (isPreview()) redirect("/sign-in");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const next = encodeURIComponent(await currentPath());
  if (!token) redirect(`/auth/end?next=${next}`);
  const result = await lookupOnce(token);
  if (!result.ok) redirect(result.reason === "removed" ? "/auth/end?reason=removed" : `/auth/end?next=${next}`);
  return result.user;
}

// Pages: signed in, plus whether the user is an admin (a non-admin sees the Forbidden page).
export async function requireAdmin(): Promise<{ user: User; isAdmin: boolean }> {
  const user = await requireUser();
  return { user, isAdmin: user.role === "admin" };
}

// Server actions: a non-admin is sent to /admin/users, which shows "You don't have access to this page."
export async function assertAdminForAction(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/admin/users");
  return user;
}
