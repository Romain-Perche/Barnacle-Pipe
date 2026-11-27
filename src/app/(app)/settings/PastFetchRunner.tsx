"use client";
// Moves a past-email fetch on while Settings is open (SF-128 contracts/routes.md § PastFetchRunner): wait the
// server-rendered wait (Gmail's, if any), run one part, refresh the card, then the next part 1 second later, or after
// the seconds the part answered; ends on `stop` or a failed action. Renders nothing: the card's lines are server-rendered.
// Closing the page ends the loop; the 15-minute check carries the fetch on.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { runPastFetchPartAction } from "./actions";

export function PastFetchRunner({ waitSeconds }: { waitSeconds: number }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      let r;
      try {
        r = await runPastFetchPartAction();
      } catch {
        if (!cancelled) router.refresh();
        return;
      }
      if (cancelled) return;
      router.refresh();
      if (r.next === "stop") return;
      timer = setTimeout(tick, (r.next === "wait" ? r.seconds : 1) * 1000);
    };
    timer = setTimeout(tick, Math.max(waitSeconds, 1) * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // One loop while the running fetch is shown; the server-rendered wait only seeds the first call.
  }, []);
  return null;
}
