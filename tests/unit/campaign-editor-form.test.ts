// covers SF-119 US1 scenario 1, US1 scenario 4, FR-019 (fix round 1): the draft form leaves every check to the server
// (noValidate, so a bad Reply-to shows the app's own message, as the person, organisation and deal forms do), and the
// Status column and the edit page header read "Draft".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messages } from "@/server/messages";

const src = (f: string) => readFileSync(`src/app/(app)/campaigns/${f}`, "utf8");

describe("campaign draft form", () => {
  it("sets noValidate on #campaign-form", () => {
    const form = src("CampaignEditor.tsx").match(/<form\s[^>]*id=\{FORM_ID\}[^>]*>/s)?.[0];
    expect(form).toBeDefined();
    expect(form).toMatch(/\bnoValidate\b/);
  });
  it("shows the status as campaign_status_draft (\"Draft\") on the list and the edit page", () => {
    expect(messages.campaign_status_draft).toBe("Draft");
    expect("campaign_draft" in messages).toBe(false);
    for (const f of ["page.tsx", "CampaignEditor.tsx"]) expect(src(f), f).toContain("messages.campaign_status_draft");
  });
});
