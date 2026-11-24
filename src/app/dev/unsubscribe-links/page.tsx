// SF-121: every person's unsubscribe link and List-Unsubscribe headers, for development and tests only (FR-017):
// the way to reach /unsubscribe/<token> before campaign sending exists. 404 anywhere else.
import { notFound } from "next/navigation";
import { Wordmark } from "@/app/Wordmark";
import { isFakeAllowed } from "@/server/env";
import { listUnsubscribeLinks } from "@/server/records/unsubscribe";

export const dynamic = "force-dynamic";

export default async function UnsubscribeLinksPage() {
  if (!isFakeAllowed()) notFound();
  const people = await listUnsubscribeLinks();

  return (
    <main className="outside">
      <div className="panel" style={{ maxWidth: "none" }}>
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> UNSUBSCRIBE LINKS · DEVELOPMENT AND TEST ONLY
        </div>
        <h1>Unsubscribe links</h1>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Page link</th>
              <th>List-Unsubscribe</th>
              <th>List-Unsubscribe-Post</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <a href={p.links.pageUrl}>{p.links.pageUrl}</a>
                </td>
                <td>
                  <code>{p.links.listUnsubscribe}</code>
                </td>
                <td>
                  <code>{p.links.listUnsubscribePost}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
