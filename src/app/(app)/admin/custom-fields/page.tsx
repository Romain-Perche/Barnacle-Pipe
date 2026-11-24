// Custom fields (SF-115 design B): a tab per record kind with its number of fields, a table of the kind's fields (order,
// name, type, choices, in list) and the add / edit box or the delete confirmation over the page, opened from the address
// (`kind`, `field`, `delete`: fixed words and ids only; nothing from the address is shown).
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { countValues, fieldCounts, getField, listFields } from "@/server/custom-fields/fields";
import { KIND_OF_TAB, TYPE_LABELS, type KindTab } from "@/server/custom-fields/rules";
import { messageFor, messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { parseId } from "@/server/records/list-query";
import { Forbidden } from "../../Forbidden";
import { addCustomField, moveCustomField, updateCustomField } from "./actions";
import { ChoiceRows } from "./ChoiceRows";
import { FieldBox } from "./FieldBox";
import { FieldDeleteConfirm } from "./FieldDeleteConfirm";

const PAGE = "/admin/custom-fields";
const TABS: { tab: KindTab; label: string }[] = [
  { tab: "people", label: "People" },
  { tab: "organisations", label: "Organisations" },
  { tab: "deals", label: "Deals" },
];
const PAGE_ERRORS = new Set(["custom_fields_limit", "custom_list_limit", "custom_choices_limit", "custom_choice_last"]);

type Params = { kind?: string | string[]; field?: string | string[]; delete?: string | string[]; error?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomFieldsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return <Forbidden />;
  const params = await searchParams;
  const rawTab = first(params.kind);
  const tab: KindTab = rawTab && Object.hasOwn(KIND_OF_TAB, rawTab) ? (rawTab as KindTab) : "people";
  const kind = KIND_OF_TAB[tab];
  const back = `${PAGE}?kind=${tab}`;
  const errorCode = first(params.error);
  const error = errorCode && PAGE_ERRORS.has(errorCode) ? messageFor(errorCode) : undefined;
  const [fields, counts, deleted, choiceError] = await Promise.all([
    listFields(kind), fieldCounts(), readFlash(["custom_field_deleted"]), readFlash(["custom_choice_error"]),
  ]);

  const fieldParam = first(params.field);
  const editId = fieldParam === "new" ? null : parseId(fieldParam);
  const editing = editId === null ? null : await getField(editId);
  const deleteId = parseId(first(params.delete));
  const deleting = deleteId === null ? null : await getField(deleteId);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ADMIN
          </div>
          <h1>Custom fields</h1>
        </div>
        <Link className="btn solid" href={`${back}&field=new`} scroll={false}>
          [ ADD FIELD ]
        </Link>
      </div>
      {deleted && (
        <p className="notice" role="status">
          {deleted.text}
        </p>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <nav className="tabs cf-tabs" aria-label="Record kinds">
        {TABS.map((t) => (
          <Link key={t.tab} href={`${PAGE}?kind=${t.tab}`} className={t.tab === tab ? "on" : undefined} aria-current={t.tab === tab ? "page" : undefined}>
            {t.label} · {counts[KIND_OF_TAB[t.tab]]}
          </Link>
        ))}
      </nav>
      {fields.length === 0 ? (
        <p className="muted">{messages.custom_fields_empty}</p>
      ) : (
        <table className="users cf-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Name</th>
              <th>Type</th>
              <th>Choices</th>
              <th>In list</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const offered = f.choices.filter((c) => !c.removed).map((c) => c.name);
              return (
                <tr key={f.id}>
                  <td className="acts order">
                    <form action={moveCustomField}>
                      <input type="hidden" name="kind" value={tab} />
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button className="btn link" type="submit" aria-label={`Move ${f.name} up`} disabled={i === 0}>
                        ↑
                      </button>
                    </form>
                    <form action={moveCustomField}>
                      <input type="hidden" name="kind" value={tab} />
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button className="btn link" type="submit" aria-label={`Move ${f.name} down`} disabled={i === fields.length - 1}>
                        ↓
                      </button>
                    </form>
                  </td>
                  <td className="nm">{f.name}</td>
                  <td className="typ">{TYPE_LABELS[f.type]}</td>
                  <td className="chips">{offered.length > 0 ? offered.join(", ") : "—"}</td>
                  <td>{f.inList ? "Yes" : "No"}</td>
                  <td className="acts">
                    <Link className="btn link" href={`${back}&field=${f.id}`} scroll={false} aria-label={`Edit ${f.name}`}>
                      [ EDIT ]
                    </Link>
                    <Link className="btn link red" href={`${back}&delete=${f.id}`} scroll={false} aria-label={`Delete ${f.name}`}>
                      [ DELETE ]
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {fieldParam === "new" && <FieldBox action={addCustomField} kind={kind} tab={tab} back={back} />}
      {editing && editing.kind === kind && (
        <FieldBox action={updateCustomField} kind={kind} tab={tab} back={back} field={editing} key={`${editing.id}-${editing.name}-${editing.inList}`}>
          {(editing.type === "single_choice" || editing.type === "multiple_choice") && <ChoiceRows field={editing} tab={tab} error={choiceError?.text} />}
        </FieldBox>
      )}
      {deleting && deleting.kind === kind && !editing && (
        <FieldDeleteConfirm id={deleting.id} name={deleting.name} kind={kind} tab={tab} count={await countValues(deleting.id)} back={back} />
      )}
    </>
  );
}
