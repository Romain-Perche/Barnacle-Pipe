// A deal that is missing, deleted or private to someone else (SF-95 US1 scenario 5): HTTP 404, nothing about the deal.
// Also answers /deals/<id>/edit.
import Link from "next/link";
import { messages } from "@/server/messages";

export default function DealNotFound() {
  return (
    <div className="empty">
      <h1>{messages.deal_not_found}</h1>
      <Link className="btn" href="/deals/list">
        [ DEAL LIST ]
      </Link>
    </div>
  );
}
