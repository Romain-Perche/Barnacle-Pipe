// A conversation that is missing, or hidden by the private rule (SF-127 FR-012): HTTP 404, nothing about it.
import Link from "next/link";
import { messages } from "@/server/messages";

export default function ConversationNotFound() {
  return (
    <div className="empty">
      <h1>{messages.email_not_found}</h1>
      <Link className="btn" href="/people">
        [ PEOPLE ]
      </Link>
    </div>
  );
}
