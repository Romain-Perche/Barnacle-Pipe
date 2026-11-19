"use client";
// Organisation picker (research.md §7): filters the non-archived organisations the page embedded, and offers
// "Add organisation '<typed>'" when no name matches exactly. Posts organisationId or newOrganisationName.
import { useId, useState } from "react";

type Org = { id: number; name: string; archived: boolean };
type Choice = { id: number } | { newName: true } | null;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function OrganisationPicker({ organisations, initialId, initialNew }: { organisations: Org[]; initialId: string; initialNew: string }) {
  const start = organisations.find((o) => String(o.id) === initialId);
  const [text, setText] = useState(start?.name ?? initialNew);
  const [choice, setChoice] = useState<Choice>(start ? { id: start.id } : initialNew ? { newName: true } : null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const typed = text.trim();
  const exact = organisations.find((o) => same(o.name, typed) && !o.archived);
  const matches = typed === "" ? [] : organisations.filter((o) => !o.archived && o.name.toLowerCase().includes(typed.toLowerCase())).slice(0, 8);
  const chosen = choice && "id" in choice ? organisations.find((o) => o.id === choice.id) : undefined;
  const organisationId = chosen ? String(chosen.id) : choice === null && exact ? String(exact.id) : "";
  const newName = choice && "newName" in choice ? typed : "";

  function pick(next: Choice, name: string) {
    setChoice(next);
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
            setChoice(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && open && typed !== "") {
              e.preventDefault();
              if (matches[0]) pick({ id: matches[0].id }, matches[0].name);
              else pick({ newName: true }, typed);
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
              <button type="button" onClick={() => pick({ id: o.id }, o.name)}>
                {o.name}
              </button>
            </li>
          ))}
          {!exact && (
            <li role="option" aria-selected={newName !== ""}>
              <button type="button" onClick={() => pick({ newName: true }, typed)}>
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
