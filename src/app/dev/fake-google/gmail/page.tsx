// The fake Google consent screen for Gmail (SF-118 research.md §14, FR-018), development and tests only: the account
// (pre-filled from login_hint), the two permissions as ticked boxes, [ ALLOW ] and [ CANCEL ]. 404 unless fakes are
// allowed and Gmail runs on the fake. Both buttons post a plain form to ./answer (a 303 to the callback).
import { notFound } from "next/navigation";
import { Wordmark } from "@/app/Wordmark";
import { appBaseUrl, gmailConfig, isFakeAllowed } from "@/server/env";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const BOXES = [
  { scope: "https://www.googleapis.com/auth/gmail.modify", label: "Read, change and send your email" },
  { scope: "https://www.googleapis.com/auth/gmail.send", label: "Send email as you" },
];

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
          {BOXES.map((b) => (
            <label key={b.scope} className="check">
              <input type="checkbox" name={`scope:${b.scope}`} defaultChecked /> {b.label}
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
