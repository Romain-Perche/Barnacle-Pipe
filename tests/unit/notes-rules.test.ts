// covers SF-102 FR-005, FR-010, FR-012, FR-016, US1 scenarios 2–3, US3 scenarios 1–2, Edge Cases (email stays text,
// renamed user shows current name), data-model.md § Validation, research.md §3, §7
import { describe, expect, it } from "vitest";
import {
  detokenize, noteSegments, notificationPreview, parseShown, tokenizeMentions, validateNoteText,
} from "@/server/records/notes-rules";

describe("validateNoteText", () => {
  it("trims and keeps inner line breaks", () => {
    expect(validateNoteText("  Called Ada\nwants a proposal \n")).toEqual({ ok: true, text: "Called Ada\nwants a proposal" });
  });
  it("refuses empty text and spaces only", () => {
    expect(validateNoteText("")).toEqual({ ok: false, code: "note_required" });
    expect(validateNoteText("   \n\t ")).toEqual({ ok: false, code: "note_required" });
  });
  it("accepts exactly 10,000 characters and refuses 10,001", () => {
    expect(validateNoteText("x".repeat(10_000))).toEqual({ ok: true, text: "x".repeat(10_000) });
    expect(validateNoteText(` ${"x".repeat(10_000)} `)).toEqual({ ok: true, text: "x".repeat(10_000) });
    expect(validateNoteText("x".repeat(10_001))).toEqual({ ok: false, code: "note_too_long" });
  });
  // covers FR-005, fix round 1: the browser posts a line break as CRLF; the box's maxlength counts it as 1
  it("counts a CRLF or lone CR line break as one character and returns the text with LF only", () => {
    const text = `${"a".repeat(5_000)}\r\n${"a".repeat(4_998)}`;
    expect(validateNoteText(text)).toEqual({ ok: true, text: `${"a".repeat(5_000)}\n${"a".repeat(4_998)}` });
    expect(validateNoteText(`${"a".repeat(9_999)}\r\n`)).toEqual({ ok: true, text: "a".repeat(9_999) });
    expect(validateNoteText(`one\rtwo\r\nthree`)).toEqual({ ok: true, text: "one\ntwo\nthree" });
    expect(validateNoteText(`${"a".repeat(5_000)}\r\n${"a".repeat(5_000)}`)).toEqual({ ok: false, code: "note_too_long" });
  });
});

describe("tokenizeMentions", () => {
  const users = [{ id: 2, name: "Bob Fake" }, { id: 3, name: "Bob Fakeson" }];
  it("replaces each chosen @name with a token, longest names first", () => {
    expect(tokenizeMentions("Hi @Bob Fake and @Bob Fakeson", users)).toEqual({ body: "Hi @[user:2] and @[user:3]", ids: [2, 3] });
  });
  it("drops an id whose @name is no longer in the text", () => {
    expect(tokenizeMentions("Hi @Bob Fakeson", users)).toEqual({ body: "Hi @[user:3]", ids: [3] });
  });
  it("leaves an email address and an unchosen @name as typed", () => {
    expect(tokenizeMentions("Write to ada@example.fake or @Cy Fake", users)).toEqual({ body: "Write to ada@example.fake or @Cy Fake", ids: [] });
  });
  it("replaces every occurrence of the same mention and lists the id once", () => {
    expect(tokenizeMentions("@Bob Fake, @Bob Fake", [users[0]])).toEqual({ body: "@[user:2], @[user:2]", ids: [2] });
  });
  // covers Edge case 5, fix round 1
  it("replaces a chosen @name only where the name ends at a word end", () => {
    expect(tokenizeMentions("@Bob Fake and @Bob Fakeson", [users[0]])).toEqual({ body: "@[user:2] and @Bob Fakeson", ids: [2] });
    expect(tokenizeMentions("@Bob Fakeson only", [users[0]])).toEqual({ body: "@Bob Fakeson only", ids: [] });
    expect(tokenizeMentions("ask @Bob Fake", [users[0]])).toEqual({ body: "ask @[user:2]", ids: [2] });
    expect(tokenizeMentions("@Bob Fake2 or @Bob Fakeé", [users[0]])).toEqual({ body: "@Bob Fake2 or @Bob Fakeé", ids: [] });
  });
});

describe("detokenize and noteSegments", () => {
  const names = new Map([[2, "Robert Fake"]]);
  it("turns tokens back into the current names", () => {
    expect(detokenize("Hi @[user:2]!", names)).toBe("Hi @Robert Fake!");
  });
  it("splits text and mentions; an unknown token stays text", () => {
    expect(noteSegments("Hi @[user:2], see @[user:9]\nbye", names)).toEqual([
      { text: "Hi " },
      { mention: "Robert Fake" },
      { text: ", see @[user:9]\nbye" },
    ]);
    expect(detokenize("x @[user:9]", names)).toBe("x @[user:9]");
  });
  it("gives one text segment for a note without mentions", () => {
    expect(noteSegments("<b>plain</b>", new Map())).toEqual([{ text: "<b>plain</b>" }]);
  });
});

describe("notificationPreview", () => {
  it("shows the visible text, cut to 200 characters with …", () => {
    expect(notificationPreview("@[user:2] can you send it?", new Map([[2, "Bob Fake"]]))).toBe("@Bob Fake can you send it?");
    expect(notificationPreview("a".repeat(200), new Map())).toBe("a".repeat(200));
    expect(notificationPreview("a".repeat(201), new Map())).toBe(`${"a".repeat(200)}…`);
  });
  it("never cuts a surrogate pair", () => {
    const text = `${"a".repeat(199)}😀😀`;
    expect(notificationPreview(text, new Map())).toBe(`${"a".repeat(199)}😀…`);
  });
});

describe("parseShown", () => {
  it("accepts multiples of 50 from 50 to 5,000, else 50", () => {
    for (const v of [undefined, "", "abc", "0", "75", "-50", "999999", "5050", "100.0", " 100"]) expect(parseShown(v), String(v)).toBe(50);
    expect(parseShown("100")).toBe(100);
    expect(parseShown("5000")).toBe(5000);
    expect(parseShown(["150", "200"])).toBe(150);
  });
});

// covers SF-114 FR-009, FR-010: the ambassador page's `?updates=` (20 at a time) and `?people=` / `?deals=` (50)
import { parseShownBy } from "@/server/records/notes-rules";
describe("parseShownBy", () => {
  it("takes multiples of the step from the step to 5,000, else the step", () => {
    expect(parseShownBy("40", 20)).toBe(40);
    expect(parseShownBy("20", 20)).toBe(20);
    expect(parseShownBy("5000", 20)).toBe(5000);
    for (const v of ["30", "0", "abc", "5020", "", undefined, "-20"]) expect(parseShownBy(v, 20)).toBe(20);
    expect(parseShownBy(["60", "80"], 20)).toBe(60);
  });
  it("leaves parseShown as it was (step 50)", () => {
    for (const v of ["50", "100", "5000", "75", "0", "x", undefined]) expect(parseShown(v)).toBe(parseShownBy(v, 50));
    expect(parseShown("100")).toBe(100);
    expect(parseShown("75")).toBe(50);
  });
});
