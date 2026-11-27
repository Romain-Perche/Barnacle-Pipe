// covers SF-118 FR-018 (the fakes are checked against Google's published descriptions), T010 and T024: the fake Gmail
// refuses a request or an answer that gmail-api.json refuses, and a push body that pubsub-api.json's PubsubMessage
// refuses; well-formed calls pass.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPushBody, installGmailFake, TEST_GMAIL_KEY, type GmailFake } from "../fakes/gmail";

let fake: GmailFake;
const G = "https://gmail.googleapis.com/gmail/v1/users/me";

async function accessToken(email = "linus@barnacle.ai") {
  const code = fake.consent({
    email,
    scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send"],
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    redirectUri: "http://localhost:3000/settings/gmail/callback",
    clientId: fake.options.clientId,
    offline: true,
  });
  const res = await fake.checkedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:3000/settings/gmail/callback",
      client_id: fake.options.clientId,
      client_secret: fake.options.clientSecret,
      code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    }).toString(),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

beforeEach(() => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  fake = installGmailFake();
});

describe("Gmail requests and answers against gmail-api.json", () => {
  it("lets the app's calls through: profile, watch, history, list, get", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    fake.addMessage("linus@barnacle.ai", { from: "ana@example.test", to: "linus@barnacle.ai", subject: "Hi", text: "Hello", attachments: [{ name: "a.pdf", size: 10 }] });
    expect((await fake.checkedFetch(`${G}/profile`, { method: "GET", headers: auth })).status).toBe(200);
    const w = await fake.checkedFetch(`${G}/watch`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ topicName: "projects/p/topics/t" }) });
    expect(w.status).toBe(200);
    const h = await fake.checkedFetch(`${G}/history?startHistoryId=1&historyTypes=messageAdded&maxResults=500`, { method: "GET", headers: auth });
    expect(h.status).toBe(200);
    const list = (await (await fake.checkedFetch(`${G}/messages?q=after%3A0&maxResults=500&includeSpamTrash=false`, { method: "GET", headers: auth })).json()) as { messages: { id: string }[] };
    expect((await fake.checkedFetch(`${G}/messages/${list.messages[0].id}?format=full`, { method: "GET", headers: auth })).status).toBe(200);
    expect(fake.violations).toEqual([]);
  });
  it("refuses a watch body with `topic` instead of `topicName`", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
    await expect(fake.checkedFetch(`${G}/watch`, { method: "POST", headers: auth, body: JSON.stringify({ topic: "projects/p/topics/t" }) })).rejects.toThrow(
      /no property "topic" in WatchRequest/,
    );
    expect(fake.violations).toHaveLength(1);
    fake.violations.length = 0;
  });
  it("refuses history.list with an undeclared query parameter (startHistory)", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    await expect(fake.checkedFetch(`${G}/history?startHistory=1`, { method: "GET", headers: auth })).rejects.toThrow(/no query parameter "startHistory"/);
    fake.violations.length = 0;
  });
  it("refuses an answer of getProfile with `email` instead of `emailAddress`", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    fake.tamper(({ emailAddress, ...rest }) => ({ ...rest, email: emailAddress }));
    await expect(fake.checkedFetch(`${G}/profile`, { method: "GET", headers: auth })).rejects.toThrow(/no property "email" in Profile/);
    fake.violations.length = 0;
  });
  it("refuses an int64 sent as a number and a path Gmail does not have", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    fake.tamper((b) => ({ ...b, historyId: 123 }));
    await expect(fake.checkedFetch(`${G}/profile`, { method: "GET", headers: auth })).rejects.toThrow(/historyId must be a string/);
    await expect(fake.checkedFetch(`${G}/mailboxes`, { method: "GET", headers: auth })).rejects.toThrow(/no GET/);
    fake.violations.length = 0;
  });
});

