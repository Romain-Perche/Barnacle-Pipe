// covers SF-102 FR-001, FR-017, US2 scenario 1, Edge Case "no day heading twice" (research.md §8)
import { describe, expect, it } from "vitest";
import { entryTag, groupByDay } from "@/server/records/timeline-view";

const at = (iso: string, id: number) => ({ id, createdAt: new Date(iso) });

describe("groupByDay", () => {
  it("keeps the order, one group per UK day, today marked", () => {
    const now = new Date("2026-11-20T15:00:00Z");
    const groups = groupByDay([at("2026-11-20T10:14:00Z", 4), at("2026-11-20T09:00:00Z", 3), at("2026-11-19T16:02:00Z", 2), at("2026-11-17T11:45:00Z", 1)], now);
    expect(groups.map((g) => g.heading)).toEqual(["TODAY · 20 NOV 2026", "19 NOV 2026", "17 NOV 2026"]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([[4, 3], [2], [1]]);
  });
  it("puts entries on the same UK day under one heading (BST: 23:30 UTC is the next day)", () => {
    const groups = groupByDay([at("2026-07-01T08:00:00Z", 2), at("2026-06-30T23:30:00Z", 1)], new Date("2026-11-20T12:00:00Z"));
    expect(groups.map((g) => g.heading)).toEqual(["01 JUL 2026"]);
  });
  it("gives no group for no entries", () => {
    expect(groupByDay([], new Date())).toEqual([]);
  });
});

describe("entryTag", () => {
  it("is NOTE for a note, CHANGE for another event, DEAL for a deal's entry", () => {
    expect(entryTag({ kind: "note", deal: null })).toBe("NOTE");
    expect(entryTag({ kind: "moved", deal: null })).toBe("CHANGE");
    expect(entryTag({ kind: "note", deal: { id: 1, title: "x", archived: false } })).toBe("DEAL");
    expect(entryTag({ kind: "added", deal: { id: 1, title: "x", archived: false } })).toBe("DEAL");
  });
});

// covers SF-114 US3 scenario 4: an entry of a referred person is tagged PERSON on the ambassador page
describe("entryTag on the ambassador page", () => {
  it("is PERSON for a referred person's entry, DEAL for a referred deal's, else NOTE / CHANGE", () => {
    const person = { id: 2, name: "Ben", archived: false };
    expect(entryTag({ kind: "note", deal: null, person })).toBe("PERSON");
    expect(entryTag({ kind: "referrer_set", deal: null, person })).toBe("PERSON");
    expect(entryTag({ kind: "note", deal: { id: 1, title: "x", archived: false }, person: null })).toBe("DEAL");
    expect(entryTag({ kind: "note", deal: null, person: null })).toBe("NOTE");
    expect(entryTag({ kind: "ambassador_added", deal: null, person: null })).toBe("CHANGE");
  });
});
