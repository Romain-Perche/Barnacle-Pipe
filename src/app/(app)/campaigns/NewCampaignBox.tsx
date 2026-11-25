// "New campaign" in a box over the Campaigns page (SF-119, /campaigns?new=1), like the activity box.
import { messages } from "@/server/messages";
import { NewCampaignForm } from "./NewCampaignForm";

export function NewCampaignBox() {
  return (
    <div className="overlay">
      <div className="lostbox" role="dialog" aria-modal="true" aria-labelledby="new-campaign-title">
        <div className="label" id="new-campaign-title">
          <span className="c">//</span> {messages.campaign_new_title}
        </div>
        <NewCampaignForm />
      </div>
    </div>
  );
}