describe("SF-127: messages.get and messages.attachments.get against gmail-api.json", () => {
  // covers SF-127 FR-006, contracts/gmail.md § Fake, T011, T019
  const addWithFile = (o: { inline?: boolean } = {}) =>
    fake.addMessage("linus@barnacle.ai", { from: "ana@example.test", to: "linus@barnacle.ai", subject: "F", text: "x", attachments: [{ name: "figures.pdf", size: 5, data: "%PDF!", inline: o.inline }] });
  const part = async (auth: Record<string, string>, id: string) =>
    ((await (await fake.checkedFetch(`${G}/messages/${id}?format=full`, { method: "GET", headers: auth })).json()) as { payload: { parts: { filename: string; body: { attachmentId?: string; data?: string } }[] } }).payload.parts.find((p) => p.filename === "figures.pdf")!;
  it("serves an attachment's bytes as MessagePartBody { size, data } (base64url); an inline part carries them in body.data", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { id } = addWithFile();
    const p = await part(auth, id);
    const res = await fake.checkedFetch(`${G}/messages/${id}/attachments/${p.body.attachmentId}`, { method: "GET", headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { size: number; data: string };
    expect(body.size).toBe(5);
    expect(Buffer.from(body.data, "base64url").toString()).toBe("%PDF!");
    const inline = await part(auth, addWithFile({ inline: true }).id);
    expect(inline.body.attachmentId).toBeUndefined();
    expect(Buffer.from(inline.body.data!, "base64url").toString()).toBe("%PDF!");
    expect((await fake.checkedFetch(`${G}/messages/${id}/attachments/nope`, { method: "GET", headers: auth })).status).toBe(404);
    expect((await fake.checkedFetch(`${G}/messages/${id}/attachments/${p.body.attachmentId}`, { method: "GET", headers: { authorization: "Bearer dead" } })).status).toBe(401);
    expect(fake.violations).toEqual([]);
  });
  it("refuses messages.get with an undeclared query parameter (formatt)", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { id } = addWithFile();
    await expect(fake.checkedFetch(`${G}/messages/${id}?formatt=full`, { method: "GET", headers: auth })).rejects.toThrow(/no query parameter "formatt"/);
    fake.violations.length = 0;
  });
  it("refuses a messages.get answer whose part body has an undeclared property", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { id } = addWithFile();
    fake.tamper((b) => {
      const payload = b.payload as { parts: { body: Record<string, unknown> }[] };
      payload.parts[1].body.attachment = "x";
      return b;
    });
    await expect(fake.checkedFetch(`${G}/messages/${id}?format=full`, { method: "GET", headers: auth })).rejects.toThrow(/no property "attachment" in MessagePartBody/);
    fake.violations.length = 0;
  });
  it("refuses attachments.get with an undeclared query parameter, and an answer with `dataa`", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { id } = addWithFile();
    const p = await part(auth, id);
    const url = `${G}/messages/${id}/attachments/${p.body.attachmentId}`;
    await expect(fake.checkedFetch(`${url}?format=raw`, { method: "GET", headers: auth })).rejects.toThrow(/users.messages.attachments.get has no query parameter "format"/);
    fake.tamper(({ data, ...rest }) => ({ ...rest, dataa: data }));
    await expect(fake.checkedFetch(url, { method: "GET", headers: auth })).rejects.toThrow(/no property "dataa" in MessagePartBody/);
    fake.tamper((b) => ({ ...b, size: "5" }));
    await expect(fake.checkedFetch(url, { method: "GET", headers: auth })).rejects.toThrow(/size must be an integer/);
    fake.violations.length = 0;
  });
});

describe("push bodies against pubsub-api.json", () => {
  it("accepts the fake's notice and refuses message.payload instead of message.data", async () => {
    await accessToken();
    const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
    await fake.checkedFetch(`${G}/watch`, { method: "POST", headers: auth, body: JSON.stringify({ topicName: "projects/p/topics/t" }) });
    const n = fake.notice("linus@barnacle.ai")!;
    expect(() => checkPushBody(n.body)).not.toThrow();
    const { data, ...rest } = n.body.message;
    expect(() => checkPushBody({ ...n.body, message: { ...rest, payload: data } })).toThrow(/no property "payload" in PubsubMessage/);
    expect(() => checkPushBody({ ...n.body, extra: 1 })).toThrow(/push body has no "extra"/);
    expect(() => checkPushBody({ ...n.body, message: { ...n.body.message, data: "%%%" } })).toThrow(/base64/);
  });
});

