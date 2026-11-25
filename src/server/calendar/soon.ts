// Work that runs once the response is sent (SF-124 research.md §12): saving an activity never waits on Google.
// Inside a request Next's after() (Vercel's waitUntil) runs the task after the answer; outside one (tests, the seeder,
// scripts) after() throws, and the task starts at once without being awaited. Errors are never rethrown: the 15-minute
// check catches up.
import { after } from "next/server";

const running = new Set<Promise<unknown>>();

export function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () => {
    const p = task().catch(() => {});
    running.add(p);
    return p.finally(() => running.delete(p));
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
}

// Waits for the tasks started outside a request (tests, the seeder) to end.
export async function afterResponseSettled(): Promise<void> {
  while (running.size > 0) await Promise.all([...running]);
}
