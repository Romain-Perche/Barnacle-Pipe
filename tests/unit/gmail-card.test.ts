// covers SF-124 FR-017, US1 scenarios 1 and 3 (contracts/routes.md § Gmail card, design A): the SF-118 Gmail card gains
// one "Calendar" line, and while Calendar access is missing the reconnect message and [ RECONNECT GMAIL ]; no Calendar
// line when Calendar is off or the connection needs reconnecting.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings", useRouter: () => ({ refresh: () => {} }), redirect: () => {}, notFound: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { GmailCard } = await import("@/app/(app)/settings/GmailCard");
import type { GmailSettings } from "@/server/gmail/connections";

const base: GmailSettings = {
  mode: "fake",
  state: "working",
  email: "ada@barnacle.ai",
  lastSyncedAt: new Date("2026-11-25T10:42:00Z"),
  connectedAt: new Date("2026-11-20T09:00:00Z"),
  conversations: 37,
  calendar: "syncing",
  pastFetch: { state: "none" },
};
const render = (gmail: Partial<GmailSettings>) =>
  renderToStaticMarkup(GmailCard({ gmail: { ...base, ...gmail }, notice: null, error: null, confirmDisconnect: false }));
const text = (html: string) => html.replace(/<[^>]+>/g, "\n");

describe("the Gmail card with Google Calendar", () => {
  it("syncing: the Calendar line after the SF-118 lines, no reconnect", () => {
    const html = render({});
    expect(html).toContain("Gmail · connected");
    expect(html).toContain("<li>Calendar: Syncing your activities with your Google Calendar</li>");
    expect(html.indexOf("Calendar: Syncing")).toBeGreaterThan(html.indexOf("Copying since"));
    expect(html).not.toContain("[ RECONNECT GMAIL ]");
    expect(html).not.toContain("Reconnect Google to sync");
    expect(html).toContain("[ SEND ME A TEST EMAIL ]");
    expect(html).toContain("[ DISCONNECT ]");
  });
  it("missing: the reconnect message first, the Calendar line, then [ RECONNECT GMAIL ] [ SEND ME A TEST EMAIL ] [ DISCONNECT ]", () => {
    const html = render({ calendar: "missing" });
    expect(html).toContain("Gmail · connected");
    expect(html).toContain('<p class="err">Reconnect Google to sync your activities with your calendar.</p>');
    expect(html.indexOf("Reconnect Google to sync")).toBeLessThan(html.indexOf("Connected as"));
    expect(html).toContain("<li>Calendar: Not synced: Calendar access missing</li>");
    const t = text(html);
    const r = t.indexOf("[ RECONNECT GMAIL ]");
    expect(r).toBeGreaterThan(-1);
    expect(t.indexOf("[ SEND ME A TEST EMAIL ]")).toBeGreaterThan(r);
    expect(t.indexOf("[ DISCONNECT ]")).toBeGreaterThan(t.indexOf("[ SEND ME A TEST EMAIL ]"));
  });
  it.each<[string, Partial<GmailSettings>]>([
    ["Calendar off", { calendar: "off" }],
    ["needs reconnecting", { state: "needs_reconnect", calendar: "off" }],
    ["not connected", { state: "not_connected", calendar: "off", email: null }],
  ])("%s: no Calendar line", (_name, g) => {
    expect(render(g)).not.toContain("Calendar:");
  });
});

// covers SF-128 FR-001, FR-009, FR-010, FR-011, FR-014, US1 scenarios 1, 4, 5, US4 scenario 1, Edge Cases "Connection not
// working", "Reload after the end" (data-model.md § Card state, design B): the "// PAST EMAILS" part.
describe("the // PAST EMAILS part", () => {
  const ended = new Date("2026-11-26T11:20:00Z");
  const part = (html: string) => {
    const at = html.indexOf('aria-label="Past emails"');
    return at < 0 ? null : text(html.slice(at).replace(/<script[\s\S]*?<\/script>/g, "")).split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
  };
  const BUTTON = "[ FETCH PAST EMAILS ]";
  const EXPLAIN = "Copies the last 12 months of your conversations with people in the CRM. Press again after an import: nothing is copied twice.";
  const LEAVE = "You can leave this page: fetching carries on by itself.";
  const PAUSED = "Fetching past emails is paused until Gmail is reconnected.";
  const UNREACHABLE = "Gmail can&#x27;t be reached right now. Fetching will carry on by itself.";
  const running = { state: "running", copied: 23, paused: false, unreachable: false, waitSeconds: 0 } as const;
  it.each<[string, Partial<GmailSettings>, string[]]>([
    ["none, working", {}, ["//", "PAST EMAILS", BUTTON, EXPLAIN]],
    ["none, needs reconnecting", { state: "needs_reconnect", calendar: "off" }, ["//", "PAST EMAILS", EXPLAIN]],
    ["running", { pastFetch: running }, ["//", "PAST EMAILS", "FETCHING…", "Fetching past emails: 23 conversations copied", LEAVE]],
    ["running, unreachable", { pastFetch: { ...running, unreachable: true } }, ["//", "PAST EMAILS", "FETCHING…", "Fetching past emails: 23 conversations copied", UNREACHABLE, LEAVE]],
    ["running, paused", { state: "needs_reconnect", calendar: "off", pastFetch: { ...running, paused: true } }, ["//", "PAST EMAILS", "FETCHING…", "Fetching past emails: 23 conversations copied", PAUSED]],
    ["ended, working, 1", { pastFetch: { state: "ended", copied: 1, endedAt: ended } }, ["//", "PAST EMAILS", BUTTON, "Past emails fetched: 1 conversation copied.", "Last fetched 26 Nov 2026, 11:20. Press again after an import to copy conversations with new people."]],
    ["ended, needs reconnecting", { state: "needs_reconnect", calendar: "off", pastFetch: { state: "ended", copied: 60, endedAt: ended } }, ["//", "PAST EMAILS", "Past emails fetched: 60 conversations copied.", "Last fetched 26 Nov 2026, 11:20. Press again after an import to copy conversations with new people."]],
  ])("%s", (_name, g, lines) => {
    expect(part(render(g))).toEqual(lines);
  });
  it("after the card's lines; the button posts a form", () => {
    const html = render({});
    expect(html.indexOf('aria-label="Past emails"')).toBeGreaterThan(html.indexOf("</ul>"));
    expect(html).toMatch(/<form[^>]*><button class="btn" type="submit">\[ FETCH PAST EMAILS \]<\/button><\/form>/);
  });
  it("no part when not connected or Gmail is off", () => {
    expect(part(render({ state: "not_connected", calendar: "off", email: null }))).toBeNull();
    expect(part(render({ mode: "off" }))).toBeNull();
  });
});
