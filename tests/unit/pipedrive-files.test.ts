// covers SF-122 FR-015, FR-020, US4 scenarios 3–4: which Pipedrive files are copied, listed or counted
import { describe, expect, it } from "vitest";
import type { PdFile } from "@/server/pipedrive/api";
import { fileCheck, formatMb } from "@/server/pipedrive/deal-rules";

const file = (f: Partial<PdFile> = {}): PdFile => ({
  id: 5, active: true, addTime: "2026-01-01 00:00:00", name: "a.pdf", size: 100, userId: 1, dealId: 1, personId: null, orgId: null, leadId: "",
  mailMessageId: "", remoteLocation: "", ...f,
});

describe("formatMb", () => {
  it("gives megabytes to one decimal (1 MB = 1,048,576 bytes)", () => {
    expect(formatMb(27_367_014)).toBe("26.1");
    expect(formatMb(26_214_400)).toBe("25.0");
  });
});

describe("fileCheck", () => {
  it("copies a file up to 25 MB exactly", () => {
    expect(fileCheck(file({ size: 26_214_400 }))).toEqual({ ok: true });
    expect(fileCheck(file({ size: null }))).toEqual({ ok: true });
  });
  it("lists a file over 25 MB, an empty one, a too long name and a linked document", () => {
    expect(fileCheck(file({ size: 27_367_014 }))).toEqual({ problem: { code: "pipedrive_file_too_large", args: { mb: "26.1" } } });
    expect(fileCheck(file({ size: 0 }))).toEqual({ problem: { code: "pipedrive_file_empty" } });
    expect(fileCheck(file({ name: `${"n".repeat(252)}.pdf` }))).toEqual({ problem: { code: "file_name_too_long", args: { name: `${"n".repeat(252)}.pdf` } } });
    expect(fileCheck(file({ remoteLocation: "googledrive" }))).toEqual({ problem: { code: "pipedrive_file_link" } });
  });
  it("counts email attachments (even on a deal), files on leads and projects; passes over removed files", () => {
    expect(fileCheck(file({ mailMessageId: "77" }))).toEqual({ elsewhere: "email" });
    expect(fileCheck(file({ dealId: null, leadId: "abc" }))).toEqual({ elsewhere: "lead" });
    expect(fileCheck(file({ dealId: null }))).toEqual({ elsewhere: "project" });
    expect(fileCheck(file({ active: false }))).toEqual({ skip: true });
  });
});
