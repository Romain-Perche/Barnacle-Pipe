"use client";
// The deals board, design A (research.md §1, §4): one column per stage, rounded cards that link to the drawer.
// Drag a card onto another column: it moves at once (optimistic), then the server confirms. A deal changed since
// the board was loaded → the fresh board and the deal_changed message; a failed call → the card goes back and the
// deal_move_failed message. Keyboard and touch users move deals with the drawer's "Move to" form instead.
import Link from "next/link";
import { startTransition, useOptimistic, useRef, useState } from "react";
import type { BoardColumn } from "@/server/deals/deals";
import { boardHref } from "@/server/deals/rules";
import { formatMoney } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { moveDealFromBoard } from "./actions";

type Move = { dealId: number; from: number; to: number };

function applyMove(columns: BoardColumn[], m: Move): BoardColumn[] {
  const card = columns.find((c) => c.id === m.from)?.cards.find((d) => d.id === m.dealId);
  if (!card) return columns;
  const value = card.valuePence ?? 0;
  return columns.map((c) => {
    if (c.id === m.from) return { ...c, count: c.count - 1, totalPence: c.totalPence - value, cards: c.cards.filter((d) => d.id !== m.dealId) };
    if (c.id === m.to) return { ...c, count: c.count + 1, totalPence: c.totalPence + value, cards: [{ ...card, stageId: m.to }, ...c.cards] };
    return c;
  });
}

export function Board({ pipelineId, columns, openId }: { pipelineId: number; columns: BoardColumn[]; openId: number | null }) {
  const [shown, move] = useOptimistic(columns, applyMove);
  const [message, setMessage] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const dragged = useRef<{ dealId: number; from: number; version: number } | null>(null);

  function drop(to: number) {
    setOver(null);
    const d = dragged.current;
    dragged.current = null;
    if (!d || d.from === to) return; // dropped back on its own column: nothing happens
    startTransition(async () => {
      move({ dealId: d.dealId, from: d.from, to });
      try {
        const result = await moveDealFromBoard({ dealId: d.dealId, version: d.version, fromStageId: d.from, toStageId: to });
        setMessage(result.status === "stale" ? messages.deal_changed : null);
      } catch {
        setMessage(messages.deal_move_failed);
      }
    });
  }

  return (
    <>
      {message && (
        <p className="err" role="alert">
          {message}
        </p>
      )}
      <div className="board" aria-label="Board">
        {shown.map((col) => (
          <section
            key={col.id}
            className={over === col.id ? "col over" : "col"}
            aria-label={col.name}
            onDragOver={(e) => {
              if (!dragged.current) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== col.id) setOver(col.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(col.id);
            }}
          >
            <header className="ch">
              <div className="nm">
                <h2>{col.name}</h2>
                <Link className="plus" href={`/deals/new?pipeline=${pipelineId}&stage=${col.id}`} aria-label={`Add a deal to ${col.name}`}>
                  +
                </Link>
              </div>
              <div className="tot">
                {templates.deal_count(col.count)} · {formatMoney(col.totalPence)}
              </div>
            </header>
            <div className="cards">
              {col.cards.length === 0 && <p className="none">{messages.no_deals_in_stage}</p>}
              {col.cards.map((card) => (
                <Link
                  key={card.id}
                  href={boardHref(pipelineId, { open: card.id })}
                  scroll={false}
                  className={openId === card.id ? "card sel" : "card"}
                  aria-current={openId === card.id ? "true" : undefined}
                  draggable
                  onDragStart={(e) => {
                    dragged.current = { dealId: card.id, from: col.id, version: card.version };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(card.id));
                  }}
                  onDragEnd={() => {
                    dragged.current = null;
                    setOver(null);
                  }}
                >
                  <span className="t">
                    {card.title}
                    {card.private && <span className="badge tag">Private</span>}
                  </span>
                  {card.organisation && <span className="ln">{card.organisation.name}</span>}
                  {card.person && <span className="ln">{card.person.name}</span>}
                  <span className="val">{formatMoney(card.valuePence)}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
