// The fake Google consent screen for Gmail (SF-118 research.md §14, FR-018), development and tests only: the account
// (pre-filled from login_hint), the asked permissions as ticked boxes (SF-124: Calendar's too when Calendar sync is on), [ ALLOW ] and [ CANCEL ]. 404 unless fakes are
// allowed and Gmail runs on the fake. Both buttons post a plain form to ./answer (a 303 to the callback).
import { notFound } from "next/navigation";
import { Wordmark } from "@/app/Wordmark";
import { appBaseUrl, gmailConfig, isFakeAllowed } from "@/server/env";
import { askedScopes, CALENDAR_SCOPE } from "@/server/gmail/rules";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.modify": "Read, change and send your email",
  "https://www.googleapis.com/auth/gmail.send": "Send email as you",
  [CALENDAR_SCOPE]: "See, create, change and delete events on calendars you own",
};

export default async function FakeGmailConsentPage({ searchParams }: Props) {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake") notFound();
  const q = await searchParams;
  const redirectUri = one(q.redirect_uri);
  if (redirectUri !== `${appBaseUrl()}/settings/gmail/callback`) notFound();
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "access_type"] as const;
  return (
    <main className="outside">
      <div className="panel">
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> FAKE GOOGLE · GMAIL ACCESS · DEVELOPMENT AND TEST ONLY
        </div>
        <h1>Barnacle CRM wants to access your Google Account</h1>
        <form action="/dev/fake-google/gmail/answer" method="post" className="stack">
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={one(q[k])} />
          ))}
          <label className="field">
            <span>Account</span>
            <input className="input" name="email" type="text" autoComplete="off" defaultValue={one(q.login_hint)} />
          </label>
          {askedScopes().map((scope) => (
            <label key={scope} className="check">
              <input type="checkbox" name={`scope:${scope}`} defaultChecked /> {LABELS[scope]}
            </label>
          ))}
          <button className="btn solid" type="submit" name="decision" value="allow">
            [ ALLOW ]
          </button>
        </form>
        <form action="/dev/fake-google/gmail/answer" method="post" style={{ marginTop: 24 }}>
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={one(q[k])} />
          ))}
          <button className="btn" type="submit" name="decision" value="cancel">
            [ CANCEL ]
          </button>
        </form>
      </div>
    </main>
  );
}
