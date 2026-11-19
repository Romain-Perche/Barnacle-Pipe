// covers FR-010..FR-018, SC-003, SC-008, US2 scenarios 2–9, edge cases (spaces, own deactivate)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, lookupSession } from "@/server/auth/session";
import { closeDb, sql } from "@/server/db";
import { addUser, deactivate, listUsers, makeAdmin, reactivate, removeAdmin } from "@/server/users";
import { count, getUser, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let grace: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

async function changes() {
  return sql`select user_id::int as user_id, actor_id::int as actor_id, action from user_changes order by id`;
}

describe("addUser", () => {
  it("adds a trimmed, lowercased barnacle.ai user as an active User named after the local part", async () => {
    expect(await addUser(ada.id, "  JD@barnacle.ai  ")).toEqual({ ok: true });
    const jd = await getUser("jd@barnacle.ai");
    expect(jd).toMatchObject({ name: "jd", role: "user", status: "active", added_by: ada.id, last_sign_in_at: null });
    expect(await changes()).toEqual([{ user_id: jd.id, actor_id: ada.id, action: "added" }]);
  });

  it.each(["me@gmail.com", "x@barnacle.ai.evil.com", "", "   ", "jd@sub.barnacle.ai"])("refuses %j with invalid_domain", async (email) => {
    expect(await addUser(ada.id, email)).toEqual({ ok: false, code: "invalid_domain" });
    expect(await count("users")).toBe(3);
  });

  it("refuses an existing address in any case with duplicate", async () => {
    await addUser(ada.id, "jd@barnacle.ai");
    expect(await addUser(ada.id, "JD@barnacle.ai")).toEqual({ ok: false, code: "duplicate" });
    expect(await count("users")).toBe(4);
  });
});

describe("roles", () => {
  it("makes a user admin and removes it again", async () => {
    expect(await makeAdmin(ada.id, linus.id)).toEqual({ ok: true });
    expect((await getUser("linus@barnacle.ai")).role).toBe("admin");
    expect(await removeAdmin(ada.id, linus.id)).toEqual({ ok: true });
    expect((await getUser("linus@barnacle.ai")).role).toBe("user");
    expect((await changes()).map((c) => c.action)).toEqual(["made_admin", "admin_removed"]);
  });

  it("lets an admin remove their own rights when another active admin exists", async () => {
    expect(await removeAdmin(ada.id, ada.id)).toEqual({ ok: true });
    expect((await getUser("ada@barnacle.ai")).role).toBe("user");
  });

  it("refuses to remove the last active admin's rights (US2-8)", async () => {
    await sql`update users set status = 'deactivated' where id = ${grace.id}`;
    expect(await removeAdmin(ada.id, ada.id)).toEqual({ ok: false, code: "last_admin" });
    expect((await getUser("ada@barnacle.ai")).role).toBe("admin");
    expect(await changes()).toEqual([]);
  });

  it("two concurrent demotions of the last two admins leave one active admin (SC-008)", async () => {
    const results = await Promise.all([removeAdmin(ada.id, grace.id), removeAdmin(grace.id, ada.id)]);
    const [row] = await sql`select count(*)::int as n from users where role = 'admin' and status = 'active'`;
    expect(row.n).toBe(1);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.code)).toEqual([expect.stringMatching(/^(forbidden|last_admin)$/)]);
  });
});

describe("status", () => {
  it("deactivates a user and revokes all their sessions (US2-6, FR-007)", async () => {
    const a = await createSession(linus.id);
    const b = await createSession(linus.id);
    expect(await deactivate(ada.id, linus.id)).toEqual({ ok: true });
    expect((await getUser("linus@barnacle.ai")).status).toBe("deactivated");
    expect(await lookupSession(a.token)).toEqual({ ok: false, reason: "removed" });
    expect(await lookupSession(b.token)).toEqual({ ok: false, reason: "removed" });
    expect(await changes()).toEqual([{ user_id: linus.id, actor_id: ada.id, action: "deactivated" }]);
  });

  it("refuses to deactivate yourself (FR-015)", async () => {
    expect(await deactivate(ada.id, ada.id)).toEqual({ ok: false, code: "self_deactivate" });
    expect((await getUser("ada@barnacle.ai")).status).toBe("active");
  });

  it("lets an admin deactivate another admin; the acting admin remains", async () => {
    expect(await deactivate(ada.id, grace.id)).toEqual({ ok: true });
    const [row] = await sql`select count(*)::int as n from users where role = 'admin' and status = 'active'`;
    expect(row.n).toBe(1);
  });

  it("the only active admin can neither deactivate themselves nor drop their rights (US2-8)", async () => {
    await sql`update users set status = 'deactivated' where id = ${grace.id}`;
    expect(await deactivate(ada.id, ada.id)).toEqual({ ok: false, code: "self_deactivate" });
    expect(await removeAdmin(ada.id, ada.id)).toEqual({ ok: false, code: "last_admin" });
    expect(await getUser("ada@barnacle.ai")).toMatchObject({ role: "admin", status: "active" });
  });

  it("reactivates with the role the user had before (US2-7)", async () => {
    await deactivate(ada.id, grace.id);
    expect(await reactivate(ada.id, grace.id)).toEqual({ ok: true });
    expect(await getUser("grace@barnacle.ai")).toMatchObject({ role: "admin", status: "active" });
    expect((await changes()).map((c) => c.action)).toEqual(["deactivated", "reactivated"]);
  });
});

describe("access (FR-011, SC-003)", () => {
  it("refuses every action from a non-admin and changes nothing", async () => {
    const before = await sql`select * from users order by id`;
    for (const result of [
      await addUser(linus.id, "new@barnacle.ai"),
      await makeAdmin(linus.id, linus.id),
      await removeAdmin(linus.id, ada.id),
      await deactivate(linus.id, ada.id),
      await reactivate(linus.id, ada.id),
    ]) {
      expect(result).toEqual({ ok: false, code: "forbidden" });
    }
    expect(await sql`select * from users order by id`).toEqual(before);
    expect(await changes()).toEqual([]);
  });

  it("refuses actions from a deactivated admin", async () => {
    await sql`update users set status = 'deactivated' where id = ${grace.id}`;
    expect(await makeAdmin(grace.id, linus.id)).toEqual({ ok: false, code: "forbidden" });
  });
});

describe("listUsers", () => {
  it("lists active users first, then by name", async () => {
    await makeUser({ email: "alan@barnacle.ai", name: "alan", status: "deactivated" });
    await makeUser({ email: "bob@barnacle.ai", name: "bob" });
    expect((await listUsers()).map((u) => u.email)).toEqual([
      "ada@barnacle.ai",
      "bob@barnacle.ai",
      "grace@barnacle.ai",
      "linus@barnacle.ai",
      "alan@barnacle.ai",
    ]);
  });
});
