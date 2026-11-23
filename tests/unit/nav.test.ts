// covers SF-109 FR-008, US3 (T036): the sidebar has "Activities" between "Organisations" and "Notifications"
import { describe, expect, it } from "vitest";
import { mainNav } from "@/app/(app)/nav";

describe("mainNav", () => {
  it("links Activities to /activities after Organisations, before Notifications", () => {
    const labels = mainNav.map((n) => n.label);
    const i = labels.indexOf("Activities");
    expect(mainNav[i]).toEqual({ href: "/activities", label: "Activities" });
    expect(labels[i - 1]).toBe("Organisations");
    expect(labels[i + 1]).toBe("Notifications");
  });
});
