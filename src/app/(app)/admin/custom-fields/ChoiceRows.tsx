// The choices of a choice field in its edit box (SF-115 design B): each offered choice with ↑ ↓, a name input +
// [ RENAME ] and [ REMOVE ], then "New choice" + [ ADD ]. Plain server-action forms that come back to the same box.
import type { CustomField } from "@/server/custom-fields/rules";
import { addCustomChoice, moveCustomChoice, removeCustomChoice, renameCustomChoice } from "./actions";

function Hidden({ values }: { values: Record<string, string | number> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export function ChoiceRows({ field, tab, error }: { field: CustomField; tab: string; error?: string }) {
  const offered = field.choices.filter((c) => !c.removed);
  const base = { kind: tab, fieldId: field.id };
  return (
    <div className="field choices">
      <span>Choices</span>
      {error && (
        <p className="ferr" role="alert">
          {error}
        </p>
      )}
      <ul className="choice-rows">
        {offered.map((c, i) => (
          <li key={c.id}>
            <form action={moveCustomChoice}>
              <Hidden values={{ ...base, id: c.id, dir: "up" }} />
              <button className="btn link" type="submit" aria-label={`Move ${c.name} up`} disabled={i === 0}>
                ↑
              </button>
            </form>
            <form action={moveCustomChoice}>
              <Hidden values={{ ...base, id: c.id, dir: "down" }} />
              <button className="btn link" type="submit" aria-label={`Move ${c.name} down`} disabled={i === offered.length - 1}>
                ↓
              </button>
            </form>
            <form action={renameCustomChoice} className="inline">
              <Hidden values={{ ...base, id: c.id }} />
              <input className="input" name="name" type="text" defaultValue={c.name} aria-label={`Name of ${c.name}`} maxLength={80} />
              <button className="btn link" type="submit" aria-label={`Rename ${c.name}`}>
                [ RENAME ]
              </button>
            </form>
            <form action={removeCustomChoice}>
              <Hidden values={{ ...base, id: c.id }} />
              <button className="btn link red" type="submit" aria-label={`Remove ${c.name}`}>
                [ REMOVE ]
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addCustomChoice} className="addrow">
        <Hidden values={base} />
        <input className="input" name="name" type="text" aria-label="New choice" placeholder="New choice" autoComplete="off" maxLength={80} />
        <button className="btn" type="submit">
          [ ADD ]
        </button>
      </form>
    </div>
  );
}
