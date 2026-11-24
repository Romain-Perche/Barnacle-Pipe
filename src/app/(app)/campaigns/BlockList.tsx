"use client";
// The layout blocks of a draft (SF-119 US3, design A): one card per block in order with its name, ↑ ↓ [ REMOVE ] and its
// inputs (the limits as maxLength), then [ + ADD BLOCK ] with the five types, disabled at 50. A refused block shows its
// message on the card. The editor posts the list as one JSON field.
import { useState } from "react";
import { BLOCK_LABELS, BLOCK_TYPES, CONTENT_LIMITS, newBlock, type Block, type BlockType } from "@/server/campaigns/content";
import { messages } from "@/server/messages";

export type KeyedBlock = { key: number; block: Block };
type Field = HTMLInputElement | HTMLTextAreaElement;
// The editor's focus tracker: remembers the field the merge tag menu inserts into.
export type Track = (set: (value: string) => void) => (e: React.FocusEvent<Field>) => void;

type Props = { blocks: KeyedBlock[]; onChange: (blocks: KeyedBlock[]) => void; errors: Record<string, string>; track: Track; nextKey: () => number };

function Input({ label, value, max, onChange, track, multiline, type = "text" }: {
  label: string; value: string; max: number; onChange: (v: string) => void; track?: Track; multiline?: boolean; type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="input" rows={5} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} onFocus={track?.(onChange)} />
      ) : (
        <input className="input" type={type} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} onFocus={track?.(onChange)} />
      )}
    </label>
  );
}

function BlockFields({ block, set, track }: { block: Block; set: (b: Block) => void; track: Track }) {
  switch (block.type) {
    case "heading":
      return <Input label={BLOCK_LABELS.heading} value={block.text} max={CONTENT_LIMITS.heading} onChange={(text) => set({ ...block, text: text.replace(/\r?\n/g, " ") })} track={track} />;
    case "text":
      return <Input label={BLOCK_LABELS.text} value={block.text} max={CONTENT_LIMITS.text} onChange={(text) => set({ ...block, text })} track={track} multiline />;
    case "button":
      return (
        <div className="f2">
          <Input label={messages.campaign_block_label} value={block.label} max={CONTENT_LIMITS.buttonLabel} onChange={(label) => set({ ...block, label })} track={track} />
          <Input label={messages.campaign_block_link} type="url" value={block.url} max={CONTENT_LIMITS.url} onChange={(url) => set({ ...block, url })} />
        </div>
      );
    case "image":
      return (
        <>
          <Input label={messages.campaign_block_image_src} type="url" value={block.src} max={CONTENT_LIMITS.url} onChange={(src) => set({ ...block, src })} />
          <div className="f2">
            <Input label={messages.campaign_block_alt} value={block.alt} max={CONTENT_LIMITS.alt} onChange={(alt) => set({ ...block, alt })} track={track} />
            <Input label={messages.campaign_block_link} type="url" value={block.url} max={CONTENT_LIMITS.url} onChange={(url) => set({ ...block, url })} />
          </div>
        </>
      );
    default:
      return null;
  }
}

export function BlockList({ blocks, onChange, errors, track, nextKey }: Props) {
  const [adding, setAdding] = useState(false);
  const move = (i: number, j: number) => {
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const full = blocks.length >= CONTENT_LIMITS.blocks;
  return (
    <div className="blocks">
      {blocks.map((k, i) => (
        <div className={errors[`block.${i}`] ? "blk bad" : "blk"} key={k.key}>
          <div className="bh">
            <span className="bt">{BLOCK_LABELS[k.block.type]}</span>
            <span className="bacts">
              <button type="button" className="btn link" aria-label={`Move ${BLOCK_LABELS[k.block.type]} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="btn link" aria-label={`Move ${BLOCK_LABELS[k.block.type]} down`} disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              <button type="button" className="btn link red" onClick={() => onChange(blocks.filter((_, x) => x !== i))}>
                {messages.campaign_remove_block}
              </button>
            </span>
          </div>
          <BlockFields block={k.block} set={(b) => onChange(blocks.map((x, n) => (n === i ? { key: x.key, block: b } : x)))} track={track} />
          {errors[`block.${i}`] && (
            <p className="ferr" role="alert">
              {errors[`block.${i}`]}
            </p>
          )}
        </div>
      ))}
      <div className="addblock">
        <button type="button" className="btn link" disabled={full} aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {messages.campaign_add_block}
        </button>
        {adding && !full && (
          <span className="addblock-types">
            {BLOCK_TYPES.map((t: BlockType) => (
              <button
                key={t}
                type="button"
                className="btn"
                onClick={() => {
                  onChange([...blocks, { key: nextKey(), block: newBlock(t) }]);
                  setAdding(false);
                }}
              >
                {BLOCK_LABELS[t]}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
