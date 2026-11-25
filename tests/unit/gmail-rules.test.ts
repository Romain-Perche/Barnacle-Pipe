// covers SF-118 FR-002 (scopes), FR-006 (key refused), FR-009 (what is copied), FR-010 (what is kept), FR-013 (sending
// without header injection), US2 scenario 7, edge cases "Address match", "Drafts, spam, bin", "Messages with only HTML
// or only attachments" (research.md §2, §5, §9, §10)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadHeader,
  buildMime,
  classifyGoogleError,
  decideCopy,
  decodeHeader,
  askedScopes,
  CALENDAR_SCOPE,
  GMAIL_SCOPES,
  hasAllScopes,
  hasCalendarScope,
  parseAddressList,
  readMessage,
  testEmail,
  type GmailMessage,
} from "@/server/gmail/rules";

const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("scopes", () => {
  // SF-118's two scopes alone: Calendar sync off (SF-124 adds the third scope when it is on).
  beforeEach(() => void vi.stubEnv("CALENDAR_SYNC", ""));
  afterEach(() => void vi.unstubAllEnvs());
  it("asks for exactly gmail.modify and gmail.send", () => {
    expect([...GMAIL_SCOPES]).toEqual([MODIFY, SEND]);
  });
  it("needs both, in any order, extra scopes allowed", () => {
    expect(hasAllScopes(`${MODIFY} ${SEND}`)).toBe(true);
    expect(hasAllScopes(`${SEND}  ${MODIFY} openid`)).toBe(true);
    expect(hasAllScopes(MODIFY)).toBe(false);
    expect(hasAllScopes(SEND)).toBe(false);
    expect(hasAllScopes("")).toBe(false);
    expect(hasAllScopes(`${MODIFY}x ${SEND}`)).toBe(false);
  });
});

// covers SF-124 FR-001, US1 scenario 2, edge case "Calendar not set up" (research.md §2): with Calendar on, connecting
// asks for calendar.events.owned on top of the two Gmail scopes, and a grant without it is refused.
describe("scopes with Google Calendar (SF-124)", () => {
  const CAL = "https://www.googleapis.com/auth/calendar.events.owned";
  afterEach(() => void vi.unstubAllEnvs());
  it("asks 3 scopes with Calendar on, 2 with it off", () => {
    expect(CALENDAR_SCOPE).toBe(CAL);
    vi.stubEnv("CALENDAR_SYNC", "on");
    expect(askedScopes()).toEqual([MODIFY, SEND, CAL]);
    vi.stubEnv("CALENDAR_SYNC", "");
    expect(askedScopes()).toEqual([MODIFY, SEND]);
  });
  it("refuses a grant without the Calendar scope when on, accepts it when off", () => {
    vi.stubEnv("CALENDAR_SYNC", "on");
    expect(hasAllScopes(`${MODIFY} ${SEND}`)).toBe(false);
    expect(hasAllScopes(`${MODIFY} ${SEND} ${CAL}`)).toBe(true);
    expect(hasAllScopes(`${MODIFY} ${CAL}`)).toBe(false);
    vi.stubEnv("CALENDAR_SYNC", "");
    expect(hasAllScopes(`${MODIFY} ${SEND}`)).toBe(true);
    expect(hasAllScopes(`${MODIFY} ${SEND}`, [MODIFY, SEND, CAL])).toBe(false);
  });
  it("tells whether a scopes text holds the Calendar scope", () => {
    expect(hasCalendarScope(`${MODIFY} ${CAL}`)).toBe(true);
    expect(hasCalendarScope(`${MODIFY} ${CAL}x`)).toBe(false);
    expect(hasCalendarScope("")).toBe(false);
  });
});

