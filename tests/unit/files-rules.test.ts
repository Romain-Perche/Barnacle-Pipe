// covers SF-116 FR-001, FR-004, FR-005, edge cases "kind" (fake.png, SVG, HTML) and "file names" (255 characters, unsafe
// characters replaced when downloading)
import { describe, expect, it } from "vitest";
import {
  fileKind, isPreviewable, kindLabel, MAX_FILE_BYTES, MAX_FILE_NAME, safeDownloadName, shortName, uploadContentType, validateFile,
} from "@/server/files/rules";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const GIF = bytes("GIF89a", 1, 0);
const GIF87 = bytes("GIF87a", 1, 0);
const WEBP = bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 ");
const PDF = bytes("%PDF-1.4\n");
const TEXT = bytes("Just some text, not an image");

describe("validateFile", () => {
  it("accepts 1 byte to exactly 25 MB, refuses empty and larger files (US1 scenarios 3, 4)", () => {
    expect(MAX_FILE_BYTES).toBe(26_214_400);
    expect(validateFile({ name: "a.pdf", size: 0 })).toEqual({ ok: false, code: "file_empty" });
    expect(validateFile({ name: "a.pdf", size: 1 })).toEqual({ ok: true });
    expect(validateFile({ name: "a.pdf", size: 26_214_400 })).toEqual({ ok: true });
    expect(validateFile({ name: "a.pdf", size: 26_214_401 })).toEqual({ ok: false, code: "file_too_large" });
  });
  it("counts the name in code points: 255 is fine, 256 is too long, in any language", () => {
    expect(MAX_FILE_NAME).toBe(255);
    expect(validateFile({ name: "a".repeat(255), size: 5 })).toEqual({ ok: true });
    expect(validateFile({ name: "a".repeat(256), size: 5 })).toEqual({ ok: false, code: "file_name_too_long" });
    expect(validateFile({ name: "😀".repeat(255), size: 5 })).toEqual({ ok: true });
    expect(validateFile({ name: "😀".repeat(256), size: 5 })).toEqual({ ok: false, code: "file_name_too_long" });
    expect(validateFile({ name: "契約書".repeat(85), size: 5 })).toEqual({ ok: true });
    expect(validateFile({ name: "", size: 5 })).toEqual({ ok: false, code: "file_name_too_long" });
  });
});

describe("uploadContentType", () => {
  it("gives the five previewable types by extension, any case, else octet-stream", () => {
    expect(uploadContentType("a.JPG")).toBe("image/jpeg");
    expect(uploadContentType("a.jpeg")).toBe("image/jpeg");
    expect(uploadContentType("a.png")).toBe("image/png");
    expect(uploadContentType("a.Gif")).toBe("image/gif");
    expect(uploadContentType("a.webp")).toBe("image/webp");
    expect(uploadContentType("a.PDF")).toBe("application/pdf");
    expect(uploadContentType("a.svg")).toBe("application/octet-stream");
    expect(uploadContentType("a.html")).toBe("application/octet-stream");
    expect(uploadContentType("README")).toBe("application/octet-stream");
  });
});

