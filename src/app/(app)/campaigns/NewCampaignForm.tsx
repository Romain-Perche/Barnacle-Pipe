"use client";
// The "New campaign" box's form (SF-119 US1 scenario 2): a name, [ CREATE ] / [ CANCEL ]. A refused name comes back with
// what was typed; a created draft opens on its edit page.
import Link from "next/link";
import { useActionState } from "react";
import { CAMPAIGN_LIMITS } from "@/server/campaigns/rules";
import { messages } from "@/server/messages";
import { createCampaignAction } from "./actions";

export function NewCampaignForm() {
  const [state, action, pending] = useActionState(createCampaignAction, null);
  return (
    <form action={action}>
      <label className="field">
        <span>{messages.campaign_field_name}</span>
        <input
          key={state?.seq ?? 0}
          className="input"
          name="name"
          maxLength={CAMPAIGN_LIMITS.name}
          defaultValue={state?.name ?? ""}
          autoFocus
          required
          aria-invalid={Boolean(state?.error)}
        />
      </label>
      {state?.error && (
        <p className="ferr" role="alert">
          {state.error}
        </p>
      )}
      <div className="form-acts">
        <button className="btn solid" type="submit" disabled={pending}>
          {messages.campaign_create}
        </button>
        <Link className="btn" href="/campaigns" scroll={false}>
          {messages.delete_cancel}
        </Link>
      </div>
    </form>
  );
}
