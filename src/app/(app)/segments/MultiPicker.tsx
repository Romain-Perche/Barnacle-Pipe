"use client";
// A filtering multi-select (SF-120): type to narrow the options, pick one or more, each chosen value a removable chip.
// Posts one hidden `name` input per chosen value. Only ids among `options` are ever shown (a made-up id in the values
// is not), and names are text nodes.
import { useId, useMemo, useState } from "react";

type Option = { id: string; name: string };
const SHOWN = 30;

export function MultiPicker({ name, label, options, initial }: { name: string; label: string; options: Option[]; initial: string[] }) {
  const [chosen, setChosen] = useState(() => initial.filter((v, i) => options.some((o) => o.id === v) && initial.indexOf(v) === i));
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    return options.filter((o) => !chosen.includes(o.id) && (t === "" || o.name.toLowerCase().includes(t))).slice(0, SHOWN);
  }, [options, chosen, text]);
  const pick = (id: string) => {
    setChosen([...chosen, id]);
    setText("");
  };
  return (
    <div className="picker multipicker">
      {chosen.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="chips">
        {chosen.map((id) => (
          <span key={id} className="chip">
            {byId.get(id)?.name}
            <button type="button" className="chip-x" aria-label={`Remove ${byId.get(id)?.name ?? ""}`} onClick={() => setChosen(chosen.filter((c) => c !== id))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="input"
          aria-label={label}
          aria-controls={listId}
          aria-expanded={open}
          role="combobox"
          placeholder="Type to find…"
          value={text}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches[0]) pick(matches[0].id);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="picker-list" id={listId} role="listbox">
          {matches.map((o) => (
            <li key={o.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.id)}>
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
