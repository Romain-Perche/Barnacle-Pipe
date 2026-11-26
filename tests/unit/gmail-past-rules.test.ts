// covers SF-128 FR-003, FR-007, Edge Cases "The 12 months", "Address matching", "Conversation partly older than 12
// months", "CRM person only in an older message" (data-model.md § Copy rule): the window, the decision on one thread
// and how long Gmail asks to wait.
import { describe, expect, it } from "vitest";
import { pastWindow, planPastThread, slowDownSeconds } from "@/server/gmail/rules";

const press = new Date("2026-11-26T10:00:00Z");
const { start, end } = pastWindow(press);
const DAY = 86_400_000;
const ago = (days: number) => new Date(press.getTime() - days * DAY);
const msg = (id: string, days: number, addresses: string[], labelIds = ["INBOX"]) => ({ id, labelIds, internalDate: ago(days), addresses });
const plan = (messages: ReturnType<typeof msg>[], o: { crm?: string[]; stored?: string[] } = {}) =>
  planPastThread({ messages, windowStart: start, windowEnd: end, crmAddresses: new Set(o.crm ?? ["ana@example.test"]), stored: new Set(o.stored ?? []) });

describe("pastWindow: 12 calendar months back from the press (UTC)", () => {
  it("26 Nov 2026 10:00 → from 26 Nov 2025 10:00 to the press", () => {
    expect(start.toISOString()).toBe("2025-11-26T10:00:00.000Z");
    expect(end.toISOString()).toBe(press.toISOString());
  });
});

describe("planPastThread", () => {
  it("no candidate has a CRM address → nothing", () => {
    expect(plan([msg("a", 10, ["team@barnacle.ai"]), msg("b", 5, ["news@example.test"])])).toEqual([]);
  });
  it.each(["DRAFT", "SPAM", "TRASH"])("the CRM address only on a %s message → nothing", (label) => {
    expect(plan([msg("a", 10, ["ana@example.test"], [label]), msg("b", 5, ["team@barnacle.ai"])])).toEqual([]);
  });
  it("the CRM address only on a message older than the window, or after its end → nothing", () => {
    expect(plan([msg("old", 425, ["ana@example.test"]), msg("b", 5, ["team@barnacle.ai"])])).toEqual([]);
    expect(plan([msg("later", -1, ["ana@example.test"]), msg("b", 5, ["team@barnacle.ai"])])).toEqual([]);
  });
  it("a display name never counts: only addresses are matched", () => {
    // readMessage gives addresses only; "Ana Fake" <other@example.test> carries other@example.test.
    expect(plan([msg("a", 5, ["other@example.test"])])).toEqual([]);
  });
  it("a match → every in-window candidate not stored yet, oldest first; older, stored and skipped ones left out", () => {
    const m = [msg("new", 3, ["team@barnacle.ai"]), msg("mid", 20, ["ana@example.test"]), msg("older", 425, ["ana@example.test"]), msg("stored", 10, ["ana@example.test"]), msg("draft", 2, ["ana@example.test"], ["DRAFT"])];
    expect(plan(m, { stored: ["stored"] })).toEqual(["mid", "new"]);
  });
  it("11 months 29 days counts; 12 months 2 days does not", () => {
    const inside = new Date(Date.UTC(2025, 10, 27, 10)); // 26 Nov 2026 minus 11 months 29 days
    const outside = new Date(Date.UTC(2025, 10, 24, 10)); // 12 months 2 days
    const one = (d: Date) => [{ id: "x", labelIds: ["INBOX"], internalDate: d, addresses: ["ana@example.test"] }];
    expect(planPastThread({ messages: one(inside), windowStart: start, windowEnd: end, crmAddresses: new Set(["ana@example.test"]), stored: new Set() })).toEqual(["x"]);
    expect(planPastThread({ messages: one(outside), windowStart: start, windowEnd: end, crmAddresses: new Set(["ana@example.test"]), stored: new Set() })).toEqual([]);
  });
  it("an unreadable internalDate never counts", () => {
    const bad = { id: "x", labelIds: ["INBOX"], internalDate: new Date(NaN), addresses: ["ana@example.test"] };
    expect(planPastThread({ messages: [bad], windowStart: start, windowEnd: end, crmAddresses: new Set(["ana@example.test"]), stored: new Set() })).toEqual([]);
  });
});

describe("slowDownSeconds: Gmail's Retry-After", () => {
  it.each<[string | null, number]>([
    ["12", 12],
    ["0.2", 1],
    ["999", 300],
    [null, 30],
    ["soon", 30],
  ])("%s → %i", (h, s) => expect(slowDownSeconds(h)).toBe(s));
});
