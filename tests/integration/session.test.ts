// covers FR-006, FR-007, FR-017, US1 scenarios 6–7
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, endSession, lookupSession, revokeAllSessions } from "@/server/auth/session";
import { closeDb, sql } from "@/server/db";
import { count, makeUser, resetDb } from "./db-helpers";

beforeEach(resetDb);
afterAll(closeDb);

describe("sessions", () => {
  it("stores only the SHA-256 of the token, valid for 30 days", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    const { token } = await createSession(u.id);
    const [row] = await sql`select token_hash, expires_at - created_at as ttl from sessions`;
    expect(Buffer.from(row.token_hash).equals(createHash("sha256").update(token).digest())).toBe(true);
    expect(Buffer.from(row.token_hash).toString("utf8")).not.toContain(token);
    expect(row.ttl).toBe("30 days");
  });

  it("looks up a valid session and returns the fresh user row (role read each time, FR-017)", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
    const { token } = await createSession(u.id);
    let s = await lookupSession(token);
    expect(s).toMatchObject({ ok: true, user: { id: u.id, name: "Ada Fake", role: "user", status: "active" } });
    await sql`update users set role = 'admin' where id = ${u.id}`;
    s = await lookupSession(token);
    expect(s).toMatchObject({ ok: true, user: { role: "admin" } });
  });

  it("refuses an unknown token with expired", async () => {
    expect(await lookupSession("nope")).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an expired session with expired", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    const { token } = await createSession(u.id);
    await sql`update sessions set expires_at = now() - interval '1 second'`;
    expect(await lookupSession(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a revoked session and a deactivated user's session with removed (FR-007)", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    const a = await createSession(u.id);
    const b = await createSession(u.id);
    await revokeAllSessions(u.id);
    expect(await lookupSession(a.token)).toEqual({ ok: false, reason: "removed" });
    expect(await lookupSession(b.token)).toEqual({ ok: false, reason: "removed" });

    const v = await makeUser({ email: "linus@barnacle.ai" });
    const c = await createSession(v.id);
    await sql`update users set status = 'deactivated' where id = ${v.id}`;
    expect(await lookupSession(c.token)).toEqual({ ok: false, reason: "removed" });
  });

  it("refreshes last_seen_at and expires_at at most once an hour (FR-006)", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    const { token } = await createSession(u.id);
    await sql`update sessions set last_seen_at = now() - interval '30 minutes', expires_at = now() + interval '29 days'`;
    await lookupSession(token);
    let [row] = await sql`select now() - last_seen_at > interval '29 minutes' as stale from sessions`;
    expect(row.stale).toBe(true);

    await sql`update sessions set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'`;
    await lookupSession(token);
    [row] = await sql`select now() - last_seen_at < interval '1 minute' as fresh, expires_at > now() + interval '29 days' as extended from sessions`;
    expect(row).toEqual({ fresh: true, extended: true });
  });

  it("sign-out ends only the current session (clarification: only the current browser)", async () => {
    const u = await makeUser({ email: "ada@barnacle.ai" });
    const a = await createSession(u.id);
    const b = await createSession(u.id);
    await endSession(a.token);
    expect(await count("sessions")).toBe(1);
    expect(await lookupSession(a.token)).toEqual({ ok: false, reason: "expired" });
    expect((await lookupSession(b.token)).ok).toBe(true);
  });
});
