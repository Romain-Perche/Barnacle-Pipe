// `?email=new` on a deal, person or organisation page and on the board with the deal drawer open (SF-129
// contracts/routes.md § Pages, research.md §6): the email box, a tall panel on the right over the dimmed page (design
// B). Anything else, an archived record or one the viewer cannot see opens nothing.
// SF-130: `?email=reply-<id>` / `reply-all-<id>` / `forward-<id>` on those pages and on the conversation page (target
// null there unless its ?from= record is visible and not archived): the box filled for that email; an email missing or
// in a conversation the viewer cannot see opens the box with "This conversation doesn't exist or you can't see it.".
// Nothing from the address is shown; `back` is the page's own address without `email`.
import { emailBox, readRecord, type ComposeTarget } from "@/server/emails/compose";
import { replyBox } from "@/server/emails/reply";
import { parseEmailParam } from "@/server/emails/reply-rules";
import { sql } from "@/server/db";
import type { Target } from "@/server/records/timeline";
import { EmailBox } from "./EmailBox";

const composeTarget = (t: Target): ComposeTarget =>
  "dealId" in t ? { kind: "deal", id: t.dealId } : "personId" in t ? { kind: "person", id: t.personId } : { kind: "organisation", id: t.organisationId };

export async function EmailOverlay({ viewerId, target, email, back }: { viewerId: number; target: Target | null; email?: string; back: string }) {
  const ask = parseEmailParam(email);
  if (!ask) return null;
  if (ask.mode === "new") {
    if (!target) return null;
    const box = await emailBox(viewerId, composeTarget(target));
    return box ? <EmailBox box={box} back={back} /> : null;
  }
  // A record page whose record is hidden or archived opens nothing (as SF-129).
  const record = target ? composeTarget(target) : null;
  if (record) {
    const r = await readRecord(sql, viewerId, record);
    if (!r || r.archived) return null;
  }
  return <EmailBox box={await replyBox(viewerId, ask, record)} back={back} />;
}