// covers SF-128 FR-015, T006: the thread calls of a past-email fetch (users.threads.list, users.threads.get) are checked
// against gmail-api.json like the rest of the fake.
describe("SF-128 threads.list and threads.get against gmail-api.json", () => {
  const put = (days: number, threadId?: string) =>
    fake.addMessage("linus@barnacle.ai", { from: "ana@example.test", to: "linus@barnacle.ai", subject: "Hi", text: "Hello", internalDate: new Date(Date.now() - days * 86_400_000), threadId });
  it("lets through q, maxResults, pageToken, includeSpamTrash, format and metadataHeaders, answering ListThreadsResponse / Thread", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const a = put(3);
    put(2, a.threadId);
    put(40);
    put(400);
    const since = Math.floor((Date.now() - 100 * 86_400_000) / 1000);
    const first = await fake.checkedFetch(`${G}/threads?q=after%3A${since}+before%3A${Math.ceil(Date.now() / 1000) + 60}&maxResults=1&includeSpamTrash=false`, { method: "GET", headers: auth });
    const p1 = (await first.json()) as { threads: { id: string }[]; nextPageToken: string; resultSizeEstimate: number };
    expect(p1.threads.map((t) => t.id)).toEqual([a.threadId]);
    expect(p1.resultSizeEstimate).toBe(2);
    const p2 = (await (await fake.checkedFetch(`${G}/threads?q=after%3A${since}&maxResults=1&includeSpamTrash=false&pageToken=${p1.nextPageToken}`, { method: "GET", headers: auth })).json()) as { threads: { id: string }[]; nextPageToken?: string };
    expect(p2.threads).toHaveLength(1);
    expect(p2.nextPageToken).toBeUndefined();
    const t = (await (await fake.checkedFetch(`${G}/threads/${a.threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`, { method: "GET", headers: auth })).json()) as {
      messages: { payload: { headers: { name: string }[]; parts?: unknown } }[];
    };
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0].payload.headers.map((h) => h.name)).toEqual(["From", "To"]);
    expect(t.messages[0].payload.parts).toBeUndefined();
    const min = (await (await fake.checkedFetch(`${G}/threads/${a.threadId}?format=minimal`, { method: "GET", headers: auth })).json()) as { messages: { payload?: unknown }[] };
    expect(min.messages[0].payload).toBeUndefined();
    const full = (await (await fake.checkedFetch(`${G}/threads/${a.threadId}?format=full`, { method: "GET", headers: auth })).json()) as { messages: { payload: { parts: unknown[] } }[] };
    expect(full.messages[0].payload.parts).toHaveLength(1);
    expect(fake.violations).toEqual([]);
  });
  it("an unknown page token answers 400 invalidArgument", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    expect((await fake.checkedFetch(`${G}/threads?q=after%3A0&pageToken=nope`, { method: "GET", headers: auth })).status).toBe(400);
  });
  it("refuses threads.list with afterDate and threads.get with fields2 (undeclared query parameters)", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const a = put(3);
    await expect(fake.checkedFetch(`${G}/threads?afterDate=1`, { method: "GET", headers: auth })).rejects.toThrow(/threads.list has no query parameter "afterDate"/);
    await expect(fake.checkedFetch(`${G}/threads/${a.threadId}?fields2=x`, { method: "GET", headers: auth })).rejects.toThrow(/threads.get has no query parameter "fields2"/);
    fake.violations.length = 0;
  });
  it("refuses a threads.list answer with a property ListThreadsResponse or Thread lacks", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    put(3);
    fake.tamper((b) => ({ ...b, total: 1 }));
    await expect(fake.checkedFetch(`${G}/threads?q=after%3A0`, { method: "GET", headers: auth })).rejects.toThrow(/no property "total" in ListThreadsResponse/);
    fake.tamper((b) => ({ ...b, threads: (b.threads as object[]).map((t) => ({ ...t, subject: "x" })) }));
    await expect(fake.checkedFetch(`${G}/threads?q=after%3A0`, { method: "GET", headers: auth })).rejects.toThrow(/no property "subject" in Thread/);
    fake.violations.length = 0;
  });
});

