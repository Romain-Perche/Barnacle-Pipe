// What the sign-in page shows (contracts/routes.md). Preview is decided before any database access.
import { isSafeNext } from "@/server/auth/rules";
import { sql } from "@/server/db";
import { appBaseUrl, firstAdminEmail, isFakeAllowed, isPreview } from "@/server/env";
import { messageFor } from "@/server/messages";

export type SignInState =
  | { kind: "notice"; code: "preview" | "setup" }
  | { kind: "form"; error: string | undefined; fake: boolean; next: string };

const SIGN_IN_ERRORS = new Set(["domain", "not_allowed", "removed", "cancelled"]);

async function countUsers(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  return row.n;
}

export async function signInPageState(
  params: { error?: string; next?: string },
  userCount: () => Promise<number> = countUsers,
): Promise<SignInState> {
  if (isPreview()) return { kind: "notice", code: "preview" };
  if (firstAdminEmail() === null && (await userCount()) === 0) return { kind: "notice", code: "setup" };
  const error = params.error && SIGN_IN_ERRORS.has(params.error) ? messageFor(params.error) : undefined;
  return { kind: "form", error, fake: isFakeAllowed(), next: isSafeNext(params.next, appBaseUrl()) };
}
