"use client";
// "Referred by" picker (SF-114 research.md §12), built like PersonPicker: type to find one of the offered ambassadors
// the page embedded (name and "<organisation> · <first email>", so two with the same name differ), or [ CLEAR ].
// Posts hidden `referredBy`: "", the id, or "keep" while a referrer hidden from the user is left as it is (their id
// never reaches the page). The server re-checks the choice inside the save.
import { useId, useState } from "react";
import { messages } from "@/server/messages";

type Option = { id: number; name: string; detail: string };
export type CurrentReferrer = { id: number; name: string } | "hidden" | null;

type Props = {
  options: Option[];
  // The record's current referrer, shown even when no longer offered.
  current: CurrentReferrer;
  // Uncontrolled: the posted value to start from; controlled: `value` and `onChange` (the deal form's pre-fill).
  initial?: string;
  value?: string;
  onChange?: (value: string) => void;
};

export function ReferrerPicker({ options, current, initial = "", value: controlled, onChange }: Props) {
  const [own, setOwn] = useState(initial);
  const value = controlled ?? own;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();

  const set = (next: string) => {
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
    setText("");
    setOpen(false);
  };
  const named = (id: string) =>
    options.find((o) => String(o.id) === id) ?? (current && current !== "hidden" && String(current.id) === id ? { ...current, detail: "" } : undefined);
  const chosen = value === "keep" ? null : named(value);
  const typed = text.trim().toLowerCase();
  const matches = typed === "" ? options.slice(0, 8) : options.filter((o) => o.name.toLowerCase().includes(typed)).slice(0, 8);

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      {value === "keep" || chosen ? (
        <div className="picker-row">
          <span className="chosen">
            {value === "keep" ? messages.referred_by_private : chosen!.name}
            {chosen?.detail ? <span className="hint"> {chosen.detail}</span> : null}
          </span>
          <button type="button" className="btn link" onClick={() => set("")} aria-label="Clear Referred by">
            [ CLEAR ]
          </button>
        </div>
      ) : (
        <div className="picker-row">
          <input
            className="input"
            type="text"
            role="combobox"
            aria-label="Referred by"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            autoComplete="off"
            placeholder="Type to find an ambassador"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                e.preventDefault();
                const exact = options.find((o) => o.name.toLowerCase() === typed);
                if (exact) set(String(exact.id));
              }
            }}
          />
        </div>
      )}
      {open && !chosen && value !== "keep" && matches.length > 0 && (
        <ul className="picker-list" id={listId} role="listbox" aria-label="Ambassadors">
          {matches.map((o) => (
            <li key={o.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => set(String(o.id))}>
                {o.name}
                {o.detail && <span className="hint"> {o.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* An id that is neither offered nor the current referrer (a refused request) is not sent again. */}
      <input type="hidden" name="referredBy" value={value === "keep" || chosen ? value : ""} />
    </div>
  );
}
