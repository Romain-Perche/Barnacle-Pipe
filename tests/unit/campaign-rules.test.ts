// covers SF-119 FR-003, FR-004, US1 scenarios 3–5, SC-006 (T009) and US6 / Edge Case "100 characters" (copyName): every
// draft limit and message, counted in code points, trimming, markup kept as typed, "Still empty" and the copy's name.
import { describe, expect, it } from "vitest";
import { copyName, stillEmpty, validateDraft } from "@/server/campaigns/rules";

const form = { name: "Exec dinner – March (fake)", senderName: "Ada Fake", replyTo: "", subject: "", previewText: "" };
const errors = (over: Partial<typeof form>) => {
  const r = validateDraft({ ...form, ...over });
  return r.ok ? {} : r.errors;
};

describe("validateDraft", () => {
  it("refuses each limit with its message", () => {
    expect(errors({ name: "  " })).toEqual({ name: "Give the campaign a name." });
    expect(errors({ name: "n".repeat(101) })).toEqual({ name: "A campaign name can be at most 100 characters." });
    expect(errors({ senderName: "s".repeat(101) })).toEqual({ senderName: "Sender name: at most 100 characters." });
    expect(errors({ replyTo: "not-an-email" })).toEqual({ replyTo: "Reply-to: enter one valid email address." });
    expect(errors({ replyTo: "a@x.test, b@x.test" })).toEqual({ replyTo: "Reply-to: enter one valid email address." });
    expect(errors({ subject: "s".repeat(256) })).toEqual({ subject: "Subject: at most 255 characters." });
    expect(errors({ previewText: "p".repeat(256) })).toEqual({ previewText: "Preview text: at most 255 characters." });
  });
  it("returns every error at once", () => {
    expect(Object.keys(errors({ name: "", subject: "s".repeat(256), replyTo: "x" }))).toEqual(["name", "replyTo", "subject"]);
  });
  it("accepts every limit, an empty reply-to and an emoji name of 100 code points", () => {
    const r = validateDraft({ name: "n".repeat(100), senderName: "s".repeat(100), replyTo: "", subject: "s".repeat(255), previewText: "p".repeat(255) });
    expect(r.ok).toBe(true);
    const emoji = "😀".repeat(100);
    expect(emoji.length).toBe(200);
    expect(validateDraft({ ...form, name: emoji }).ok).toBe(true);
  });
  it("trims outer spaces, normalises the reply-to and keeps markup as typed", () => {
    const r = validateDraft({ name: "  <script>x</script> ", senderName: " Ada ", replyTo: " Ada.Fake@Barnacle.AI ", subject: " Hi ", previewText: " p " });
    expect(r).toEqual({ ok: true, value: { name: "<script>x</script>", senderName: "Ada", replyTo: "ada.fake@barnacle.ai", subject: "Hi", previewText: "p" } });
  });
});

describe("stillEmpty (US1 scenario 5)", () => {
  it("names Sender name, Subject and Content when empty, in that order", () => {
    expect(stillEmpty({ senderName: "", subject: "", content: null })).toEqual(["Sender name", "Subject", "Content"]);
    expect(stillEmpty({ senderName: "Ada", subject: "", content: { kind: "html", html: "  " } })).toEqual(["Subject", "Content"]);
    expect(stillEmpty({ senderName: "Ada", subject: "Hi", content: { kind: "blocks", blocks: [{ type: "divider" }] } })).toEqual([]);
  });
});

describe("copyName", () => {
  it("is Copy of <name>, cut to 100 code points", () => {
    expect(copyName("Exec dinner")).toBe("Copy of Exec dinner");
    const copy = copyName("n".repeat(100));
    expect([...copy].length).toBe(100);
    expect(copy.startsWith("Copy of n")).toBe(true);
    expect([...copyName("😀".repeat(100))].length).toBe(100);
    expect(copyName("n".repeat(91) + " end")).toBe("Copy of " + "n".repeat(91)); // the cut ends on a space: trimmed
  });
});
