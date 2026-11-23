// covers SF-114 FR-015, FR-016, edge case "markup in a name": the ambassador pages render names as React text nodes only
// and show no text from the address (the counts are parsed to numbers); the sidebar link sits after Organisations
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mainNav } from "@/app/(app)/nav";

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));

describe("the ambassador pages", () => {
  const sources = [
    ...files("src/app/(app)/ambassadors"),
    "src/app/(app)/records/ReferrerPicker.tsx",
    "src/app/(app)/records/ReferredBy.tsx",
  ].map((f) => [f, readFileSync(f, "utf8")] as const);

  it("never inject markup", () => {
    for (const [file, text] of sources) expect(text, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });

  it("read only counts from the address", () => {
    const page = readFileSync("src/app/(app)/ambassadors/[id]/page.tsx", "utf8");
    expect(page).toMatch(/parseShown\(query\.people\)/);
    expect(page).toMatch(/parseShown\(query\.deals\)/);
    expect(page).toMatch(/parseShownBy\(query\.updates, 20\)/);
    expect(page).not.toMatch(/query\.(?!people\b|deals\b|updates\b)\w+/);
  });

  it("are linked from the sidebar after Organisations", () => {
    const labels = mainNav.map((n) => n.label);
    expect(labels.indexOf("Ambassadors")).toBe(labels.indexOf("Organisations") + 1);
    expect(mainNav.find((n) => n.label === "Ambassadors")?.href).toBe("/ambassadors");
  });
});
