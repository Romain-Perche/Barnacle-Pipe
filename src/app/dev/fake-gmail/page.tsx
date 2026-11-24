// The fake Gmail mailbox (SF-118 research.md §14, FR-018), development and tests only: pick a user, put a received or
// sent message in their fake mailbox (with or without delivering its notice), run the 15-minute check, refuse the key,
// fail renewals, forget history; see the mailbox's messages with their labels, the key's status and the watch's.
// 404 unless fakes are allowed and Gmail runs on the fake.
import { notFound } from "next/navigation";
import { sql } from "@/server/db";
import { gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { forgetFakeHistory, putFakeMessage, refuseFakeKey, runFakeCheck, toggleFakeRenewals } from "./actions";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const DONE: Record<string, string> = {
  delivered: "Message put in and its notice delivered.",
  dropped: "Message put in; its notice was dropped.",
  no_watch: "Message put in; no notice (no active watch).",
  checked: "The 15-minute check ran.",
  refused: "Google no longer accepts this user's key.",
  renewals: "Renewals switched.",
  forgot: "Gmail forgot its history.",
  no_user: "Pick a user first.",
};

export default async function FakeGmailPage({ searchParams }: Props) {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake") notFound();
  const q = await searchParams;
  const users = await sql<{ email: string; name: string }[]>`select email, name from users order by lower(name)`;
  const user = users.find((u) => u.email === one(q.user).toLowerCase())?.email ?? "";
  const fake = fakeGmail();
  const box = user ? fake.mailbox(user) : [];
  const watch = user ? fake.watchOf(user) : null;
  const head = (m: (typeof box)[number], name: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const threads = [...new Set(box.map((m) => m.threadId))];
  const userField = <input type="hidden" name="user" value={user} />;
  return (
    <main className="main" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="label">
        <span className="c">//</span> FAKE GMAIL · DEVELOPMENT AND TEST ONLY
      </div>
      <h1>Fake mailbox</h1>
      {DONE[one(q.done)] && <p className="notice">{DONE[one(q.done)]}</p>}
      <form method="get" className="form-acts">
        <select className="input" name="user" defaultValue={user}>
          <option value="">Pick a user</option>
          {users.map((u) => (
            <option key={u.email} value={u.email}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          [ OPEN ]
        </button>
      </form>
      {user && (
        <>
          <p className="hint">
            Key: {fake.keyStatusOf(user)} · Watch: {watch ? `active until ${new Date(watch.expiration).toISOString()}` : "none"} · Renewals:{" "}
            {fake.isFailingWatch() ? "failing" : "working"}
          </p>
          <div className="form-acts">
            <form action={runFakeCheck}>
              {userField}
              <button className="btn solid" type="submit">
                [ RUN THE 15-MINUTE CHECK ]
              </button>
            </form>
            <form action={refuseFakeKey}>
              {userField}
              <button className="btn" type="submit">
                [ REFUSE THE KEY ]
              </button>
            </form>
            <form action={toggleFakeRenewals}>
              {userField}
              <button className="btn" type="submit">
                [ FAIL RENEWALS ]
              </button>
            </form>
            <form action={forgetFakeHistory}>
              {userField}
              <button className="btn" type="submit">
                [ FORGET HISTORY ]
              </button>
            </form>
          </div>
          <h2>Put in a message</h2>
          <form action={putFakeMessage} className="stack">
            {userField}
            <label className="field">
              <span>Received or sent</span>
              <select className="input" name="direction" defaultValue="received">
                <option value="received">Received</option>
                <option value="sent">Sent</option>
              </select>
            </label>
            {(["from", "to", "cc", "bcc", "subject"] as const).map((k) => (
              <label key={k} className="field">
                <span>{k === "cc" || k === "bcc" ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)}</span>
                <input className="input" name={k} type="text" autoComplete="off" />
              </label>
            ))}
            <label className="field">
              <span>Text</span>
              <textarea className="input" name="text" rows={3} />
            </label>
            <label className="field">
              <span>HTML</span>
              <textarea className="input" name="html" rows={2} />
            </label>
            <label className="field">
              <span>Attachments (one &quot;name:size&quot; per line)</span>
              <textarea className="input" name="attachments" rows={2} placeholder="contract.pdf:20971520" />
            </label>
            <label className="field">
              <span>Date offset in minutes (negative: earlier)</span>
              <input className="input" name="offset" type="number" defaultValue={0} />
            </label>
            <label className="field">
              <span>Label</span>
              <select className="input" name="label" defaultValue="INBOX">
                {["INBOX", "SPAM", "DRAFT", "TRASH"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Conversation</span>
              <select className="input" name="thread" defaultValue="">
                <option value="">New conversation</option>
                {threads.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" name="deliver" defaultChecked /> Deliver its notice
            </label>
            <button className="btn solid" type="submit">
              [ PUT IN THE MAILBOX ]
            </button>
          </form>
          <h2>Messages ({box.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th>Subject</th>
                <th>Labels</th>
                <th>Conversation</th>
              </tr>
            </thead>
            <tbody>
              {[...box].reverse().map((m) => (
                <tr key={m.id}>
                  <td>{new Date(Number(m.internalDate)).toISOString()}</td>
                  <td>{head(m, "from")}</td>
                  <td>{head(m, "to")}</td>
                  <td>{head(m, "subject")}</td>
                  <td>{m.labelIds.join(", ")}</td>
                  <td>{m.threadId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
