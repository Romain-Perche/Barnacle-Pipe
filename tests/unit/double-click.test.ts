import { describe, expect, it } from "vitest";
import { pageToOpen } from "@/server/records/double-click";

type T = { closest(sel: string): T | null; page?: string; link?: boolean; inside?: boolean };
const row = (page: string) => ({ getAttribute: () => page });
function target(page: string | null, anchor: "none" | "stretched" | "other"): T {
  const rowEl = page === null ? null : row(page);
  return {
    closest(sel: string) {
      if (sel === "[data-page]") return rowEl as never;
      if (sel === "a") {
        if (anchor === "none") return null;
        return { classList: { contains: () => anchor === "stretched" }, closest: () => rowEl } as never;
      }
      return null;
    },
  };
}

describe("pageToOpen", () => {
  // covers FR-006, FR-009
  it("returns the address of the row or card", () => {
    expect(pageToOpen(target("/deals/5", "none"))).toBe("/deals/5");
    expect(pageToOpen(target("/people/12", "none"))).toBe("/people/12");
    expect(pageToOpen(target("/organisations/3", "none"))).toBe("/organisations/3");
  });
  it("returns it for the stretched cell link", () => {
    expect(pageToOpen(target("/deals/5", "stretched"))).toBe("/deals/5");
  });
  it("returns null for a name, organisation or person link", () => {
    expect(pageToOpen(target("/deals/5", "other"))).toBeNull();
  });
  it("returns null without a data-page ancestor or target", () => {
    expect(pageToOpen(target(null, "none"))).toBeNull();
    expect(pageToOpen(null)).toBeNull();
  });
  it("refuses addresses of another shape", () => {
    for (const bad of ["/deals/x", "//evil.com", "/people/1/edit", "https://x.com/deals/1", ""]) {
      expect(pageToOpen(target(bad, "none"))).toBeNull();
    }
  });
});
