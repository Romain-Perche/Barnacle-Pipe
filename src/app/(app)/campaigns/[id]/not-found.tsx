// A campaign that does not exist or was deleted (SF-119 US6 scenario 3): "This campaign no longer exists."
import Link from "next/link";
import { messages } from "@/server/messages";

export default function CampaignNotFound() {
  return (
    <div className="empty">
      <h1>{messages.campaign_gone}</h1>
      <Link className="btn" href="/campaigns">
        [ CAMPAIGNS ]
      </Link>
    </div>
  );
}
