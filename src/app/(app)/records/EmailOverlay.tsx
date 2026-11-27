// `?email=new` on a deal, person or organisation page and on the board with the deal drawer open (SF-129
// contracts/routes.md § Pages, research.md §6): the email box, a tall panel on the right over the dimmed page (design
// B). `new` is the only value read; anything else, an archived record or one the viewer cannot see opens nothing.
// Nothing from the address is shown; `back` is the page's own address without `email`.
import { emailBox, type ComposeTarget } from "@/server/emails/compose";
import type { Target } from "@/server/records/timeline";
import { EmailBox } from "./EmailBox";

const composeTarget = (t: Target): ComposeTarget =>
  "dealId" in t ? { kind: "deal", id: t.dealId } : "personId" in t ? { kind: "person", id: t.personId } : { kind: "organisation", id: t.organisationId };

export async function EmailOverlay({ viewerId, target, email, back }: { viewerId: number; target: Target; email?: string; back: string }) {
  if (email !== "new") return null;
  const box = await emailBox(viewerId, composeTarget(target));
  if (!box) return null;
  return <EmailBox box={box} back={back} />;
}
