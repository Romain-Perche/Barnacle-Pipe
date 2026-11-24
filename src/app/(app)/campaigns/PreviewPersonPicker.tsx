"use client";
// "// PREVIEW FOR" (SF-119 research.md §7): a search box that asks the server 250 ms after typing stops for the people the
// user can see (not archived, 20 at most), then asks for the chosen person's values. The choice lives only in this page.
import { useEffect, useId, useRef, useState } from "react";
import type { PreviewValues } from "@/server/campaigns/merge";
import type { PreviewPerson } from "@/server/campaigns/preview";
import { messages } from "@/server/messages";
import { findPreviewPeople, previewPerson } from "./actions";

type Props = { chosen: { id: number; name: string } | null; onChoose: (person: { id: number; name: string } | null, values: PreviewValues | null) => void };

export function PreviewPersonPicker({ chosen, onChoose }: Props) {
  const [query, setQuery] = useState(chosen?.name ?? "");
  const [found, setFound] = useState<PreviewPerson[] | null>(null);
  const typed = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (!typed.current) return;
    const q = query.trim();
    if (q === "") {
      setFound(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      findPreviewPeople(q).then((people) => live && setFound(people), () => live && setFound([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  async function choose(p: PreviewPerson) {
    typed.current = false;
    setFound(null);
    setQuery(p.name);
    const values = await previewPerson(p.id);
    onChoose(values ? { id: p.id, name: p.name } : null, values);
    if (!values) setQuery("");
  }

  return (
    <div className="picker preview-picker">
      <input
        className="input"
        type="search"
        aria-label={messages.campaign_find_person}
        placeholder={messages.campaign_find_person}
        aria-controls={listId}
        value={query}
        maxLength={100}
        onChange={(e) => {
          typed.current = true;
          setQuery(e.target.value);
          if (chosen) onChoose(null, null);
        }}
      />
      {found && (
        <ul className="picker-list" id={listId}>
          {found.length === 0 && <li className="picker-none">{messages.campaign_no_people}</li>}
          {found.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => void choose(p)}>
                {p.name}
                {p.detail && <span className="em"> · {p.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
