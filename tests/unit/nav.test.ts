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
    expect(labels[i + 1]).toBe("Notifications");
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
