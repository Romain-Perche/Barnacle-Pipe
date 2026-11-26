// covers SF-127 FR-002, FR-004, FR-011, FR-016, contracts/routes.md § EMAIL timeline entry and § download route:
// the pure rules of email on the timeline (text from HTML, preview, recipients line, back link, merge of hand choices,
// the download's Content-Disposition).
import { describe, expect, it } from "vitest";
import {
  addressText,
  contentDisposition,
  emailPreview,
  emailText,
  mergeLinkChoice,
  parseFrom,
  parseLinkKind,
  recipientsLine,
  subjectOrDefault,
} from "@/server/emails/rules";
import { messages, templates } from "@/server/messages";

describe("emailText (FR-004)", () => {
  it("takes the text part when there is one", () => {
    expect(emailText("Hi Ada", "<p>Other</p>")).toBe("Hi Ada");
  });
  it("turns HTML into plain text when there is no text part: no script, style or markup", () => {
    // covers US1 scenario 7, US2 scenario 2
    const t = emailText(null, "<style>p{color:red}</style><p>Hello <b>Ada</b></p><script>alert(1)</script><img src=x>");
    expect(t).toBe("Hello Ada");
  });
  it("decodes entities once, so escaped markup stays text", () => {
    expect(emailText(null, "<p>&lt;b&gt;bold&lt;/b&gt;</p>")).toBe("<b>bold</b>");
  });
  it("is null when there is no text at all (attachments only)", () => {
    expect(emailText(null, null)).toBeNull();
    expect(emailText("  \n ", null)).toBeNull();
    expect(emailText("", "<p> </p>")).toBeNull();
  });
});

describe("emailPreview (FR-002, edge case 'Very long email')", () => {
  it("collapses whitespace runs", () => {
    expect(emailPreview("Hi Ada,\n\n  here   are\tthe figures")).toBe("Hi Ada, here are the figures");
  });
  it("keeps at most 200 code points, then …", () => {
    const long = "é".repeat(150) + "😀".repeat(100);
    const p = emailPreview(long)!;
    expect([...p]).toHaveLength(201);
    expect(p.endsWith("…")).toBe(true);
    expect(emailPreview("a".repeat(200))).toBe("a".repeat(200));
  });
  it("is null without text", () => {
    expect(emailPreview(null)).toBeNull();
    expect(emailPreview("   ")).toBeNull();
  });
});

describe("recipientsLine (FR-002)", () => {
  const ana = { email: "ana@example.test", name: "Ana Example" };
  const ada = { email: "ada@barnacle.ai", name: "Ada Fake" };
  const ben = { email: "ben@example.test", name: null };
  it("names the sender and the To recipients, a bare address when no name", () => {
    expect(recipientsLine({ from: ana, to: [ada], cc: [], bcc: [] })).toBe("Ana Example → Ada Fake");
    expect(recipientsLine({ from: { email: "x@y.test", name: null }, to: [ada, ben], cc: [], bcc: [] })).toBe("x@y.test → Ada Fake, ben@example.test");
  });
  it("adds Cc, and Bcc only when the copy has it", () => {
    // covers US1 scenario 5
    expect(recipientsLine({ from: ana, to: [ada], cc: [ben], bcc: [] })).toBe("Ana Example → Ada Fake · Cc ben@example.test");
    expect(recipientsLine({ from: ada, to: [ana], cc: [], bcc: [ben] })).toBe("Ada Fake → Ana Example · Bcc ben@example.test");
  });
  it("a missing sender reads as the fixed text", () => {
    expect(recipientsLine({ from: null, to: [ada], cc: [], bcc: [] })).toBe(`${messages.email_unknown_sender} → Ada Fake`);
  });
  it("addressText: name and address, or the address", () => {
    expect(addressText(ana)).toBe("Ana Example <ana@example.test>");
    expect(addressText(ben)).toBe("ben@example.test");
  });
});

