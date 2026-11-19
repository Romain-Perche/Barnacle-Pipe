import { Wordmark } from "@/app/Wordmark";
import { messages } from "@/server/messages";

// Outside the app shell (e.g. the fake Google login when it is turned off).
export default function NotFound() {
  return (
    <main className="outside">
      <div className="panel">
        <Wordmark centre="#FAF6F1" />
        <div className="label">
          <span className="c">//</span> 404
        </div>
        <h1>{messages.not_found}</h1>
      </div>
    </main>
  );
}
