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

// covers SF-114 spec.md § Clarifications (Session 2026-11-23): the two choices people made are recorded, not the factory's
describe("docs/DECISIONS.md (SF-114)", () => {
  const sf114 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-114)"));
  it("records the Ambassador tick and the design B ambassador page, nothing else", () => {
    expect(sf114).toEqual([
      "- An ambassador is a person with the Ambassador tick on their form; only ticked people can be chosen as Referred by (SF-114)",
      "- The ambassador page uses design B: its own one-column page with [ PERSON PAGE ], a summary strip, people referred, deals referred, then latest updates grouped by day (SF-114)",
    ]);
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

// covers SF-116 spec.md § Clarifications (T043): the seven choices people made are recorded, one line each
describe("docs/DECISIONS.md (SF-116)", () => {
  const sf116 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-116)"));
  it("records the design, delete, listing, upload link, PDF preview, Kind column and no-store choices", () => {
    expect(sf116).toHaveLength(7);
    expect(sf116.some((l) => l.includes("Files use design A"))).toBe(true);
    expect(sf116.some((l) => l.includes("can delete its files, as with notes"))).toBe(true);
    expect(sf116.some((l) => l.includes("lists only their own files"))).toBe(true);
    expect(sf116.some((l) => l.includes("valid for up to 2 hours") && l.includes("lasts 60 seconds"))).toBe(true);
    expect(sf116.some((l) => l.includes("new browser tab"))).toBe(true);
    expect(sf116.some((l) => l.includes("The Kind column"))).toBe(true);
    expect(sf116.some((l) => l.includes("With no file store set up"))).toBe(true);
    expect(sf116.some((l) => /Departs from blueprint/.test(l))).toBe(false);
  });
});

// covers SF-115 spec.md § Clarifications (Session 2026-11-24): the choices people made are recorded, one line each
describe("docs/DECISIONS.md (SF-115)", () => {
  const sf115 = readFileSync("docs/DECISIONS.md", "utf8").split("\n").filter((l) => l.startsWith("- ") && l.endsWith("(SF-115)"));
  it("records design B, the shared Show in list, the fixed type and the six confirmed choices", () => {
    expect(sf115.slice(0, 3)).toEqual([
      "- Custom fields use design B: a Custom fields admin page with a tab per kind and a table, the add and edit form and the delete confirmation in a box over the page; values in their own // MORE DETAILS section (SF-115)",
      "- An admin ticks \"Show in list\" on a custom field; it is the same for every user, at most 8 per list (SF-115)",
      "- A custom field's type cannot be changed: to change it, delete the field and add a new one (SF-115)",
    ]);
    expect(sf115).toHaveLength(9);
    expect(sf115.some((l) => l.includes("archived person or deal") && l.includes("refused until it is restored"))).toBe(true);
    expect(sf115.some((l) => l.includes("file_added and file_deleted"))).toBe(true);
    expect(sf115.some((l) => l.startsWith("- Departs from blueprint"))).toBe(false);
  });
});
