import Link from "next/link";
import { messages } from "@/server/messages";

// Unknown address while signed in: inside the sidebar layout, with a way back.
export default function NotFound() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> 404
          </div>
          <h1>{messages.not_found}</h1>
        </div>
      </div>
      <Link className="btn" href="/">
        [ BACK TO HOME ]
      </Link>
    </>
  );
}
