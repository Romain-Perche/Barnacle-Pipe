// covers SF-124 FR-015, T019 (contracts/google.md § Fake, § Checks): the fake Google Calendar refuses what Google's
// calendar-api.json refuses (a wrong body field, an undeclared query parameter, a wrong nested field, an answer property
// the schema lacks), and copies Google's behaviour: 409 on an existing id, 410 on an expired sync token and on a patch of
// a cancelled event, cancelled events only with a sync token or showDeleted, 403 insufficientPermissions without the
// Calendar scope, 403 forbiddenForNonOrganizer, 404 on an unknown id, the unreachable switch, channels and notices.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_NOTICE_HEADERS, installGmailFake, TEST_GMAIL_KEY, type GmailFake } from "../fakes/gmail";

const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const CAL = "https://www.googleapis.com/auth/calendar.events.owned";
const E = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
let fake: GmailFake;

async function accessToken(scopes = [MODIFY, SEND, CAL], email = "ada@barnacle.ai") {
  const code = fake.consent({
    email,
    scopes,
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

const event = {
  summary: "Call · Fake call",
  description: "Open in Barnacle CRM: http://localhost:3000/activities?activity=1",
  start: { dateTime: "2026-12-02T10:00:00.000Z", timeZone: "Europe/London" },
  end: { dateTime: "2026-12-02T10:30:00.000Z", timeZone: "Europe/London" },
  reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] },
  visibility: "private",
  transparency: "opaque",
  guestsCanInviteOthers: false,
  extendedProperties: { private: { barnacleCrmActivity: "1" } },
};

let auth: Record<string, string>;
const send = (method: string, url: string, body?: unknown) =>
  fake.checkedFetch(url, { method, headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const listed = async (q: string) => (await (await send("GET", `${E}?${q}`)).json()) as { items: { id: string; status: string }[]; nextSyncToken?: string };

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  fake = installGmailFake();
  auth = { authorization: `Bearer ${await accessToken()}` };
});

describe("Calendar requests and answers against calendar-api.json", () => {
  it("lets the app's calls through: insert, patch, list, delete, watch, stop", async () => {
    expect((await send("POST", `${E}?sendUpdates=none`, { id: "crm0123456789abcdefghijklmnopqrstuv", ...event })).status).toBe(200);
    expect((await send("PATCH", `${E}/crm0123456789abcdefghijklmnopqrstuv?sendUpdates=none`, { summary: "Call · Other" })).status).toBe(200);
    expect((await send("GET", `${E}?maxResults=2500&showDeleted=true`)).status).toBe(200);
    expect((await send("DELETE", `${E}/crm0123456789abcdefghijklmnopqrstuv?sendUpdates=none`)).status).toBe(204);
    const w = await send("POST", `${E}/watch`, { id: "chan-1", type: "web_hook", address: "https://crm.example.test/calendar/push", token: "secret", params: { ttl: "604800" } });
    const ch = (await w.json()) as { resourceId: string; expiration: string };
    expect(Number(ch.expiration)).toBeGreaterThan(Date.now());
    expect((await send("POST", "https://www.googleapis.com/calendar/v3/channels/stop", { id: "chan-1", resourceId: ch.resourceId })).status).toBe(204);
    expect(fake.violations).toEqual([]);
  });
  it.each<[string, () => Promise<Response>, RegExp]>([
    ["an insert body with `summery`", () => send("POST", `${E}?sendUpdates=none`, { ...event, summery: "x" }), /no property "summery" in Event/],
    ["a list with the query `updatedSince`", () => send("GET", `${E}?updatedSince=2026-01-01T00:00:00Z`), /no query parameter "updatedSince"/],
    ["a patch body `reminders.overrides[0].minute`", () => send("PATCH", `${E}/crmabcdef?sendUpdates=none`, { reminders: { useDefault: false, overrides: [{ method: "email", minute: 15 }] } }), /no property "minute" in EventReminder/],
    ["a path Calendar does not have", () => send("POST", `${E}/crmabcdef/copy`), /calendar-api.json has no POST/],
  ])("refuses %s", async (_name, call, message) => {
    await expect(call()).rejects.toThrow(message);
    expect(fake.violations).toHaveLength(1);
    fake.violations.length = 0;
  });
  it("refuses an answer with a property Event does not declare", async () => {
    fake.tamper((b) => ({ ...b, colour: "red" }));
    await expect(send("POST", `${E}?sendUpdates=none`, { id: "crmtamper1", ...event })).rejects.toThrow(/no property "colour" in Event/);
    fake.violations.length = 0;
  });
});

describe("the fake behaves as Google", () => {
  it("409 on an existing id, 400 on an id that is not base32hex, 404 on an unknown one", async () => {
    expect((await send("POST", `${E}?sendUpdates=none`, { id: "crmdup01", ...event })).status).toBe(200);
    expect((await send("POST", `${E}?sendUpdates=none`, { id: "crmdup01", ...event })).status).toBe(409);
    expect((await send("POST", `${E}?sendUpdates=none`, { id: "crm_WXYZ", ...event })).status).toBe(400);
    expect((await send("PATCH", `${E}/crmnothere?sendUpdates=none`, { summary: "x" })).status).toBe(404);
  });
  it("sync tokens: changes since, cancelled items with a token or showDeleted, 410 below the floor", async () => {
    await send("POST", `${E}?sendUpdates=none`, { id: "crmlist01", ...event });
    const first = await listed("maxResults=2500");
    expect(first.items.map((i) => i.id)).toEqual(["crmlist01"]);
    await send("DELETE", `${E}/crmlist01?sendUpdates=none`);
    expect((await listed("maxResults=2500")).items).toEqual([]);
    expect((await listed("maxResults=2500&showDeleted=true")).items.map((i) => i.status)).toEqual(["cancelled"]);
    const since = await listed(`maxResults=2500&syncToken=${first.nextSyncToken}`);
    expect(since.items.map((i) => [i.id, i.status])).toEqual([["crmlist01", "cancelled"]]);
    fake.expireCalendarTokens();
    expect((await send("GET", `${E}?syncToken=${since.nextSyncToken}`)).status).toBe(410);
    // a patch or delete of a cancelled event
    expect((await send("PATCH", `${E}/crmlist01?sendUpdates=none`, { summary: "x" })).status).toBe(410);
    expect((await send("DELETE", `${E}/crmlist01?sendUpdates=none`)).status).toBe(410);
  });
  it("403 insufficientPermissions without the Calendar scope", async () => {
    auth = { authorization: `Bearer ${await accessToken([MODIFY, SEND])}` };
    const res = await send("GET", `${E}?maxResults=2500`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("insufficientPermissions");
  });
  it("403 forbiddenForNonOrganizer on a title or time change of someone else's event; other fields pass", async () => {
    const id = await fake.addEvent("ada@barnacle.ai", { summary: "Their meeting", start: "2026-12-08T15:00:00Z", end: "2026-12-08T15:45:00Z", attendees: ["ana@example.test"], organizer: "ana@example.test" });
    const res = await send("PATCH", `${E}/${id}?sendUpdates=none`, { summary: "Mine now" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("forbiddenForNonOrganizer");
    expect((await send("PATCH", `${E}/${id}?sendUpdates=none`, { description: "note" })).status).toBe(200);
  });
  it("unreachable: every Google call fails as a network error until reachable again", async () => {
    fake.setUnreachable(true);
    await expect(send("GET", `${E}?maxResults=2500`)).rejects.toBeInstanceOf(TypeError);
    fake.setUnreachable(false);
    expect((await send("GET", `${E}?maxResults=2500`)).status).toBe(200);
    expect(fake.violations).toEqual([]);
  });
  it("tester API: add, change, decline, delete; notices carry exactly Google's headers, only while the channel is active", async () => {
    const id = await fake.addEvent("ada@barnacle.ai", { summary: "Intro", start: "2026-12-08T15:00:00Z", end: "2026-12-08T15:45:00Z", attendees: ["ana@example.test"] });
    await fake.changeEvent("ada@barnacle.ai", id, { start: "2026-12-04", end: "2026-12-07", allDay: true });
    await fake.declineEvent("ada@barnacle.ai", id);
    const [e] = fake.calendarEvents("ada@barnacle.ai");
    expect(e).toMatchObject({ start: { date: "2026-12-04" }, end: { date: "2026-12-07" } });
    expect(e.attendees?.find((a) => a.self)?.responseStatus).toBe("declined");
    await fake.deleteEvent("ada@barnacle.ai", id);
    expect(fake.calendarEvents("ada@barnacle.ai")[0].status).toBe("cancelled");
    expect(fake.calendarNotice("ada@barnacle.ai")).toBeNull();
    const w = await send("POST", `${E}/watch`, { id: "chan-2", type: "web_hook", address: "https://crm.example.test/calendar/push", token: "secret", params: { ttl: "604800" } });
    const ch = (await w.json()) as { resourceId: string };
    const h = fake.calendarNotice("ada@barnacle.ai")!;
    expect([...h.keys()].sort()).toEqual(CALENDAR_NOTICE_HEADERS);
    expect(h.get("x-goog-channel-token")).toBe("secret");
    expect(h.get("x-goog-resource-id")).toBe(ch.resourceId);
    await send("POST", "https://www.googleapis.com/calendar/v3/channels/stop", { id: "chan-2", resourceId: ch.resourceId });
    expect(fake.calendarNotice("ada@barnacle.ai")).toBeNull();
  });
});
