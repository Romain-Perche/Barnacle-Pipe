// POST /calendar/push — Google Calendar's change notices (SF-124 research.md §11, contracts/routes.md § Routes). Public
// (listed in src/proxy.ts): the proof is the channel's secret token, checked by receiveCalendarPush. Empty answers only.
import { receiveCalendarPush } from "@/server/calendar/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { status } = await receiveCalendarPush(req.headers);
  return new Response(null, { status });
}