describe("parseAddressList", () => {
  it("reads quoted names, commas inside quotes included", () => {
    expect(parseAddressList(`"Ana Fake" <ana@example.test>, "Kim, Fake" <kim@example.test>`)).toEqual([
      { email: "ana@example.test", name: "Ana Fake" },
      { email: "kim@example.test", name: "Kim, Fake" },
    ]);
  });
  it("lower-cases and trims an address", () => {
    expect(parseAddressList("ANA@Example.test ")).toEqual([{ email: "ana@example.test", name: null }]);
    expect(parseAddressList("Ana <ANA@Example.TEST>")).toEqual([{ email: "ana@example.test", name: "Ana" }]);
  });
  it("reads groups and comments, and drops an address-less display name", () => {
    expect(parseAddressList("Team: a@example.test, B <b@example.test>;, c@example.test")).toEqual([
      { email: "a@example.test", name: null },
      { email: "b@example.test", name: "B" },
      { email: "c@example.test", name: null },
    ]);
    expect(parseAddressList("ana@example.test (Ana Fake)")).toEqual([{ email: "ana@example.test", name: "Ana Fake" }]);
    expect(parseAddressList("Ana (work) <ana@example.test>")).toEqual([{ email: "ana@example.test", name: "Ana" }]);
    expect(parseAddressList("Ana Fake")).toEqual([]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
  it("decodes an encoded display name", () => {
    expect(parseAddressList("=?utf-8?B?w4FuYQ==?= <ana@example.test>")).toEqual([{ email: "ana@example.test", name: "Ána" }]);
  });
});

describe("decodeHeader", () => {
  it("decodes RFC 2047 B and Q words, joining adjacent ones", () => {
    expect(decodeHeader("=?utf-8?B?Q2Fmw6kgbWVldGluZw==?=")).toBe("Café meeting");
    expect(decodeHeader("=?ISO-8859-1?Q?Caf=E9_au_lait?=")).toBe("Café au lait");
    expect(decodeHeader("Re: =?utf-8?Q?a?= =?utf-8?Q?b?= end")).toBe("Re: ab end");
    expect(decodeHeader("Plain subject")).toBe("Plain subject");
  });
});

const header = (name: string, value: string) => ({ name, value });
function message(over: Partial<GmailMessage> & { headers?: { name: string; value: string }[]; parts?: NonNullable<GmailMessage["payload"]>["parts"] } = {}): GmailMessage {
  return {
    id: over.id ?? "m1",
    threadId: over.threadId ?? "t1",
    labelIds: over.labelIds ?? ["INBOX"],
    internalDate: over.internalDate ?? String(Date.UTC(2026, 10, 24, 10)),
    payload: over.payload ?? {
      mimeType: "multipart/mixed",
      headers: over.headers ?? [
        header("From", `"Ana Fake" <ana@example.test>`),
        header("To", "linus@barnacle.ai"),
        header("Subject", "Hello"),
        header("Message-ID", "<abc@example.test>"),
        header("Date", "Tue, 24 Nov 2026 09:59:00 +0000"),
      ],
      parts: over.parts ?? [],
    },
  };
}

describe("readMessage", () => {
  it("keeps the text and the HTML, the addresses, the subject, the ids and both dates", () => {
    const m = readMessage(
      message({
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", headers: [header("Content-Type", "text/plain; charset=UTF-8")], body: { size: 5, data: b64("Hi, é") } },
              { mimeType: "text/html", body: { size: 12, data: b64("<p>Hi, é</p>") } },
            ],
          },
        ],
      }),
    );
    expect(m).toMatchObject({
      gmailMessageId: "m1",
      gmailThreadId: "t1",
      rfcMessageId: "<abc@example.test>",
      direction: "received",
      from: { email: "ana@example.test", name: "Ana Fake" },
      to: [{ email: "linus@barnacle.ai", name: null }],
      cc: [],
      bcc: [],
      subject: "Hello",
      textBody: "Hi, é",
      htmlBody: "<p>Hi, é</p>",
      attachments: [],
    });
    expect(m.receivedAt.toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(m.sentAt?.toISOString()).toBe("2026-11-24T09:59:00.000Z");
  });
  it("reads an HTML-only message (no text) and a Latin-1 body", () => {
    const m = readMessage(message({ parts: [{ mimeType: "text/html", body: { size: 9, data: b64("<b>x</b>") } }] }));
    expect(m.textBody).toBeNull();
    expect(m.htmlBody).toBe("<b>x</b>");
    const latin = readMessage(
      message({ parts: [{ mimeType: "text/plain", headers: [header("Content-Type", 'text/plain; charset="iso-8859-1"')], body: { size: 4, data: Buffer.from([0x43, 0x61, 0x66, 0xe9]).toString("base64url") } }] }),
    );
    expect(latin.textBody).toBe("Café");
  });
  it("reads an attachments-only message: names, types and sizes, never contents", () => {
    const m = readMessage(
      message({
        parts: [
          { partId: "1", mimeType: "application/pdf", filename: "contract.pdf", body: { size: 20971520, attachmentId: "att-1" } },
          { partId: "2", mimeType: "image/png", filename: "", body: { size: 1234, attachmentId: "att-2" } },
          { partId: "3", mimeType: "text/plain", filename: `${"n".repeat(300)}.txt`, body: { size: 3, data: b64("abc") } },
        ],
      }),
    );
    expect(m.textBody).toBeNull();
    expect(m.htmlBody).toBeNull();
    expect(m.attachments).toEqual([
      { name: "contract.pdf", contentType: "application/pdf", size: 20971520 },
      { name: "(no name)", contentType: "image/png", size: 1234 },
      { name: "n".repeat(255), contentType: "text/plain", size: 3 },
    ]);
    expect(JSON.stringify(m)).not.toContain("att-1");
  });
  it("is sent when Gmail labels it SENT; received_at comes from internalDate, not the Date line", () => {
    const m = readMessage(message({ labelIds: ["SENT"], internalDate: "1700000000000", headers: [header("Date", "Mon, 1 Jan 1990 00:00:00 +0000")] }));
    expect(m.direction).toBe("sent");
    expect(m.receivedAt.getTime()).toBe(1700000000000);
    expect(m.sentAt?.getUTCFullYear()).toBe(1990);
    expect(readMessage(message({ headers: [header("Date", "not a date")] })).sentAt).toBeNull();
  });
  it("drops NUL characters Postgres can't store, and a Message-ID over 998 characters", () => {
    const m = readMessage(message({ headers: [header("Subject", "a\u0000b"), header("Message-ID", `<${"x".repeat(1000)}>`)], parts: [{ mimeType: "text/plain", body: { size: 3, data: b64("a\u0000b") } }] }));
    expect(m.subject).toBe("ab");
    expect(m.textBody).toBe("ab");
    expect(m.rfcMessageId).toBeNull();
  });
});

describe("decideCopy", () => {
  const connectedAt = new Date("2026-11-24T09:00:00Z");
  const base = { labelIds: ["INBOX"], internalDate: new Date("2026-11-24T10:00:00Z"), connectedAt, threadKnown: false, addresses: ["ana@example.test"], crmAddresses: new Set(["ana@example.test"]) };
  it("copies a message with a CRM address after the connection", () => {
    expect(decideCopy(base)).toBe("copy");
  });
  it.each(["DRAFT", "SPAM", "TRASH"])("skips %s", (label) => {
    expect(decideCopy({ ...base, labelIds: ["INBOX", label] })).toBe("skip");
    expect(decideCopy({ ...base, labelIds: [label], threadKnown: true })).toBe("skip");
  });
  it("skips a message from before the connection, even in a known thread", () => {
    expect(decideCopy({ ...base, internalDate: new Date("2026-11-23T10:00:00Z") })).toBe("skip");
    expect(decideCopy({ ...base, internalDate: new Date("2026-11-23T10:00:00Z"), threadKnown: true })).toBe("skip");
  });
  it("copies a message in a known thread with no CRM address", () => {
    expect(decideCopy({ ...base, addresses: ["kim@barnacle.ai"], threadKnown: true })).toBe("copy");
    expect(decideCopy({ ...base, addresses: ["kim@barnacle.ai"] })).toBe("skip");
  });
  it("copies when the CRM address is only in Bcc, and skips when only the display name matches", () => {
    const bccOnly = readMessage(message({ headers: [header("From", "linus@barnacle.ai"), header("Bcc", "ANA@Example.test ")] }));
    const nameOnly = readMessage(message({ headers: [header("From", `"Ana Fake" <other@example.test>`)] }));
    const crm = new Set(["ana@example.test"]);
    expect(decideCopy({ ...base, addresses: bccOnly.addresses, crmAddresses: crm })).toBe("copy");
    expect(nameOnly.addresses).toEqual(["other@example.test"]);
    expect(decideCopy({ ...base, addresses: nameOnly.addresses, crmAddresses: new Set(["ana fake"]) })).toBe("skip");
  });
});

describe("buildMime", () => {
  const plain = { from: "linus@barnacle.ai", to: ["ana@example.test"], subject: "Hello", text: "Hi Ana" };
  const decodeBodies = (mime: string) =>
    [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
  it("builds a text/plain message with base64 body and CRLF lines", () => {
    const mime = buildMime({ ...plain, cc: ["kim@example.test"] });
    expect(mime).toContain("From: linus@barnacle.ai\r\n");
    expect(mime).toContain("To: ana@example.test\r\n");
    expect(mime).toContain("Cc: kim@example.test\r\n");
    expect(mime).toContain("Subject: Hello\r\n");
    expect(mime).toContain("MIME-Version: 1.0\r\n");
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toMatch(/\r\nDate: [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}\r\n/);
    expect(decodeBodies(mime)).toEqual(["Hi Ana"]);
    expect(mime).not.toMatch(/[^\r]\n/);
  });
  it("encodes a non-ASCII subject (RFC 2047)", () => {
    const mime = buildMime({ ...plain, subject: "Café ☕" });
    const subject = /\r\nSubject: (.*)\r\n/.exec(mime)![1];
    expect(subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeHeader(subject)).toBe("Café ☕");
  });
  it("uses multipart/alternative with HTML", () => {
    const mime = buildMime({ ...plain, html: "<p>Hi Ana</p>" });
    const boundary = /Content-Type: multipart\/alternative; boundary="([^"]+)"/.exec(mime)![1];
    expect(mime).toContain(`--${boundary}\r\nContent-Type: text/plain`);
    expect(mime).toContain(`--${boundary}\r\nContent-Type: text/html`);
    expect(mime).toContain(`--${boundary}--`);
    expect(decodeBodies(mime)).toEqual(["Hi Ana", "<p>Hi Ana</p>"]);
  });
  it("adds In-Reply-To and References when given", () => {
    const mime = buildMime({ ...plain, inReplyTo: "<abc@example.test>", references: "<root@example.test> <abc@example.test>" });
    expect(mime).toContain("In-Reply-To: <abc@example.test>\r\n");
    expect(mime).toContain("References: <root@example.test> <abc@example.test>\r\n");
    expect(buildMime(plain)).not.toContain("In-Reply-To");
  });
  it("refuses CR or LF in the subject or an address, and an address that is not one (BadHeader)", () => {
    expect(() => buildMime({ ...plain, subject: "Hi\r\nBcc: evil@example.test" })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, subject: "Hi\nthere" })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, to: ["ana@example.test\r\nBcc: evil@example.test"] })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, cc: ["a@b.test, c@d.test"] })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, to: [] })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, inReplyTo: "<a>\r\nX: y" })).toThrow(BadHeader);
  });
  it("makes the test email to the user's own address with the fixed subject and text", () => {
    expect(testEmail("linus@barnacle.ai")).toEqual({
      to: ["linus@barnacle.ai"],
      subject: "Barnacle CRM test email",
      text: "This is a test email from Barnacle CRM. If you can read it, the CRM can send email from your Gmail.",
    });
  });
});

describe("classifyGoogleError", () => {
  it("is key_refused for invalid_grant, a Gmail 401 and a 403 for missing permissions", () => {
    expect(classifyGoogleError(400, { error: "invalid_grant" })).toBe("key_refused");
    expect(classifyGoogleError(401, { error: { code: 401, message: "x", status: "UNAUTHENTICATED" } })).toBe("key_refused");
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } })).toBe("key_refused");
    expect(classifyGoogleError(403, { error: { code: 403, details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } })).toBe("key_refused");
  });
  it("is unavailable for anything else", () => {
    expect(classifyGoogleError(403, { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } })).toBe("unavailable");
    expect(classifyGoogleError(429, {})).toBe("unavailable");
    expect(classifyGoogleError(500, null)).toBe("unavailable");
    expect(classifyGoogleError(503, "oops")).toBe("unavailable");
    expect(classifyGoogleError(400, { error: "invalid_client" })).toBe("unavailable");
    expect(classifyGoogleError(401, { error: "invalid_client" })).toBe("unavailable");
    expect(classifyGoogleError(400, { error: "invalid_request" })).toBe("unavailable");
  });
});
