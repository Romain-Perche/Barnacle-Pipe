// A record's "Referred by" (SF-114 contracts/routes.md § Pages): the referrer's name (a text node) linking to their
// ambassador page, or their person page when they have none for the viewer; "Referred by a private person" when the
// referrer is hidden from the viewer (no name, no link); "—" when there is none.
import Link from "next/link";
import { messages } from "@/server/messages";
import type { Referrer } from "@/server/records/ambassadors";

export function ReferredBy({ referrer }: { referrer: Referrer }) {
  if (referrer === null) return <>—</>;
  if (referrer === "hidden") return <>{messages.referred_by_private}</>;
  return <Link href={referrer.ambassadorPage ? `/ambassadors/${referrer.id}` : `/people/${referrer.id}`}>{referrer.name}</Link>;
}
