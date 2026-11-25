// AI review helper (SF-124): steers the development fake Google Calendar (.fake-gmail/state.json, shared with the app on
// :3000) for what /dev/fake-calendar has no button for. Run from the repo root (same env as gmail-ctl.ts):
//   APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) \
//   CALENDAR_SYNC=on APP_URL=http://localhost:3000 npx tsx .factory/run/calendar-ctl.ts <op> [args…]
// ops (output: one JSON line):
//   events <email>                 the user's fake events (as stored)
//   change <email> <id> <json>     FakeEventChange (summary, description, location, start, end, allDay, attendees), no notice
//   notice <email>                 the headers of Google's notice for the active channel (counted as sent), or null
//   channel <email>                the active channel
import { fakeGmail } from "@/server/gmail/fake-gmail";

async function main() {
  const [op, a, b, c] = process.argv.slice(2);
  const fake = fakeGmail();
  let out: unknown = null;
  if (op === "events") out = fake.calendarEvents(a);
  else if (op === "change") out = await fake.changeEvent(a, b, JSON.parse(c), { deliver: false });
  else if (op === "notice") {
    const h = fake.calendarNotice(a);
    out = h && Object.fromEntries(h.entries());
  } else if (op === "channel") out = fake.calendarChannel(a);
  console.log(JSON.stringify(out ?? null));
  process.exit(0);
}
main();
