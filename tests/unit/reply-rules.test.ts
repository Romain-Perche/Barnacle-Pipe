// covers SF-130 FR-004 to FR-008, FR-010, US1 scenarios 1, 4, 5, US3 scenarios 1–3, US4 scenarios 1, 2, 5, edge cases
// "No sender address", "Reply to an email the user sent only to themselves", "Reply all where only the user remains",
// "Quote of an HTML-only email", "Characters": the pure rules of reply-rules.ts.
import { describe, expect, it } from "vitest";
import {
  bodyWithQuote, forwardQuote, forwardSubject, MESSAGE_ID, parseEmailParam, prefill, quoteDate, referencesFor, replyQuote, replySubject,
  type ReplyEmail,
} from "@/server/emails/reply-rules";

const OWN = "ada@barnacle.ai";
const ana = { email: "ana@example.test", name: "Ana Fake" };
const at = (email: string) => ({ email, name: null });

function email(o: Partial<ReplyEmail> = {}): ReplyEmail {
  return {
    from: ana, to: [{ email: OWN, name: "Ada Fake" }], cc: [], subject: "Pricing", receivedAt: new Date("2026-11-27T14:05:00Z"),
    textBody: "Hello Ada,\n\nHere is the price.", htmlBody: null, ...o,
  };
}

describe("parseEmailParam (T007, research §6)", () => {
  it("reads new and the three reply modes with an id", () => {
    expect(parseEmailParam("new")).toEqual({ mode: "new" });
    expect(parseEmailParam("reply-12")).toEqual({ mode: "reply", messageId: 12 });
    expect(parseEmailParam("reply-all-12")).toEqual({ mode: "reply_all", messageId: 12 });
    expect(parseEmailParam("forward-12")).toEqual({ mode: "forward", messageId: 12 });
  });
  it("refuses anything else", () => {
    for (const v of ["reply", "reply-0", "reply-x", "new-3", "reply-12345678901234567", "forward-", "reply-all", "REPLY-1", "", undefined, null, "reply-01"]) {
      expect(parseEmailParam(v)).toBeNull();
    }
  });
});

describe("prefill reply (FR-004, US1 scenarios 1 and 4, edge cases)", () => {
  it("a received email → its sender", () => {
    expect(prefill("reply", email(), OWN)).toEqual({ to: ["ana@example.test"], cc: [] });
  });
  it("an email the user sent (any case) → its To, Cc empty", () => {
    const sent = email({ from: { email: "Ada@Barnacle.AI", name: "Ada Fake" }, to: [at("ana@example.test")], cc: [at("ben@example.test")] });
    expect(prefill("reply", sent, OWN)).toEqual({ to: ["ana@example.test"], cc: [] });
  });
  it("sent only to themselves → their own address in To", () => {
    expect(prefill("reply", email({ from: at(OWN), to: [at(OWN)] }), OWN)).toEqual({ to: [OWN], cc: [] });
  });
  it("unknown sender → To empty", () => {
    expect(prefill("reply", email({ from: null }), OWN)).toEqual({ to: [], cc: [] });
  });
});

describe("prefill reply all (FR-005, US3 scenarios 1–3)", () => {
  it("received from ana to own + ben, cc cat → To [ana, ben], Cc [cat]", () => {
    const e = email({ to: [at(OWN), at("ben@example.test")], cc: [at("cat@example.test")] });
    expect(prefill("reply_all", e, OWN)).toEqual({ to: ["ana@example.test", "ben@example.test"], cc: ["cat@example.test"] });
  });
  it("sent by own to ana, cc ben, bcc dan → To [ana], Cc [ben], dan nowhere", () => {
    const e = { ...email({ from: at(OWN), to: [at("ana@example.test")], cc: [at("ben@example.test")] }), bcc: [at("dan@example.test")] };
    expect(prefill("reply_all", e, OWN)).toEqual({ to: ["ana@example.test"], cc: ["ben@example.test"] });
  });
  it("each address once at its first place; own address in another case left out", () => {
    const e = email({ to: [at("Ada@Barnacle.ai"), at("ben@example.test"), at("ANA@example.test")], cc: [at("ben@example.test"), at("cat@example.test"), at("cat@example.test")] });
    expect(prefill("reply_all", e, OWN)).toEqual({ to: ["ana@example.test", "ben@example.test"], cc: ["cat@example.test"] });
  });
  it("received to own alone → the sender only; sent to self alone → both empty", () => {
    expect(prefill("reply_all", email(), OWN)).toEqual({ to: ["ana@example.test"], cc: [] });
    expect(prefill("reply_all", email({ from: at(OWN), to: [at(OWN)] }), OWN)).toEqual({ to: [], cc: [] });
  });
  it("no sender: the other recipients", () => {
    expect(prefill("reply_all", email({ from: null, to: [at(OWN), at("ben@example.test")] }), OWN)).toEqual({ to: ["ben@example.test"], cc: [] });
  });
});

describe("prefill forward (FR-006)", () => {
  it("To and Cc empty", () => {
    expect(prefill("forward", email({ cc: [at("cat@example.test")] }), OWN)).toEqual({ to: [], cc: [] });
  });
});

