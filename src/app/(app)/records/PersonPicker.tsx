"use client";
// Main person picker for a deal (SF-93 research.md §8), built like OrganisationPicker: filters the visible,
// non-archived people the page embedded. Only a picked person (or an exact name) is saved; no "add new".
// Posts personId; the server re-checks the person is visible to the user.
import { useId, useState } from "react";

type Person = { id: number; name: string; archived: boolean };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function PersonPicker({ people, initialId }: { people: Person[]; initialId: string }) {
  const start = people.find((p) => String(p.id) === initialId);
  const [text, setText] = useState(start?.name ?? "");
  const [chosenId, setChosenId] = useState<number | null>(start?.id ?? null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const typed = text.trim();
  const exact = typed === "" ? undefined : people.find((p) => same(p.name, typed) && !p.archived);
  const matches = typed === "" ? [] : people.filter((p) => !p.archived && p.name.toLowerCase().includes(typed.toLowerCase())).slice(0, 8);
  const chosen = chosenId === null ? undefined : people.find((p) => p.id === chosenId);
  const linked = chosen ?? exact;

  function pick(person: Person | null) {
    setChosenId(person?.id ?? null);
    setText(person?.name ?? "");
    setOpen(false);
  }

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="picker-row">
        <input
          className="input"
          type="text"
          role="combobox"
          aria-label="Person"
          aria-expanded={open && typed !== ""}
          aria-controls={listId}
          autoComplete="off"
          placeholder="Type to find a person"
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
              if (exact) pick(exact);
              else setOpen(false);
            }
          }}
        />
        {text !== "" && (
          <button type="button" className="btn link" onClick={() => pick(null)}>
            [ CLEAR ]
          </button>
        )}
      </div>
      {chosen?.archived && <span className="badge off tag">Archived</span>}
      {open && typed !== "" && matches.length > 0 && (
        <ul className="picker-list" id={listId} role="listbox" aria-label="People">
          {matches.map((p) => (
            <li key={p.id} role="option" aria-selected={linked?.id === p.id}>
              <button type="button" onClick={() => pick(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name="personId" value={linked ? String(linked.id) : ""} />
    </div>
  );
}
