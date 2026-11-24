"use client";
// [ INSERT MERGE TAG ] (SF-119 FR-008): the merge fields (built-ins, then people custom fields by current name) and an
// optional "If empty, show" text; the chosen tag goes in at the cursor of the last focused text field (the editor's
// onInsert). The toggle keeps the focus where it was, so the cursor is not lost.
import { useId, useState } from "react";
import { insertTag, type MergeField } from "@/server/campaigns/merge";
import { CAMPAIGN_LIMITS } from "@/server/campaigns/rules";
import { messages } from "@/server/messages";

export function MergeTagMenu({ fields, onInsert }: { fields: readonly MergeField[]; onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState("");
  const id = useId();
  return (
    <span className="tagmenu">
      <button
        type="button"
        className="btn link"
        aria-expanded={open}
        aria-controls={id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {messages.campaign_insert_tag}
      </button>
      {open && (
        <span className="tagmenu-box" id={id}>
          <label className="field">
            <span>{messages.campaign_if_empty}</span>
            <input className="input" value={fallback} maxLength={CAMPAIGN_LIMITS.fallback} onChange={(e) => setFallback(e.target.value)} />
          </label>
          <span className="tagmenu-list" role="list">
            {fields.map((f) => (
              <button
                key={f.key}
                type="button"
                role="listitem"
                onClick={() => {
                  onInsert(insertTag(f, fallback));
                  setFallback("");
                  setOpen(false);
                }}
              >
                {f.name}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
