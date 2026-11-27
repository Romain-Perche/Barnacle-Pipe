// covers SF-129 FR-022 (T041): every compose_* code the email domain and box use has its fixed text in messages.ts,
// the texts of data-model.md § Validation, and the "Email sent to …" template.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messages, templates } from "@/server/messages";

const sources = ["src/server/emails/compose.ts", "src/server/emails/compose-rules.ts", "src/app/(app)/records/EmailBox.tsx", "src/app/(app)/records/email-actions.ts"];

describe("SF-129 messages", () => {
  it("every compose_* code in the code exists in messages or templates", () => {
    const codes = new Set(sources.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bcompose_[a-z_]+/g)].map((m) => m[0])));
    expect(codes.size).toBeGreaterThan(10);
    for (const code of codes) expect(Object.hasOwn(messages, code) || Object.hasOwn(templates, code), code).toBe(true);
  });
  it("the texts of data-model.md", () => {
    expect(messages.compose_attachments_too_large).toBe("Attachments can be 25 MB in total at most.");
    expect(messages.compose_attachment_gone).toBe("One of the attached files is no longer on the record. Remove it and send again.");
    expect(messages.compose_reconnect_gmail).toBe("Reconnect your Gmail in Settings to send email from the CRM.");
    expect(messages.compose_footer).toBe("Sent from your Gmail. It shows on this record and on the CRM people it goes to.");
    expect(templates.compose_address_invalid("ana@")).toBe("ana@ is not a valid email address.");
    const five = ["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"].join(", ");
    expect(templates.email_sent(five, 7)).toBe(`Email sent to ${five} and 2 more.`);
  });
});