describe("subjects (FR-007, US1 scenario 5, US4 scenario 5)", () => {
  it("Re:", () => {
    expect(replySubject("Pricing")).toBe("Re: Pricing");
    expect(replySubject("RE: Pricing")).toBe("RE: Pricing");
    expect(replySubject("Re: Re: Pricing")).toBe("Re: Re: Pricing");
    expect(replySubject("re:Pricing")).toBe("re:Pricing");
    expect(replySubject("")).toBe("Re: (no subject)");
    expect(replySubject("  ")).toBe("Re: (no subject)");
    expect(replySubject("Fwd: Pricing")).toBe("Re: Fwd: Pricing");
  });
  it("Fwd:", () => {
    expect(forwardSubject("Pricing")).toBe("Fwd: Pricing");
    for (const s of ["FWD: x", "Fw: x", "fw: x", "Fwd:x"]) expect(forwardSubject(s)).toBe(s);
    expect(forwardSubject("")).toBe("Fwd: (no subject)");
    expect(forwardSubject("Re: Pricing")).toBe("Fwd: Re: Pricing");
  });
});

describe("quoteDate (FR-008)", () => {
  it("UK time, GMT and BST", () => {
    expect(quoteDate(new Date("2026-11-27T14:05:00Z"))).toBe("27 Nov 2026 at 14:05");
    expect(quoteDate(new Date("2026-07-03T08:09:00Z"))).toBe("03 Jul 2026 at 09:09");
  });
});

describe("replyQuote (FR-008, edge cases)", () => {
  it("the On line then each line with > (an empty line gives >)", () => {
    expect(replyQuote(email({ textBody: "line 1\n\nline 3" }))).toBe("On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:\n> line 1\n>\n> line 3");
  });
  it("the address alone when there is no name; Unknown sender when there is no sender", () => {
    expect(replyQuote(email({ from: at("ana@example.test"), textBody: "x" }))).toBe("On 27 Nov 2026 at 14:05, ana@example.test wrote:\n> x");
    expect(replyQuote(email({ from: null, textBody: "x" }))).toBe("On 27 Nov 2026 at 14:05, Unknown sender wrote:\n> x");
  });
  it("HTML-only text as SF-127 shows it; <b>prix</b> 🎉 kept as text; CRLF made LF", () => {
    expect(replyQuote(email({ textBody: null, htmlBody: "<p>Bonjour</p><p>Merci</p>" }))).toMatch(/wrote:\n> Bonjour\n(>\n)?> Merci$/);
    expect(replyQuote(email({ textBody: "<b>prix</b> 🎉\r\nfin" }))).toBe("On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:\n> <b>prix</b> 🎉\n> fin");
  });
  it("no text: the On line only", () => {
    expect(replyQuote(email({ textBody: null, htmlBody: null }))).toBe("On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:");
  });
});

describe("forwardQuote (FR-008, US4 scenario 2)", () => {
  it("the forwarded block, then the text unchanged", () => {
    const e = email({ to: [{ email: OWN, name: "Ada Fake" }, at("ben@example.test")], textBody: "Hello\n\n> earlier" });
    expect(forwardQuote(e)).toBe(
      [
        "---------- Forwarded message ---------",
        "From: Ana Fake <ana@example.test>",
        "Date: 27 Nov 2026 at 14:05",
        "Subject: Pricing",
        "To: Ada Fake <ada@barnacle.ai>, ben@example.test",
        "",
        "Hello\n\n> earlier",
      ].join("\n"),
    );
  });
  it("no text: the block with nothing below it", () => {
    expect(forwardQuote(email({ textBody: null, subject: "" }))).toBe(
      "---------- Forwarded message ---------\nFrom: Ana Fake <ana@example.test>\nDate: 27 Nov 2026 at 14:05\nSubject: \nTo: Ada Fake <ada@barnacle.ai>",
    );
  });
});

describe("bodyWithQuote and referencesFor (FR-010)", () => {
  it("text, a blank line, the quote", () => {
    expect(bodyWithQuote("Thanks Ana,\n\nAgreed.", "On …")).toBe("Thanks Ana,\n\nAgreed.\n\nOn …");
  });
  it("oldest first, up to and including the answered one, duplicates and invalid ids dropped", () => {
    const ids = ["<a@x>", null, "<b@x>", "<a@x>", "not an id", "<c d@x>", "<c@x>", "<later@x>"];
    expect(referencesFor(ids, 6)).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(referencesFor(ids, 0)).toEqual(["<a@x>"]);
    expect(referencesFor([null], 0)).toEqual([]);
  });
  it("MESSAGE_ID", () => {
    expect(MESSAGE_ID.test("<abc@example.test>")).toBe(true);
    expect(MESSAGE_ID.test("<a b@x>")).toBe(false);
    expect(MESSAGE_ID.test("abc@x")).toBe(false);
    expect(MESSAGE_ID.test(`<${"a".repeat(997)}>`)).toBe(false);
  });
});
