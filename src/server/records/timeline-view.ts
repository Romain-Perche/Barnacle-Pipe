// Pure helpers of the timeline's look (SF-102 design B, research.md §8): day groups and entry tags.
import { formatDayHeading, ukDayKey } from "@/server/format";

export type DayGroup<T> = { key: string; heading: string; entries: T[] };

// Entries arrive newest first; one group per UK day, in that order, so no heading appears twice.
export function groupByDay<T extends { createdAt: Date }>(entries: T[], now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const e of entries) {
    const key = ukDayKey(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else groups.push({ key, heading: formatDayHeading(e.createdAt, now), entries: [e] });
  }
  return groups;
}

export type EntryTag = "NOTE" | "CHANGE" | "DEAL" | "ACTIVITY";

// DEAL: an entry of a linked deal on a person's or organisation's timeline; NOTE: a note of the page's record;
// ACTIVITY: a done call, meeting or task (SF-109), wherever it is linked.
export function entryTag(e: { kind: string; deal: unknown }): EntryTag {
  if (e.kind === "activity") return "ACTIVITY";
  if (e.deal) return "DEAL";
  return e.kind === "note" ? "NOTE" : "CHANGE";
}
