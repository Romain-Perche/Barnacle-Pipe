// covers SF-129 FR-004, FR-005, FR-022, Edge Cases "Addresses" and "Required fields": the pure checks of the email
// box (src/server/emails/compose-rules.ts) and the "Email sent to …" notice.
import { describe, expect, it } from "vitest";
import {
  normaliseRecipients, sentNotice, splitAddresses, totalBytes, validateCompose,
} from "@/server/emails/compose-rules";
import { templates } from "@/server/messages";

const ok = { to: ["ana@example.test"], cc: [], bcc: [], subject: "Next steps", text: "Hi" };
const codes = (input: Parameters<typeof validateCompose>[0]) => validateCompose(input).map((e) => e.code);

describe("splitAddresses", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(splitAddresses("a@example.test, b@example.test; c@example.test")).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    expect(splitAddresses(" a@example.test\nb@example.test  c@example.test ")).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    expect(splitAddresses(" ,; ")).toEqual([]);
  });
});

describe("normaliseRecipients", () => {
  it("keeps a duplicate once, in the first field, as typed there", () => {
    expect(normaliseRecipients({ to: ["Ana@Example.test"], cc: ["ana@example.test ", "ben@example.test"], bcc: ["BEN@example.test", " "] })).toEqual({
      to: ["Ana@Example.test"], cc: ["ben@example.test"], bcc: [],
    });
  });
});

describe("validateCompose", () => {
  it("passes a filled email, an empty text included", () => {
    expect(codes(ok)).toEqual([]);
    expect(codes({ ...ok, text: "" })).toEqual([]);
  });
  it("names each invalid address", () => {
    expect(validateCompose({ ...ok, cc: ["ana@"] })).toEqual([{ code: "compose_address_invalid", address: "ana@" }]);
  });
  it("refuses header-unsafe addresses (CR, LF, <, >, comma)", () => {
    for (const bad of ["ana@example.test\r\nBcc: x@example.test", "ana@exa\nmple.test", "<ana@example.test>", "ana,b@example.test", "a>b@example.test"]) {
      expect(codes({ ...ok, to: [bad] })).toContain("compose_address_invalid");
    }
  });
  it("requires To and a subject", () => {
    expect(codes({ ...ok, to: [], cc: ["ana@example.test"] })).toEqual(["compose_to_required"]);
    expect(codes({ ...ok, subject: "   " })).toEqual(["compose_subject_required"]);
  });
  it("100 distinct addresses pass, 101 are refused", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.test`);
    expect(codes({ ...ok, to: many(100) })).toEqual([]);
    expect(codes({ ...ok, to: many(60), cc: many(101).slice(60) })).toEqual(["compose_too_many_addresses"]);
  });
  it("counts the subject and the text in code points", () => {
    expect(codes({ ...ok, subject: "🎉".repeat(250) })).toEqual([]);
    expect(codes({ ...ok, subject: "a".repeat(251) })).toEqual(["compose_subject_too_long"]);
    expect(codes({ ...ok, text: "é".repeat(100_000) })).toEqual([]);
    expect(codes({ ...ok, text: "a".repeat(100_001) })).toEqual(["compose_text_too_long"]);
  });
  it("attachments: 25 MB in total pass, one byte more is refused", () => {
    expect(totalBytes([24 * 1024 * 1024, 1024 * 1024])).toBe(26_214_400);
    expect(codes({ ...ok, attachmentBytes: 26_214_400 })).toEqual([]);
    expect(codes({ ...ok, attachmentBytes: 26_214_401 })).toEqual(["compose_attachments_too_large"]);
  });
  it("lists every failing rule at once", () => {
    expect(codes({ to: [], cc: [], bcc: [], subject: "", text: "a".repeat(100_001) })).toEqual(["compose_to_required", "compose_subject_required", "compose_text_too_long"]);
  });
});

describe("sentNotice and templates.email_sent", () => {
  it("names the first 5 addresses, then 'and <n> more'", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `p${i}@example.test`);
    const n = sentNotice(seven);
    expect(n).toEqual({ name: seven.slice(0, 5).join(", "), count: 7 });
    expect(templates.email_sent(n.name, n.count)).toBe(`Email sent to ${seven.slice(0, 5).join(", ")} and 2 more.`);
    expect(templates.email_sent("ana@example.test", 1)).toBe("Email sent to ana@example.test.");
  });
  it("names fewer when they do not fit in 300 characters", () => {
    const long = Array.from({ length: 5 }, (_, i) => `${"x".repeat(100)}${i}@example.test`);
    const n = sentNotice(long);
    expect(n.name.length).toBeLessThanOrEqual(300);
    expect(n.name.split(", ")).toHaveLength(2);
    expect(templates.email_sent(n.name, n.count)).toMatch(/ and 3 more\.$/);
  });
});
