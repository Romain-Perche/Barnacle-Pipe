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
