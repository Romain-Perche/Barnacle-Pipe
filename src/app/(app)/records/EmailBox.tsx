"use client";
// The email box (SF-129 contracts/routes.md § The panel, design B): a tall panel on the right over the dimmed page.
// From (the user's Gmail), To / Cc / Bcc as chips (Enter, comma, semicolon, space or paste adds; × removes), Subject,
// the plain Text, the attachments (the record's own files, files from the computer sent straight to Storage with their
// progress, 25 MB in total), then [ CANCEL ] / [ SEND ]. A refusal keeps everything typed; after sending the page
// goes back (the flash says "Email sent to …"). Opened without a working Gmail: the message and [ GO TO SETTINGS ] only;
// Gmail refusing at send time keeps the form and everything in it, with the message above and no [ SEND ] (panelView).
// The size message shows for as long as the attachments are over 25 MB in total; only a single computer file over
// 25 MB is refused when picked.
// Everything typed or read from the database is rendered as text nodes.
// SF-130: the same box for a reply, reply all or forward (box.reply): its heading, To / Cc / Subject prefilled (chips
// show the CRM name of an address, the address in `title`), the quote read-only under the text (never sent back: the
// server rebuilds it), the forwarded attachments as removable chips counted in the 25 MB, the record files only when a
// record is set, its footer, [ SEND ] through sendEmailReply. `missing`: email_not_found and [ CLOSE ] only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { EmailBox as Box, GmailState, Refusal } from "@/server/emails/compose";
import { overAttachmentLimit, panelView, refusedOnPick, splitAddresses, totalBytes } from "@/server/emails/compose-rules";
import { validateFile } from "@/server/files/rules";
import { formatFileSize } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { put } from "./AddFiles";
import { sendEmailFromRecord, sendEmailReply, startEmailUpload } from "./email-actions";

type Field = "to" | "cc" | "bcc";
type Upload = { id: number; name: string; size: number };

const GMAIL_TEXT: Record<Exclude<GmailState, "ok">, string> = {
  not_connected: messages.compose_connect_gmail,
  needs_reconnect: messages.compose_reconnect_gmail,
  off: messages.compose_gmail_off,
};

function refusalText(r: Refusal): string {
  return r.code === "compose_address_invalid" ? templates.compose_address_invalid(r.address ?? "") : messages[r.code];
}

