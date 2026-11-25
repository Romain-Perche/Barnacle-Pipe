// covers SF-124 plan.md § Constraints, T022 (Supabase's transaction-mode pooler: no session state; no Google call inside
// a transaction): the Calendar code never listens, sets session settings or takes advisory locks, and no sql.begin()
// block of it calls Google.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "src/server/calendar";
const GOOGLE = /\b(insertEvent|patchEvent|deleteEvent|listEvents|watchEvents|stopChannel|refreshAccessToken|listAll|loadKey)\(/;

// The text of each sql.begin( … ) call, by matching parentheses from its opening one.
function beginBlocks(text: string): string[] {
  const out: string[] = [];
  for (let at = text.indexOf("sql.begin("); at >= 0; at = text.indexOf("sql.begin(", at + 1)) {
    let depth = 0;
    let i = at + "sql.begin".length;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) break;
    }
    out.push(text.slice(at, i + 1));
  }
  return out;
}

describe("the Calendar code and the pooler", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  it("has the files of the plan", () => {
    expect(files).toEqual(expect.arrayContaining(["rules.ts", "calendar-api.ts", "fake-calendar.ts", "sync.ts", "push.ts", "soon.ts"]));
  });
  it.each(files)("%s keeps no session state", (file) => {
    const text = readFileSync(`${DIR}/${file}`, "utf8");
    expect(text).not.toMatch(/\blisten\(/);
    expect(text).not.toMatch(/sql\.unsafe\([^)]*\bset\s/i);
    expect(text).not.toMatch(/`\s*(set|listen|unlisten)\s/i);
    expect(text).not.toMatch(/pg_advisory_lock|pg_try_advisory_lock/);
  });
  it.each(files)("%s calls Google outside every sql.begin()", (file) => {
    for (const block of beginBlocks(readFileSync(`${DIR}/${file}`, "utf8"))) expect(block).not.toMatch(GOOGLE);
  });
  it("the scan finds a Google call put inside a transaction", () => {
    expect(beginBlocks("await sql.begin(async (tx) => { await patchEvent(a, b, c); });").some((b) => GOOGLE.test(b))).toBe(true);
  });
});
