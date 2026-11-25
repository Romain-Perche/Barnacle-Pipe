// Google Calendar calls (SF-124 contracts/google.md § Calls, research.md §1): the user's primary calendar only, through
// SF-118's `call` (10 s time-out, the real, fake or test fetch of settings()) and `readJson`. Every event write sends
// sendUpdates=none and never attendees. Errors carry only the HTTP status and the meaning of Google's reason code:
// - GoogleKeyRefused (401): the key is no longer accepted → the connection needs reconnecting;
// - GoogleUnavailable: network, time-out, slow down (403 rate limits, 429), 5xx, a listing's other 4xx;
// - CalendarRefused(kind): no_calendar_access, sync_token_gone, event_gone, exists, event_refused.
import { classifyCalendarError, type CalendarErrorKind, type EventBody, type GoogleEvent } from "@/server/calendar/rules";
import { call, GoogleKeyRefused, GoogleUnavailable, readJson } from "@/server/gmail/google-api";

export const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const EVENTS = `${CALENDAR_BASE}/calendars/primary/events`;

export class CalendarRefused extends Error {
  constructor(
    readonly kind: Exclude<CalendarErrorKind, "key_refused" | "unavailable">,
    status: number,
  ) {
    super(`Google Calendar refused (${status} ${kind})`);
    this.name = "CalendarRefused";
  }
}

async function fail(res: Response, op: "list" | "insert" | "write"): Promise<never> {
  const kind = classifyCalendarError(res.status, await readJson(res), op);
  if (kind === "key_refused") throw new GoogleKeyRefused(res.status, "calendar");
  if (kind === "unavailable") throw new GoogleUnavailable(res.status, "calendar");
  throw new CalendarRefused(kind, res.status);
}

function request(access: string, method: string, url: string, body?: unknown) {
  return call(url, {
    method,
    headers: { authorization: `Bearer ${access}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const withQuery = (url: string, q: [string, string][]) => (q.length ? `${url}?${new URLSearchParams(q).toString()}` : url);

export type EventsPage = { items: GoogleEvent[]; nextPageToken: string | null; nextSyncToken: string | null };

// One page of the primary calendar's events: changes since `syncToken`, or everything (deleted ones included) when full.
export async function listEvents(access: string, o: { syncToken?: string | null; pageToken?: string | null }): Promise<EventsPage> {
  const q: [string, string][] = [["maxResults", "2500"]];
  if (o.syncToken) q.push(["syncToken", o.syncToken]);
  else q.push(["showDeleted", "true"]);
  if (o.pageToken) q.push(["pageToken", o.pageToken]);
  const res = await request(access, "GET", withQuery(EVENTS, q));
  if (!res.ok) return fail(res, "list");
  const body = (await readJson(res)) as { items?: unknown; nextPageToken?: unknown; nextSyncToken?: unknown } | null;
  return {
    items: Array.isArray(body?.items) ? (body.items as GoogleEvent[]) : [],
    nextPageToken: typeof body?.nextPageToken === "string" ? body.nextPageToken : null,
    nextSyncToken: typeof body?.nextSyncToken === "string" ? body.nextSyncToken : null,
  };
}

export async function insertEvent(access: string, id: string, body: EventBody): Promise<GoogleEvent> {
  const res = await request(access, "POST", withQuery(EVENTS, [["sendUpdates", "none"]]), { id, ...body });
  if (!res.ok) return fail(res, "insert");
  return ((await readJson(res)) ?? {}) as GoogleEvent;
}

export async function patchEvent(access: string, id: string, body: EventBody): Promise<GoogleEvent> {
  const res = await request(access, "PATCH", withQuery(`${EVENTS}/${encodeURIComponent(id)}`, [["sendUpdates", "none"]]), body);
  if (!res.ok) return fail(res, "write");
  return ((await readJson(res)) ?? {}) as GoogleEvent;
}

// Deletes an event; one already gone (404 / 410) counts as done.
export async function deleteEvent(access: string, id: string): Promise<void> {
  const res = await request(access, "DELETE", withQuery(`${EVENTS}/${encodeURIComponent(id)}`, [["sendUpdates", "none"]]));
  if (res.ok || res.status === 404 || res.status === 410) return;
  return fail(res, "write");
}

export type Channel = { id: string; resourceId: string; expiration: Date | null };

export async function watchEvents(access: string, channel: { id: string; address: string; token: string; ttlSeconds: number }): Promise<Channel> {
  const res = await request(access, "POST", `${EVENTS}/watch`, {
    id: channel.id,
    type: "web_hook",
    address: channel.address,
    token: channel.token,
    params: { ttl: String(channel.ttlSeconds) },
  });
  if (!res.ok) return fail(res, "list");
  const body = (await readJson(res)) as { id?: unknown; resourceId?: unknown; expiration?: unknown } | null;
  if (typeof body?.resourceId !== "string" || body.resourceId === "") throw new GoogleUnavailable(200, "bad_channel");
  const ms = Number(body.expiration);
  return { id: channel.id, resourceId: body.resourceId, expiration: Number.isFinite(ms) && ms > 0 ? new Date(ms) : null };
}

export async function stopChannel(access: string, channel: { id: string; resourceId: string }): Promise<void> {
  const res = await request(access, "POST", `${CALENDAR_BASE}/channels/stop`, { id: channel.id, resourceId: channel.resourceId });
  if (res.ok || res.status === 404) return;
  return fail(res, "list");
}