function Addresses({ label, list, names, draft, onDraft, onAdd, onRemove }: {
  label: string; list: string[]; names: Record<string, string>; draft: string; onDraft: (v: string) => void; onAdd: (text: string) => void; onRemove: (i: number) => void;
}) {
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", ";", " "].includes(e.key)) {
      e.preventDefault();
      onAdd(draft);
    } else if (e.key === "Backspace" && draft === "" && list.length > 0) onRemove(list.length - 1);
  };
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    onAdd(draft + e.clipboardData.getData("text"));
  };
  return (
    <>
      <span className="k">{label}</span>
      <div className="fld chips">
        {list.map((a, i) => (
          <span key={`${a}-${i}`} className="chip" title={a}>
            {names[a.toLowerCase()] ?? a}
            <button type="button" className="chip-x" aria-label={`Remove ${a}`} onClick={() => onRemove(i)}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label={`${label} addresses`}
          placeholder={messages.compose_add_address}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={keyDown}
          onPaste={paste}
          onBlur={() => draft.trim() && onAdd(draft)}
        />
      </div>
    </>
  );
}

export function EmailBox({ box, back }: { box: Box; back: string }) {
  const router = useRouter();
  // The Gmail state the box opened with: router.refresh() after a refusal re-renders with the connection now marked,
  // and that must not take the form (and what was typed) away. Only a send answer changes the view.
  const [opened] = useState(box.gmail);
  const input = useRef<HTMLInputElement>(null);
  const [refusedBy, setRefusedBy] = useState<Exclude<GmailState, "ok"> | null>(null);
  const [fields, setFields] = useState<Record<Field, string[]>>({ to: box.to, cc: box.cc, bcc: [] });
  const [drafts, setDrafts] = useState<Record<Field, string>>({ to: "", cc: "", bcc: "" });
  const [subject, setSubject] = useState(box.reply?.subject ?? "");
  const [forwarded, setForwarded] = useState(box.reply?.forwarded ?? []);
  const [text, setText] = useState("");
  const [fileIds, setFileIds] = useState<number[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const files = fileIds.map((id) => box.files.find((f) => f.id === id)!).filter(Boolean);
  const used = totalBytes([...forwarded.map((f) => f.size), ...files.map((f) => f.size), ...uploads.map((u) => u.size)]);
  const offered = box.files.filter((f) => !fileIds.includes(f.id));
  const over = overAttachmentLimit(used);
  const view = panelView(opened, refusedBy);
  const gmail = refusedBy ?? opened;

  const add = (field: Field, raw: string) => {
    const more = splitAddresses(raw);
    setDrafts((d) => ({ ...d, [field]: "" }));
    if (more.length) setFields((f) => ({ ...f, [field]: [...f[field], ...more] }));
  };
  const remove = (field: Field, i: number) => setFields((f) => ({ ...f, [field]: f[field].filter((_, j) => j !== i) }));

  async function attachFromComputer(list: File[]) {
    const refused: string[] = [];
    for (const file of list) {
      if (refusedOnPick(file.size)) {
        refused.push(messages.compose_attachments_too_large);
        continue;
      }
      const valid = validateFile({ name: file.name, size: file.size });
      if (!valid.ok) {
        refused.push(valid.code === "file_too_large" ? messages.compose_attachments_too_large : templates[valid.code](file.name));
        continue;
      }
      setProgress(templates.file_uploading(file.name, 0));
      const start = await startEmailUpload({ name: file.name, size: file.size, type: file.type }).catch(() => null);
      if (!start || start.status !== "ok") {
        refused.push(start?.status === "compose_attachments_too_large" ? messages.compose_attachments_too_large : start?.status === "files_unreachable" ? messages.files_unreachable : templates.file_upload_failed(file.name));
        continue;
      }
      const stored = await put(start.url, start.contentType, file, (n) => setProgress(templates.file_uploading(file.name, n)));
      if (!stored) {
        refused.push(templates.file_upload_failed(file.name));
        continue;
      }
      setUploads((u) => [...u, { id: start.id, name: file.name, size: file.size }]);
    }
    setProgress(null);
    setErrors(refused);
    if (input.current) input.current.value = "";
  }

  async function send() {
    // An address still in an input counts, as if added.
    const all = { ...fields };
    for (const f of ["to", "cc", "bcc"] as Field[]) all[f] = [...all[f], ...splitAddresses(drafts[f])];
    setFields(all);
    setDrafts({ to: "", cc: "", bcc: "" });
    setErrors([]);
    // Over 25 MB: the size message is already shown; nothing is sent (the server checks again).
    if (over) return;
    setPending(true);
    const common = { sendKey: box.sendKey, ...all, subject, text, fileIds, uploadIds: uploads.map((u) => u.id), back };
    const answer = await (box.reply
      ? sendEmailReply({
          mode: box.reply.mode, messageId: box.reply.messageId, record: box.record ? { target: box.record.kind, id: box.record.id } : null,
          forwardIds: forwarded.map((f) => f.id), ...common,
        })
      : box.record
        ? sendEmailFromRecord({ target: box.record.kind, id: box.record.id, ...common })
        : Promise.reject(new Error("no record"))
    ).catch(() => null);
    setPending(false);
    if (!answer) return setErrors([messages.compose_send_failed]);
    if (answer.status === "sent") {
      router.push(answer.back, { scroll: false });
      router.refresh();
      return;
    }
    if (answer.status === "gmail") {
      setRefusedBy(answer.state);
      router.refresh();
      return;
    }
    setErrors([...new Set(answer.errors.map(refusalText))].filter((t) => t !== messages.compose_attachments_too_large || !over));
  }

  const heading = (
    <div className="hd">
      <span>{box.reply ? box.reply.heading : box.record ? `${messages.compose_heading} · ${box.record.name.toUpperCase()}` : messages.compose_heading}</span>
      <Link className="btn" href={back} scroll={false}>
        {messages.compose_close}
      </Link>
    </div>
  );

  return (
    <div className="overlay sideoverlay">
      <section className="sidepanel" role="dialog" aria-modal="true" aria-label={box.reply ? "Reply" : "New email"}>
        {heading}
        {box.missing && (
          <p className="notice warn" role="alert">
            {messages.email_not_found}
          </p>
        )}
        {!box.missing && gmail !== "ok" && (
          <>
            <p className="notice warn" role="alert">
              {GMAIL_TEXT[gmail]}
            </p>
            {gmail !== "off" && (
              <Link className="btn solid" href="/settings">
                {messages.compose_go_to_settings}
              </Link>
            )}
          </>
        )}
        {!box.missing && view !== "message" && (
          <form
            className="emailform"
            onSubmit={(e) => {
              e.preventDefault();
              if (view === "form" && !pending && !progress) void send();
            }}
          >
            <div className="frm">
              <span className="k">From</span>
              <span className="muted">{box.from}</span>
              {(["to", "cc", "bcc"] as Field[]).map((f) => (
                <Addresses
                  key={f}
                  label={f === "to" ? "To" : f === "cc" ? "Cc" : "Bcc"}
                  list={fields[f]}
                  names={box.names}
                  draft={drafts[f]}
                  onDraft={(v) => setDrafts((d) => ({ ...d, [f]: v }))}
                  onAdd={(raw) => add(f, raw)}
                  onRemove={(i) => remove(f, i)}
                />
              ))}
              <label className="k" htmlFor="email-subject">
                Subject
              </label>
              <input id="email-subject" className="fld" value={subject} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, " "))} />
              <label className="k" htmlFor="email-text">
                Text
              </label>
              <textarea id="email-text" className="fld big" value={text} onChange={(e) => setText(e.target.value)} rows={12} />
              {box.reply && (
                <>
                  <span className="k">{messages.reply_quote_label}</span>
                  <pre className="quote" aria-label={messages.reply_quote_label}>
                    {box.reply.quote}
                  </pre>
                </>
              )}
            </div>
            <div className="k attach-k">Attachments</div>
            {(forwarded.length > 0 || files.length > 0 || uploads.length > 0) && (
              <ul className="attachlist">
                {forwarded.map((f) => (
                  <li key={`w-${f.id}`} className="chip">
                    <span className="muted">{messages.reply_forwarded_label}</span> {f.name} · {formatFileSize(f.size)}
                    <button type="button" className="chip-x" aria-label={`Remove ${f.name}`} onClick={() => setForwarded((list) => list.filter((x) => x.id !== f.id))}>
                      ×
                    </button>
                  </li>
                ))}
                {files.map((f) => (
                  <li key={`f-${f.id}`} className="chip">
                    {f.name} · {formatFileSize(f.size)}
                    <button type="button" className="chip-x" aria-label={`Remove ${f.name}`} onClick={() => setFileIds((ids) => ids.filter((x) => x !== f.id))}>
                      ×
                    </button>
                  </li>
                ))}
                {uploads.map((u) => (
                  <li key={`u-${u.id}`} className="chip">
                    {u.name} · {formatFileSize(u.size)}
                    <button type="button" className="chip-x" aria-label={`Remove ${u.name}`} onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="attach-acts">
              {box.record && offered.length > 0 && (
                <details className="attachpick">
                  <summary className="btn">{templates.compose_attach_record(box.record.kind)}</summary>
                  <ul>
                    {offered.map((f) => (
                      <li key={f.id}>
                        <button type="button" className="btn link" onClick={() => setFileIds((ids) => [...ids, f.id])}>
                          {f.name} · {formatFileSize(f.size)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button className="btn" type="button" disabled={pending || progress !== null} onClick={() => input.current?.click()}>
                {messages.compose_attach_computer}
              </button>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                aria-label="Files to attach"
                onChange={(e) => {
                  const list = Array.from(e.currentTarget.files ?? []);
                  if (list.length > 0) void attachFromComputer(list);
                }}
              />
              <span className="tot">{templates.compose_room(used === 0 ? "0 MB" : formatFileSize(used))}</span>
            </div>
            {progress && (
              <p className="uploading" role="status">
                {progress}
              </p>
            )}
            {(over || errors.length > 0) && (
              <div role="alert">
                {over && <p className="err">{messages.compose_attachments_too_large}</p>}
                {errors.filter((t) => !over || t !== messages.compose_attachments_too_large).map((t) => (
                  <p key={t} className="err">
                    {t}
                  </p>
                ))}
              </div>
            )}
            <div className="ftr">
              <span className="muted">{box.reply ? messages.reply_footer : messages.compose_footer}</span>
              <span className="acts">
                <Link className="btn" href={back} scroll={false}>
                  {messages.compose_cancel}
                </Link>
                {view === "form" && (
                  <button className="btn solid" type="submit" disabled={pending || progress !== null}>
                    {pending ? messages.compose_sending : messages.compose_send}
                  </button>
                )}
              </span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
