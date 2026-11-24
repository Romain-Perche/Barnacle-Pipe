// A segment that does not exist (deleted by someone, or a made-up id): nothing from the address is shown (SF-120 US3-4).
import Link from "next/link";
import { messages } from "@/server/messages";

export default function SegmentNotFound() {
  return (
    <div className="empty">
      <h1>{messages.segment_not_found}</h1>
      <Link className="btn" href="/segments">
        [ SEGMENTS ]
      </Link>
    </div>
  );
}
