"use client";
// A campaign draft's edit page (SF-119 design A): the header (CAMPAIGN · DRAFT, the name, "Last edited by …", [ SAVE ]
// [ DUPLICATE ] [ DELETE ]), // DETAILS and // CONTENT · LAYOUT / PASTE HTML on the left, // PREVIEW FOR on the right.
// The preview follows what is typed without saving: tags are filled in the browser with the values the server gave for
// the chosen person. A refused save keeps everything typed (the state is never reset from the answer).
import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  LAYOUTS, blockTexts, blocksToHtml, keepTags, layoutBlocks, type Block, type Content, type LayoutKey,
} from "@/server/campaigns/content";
import type { CampaignView } from "@/server/campaigns/campaigns";
import { blockFill, fillHtml, fillText, resolver, unknownTags, type MergeField, type PreviewValues } from "@/server/campaigns/merge";
import { CAMPAIGN_LIMITS, stillEmpty } from "@/server/campaigns/rules";
import { messages } from "@/server/messages";
import { saveCampaignAction, duplicateCampaignAction } from "./actions";
import { BlockList, type KeyedBlock, type Track } from "./BlockList";
import { CampaignPreview } from "./CampaignPreview";
import { MergeTagMenu } from "./MergeTagMenu";
import { PreviewPersonPicker } from "./PreviewPersonPicker";

type Kind = "none" | "blocks" | "html";
type Target = { el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void };

const FORM_ID = "campaign-form";

function Err({ text }: { text?: string }) {
  return text ? (
    <p className="ferr" role="alert">
      {text}
    </p>
  ) : null;
}