// covers SF-128 FR-007, SC-005, T019: Gmail's slow-down answer and how the app reads it.
describe("SF-128 slow-down", () => {
  it("fake.slowDown(30): the next Gmail call answers 429 RESOURCE_EXHAUSTED rateLimitExceeded with Retry-After: 30, then calls work", async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    fake.slowDown(30);
    const res = await fake.checkedFetch(`${G}/profile`, { method: "GET", headers: auth });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    const body = (await res.json()) as { error: { code: number; status: string; message: string; errors: { reason: string; domain: string; message: string }[] } };
    // Google's JSON error shape (the discovery file has no error schema): exactly code, message, errors, status.
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "errors", "message", "status"]);
    expect(body.error).toMatchObject({ code: 429, status: "RESOURCE_EXHAUSTED", errors: [{ reason: "rateLimitExceeded" }] });
    expect((await fake.checkedFetch(`${G}/profile`, { method: "GET", headers: auth })).status).toBe(200);
  });
  it("failWith: 429 and 403 rateLimitExceeded / userRateLimitExceeded → GmailSlowDown (a GoogleUnavailable); 403 insufficientPermissions → GoogleKeyRefused", async () => {
    const { failWith, GmailSlowDown, GoogleKeyRefused, GoogleUnavailable } = await import("@/server/gmail/google-api");
    const err = (status: number, reason: string, retry?: string) =>
      new Response(JSON.stringify({ error: { code: status, message: "x", errors: [{ reason, domain: "usageLimits", message: "x" }], status: "X" } }), {
        status,
        headers: retry ? { "retry-after": retry } : {},
      });
    const caught = async (r: Response) => failWith(r).catch((e: unknown) => e);
    const a = await caught(err(429, "rateLimitExceeded", "12"));
    expect(a).toBeInstanceOf(GmailSlowDown);
    expect(a).toBeInstanceOf(GoogleUnavailable);
    expect((a as InstanceType<typeof GmailSlowDown>).seconds).toBe(12);
    for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
      const e = await caught(err(403, reason));
      expect(e).toBeInstanceOf(GmailSlowDown);
      expect((e as InstanceType<typeof GmailSlowDown>).seconds).toBe(30);
    }
    expect(await caught(err(403, "insufficientPermissions"))).toBeInstanceOf(GoogleKeyRefused);
    expect(await caught(err(500, "backendError"))).not.toBeInstanceOf(GmailSlowDown);
  });
});

// covers SF-129 FR-023, T014: the upload send (users.messages.send mediaUpload) against gmail-api.json.
describe("SF-129: the upload send against mediaUpload", () => {
  const U = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send";
  const mime = (extra = "") =>
    [
      "From: linus@barnacle.ai",
      "To: ana@example.test",
      "Subject: Hi",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("Hello").toString("base64"),
      "--b1",
      'Content-Type: application/pdf; name="a.pdf"',
      `Content-Disposition: attachment; filename="a.pdf"; filename*=UTF-8''a.pdf`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from([1, 2, 3, 250]).toString("base64"),
      "--b1--",
      extra,
    ].join("\r\n");
  const send = async (url: string, contentType: string, body: string) =>
    fake.checkedFetch(url, { method: "POST", headers: { authorization: `Bearer ${await accessToken()}`, "content-type": contentType }, body });

  it("passes a valid upload, and its attachment bytes are read back from sentMessages", async () => {
    const res = await send(`${U}?uploadType=media`, "message/rfc822", mime());
    expect(res.status).toBe(200);
    const [m] = fake.sentMessages("linus@barnacle.ai");
    expect(m.text).toBe("Hello");
    expect(m.attachments).toEqual([{ name: "a.pdf", type: "application/pdf", bytes: Buffer.from([1, 2, 3, 250]) }]);
    expect(fake.violations).toEqual([]);
  });
  it("refuses another uploadType, another content type, another path, an undeclared parameter, a body over maxSize", async () => {
    await expect(send(`${U}?uploadType=raw`, "message/rfc822", mime())).rejects.toThrow(/uploadType/);
    await expect(send(`${U}?uploadType=media`, "application/json", mime())).rejects.toThrow(/accepts message\/\*/);
    await expect(send(`${U}d?uploadType=media`, "message/rfc822", mime())).rejects.toThrow(/no upload POST/);
    await expect(send(`${U}?uploadType=media&raw=1`, "message/rfc822", mime())).rejects.toThrow(/no query parameter "raw"/);
    const big = "x".repeat(36_700_161 - mime().length);
    await expect(send(`${U}?uploadType=media`, "message/rfc822", mime(big))).rejects.toThrow(/over maxSize 36700160/);
    expect(fake.violations).toHaveLength(5);
    fake.violations.length = 0;
    expect(fake.sentMessages("linus@barnacle.ai")).toEqual([]);
  });
  it("refuses an answer with a property Message does not declare", async () => {
    fake.tamper((b) => ({ ...b, sentAt: "now" }));
    await expect(send(`${U}?uploadType=media`, "message/rfc822", mime())).rejects.toThrow(/no property "sentAt" in Message/);
    fake.violations.length = 0;
    const res = await send(`${U}?uploadType=media`, "message/rfc822", mime());
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["id", "labelIds", "threadId"]);
  });
});
