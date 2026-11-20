// Small server pieces shared by the deal drawer, the deal list and the deal page (SF-95).
import type { DealStatus } from "@/server/deals/deals";
import { formatDate } from "@/server/format";

// A YYYY-MM-DD day as "15 Dec 2026" (noon UTC is the same day in London).
export function day(date: string): string {
  return formatDate(new Date(`${date}T12:00:00Z`));
}

// "Open", "Won · 19 Nov 2026" or "Lost · 19 Nov 2026" (archiving is shown apart: a deal keeps its result).
export function resultText(deal: { status: DealStatus; closedAt: Date | null }): string {
  if (deal.status === "won" && deal.closedAt) return `Won · ${formatDate(deal.closedAt)}`;
  if (deal.status === "lost" && deal.closedAt) return `Lost · ${formatDate(deal.closedAt)}`;
  return "Open";
}

// The drawer's badges: "Won · <date>" / "Lost · <date>" for a closed deal, "Archived" for an archived one.
export function StatusBadge({ deal }: { deal: { status: DealStatus; closedAt: Date | null; archived: boolean } }) {
  return (
    <>
      {deal.status !== "open" && deal.closedAt && (
        <span className={`badge tag ${deal.status}`}>
          {deal.status === "won" ? "Won" : "Lost"} · {formatDate(deal.closedAt)}
        </span>
      )}
      {deal.archived && <span className="badge off tag">Archived</span>}
    </>
  );
}