describe("subjectOrDefault (edge case 'Missing subject')", () => {
  it("gives (no subject) for an empty or blank subject", () => {
    expect(subjectOrDefault("")).toBe(messages.email_no_subject);
    expect(subjectOrDefault("  ")).toBe(messages.email_no_subject);
    expect(subjectOrDefault("Proposal")).toBe("Proposal");
  });
  it("conversation_count", () => {
    expect(templates.conversation_count(1)).toBe("CONVERSATION · 1 EMAIL");
    expect(templates.conversation_count(3)).toBe("CONVERSATION · 3 EMAILS");
  });
});

describe("parseFrom / parseLinkKind (contracts/routes.md § conversation page: never text from the URL)", () => {
  it("reads person-, organisation- and deal- ids", () => {
    expect(parseFrom("person-12")).toEqual({ kind: "person", id: 12 });
    expect(parseFrom("organisation-3")).toEqual({ kind: "organisation", id: 3 });
    expect(parseFrom("deal-5")).toEqual({ kind: "deal", id: 5 });
  });
  it("anything else is null", () => {
    for (const v of [undefined, "", "person", "person-", "person-0", "person-01", "person-1x", "user-1", "deal-99999999999999999999", "<b>-1"]) {
      expect(parseFrom(v)).toBeNull();
    }
  });
  it("link kinds", () => {
    expect(parseLinkKind("deal")).toBe("deal");
    expect(parseLinkKind("person")).toBe("person");
    expect(parseLinkKind("organisation")).toBe("organisation");
    expect(parseLinkKind("org")).toBeNull();
    expect(parseLinkKind(undefined)).toBeNull();
  });
});

describe("mergeLinkChoice (FR-011, Plan clarification: two conversations found to be one)", () => {
  const t1 = new Date("2026-11-20T10:00:00Z");
  const t2 = new Date("2026-11-21T10:00:00Z");
  const auto = { how: "auto" as const, removed: false, changedAt: t2 };
  it("a hand choice beats an automatic link", () => {
    const manual = { how: "manual" as const, removed: false, changedAt: t1 };
    const unlinked = { how: "auto" as const, removed: true, changedAt: t1 };
    expect(mergeLinkChoice(auto, manual)).toBe(manual);
    expect(mergeLinkChoice(manual, auto)).toBe(manual);
    expect(mergeLinkChoice(auto, unlinked)).toBe(unlinked);
    expect(mergeLinkChoice(unlinked, auto)).toBe(unlinked);
  });
  it("between two hand choices the later wins", () => {
    const linked = { how: "manual" as const, removed: false, changedAt: t1 };
    const unlinked = { how: "manual" as const, removed: true, changedAt: t2 };
    expect(mergeLinkChoice(linked, unlinked)).toBe(unlinked);
    expect(mergeLinkChoice(unlinked, linked)).toBe(unlinked);
  });
  it("two automatic links: the first", () => {
    const other = { ...auto };
    expect(mergeLinkChoice(auto, other)).toBe(auto);
  });
});

describe("contentDisposition (FR-006: always a download under its name)", () => {
  it("an attachment with the ASCII name and the UTF-8 name", () => {
    expect(contentDisposition("figures.pdf")).toBe(`attachment; filename="figures.pdf"; filename*=UTF-8''figures.pdf`);
  });
  it("non-ASCII names: ASCII fallback with _, percent-encoded UTF-8", () => {
    expect(contentDisposition("Récap été.pdf")).toBe(`attachment; filename="R_cap _t_.pdf"; filename*=UTF-8''R%C3%A9cap%20%C3%A9t%C3%A9.pdf`);
  });
  it("never lets quotes, CR/LF or path characters into the header", () => {
    const h = contentDisposition('a"b\r\nSet-Cookie: x=1/..\\c.txt');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/"/g)).toHaveLength(2);
    expect(h).toContain(`filename="a_b__Set-Cookie_ x=1_.._c.txt"`);
    expect(contentDisposition("it's (1)!.txt")).toContain("filename*=UTF-8''it%27s%20%281%29!.txt");
  });
});
