"use client";
// Organisation picker (research.md §7): filters the non-archived organisations the page embedded. What the
// field shows is what is saved: a chosen option, else the non-archived organisation whose name matches the
// text (ignoring case and outer spaces), else the text as a new organisation (with a hint). Empty: none.
// Posts organisationId or newOrganisationName; the server matches names the same way.
import { useId, useState } from "react";

type Org = { id: number; name: string; archived: boolean };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function OrganisationPicker({ organisations, initialId, initialNew }: { organisations: Org[]; initialId: string; initialNew: string }) {
  const start = organisations.find((o) => String(o.id) === initialId);
  const [text, setText] = useState(start?.name ?? initialNew);
  // An explicit choice (an option, or the person's current organisation, which may be archived).
  const [chosenId, setChosenId] = useState<number | null>(start?.id ?? null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const typed = text.trim();
  const exact = typed === "" ? undefined : organisations.find((o) => same(o.name, typed) && !o.archived);
  const matches = typed === "" ? [] : organisations.filter((o) => !o.archived && o.name.toLowerCase().includes(typed.toLowerCase())).slice(0, 8);
  const chosen = chosenId === null ? undefined : organisations.find((o) => o.id === chosenId);
  const linked = chosen ?? exact;
  const organisationId = linked ? String(linked.id) : "";
  const newName = !linked ? typed : "";

  function pick(org: Org | null, name: string) {
    setChosenId(org?.id ?? null);
    setText(name);
    setOpen(false);
  }

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="picker-row">
        <input
          className="input"
          type="text"
          role="combobox"
          aria-label="Organisation"
          aria-expanded={open && typed !== ""}
          aria-controls={listId}
          autoComplete="off"
          placeholder="Type to find or add an organisation"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChosenId(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && open && typed !== "") {
              e.preventDefault();
              // Only an exact name picks an organisation; anything else stays as typed, a new name.
              if (exact) pick(exact, exact.name);
              else setOpen(false);
            }
          }}
        />
        {text !== "" && (
          <button type="button" className="btn link" onClick={() => pick(null, "")}>
            [ CLEAR ]
          </button>
        )}
      </div>
      {chosen?.archived && <span className="badge off tag">Archived</span>}
      {newName && <p className="hint">A new organisation &ldquo;{newName}&rdquo; will be added.</p>}
      {open && typed !== "" && (
        <ul className="picker-list" id={listId} role="listbox" aria-label="Organisations">
          {matches.map((o) => (
            <li key={o.id} role="option" aria-selected={organisationId === String(o.id)}>
              <button type="button" onClick={() => pick(o, o.name)}>
                {o.name}
              </button>
            </li>
          ))}
          {!exact && (
            <li role="option" aria-selected={newName !== ""}>
              <button type="button" onClick={() => pick(null, typed)}>
                Add organisation &apos;{typed}&apos;
              </button>
            </li>
          )}
        </ul>
      )}
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="newOrganisationName" value={newName} />
    </div>
  );
}
