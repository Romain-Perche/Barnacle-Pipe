"use client";
// Moves the import on while the page is open (SF-117 research.md §5): one part, then refresh the page's numbers, then
// the next part 1 second later, or after the wait Pipedrive asked for (with a countdown). Stops on `stop` (paused,
// finished, stopped) or when the page no longer shows it. Closing the page stops the loop: the import pauses.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { templates } from "@/server/messages";
import { runPipedrivePartAction } from "./actions";

export function ImportRunner({ id, waitSeconds }: { id: number; waitSeconds: number }) {
  const router = useRouter();
  const [wait, setWait] = useState(waitSeconds);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let countdown: ReturnType<typeof setInterval> | undefined;
    const startCountdown = (seconds: number) => {
      clearInterval(countdown);
      setWait(seconds);
      countdown = setInterval(() => setWait((w) => (w <= 1 ? (clearInterval(countdown), 0) : w - 1)), 1000);
    };
    const tick = async () => {
      if (cancelled) return;
      let r;
      try {
        r = await runPipedrivePartAction(id);
      } catch {
        // The part failed on the server (the import is paused there): show what the page now says.
        if (!cancelled) router.refresh();
        return;
      }
      if (cancelled) return;
      router.refresh();
      if (r.next === "stop") return;
      if (r.next === "wait") startCountdown(r.seconds);
      timer = setTimeout(tick, (r.next === "wait" ? r.seconds : 1) * 1000);
    };
    if (waitSeconds > 0) startCountdown(waitSeconds);
    timer = setTimeout(tick, waitSeconds * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(countdown);
    };
    // One loop per import shown; the server-rendered wait only seeds the first call.
  }, [id]);
  return wait > 0 ? (
    <p className="notice" role="status">
      {templates.pipedrive_slow_down(wait)}
    </p>
  ) : null;
}
