// covers SF-124 FR-017, US1 scenarios 1 and 3 (contracts/routes.md § Gmail card, design A): the SF-118 Gmail card gains
// one "Calendar" line, and while Calendar access is missing the reconnect message and [ RECONNECT GMAIL ]; no Calendar
// line when Calendar is off or the connection needs reconnecting.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings", redirect: () => {}, notFound: () => {} }));
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
