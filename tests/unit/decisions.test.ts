// covers FR-014, spec.md Clarifications (SF-92 fix round 1): the hand-over's design and the "nothing removed"
// meaning are recorded in docs/DECISIONS.md
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sf92 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-92)"));

describe("docs/DECISIONS.md (SF-92)", () => {
  it("records that the hand-over uses design B, a panel above the Users table", () => {
    expect(sf92.some((l) => /hand/i.test(l) && l.includes("design B") && l.includes("a panel above the Users table"))).toBe(true);
  });

  it("records that the hand-over removes nothing automatically", () => {
    expect(
      sf92.some((l) => l.includes("removes nothing automatically") && l.includes("can remove an address or make the person shared")),
    ).toBe(true);
  });
});
