// SF-121: the public unsubscribe page (design A: the sign-in page's twin). No sign-in: the token in the address is the
// only authority. Opening it changes nothing (FR-004); [ UNSUBSCRIBE ] posts to ./confirm. It shows no name, no email
// and no link into the app, never offers to subscribe again, and reads only `error=unavailable` from the query.
import type { Metadata } from "next";
import { Wordmark } from "@/app/Wordmark";
import { messages } from "@/server/messages";
import { unsubscribePageState } from "@/server/records/unsubscribe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string | string[] }> };

export default async function UnsubscribePage({ params, searchParams }: Props) {
  const { token } = await params;
  const unavailable = (await searchParams).error === "unavailable";
  const state = await unsubscribePageState(token);

  return (
    <main className="outside">
      <div className="panel">
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> EMAIL PREFERENCES
        </div>
        <h1>Unsubscribe</h1>
        {state === "ready" && (
          <>
            <p className="lead">{messages.unsubscribe_lead}</p>
            {unavailable && (
              <p className="err" role="alert">
                {messages.unsubscribe_error}
              </p>
            )}
            {/* Only reached with a token of the right shape: 64 hex characters. */}
            <form method="post" action={`/unsubscribe/${token}/confirm`}>
              <button className="btn primary" type="submit">
                [ UNSUBSCRIBE ]
              </button>
            </form>
          </>
        )}
        {state === "done" && (
          <p className="notice" role="status">
            {messages.unsubscribe_done}
          </p>
        )}
        {state === "not_found" && (
          <p className="err" role="alert">
            {messages.unsubscribe_invalid}
          </p>
        )}
        {state === "error" && (
          <p className="err" role="alert">
            {messages.unsubscribe_error}
          </p>
        )}
      </div>
    </main>
  );
}
