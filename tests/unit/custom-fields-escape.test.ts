// covers SF-115 edge case "markup": names and values are shown as text, never as markup (T042). The database side
// (listFields, readCustomValues, customColumns, the timeline) is checked in tests/integration/custom-values.test.ts;
// here: no new component writes HTML.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("custom field components", () => {
  it("never use dangerouslySetInnerHTML", () => {
    const files = [
      ...readdirSync("src/app/(app)/admin/custom-fields").map((f) => `src/app/(app)/admin/custom-fields/${f}`),
      "src/app/(app)/records/MoreDetails.tsx",
      "src/app/(app)/records/CustomInputs.tsx",
      "src/app/(app)/records/CustomFilters.tsx",
      "src/app/(app)/records/Timeline.tsx",
    ];
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toContain("dangerouslySetInnerHTML");
  });
});
