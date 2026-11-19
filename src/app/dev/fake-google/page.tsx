// Fake Google account chooser, for development and tests only (FR-024, FR-026).
import { notFound } from "next/navigation";
import { Wordmark } from "@/app/Wordmark";
import { isSafeNext } from "@/server/auth/rules";
import { sql } from "@/server/db";
import { appBaseUrl, isFakeAllowed } from "@/server/env";
import { fakeCancel, fakeSignIn } from "./actions";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function FakeGooglePage({ searchParams }: Props) {
  const next = isSafeNext((await searchParams).next, appBaseUrl());
  if (!isFakeAllowed()) notFound();
  const users = await sql<{ email: string; name: string }[]>`
    select email, name from users order by status = 'active' desc, lower(name)`;

  return (
    <main className="outside">
      <div className="panel">
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> FAKE GOOGLE LOGIN · DEVELOPMENT AND TEST ONLY
        </div>
        <h1>Choose an account</h1>
        <p className="lead">Stands in for Google. The CRM&apos;s sign-in rules still apply.</p>
        <ul className="chooser">
          {users.map((u) => (
            <li key={u.email}>
              <form action={fakeSignIn}>
                <input type="hidden" name="email" value={u.email} />
                <input type="hidden" name="name" value={u.name} />
                <input type="hidden" name="next" value={next} />
                <button type="submit">
                  <span className="n">{u.name}</span> <span className="e">{u.email}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={fakeSignIn} className="stack">
          <input type="hidden" name="next" value={next} />
          <label className="field">
            <span>Email</span>
            <input className="input" name="email" type="text" autoComplete="off" placeholder="someone@barnacle.ai" />
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" name="name" type="text" autoComplete="off" placeholder="Some One" />
          </label>
          <button className="btn solid" type="submit">
            [ CONTINUE ]
          </button>
        </form>
        <form action={fakeCancel} style={{ marginTop: 24 }}>
          <button className="btn" type="submit">
            [ CANCEL ]
          </button>
        </form>
      </div>
    </main>
  );
}
