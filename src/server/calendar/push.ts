// Google Calendar change notices (SF-124 research.md §11, contracts/routes.md § Routes): POST /calendar/push. Web-hook
// notices carry no signature: the proof is the channel's own secret token, set by the CRM when it asked Google to watch
// the calendar and kept only as its sha256. A notice is refused (403) unless its channel id names a working connection
// with Calendar, its token's sha256 matches (constant time) and its resource id is that channel's. The first message of
// a channel ("sync") does nothing; any other runs one calendar sync, whose errors are swallowed (the 15-minute check
// catches up). Answers never carry data.
import { createHash, timingSafeEqual } from "node:crypto";
import { syncCalendar } from "@/server/calendar/sync";
import { sql } from "@/server/db";
import { calendarConfig } from "@/server/env";
import { hasCalendarScope } from "@/server/gmail/rules";

export async function receiveCalendarPush(headers: Headers, now = new Date()): Promise<{ status: 204 | 403 }> {
  if (calendarConfig().mode === "off") return { status: 204 };
  const channelId = headers.get("x-goog-channel-id") ?? "";
  const token = headers.get("x-goog-channel-token") ?? "";
  const resourceId = headers.get("x-goog-resource-id") ?? "";
  if (!channelId || channelId.length > 64 || !token || !resourceId) return { status: 403 };
  const [row] = await sql<{ id: string; scopes: string; hash: Buffer; resource_id: string }[]>`
    select id::text as id, scopes, calendar_channel_token_hash as hash, calendar_channel_resource_id as resource_id
    from gmail_connections where calendar_channel_id = ${channelId} and state = 'working'`;
  if (!row || !hasCalendarScope(row.scopes)) return { status: 403 };
  const given = createHash("sha256").update(token).digest();
  if (!timingSafeEqual(given, row.hash) || resourceId !== row.resource_id) return { status: 403 };
  if ((headers.get("x-goog-resource-state") ?? "") === "sync") return { status: 204 };
  try {
    await syncCalendar(Number(row.id), now);
  } catch {
    // The next check carries on.
  }
  return { status: 204 };
}
