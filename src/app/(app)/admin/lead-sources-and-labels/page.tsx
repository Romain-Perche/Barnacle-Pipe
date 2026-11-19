// Lead sources and labels (US6): admins add, rename and remove the entries everyone picks from.
import { requireAdmin } from "@/server/auth/session";
import { messageFor } from "@/server/messages";
import { listChoices } from "@/server/records/choices";
import { Forbidden } from "../../Forbidden";
import { addLabel, addLeadSource, removeLabel, removeLeadSource, renameLabel, renameLeadSource } from "./actions";

const PAGE_ERRORS = new Set(["choice_exists", "choice_name_required"]);
type Action = (fd: FormData) => Promise<void>;

function ChoiceList({ title, noun, items, add, rename, remove }: { title: string; noun: string; items: { id: number; name: string }[]; add: Action; rename: Action; remove: Action }) {
  return (
    <section aria-label={title} className="choice-list">
      <div className="label sect">
        <span className="c">//</span> {title.toUpperCase()}
      </div>
      <form action={add} className="addrow">
        <input className="input" name="name" type="text" aria-label={`New ${noun}`} placeholder={`New ${noun}`} autoComplete="off" />
        <button className="btn solid" type="submit">
          [ ADD ]
        </button>
      </form>
      {items.length > 0 && (
        <table className="users">
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <form action={rename} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <input className="input" name="name" type="text" defaultValue={c.name} aria-label={`Name of ${c.name}`} />
                    <button className="btn link" type="submit" aria-label={`Rename ${c.name}`}>
                      [ RENAME ]
                    </button>
                  </form>
                </td>
                <td className="acts">
                  <form action={remove}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn link red" type="submit" aria-label={`Remove ${c.name}`}>
                      [ REMOVE ]
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function LeadSourcesAndLabelsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return <Forbidden />;
  const { error } = await searchParams;
  const message = error && PAGE_ERRORS.has(error) ? messageFor(error) : undefined;
  const [sources, labels] = await Promise.all([listChoices("lead_source"), listChoices("label")]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ADMIN
          </div>
          <h1>Lead sources and labels</h1>
        </div>
      </div>
      {message && (
        <p className="err" role="alert">
          {message}
        </p>
      )}
      <div className="grid2 top">
        <ChoiceList title="Lead sources" noun="lead source" items={sources} add={addLeadSource} rename={renameLeadSource} remove={removeLeadSource} />
        <ChoiceList title="Labels" noun="label" items={labels} add={addLabel} rename={renameLabel} remove={removeLabel} />
      </div>
    </>
  );
}
