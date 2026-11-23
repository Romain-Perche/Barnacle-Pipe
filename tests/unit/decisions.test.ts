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

// covers SF-103 spec.md § Clarifications (Session 2026-11-20): the people's choices are recorded
describe("docs/DECISIONS.md (SF-103)", () => {
  const sf103 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-103)"));
  it("records the design, the duplicate rule and the consent choice", () => {
    expect(sf103.some((l) => l.includes("CSV import uses design B"))).toBe(true);
    expect(sf103.some((l) => l.includes("is not imported; the existing person is left as it is"))).toBe(true);
    expect(sf103.some((l) => l.includes("consent the importing user chooses, with nothing chosen in advance"))).toBe(true);
  });
});

// covers SF-109 T054: the choices people made in the spec are recorded
const sf109 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-109)"));

describe("docs/DECISIONS.md (SF-109)", () => {
  it("records design A for the Activities list, the card warning, Last contacted and in-app assignment notifications", () => {
    expect(sf109.some((l) => l.includes("Activities list uses design A") && l.includes("box over the page"))).toBe(true);
    expect(sf109.some((l) => l.includes("No next activity") && l.includes("replaces the SF-93 choice"))).toBe(true);
    expect(sf109.some((l) => l.includes("Last contacted") && l.includes("marked done") && l.includes("a task never does"))).toBe(true);
    expect(sf109.some((l) => l.includes("assigned an activity") && l.includes("in the app only"))).toBe(true);
    expect(sf109).toHaveLength(4);
  });
});
