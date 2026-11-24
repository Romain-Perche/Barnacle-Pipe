// covers SF-109 FR-008, US3 (T036): the sidebar has "Activities" after "Organisations" (SF-114 puts "Ambassadors"
// right after "Organisations"), just before "Notifications"
import { describe, expect, it } from "vitest";
import { mainNav } from "@/app/(app)/nav";

describe("mainNav", () => {
  it("links Activities to /activities after Organisations, before Notifications", () => {
    const labels = mainNav.map((n) => n.label);
    const i = labels.indexOf("Activities");
    expect(mainNav[i]).toEqual({ href: "/activities", label: "Activities" });
    expect(labels[i - 1]).toBe("Ambassadors");
    expect(labels.indexOf("Organisations")).toBe(i - 2);
    // SF-119 puts "Campaigns" between Activities and Notifications.
    expect(labels[i + 1]).toBe("Campaigns");
    expect(labels[i + 2]).toBe("Notifications");
  });
});

// covers SF-119 FR-001, FR-020 (T006): "Campaigns" right after Activities, before Notifications, for every user
describe("Campaigns in the sidebar", () => {
  it("links Campaigns to /campaigns after Activities and before Notifications, not in the admin group", () => {
    const labels = mainNav.map((n) => n.label);
    const i = labels.indexOf("Campaigns");
    expect(mainNav[i]).toEqual({ href: "/campaigns", label: "Campaigns" });
    expect(labels[i - 1]).toBe("Activities");
    expect(labels[i + 1]).toBe("Notifications");
    expect(adminNav.some((n) => n.href === "/campaigns")).toBe(false);
  });
});

// covers SF-115 FR-017: "Custom fields" last in the "// Admin" group
import { adminNav } from "@/app/(app)/nav";
describe("adminNav", () => {
  it("ends with Custom fields", () => {
    expect(adminNav.at(-1)).toEqual({ href: "/admin/custom-fields", label: "Custom fields" });
    expect(adminNav.at(-2)?.label).toBe("Pipelines");
  });
});

// covers SF-117 FR-001, FR-029, US1 scenario 1: "Settings" at the bottom of the sidebar (footerNav), not in the main list
import { footerNav } from "@/app/(app)/nav";
describe("footerNav", () => {
  it("holds Settings, linked to /settings", () => {
    expect(footerNav).toEqual([{ href: "/settings", label: "Settings" }]);
    expect(mainNav.map((n) => n.href)).not.toContain("/settings");
  });
});