describe("fileKind", () => {
  it("is previewable only when bytes, name and stored type agree", () => {
    expect(fileKind({ head: PNG, name: "a.png", storedType: "image/png" })).toBe("png");
    expect(fileKind({ head: JPEG, name: "a.jpg", storedType: "image/jpeg" })).toBe("jpeg");
    expect(fileKind({ head: JPEG, name: "a.JPEG", storedType: "image/jpeg" })).toBe("jpeg");
    expect(fileKind({ head: GIF, name: "a.gif", storedType: "image/gif" })).toBe("gif");
    expect(fileKind({ head: GIF87, name: "a.gif", storedType: "image/gif" })).toBe("gif");
    expect(fileKind({ head: WEBP, name: "a.webp", storedType: "image/webp" })).toBe("webp");
    expect(fileKind({ head: PDF, name: "a.pdf", storedType: "application/pdf" })).toBe("pdf");
  });
  it("gives other for a text file named fake.png, SVG, HTML, a PNG stored as octet-stream, a PNG named .pdf", () => {
    expect(fileKind({ head: TEXT, name: "fake.png", storedType: "image/png" })).toBe("other");
    expect(fileKind({ head: bytes("<svg xmlns"), name: "a.svg", storedType: "image/svg+xml" })).toBe("other");
    expect(fileKind({ head: bytes("<html>"), name: "a.html", storedType: "text/html" })).toBe("other");
    expect(fileKind({ head: PNG, name: "a.png", storedType: "application/octet-stream" })).toBe("other");
    expect(fileKind({ head: PNG, name: "a.pdf", storedType: "application/pdf" })).toBe("other");
    expect(fileKind({ head: new Uint8Array(), name: "a.png", storedType: "image/png" })).toBe("other");
  });
  it("accepts a stored type with parameters", () => {
    expect(fileKind({ head: PDF, name: "a.pdf", storedType: "application/pdf; charset=binary" })).toBe("pdf");
  });
});

describe("isPreviewable and kindLabel", () => {
  it("previews the five kinds only", () => {
    for (const k of ["jpeg", "png", "gif", "webp", "pdf"] as const) expect(isPreviewable(k)).toBe(true);
    expect(isPreviewable("other")).toBe(false);
  });
  it("labels previewable kinds, else the extension (1–5 letters or digits) in capitals, else FILE", () => {
    expect(kindLabel("a.jpeg", "jpeg")).toBe("JPG");
    expect(kindLabel("a.png", "png")).toBe("PNG");
    expect(kindLabel("a.pdf", "pdf")).toBe("PDF");
    expect(kindLabel("budget.xlsx", "other")).toBe("XLSX");
    expect(kindLabel("data.csv", "other")).toBe("CSV");
    expect(kindLabel("fake.png", "other")).toBe("PNG");
    expect(kindLabel("README", "other")).toBe("FILE");
    expect(kindLabel("x.toolongext", "other")).toBe("FILE");
    expect(kindLabel("x.a-b", "other")).toBe("FILE");
  });
});

describe("safeDownloadName and shortName", () => {
  it("replaces characters a saved name cannot hold and trims dots and spaces", () => {
    expect(safeDownloadName("../a/b\\c.pdf")).toBe("_a_b_c.pdf");
    expect(safeDownloadName("bell\u0007.txt")).toBe("bell_.txt");
    expect(safeDownloadName('a:b*c?d"e<f>g|h.txt')).toBe("a_b_c_d_e_f_g_h.txt");
    expect(safeDownloadName("...")).toBe("file");
    expect(safeDownloadName("  report.pdf  ")).toBe("report.pdf");
    expect(safeDownloadName("契約書.pdf")).toBe("契約書.pdf");
  });
  it("shortens to 40 characters and an ellipsis", () => {
    expect(shortName("a".repeat(40))).toBe("a".repeat(40));
    expect(shortName("a".repeat(41))).toBe(`${"a".repeat(40)}…`);
    expect(shortName("😀".repeat(41))).toBe(`${"😀".repeat(40)}…`);
  });
});

// covers SF-116 US2 scenarios 2–4: a file name opens the box (images), a new tab (PDF) or a download (others)
import { fileHref } from "@/server/files/rules";
describe("fileHref", () => {
  it("links images to the box on the page, PDFs to the preview in a new tab, others to the download", () => {
    expect(fileHref({ id: 7, kind: "png" }, "/deals/3")).toEqual({ href: "/deals/3?file=7", newTab: false });
    expect(fileHref({ id: 7, kind: "webp" }, "/deals?pipeline=2&open=3#x")).toEqual({ href: "/deals?pipeline=2&open=3&file=7", newTab: false });
    expect(fileHref({ id: 7, kind: "pdf" }, "/deals/3")).toEqual({ href: "/files/7/preview", newTab: true });
    expect(fileHref({ id: 7, kind: "other" }, "/deals/3")).toEqual({ href: "/files/7/download", newTab: false });
  });
});
