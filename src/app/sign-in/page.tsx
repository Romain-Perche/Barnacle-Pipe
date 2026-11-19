import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/app/Wordmark";
import { SESSION_COOKIE } from "@/server/auth/cookie";
import { isSafeNext } from "@/server/auth/rules";
import { lookupSession } from "@/server/auth/session";
import { appBaseUrl, isPreview } from "@/server/env";
import { messages } from "@/server/messages";
import { signInPageState } from "@/server/sign-in-page";

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && !isPreview() && (await lookupSession(token)).ok) redirect(isSafeNext(params.next, appBaseUrl()));

  const state = await signInPageState(params);
  const nextQuery = state.kind === "form" && state.next !== "/" ? `?next=${encodeURIComponent(state.next)}` : "";

  return (
    <main className="outside">
      <div className="panel">
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> CRM
        </div>
        <h1>Sign in</h1>
        {state.kind === "notice" ? (
          <p className="notice" role="status">
            {messages[state.code]}
          </p>
        ) : (
          <>
            <p className="lead">Use your barnacle.ai Google account.</p>
            {state.error && (
              <p className="err" role="alert">
                {state.error}
              </p>
            )}
            <div className="stack">
              <a className="btn primary" href={`/auth/google/start${nextQuery}`}>
                Sign in with Google
              </a>
              {state.fake && (
                <Link className="btn link" href={`/dev/fake-google${nextQuery}`}>
                  [ FAKE GOOGLE LOGIN ]
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
