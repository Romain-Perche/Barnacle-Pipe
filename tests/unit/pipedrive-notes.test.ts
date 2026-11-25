// covers SF-122 FR-009, FR-010, US2 scenarios 2–4, edge cases (empty, 100,000 characters, spec Clarifications: long notes whole)
import { describe, expect, it } from "vitest";
import { noteFromPipedrive, notePreview, targetOf } from "@/server/pipedrive/deal-rules";

describe("targetOf", () => {
  it("chooses the deal, else the person, else the organisation; else a lead, else a project", () => {
    expect(targetOf({ dealId: 1, personId: 2, orgId: 3, leadId: "", projectId: null })).toEqual({ kind: "deal", id: 1 });
    expect(targetOf({ dealId: null, personId: 2, orgId: 3, leadId: "" })).toEqual({ kind: "person", id: 2 });
    expect(targetOf({ dealId: null, personId: null, orgId: 3, leadId: "" })).toEqual({ kind: "organisation", id: 3 });
    expect(targetOf({ dealId: null, personId: null, orgId: null, leadId: "abc" })).toEqual({ kind: "lead" });
    expect(targetOf({ dealId: null, personId: null, orgId: null, leadId: "" })).toEqual({ kind: "project" });
  });
});

describe("noteFromPipedrive", () => {
  it("refuses a note empty once its markup is removed, or over 100,000 characters; keeps a long one whole", () => {
    expect(noteFromPipedrive("<p> </p><br>")).toEqual({ ok: false, problem: { code: "pipedrive_note_empty" } });
    expect(noteFromPipedrive("x".repeat(100_001))).toEqual({ ok: false, problem: { code: "pipedrive_note_too_long" } });
    const long = noteFromPipedrive("y".repeat(50_000));
    expect(long).toEqual({ ok: true, text: "y".repeat(50_000) });
    expect(noteFromPipedrive("<p>Hi <span>@Jane Fake</span></p>")).toEqual({ ok: true, text: "Hi @Jane Fake" });
  });
  it("previews the first 60 characters on one line", () => {
    expect(notePreview("short")).toBe("short");
    expect(notePreview("a".repeat(61))).toBe(`${"a".repeat(60)}…`);
    expect(notePreview("line one\nline two")).toBe("line one line two");
  });
});