function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-label={text}>
        <p>{text}</p>
        <div className="form-acts">
          <button type="button" className="btn solid" onClick={onYes} autoFocus>
            {messages.campaign_switch}
          </button>
          <button type="button" className="btn" onClick={onNo}>
            {messages.delete_cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CampaignEditor({ view, fields }: { view: CampaignView; fields: MergeField[] }) {
  const keys = useRef(0);
  const nextKey = () => ++keys.current;
  const keyed = (list: Block[]): KeyedBlock[] => list.map((block) => ({ key: nextKey(), block }));

  const [name, setName] = useState(view.name);
  const [senderName, setSenderName] = useState(view.senderName);
  const [replyTo, setReplyTo] = useState(view.replyTo);
  const [subject, setSubject] = useState(view.subject);
  const [previewText, setPreviewText] = useState(view.previewText);
  const [kind, setKind] = useState<Kind>(view.content?.kind ?? "none");
  const [blocks, setBlocks] = useState<KeyedBlock[]>(() => (view.content?.kind === "blocks" ? keyed(view.content.blocks) : []));
  const [html, setHtml] = useState(view.content?.kind === "html" ? view.content.html : "");
  const [choosing, setChoosing] = useState(false);
  const [confirm, setConfirm] = useState<null | "to_html" | "to_layout">(null);

  const [saved, setSaved] = useState({ name: view.name, version: view.version, lastEdited: view.lastEdited, links: view.links });
  const [person, setPerson] = useState<{ id: number; name: string } | null>(null);
  const [values, setValues] = useState<PreviewValues | null>(null);
  const [state, formAction, pending] = useActionState(saveCampaignAction, null);
  const target = useRef<Target | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Take what an accepted save returns: the new version, the links of its tags, and the chosen person's values again.
  const seen = useRef(0);
  useEffect(() => {
    if (!state || state.seq === seen.current) return;
    seen.current = state.seq;
    if (!state.ok) return;
    setSaved({ name: name.trim(), version: state.version, lastEdited: state.lastEdited, links: state.links });
    if (person && state.previewPersonId === person.id) {
      if (state.preview) setValues(state.preview);
      else {
        setPerson(null);
        setValues(null);
      }
    }
  }, [state, name, person]);

  const track: Track = (set) => (e) => {
    target.current = { el: e.currentTarget, set };
  };
  function insert(tag: string) {
    const t = target.current?.el.isConnected ? target.current : subjectRef.current ? { el: subjectRef.current, set: setSubject } : null;
    if (!t) return;
    const { el } = t;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    t.set(el.value.slice(0, start) + tag + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  const blockList = useMemo(() => blocks.map((k) => k.block), [blocks]);
  const content: Content = kind === "blocks" && blockList.length > 0 ? { kind: "blocks", blocks: blockList } : kind === "html" ? { kind: "html", html } : null;
  const texts = useMemo(() => [subject, previewText, ...(kind === "blocks" ? blockList.flatMap(blockTexts) : kind === "html" ? [html] : [])], [subject, previewText, kind, blockList, html]);
  const resolve = useMemo(() => resolver(saved.links, fields), [saved.links, fields]);
  const unknown = useMemo(() => unknownTags(texts, saved.links, fields), [texts, saved.links, fields]);
  const ctx = useMemo(() => ({ resolve, values: person ? values : null, tint: true }), [resolve, person, values]);
  const contentHtml = useMemo(
    () => (kind === "blocks" ? blocksToHtml(blockList, blockFill(ctx)) : kind === "html" ? fillHtml(html, ctx) : ""),
    [kind, blockList, html, ctx],
  );
  const empty = stillEmpty({ senderName, subject, content });
  const errors = state && !state.ok ? state.errors : {};
  const showChooser = kind === "none" || (kind === "blocks" && blocks.length === 0) || choosing;

  function chooseLayout(layout: LayoutKey) {
    setBlocks(keyed(layoutBlocks(layout)));
    setKind("blocks");
    setHtml("");
    setChoosing(false);
  }
  function toHtml() {
    if (kind === "html") return setChoosing(false);
    if (kind === "blocks" && blocks.length > 0) return setConfirm("to_html");
    setKind("html");
  }
  function toLayout() {
    if (kind === "blocks") return;
    if (kind === "html" && html.trim() !== "") return setConfirm("to_layout");
    setHtml("");
    setKind("none");
  }

  return (
    <>
      <div className="label">
        <span className="c">//</span> {messages.campaign_kind} · <span className="status">{messages.campaign_draft}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{saved.name}</h1>
          <div className="sub">{saved.lastEdited}</div>
        </div>
        <div className="head-acts">
          <button type="submit" form={FORM_ID} className="btn solid" disabled={pending}>
            {messages.campaign_save}
          </button>
          <form action={duplicateCampaignAction}>
            <input type="hidden" name="id" value={view.id} />
            <button type="submit" className="btn">
              {messages.campaign_duplicate}
            </button>
          </form>
          <Link className="btn red" href={`/campaigns/${view.id}?delete=1`} scroll={false}>
            {messages.campaign_delete}
          </Link>
        </div>
      </div>

      <div className="campaign-notes" aria-live="polite">
        {errors.form && <p className="err">{errors.form}</p>}
        {state?.ok && <p className="notice">{state.message}</p>}
        {empty.length > 0 && (
          <p className="em">
            {messages.campaign_still_empty}
            {empty.join(", ")}
          </p>
        )}
        {unknown.length > 0 && (
          <p className="ferr">
            {messages.campaign_unknown_tags}
            {unknown.join(", ")}
          </p>
        )}
      </div>

      <div className="campaign-two">
        <form
          id={FORM_ID}
          className="campaign-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => formAction(fd));
          }}
        >
          <input type="hidden" name="id" value={view.id} />
          <input type="hidden" name="version" value={saved.version} />
          <input type="hidden" name="previewPersonId" value={person?.id ?? ""} />
          <input type="hidden" name="contentKind" value={kind} />
          {kind === "blocks" && <input type="hidden" name="blocks" value={JSON.stringify(blockList)} />}
          {kind === "html" && choosing && <input type="hidden" name="html" value={html} />}

          <div className="label sect">
            <span className="c">//</span> DETAILS
          </div>
          <div className="f2">
            <label className="field">
              <span>{messages.campaign_field_name}</span>
              <input className="input" name="name" value={name} maxLength={CAMPAIGN_LIMITS.name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
              <Err text={errors.name} />
            </label>
            <label className="field">
              <span>{messages.campaign_field_sender}</span>
              <input className="input" name="senderName" value={senderName} maxLength={CAMPAIGN_LIMITS.senderName} onChange={(e) => setSenderName(e.target.value)} aria-invalid={Boolean(errors.senderName)} />
              <Err text={errors.senderName} />
            </label>
          </div>
          <label className="field">
            <span>{messages.campaign_field_reply_to}</span>
            <input className="input" type="email" name="replyTo" value={replyTo} maxLength={CAMPAIGN_LIMITS.replyTo} onChange={(e) => setReplyTo(e.target.value)} aria-invalid={Boolean(errors.replyTo)} />
            <Err text={errors.replyTo} />
          </label>
          <div className="field">
            <span className="field-head">
              <label htmlFor="campaign-subject">{messages.campaign_field_subject}</label>
              <MergeTagMenu fields={fields} onInsert={insert} />
            </span>
            <input
              id="campaign-subject"
              ref={subjectRef}
              className="input"
              name="subject"
              value={subject}
              maxLength={CAMPAIGN_LIMITS.subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={track(setSubject)}
              aria-invalid={Boolean(errors.subject)}
            />
            <Err text={errors.subject} />
          </div>
          <label className="field">
            <span>{messages.campaign_field_preview_text}</span>
            <input className="input" name="previewText" value={previewText} maxLength={CAMPAIGN_LIMITS.previewText} onChange={(e) => setPreviewText(e.target.value)} onFocus={track(setPreviewText)} aria-invalid={Boolean(errors.previewText)} />
            <Err text={errors.previewText} />
          </label>
          <Err text={errors.fallback} />

          <div className="label sect content-head">
            <span>
              <span className="c">//</span> CONTENT ·{" "}
              <button type="button" className={kind === "blocks" ? "btn link on" : "btn link"} onClick={toLayout}>
                {messages.campaign_layout}
              </button>{" "}
              /{" "}
              <button type="button" className={kind === "html" ? "btn link on" : "btn link"} onClick={toHtml}>
                {messages.campaign_paste_html}
              </button>
            </span>
            {!showChooser && <MergeTagMenu fields={fields} onInsert={insert} />}
          </div>
          <Err text={errors.content} />

          {showChooser ? (
            <div className="chooser" role="group" aria-label={messages.campaign_layout}>
              {LAYOUTS.map((l) => (
                <button key={l.key} type="button" className="btn" onClick={() => chooseLayout(l.key)}>
                  {l.label}
                </button>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setChoosing(false);
                  setBlocks([]);
                  setKind("html");
                }}
              >
                {messages.campaign_paste_html}
              </button>
            </div>
          ) : kind === "html" ? (
            <label className="field">
              <span className="visually-hidden">{messages.campaign_paste_html}</span>
              <textarea
                className="input html-box"
                name="html"
                rows={18}
                spellCheck={false}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                onFocus={track(setHtml)}
              />
            </label>
          ) : (
            <BlockList blocks={blocks} onChange={setBlocks} errors={errors} track={track} nextKey={nextKey} />
          )}
        </form>

        <section className="campaign-preview" aria-label="Preview">
          <div className="label sect">
            <span className="c">//</span> {messages.campaign_preview_for}
          </div>
          <PreviewPersonPicker
            chosen={person}
            onChoose={(p, v) => {
              setPerson(p);
              setValues(v);
            }}
          />
          {!person && <p className="em">{messages.campaign_preview_choose}</p>}
          <CampaignPreview
            senderName={senderName}
            replyTo={replyTo}
            subject={fillText(subject, { ...ctx, tint: false })}
            previewText={fillText(previewText, { ...ctx, tint: false })}
            contentHtml={contentHtml}
            unknown={unknown}
          />
        </section>
      </div>

      {confirm === "to_html" && (
        <Confirm
          text={messages.campaign_switch_to_html}
          onYes={() => {
            setHtml(blocksToHtml(blockList, keepTags));
            setBlocks([]);
            setKind("html");
            setConfirm(null);
          }}
          onNo={() => setConfirm(null)}
        />
      )}
      {confirm === "to_layout" && (
        <Confirm
          text={messages.campaign_switch_to_layout}
          onYes={() => {
            setChoosing(true);
            setConfirm(null);
          }}
          onNo={() => setConfirm(null)}
        />
      )}
    </>
  );
}
