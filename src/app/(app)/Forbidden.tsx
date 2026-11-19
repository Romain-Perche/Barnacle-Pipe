import { messages } from "@/server/messages";

// Shown, inside the shell, to a signed-in user who is not allowed on a page.
export function Forbidden() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> 403
          </div>
          <h1>{messages.forbidden}</h1>
        </div>
      </div>
    </>
  );
}
