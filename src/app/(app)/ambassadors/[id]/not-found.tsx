// An ambassador page the user cannot open (SF-114 US3 scenario 7, US4 scenario 2): a person who is not and never was an
// ambassador, missing, or private to someone else. HTTP 404, nothing about the person.
import Link from "next/link";
import { messages } from "@/server/messages";

export default function AmbassadorNotFound() {
  return (
    <div className="empty">
      <h1>{messages.ambassador_not_found}</h1>
      <Link className="btn" href="/ambassadors">
        [ AMBASSADORS ]
      </Link>
    </div>
  );
}
