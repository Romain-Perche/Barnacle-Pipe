// The one sign-in path, used by real Google and by the fake Google login (FR-024).
import { decideSignIn, displayNameFor, normalizeEmail } from "@/server/auth/rules";
import { createSession } from "@/server/auth/session";
import { sql } from "@/server/db";
import { firstAdminEmail } from "@/server/env";

export type SignInInput = { email: string; name: string | null; emailVerified: boolean; hd: string | null };
export type SignInRefusal = "domain" | "removed" | "not_allowed";
export type SignInResult = { ok: true; token: string; userId: number } | { ok: false; code: SignInRefusal };

type Row = { id: number; status: "active" | "deactivated" };

export async function completeSignIn(input: SignInInput): Promise<SignInResult> {
  const email = normalizeEmail(input.email);
  const name = displayNameFor(email, input.name);
  const firstAdmin = firstAdminEmail();

  return sql.begin(async (tx) => {
    const find = async () => (await tx<Row[]>`select id::int as id, status from users where email = ${email}`)[0] ?? null;
    let user = await find();
    const decision = decideSignIn(input, user, firstAdmin);
    if (decision !== "ok" && decision !== "create_first_admin") return { ok: false, code: decision } as const;

    if (decision === "create_first_admin") {
      const [created] = await tx<Row[]>`
        insert into users (email, name, role, status) values (${email}, ${name}, 'admin', 'active')
        on conflict (email) do nothing returning id::int as id, status`;
      if (created) {
        await tx`insert into user_changes (user_id, actor_id, action) values (${created.id}, null, 'added')`;
        user = created;
      } else {
        // Another first sign-in won the race: apply the rules to the row it created.
        user = await find();
        const again = decideSignIn(input, user, firstAdmin);
        if (again !== "ok") return { ok: false, code: again === "create_first_admin" ? "not_allowed" : again } as const;
      }
    }

    const userId = user!.id;
    await tx`update users set name = ${name}, last_sign_in_at = now() where id = ${userId}`;
    await tx`delete from sessions where user_id = ${userId} and (expires_at <= now() or revoked_at is not null)`;
    const { token } = await createSession(userId, tx as unknown as typeof sql);
    return { ok: true, token, userId } as const;
  });
}
