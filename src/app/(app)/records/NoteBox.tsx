"use client";
// The note box (SF-102 contracts/routes.md § Client components): add a note above the timeline, or edit one in place.
// Typing "@" and letters opens a list of the teammates who can see the record; choosing one writes "@<name> " and
// adds a hidden `mention` field with their id. The server keeps only the ids whose "@<name>" is still in the text.
import Link from "next/link";
import { useActionState, useId, useRef, useState } from "react";
import { messages } from "@/server/messages";
import { FieldError } from "./FieldError";
import type { NoteState } from "./note-actions";
import type { TargetKind } from "./note-target";

type User = { id: number; name: string };

type Props = {
  action: (prev: NoteState, form: FormData) => Promise<NoteState>;
  target: TargetKind;
  targetId: number;
  candidates: User[];
  // Edit mode: the note, its text and mentions as the edit box shows them, and where [ CANCEL ] goes.
  edit?: { noteId: number; version: number; text: string; mentions: User[]; cancelHref: string; timeline: number };
};

const MAX = 10_000;
// "@" at the start or after a space, then up to 40 characters with no "@" or line break, up to the caret.
const QUERY = /(?:^|\s)@([^@\n]{1,40})$/;

function Editor({ props, initialText, initialMentions, error, pending }: { props: Props; initialText: string; initialMentions: User[]; error: NoteState; pending: boolean }) {
  const { candidates, edit } = props;
  const [text, setText] = useState(initialText);
  const [mentions, setMentions] = useState<User[]>(initialMentions);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const errId = useId();

  const match = QUERY.exec(text.slice(0, caret));
  const query = match ? match[1].trimStart().toLowerCase() : "";
  const options =
    match && query !== "" && !closed
      ? candidates
          .filter((u) => u.name.toLowerCase().includes(query))
          .sort((a, b) => Number(!b.name.toLowerCase().startsWith(query)) - Number(!a.name.toLowerCase().startsWith(query)))
          .slice(0, 8)
      : [];
  const open = options.length > 0;
  const current = Math.min(active, options.length - 1);

  function choose(u: User) {
    if (!match) return;
    const start = caret - match[1].length - 1;
    const insert = `@${u.name} `;
    const next = text.slice(0, start) + insert + text.slice(caret);
    setText(next.slice(0, MAX));
    if (!mentions.some((m) => m.id === u.id)) setMentions([...mentions, u]);
    const at = start + insert.length;
    setCaret(at);
    setActive(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(options[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setClosed(true);
    }
  }

  const sync = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  return (
    <>
      <div className="note-input">
        <textarea
          ref={area}
          className="input"
          name="body"
          aria-label="Note"
          rows={edit ? 4 : 3}
          maxLength={MAX}
          value={text}
          placeholder={edit ? undefined : "Write a note… type @ to mention a teammate"}
          aria-invalid={error?.errors.body ? true : undefined}
          aria-describedby={error?.errors.body ? errId : undefined}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setClosed(false);
            setActive(0);
            sync(e.target);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) sync(e.currentTarget);
          }}
          onClick={(e) => sync(e.currentTarget)}
          onBlur={() => setClosed(true)}
          onFocus={() => setClosed(false)}
        />
        {open && (
          <ul className="mention-list" role="listbox" id={listId} aria-label="Teammates">
            {options.map((u, i) => (
              <li
                key={u.id}
                role="option"
                aria-selected={i === current}
                className={i === current ? "on" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(u);
                }}
              >
                {u.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {mentions.map((m) => (
        <input key={m.id} type="hidden" name="mention" value={m.id} />
      ))}
      <FieldError error={error?.errors.body} id={errId} />
      <div className="note-bar">
        {edit ? (
          <Link className="btn" href={edit.cancelHref} scroll={false}>
            {messages.delete_cancel}
          </Link>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setText("");
              setMentions([]);
            }}
          >
            {messages.delete_cancel}
          </button>
        )}
        <button type="submit" className="btn solid" disabled={pending}>
          {edit ? "[ SAVE ]" : "[ ADD NOTE ]"}
        </button>
      </div>
    </>
  );
}

export function NoteBox(props: Props) {
  const [state, action, pending] = useActionState(props.action, null);
  const { edit, candidates } = props;
  // Rebuilt on every answer (`seq`): empty after an add, the typed text and mentions kept after a refusal.
  const known = [...(edit?.mentions ?? []), ...candidates];
  const text = state ? state.values.body : (edit?.text ?? "");
  const mentions = state
    ? state.values.mentions.map((id) => known.find((u) => u.id === id)).filter((u): u is User => u !== undefined)
    : (edit?.mentions ?? []);
  return (
    <form action={action} className={edit ? "notebox edit" : "notebox"} aria-label={edit ? "Edit note" : "Add a note"}>
      <input type="hidden" name="target" value={props.target} />
      <input type="hidden" name="targetId" value={props.targetId} />
      {edit && (
        <>
          <input type="hidden" name="noteId" value={edit.noteId} />
          <input type="hidden" name="version" value={edit.version} />
          <input type="hidden" name="timeline" value={edit.timeline} />
        </>
      )}
      <Editor key={state?.seq ?? 0} props={props} initialText={text} initialMentions={mentions} error={state} pending={pending} />
    </form>
  );
}
