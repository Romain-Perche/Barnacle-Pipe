// covers SF-119 FR-010, FR-011, US3 scenarios 1–5 (T026) and FR-012, FR-017, US4 scenarios 2–3, SC-004 (T032): layouts,
// block limits and addresses, markup typed in blocks shown as text, links, tags kept for the HTML box, the HTML limit and
// the preview frame document (CSP and <base target="_blank"> first, the unsubscribe line last).
import { describe, expect, it } from "vitest";
import { blocksToHtml, frameDocument, isEmptyContent, keepTags, layoutBlocks, validateContent, type Block } from "@/server/campaigns/content";
import { blockFill, mergeFields, resolver } from "@/server/campaigns/merge";

const blocks = (list: unknown) => validateContent("blocks", JSON.stringify(list), "");
const errorsOf = (r: ReturnType<typeof validateContent>) => (r.ok ? {} : r.errors);

describe("layouts (US3 scenario 1)", () => {
  it("gives each layout's blocks in order, every field empty", () => {
    const types = (l: Parameters<typeof layoutBlocks>[0]) => layoutBlocks(l).map((b) => b.type);
    expect(types("blank")).toEqual(["text"]);
    expect(types("text")).toEqual(["heading", "text"]);
    expect(types("text_button")).toEqual(["heading", "text", "button"]);
    expect(types("newsletter")).toEqual(["image", "heading", "text", "button", "divider", "text"]);
    expect(layoutBlocks("text_button")[2]).toEqual({ type: "button", label: "", url: "" });
  });
});

describe("validateContent: blocks (US3 scenarios 2–4)", () => {
  it("accepts every limit and refuses one more", () => {
    const ok = [
      { type: "heading", text: "h".repeat(200) },
      { type: "text", text: "t".repeat(10_000) },
      { type: "button", label: "b".repeat(60), url: `https://x.test/${"a".repeat(1985)}` },
      { type: "image", src: "https://x.test/a.png", alt: "a".repeat(200), url: "" },
      { type: "divider" },
    ];
    expect(blocks(ok).ok).toBe(true);
    expect(errorsOf(blocks([{ type: "heading", text: "h".repeat(201) }]))).toEqual({ "block.0": "Heading: at most 200 characters." });
    expect(errorsOf(blocks([{ type: "text", text: "t".repeat(10_001) }]))).toEqual({ "block.0": "Text: at most 10,000 characters." });
    expect(errorsOf(blocks([{ type: "button", label: "b".repeat(61), url: "" }]))).toEqual({ "block.0": "Button: at most 60 characters." });
    expect(errorsOf(blocks([{ type: "image", src: "", alt: "a".repeat(201), url: "" }]))).toEqual({ "block.0": "Image: at most 200 characters." });
    expect(errorsOf(blocks([{ type: "button", label: "", url: `https://x.test/${"a".repeat(1986)}` }]))).toEqual({ "block.0": "Button: at most 2,000 characters." });
  });
  it("refuses 51 blocks, unknown types and extra keys", () => {
    expect(blocks(Array.from({ length: 50 }, () => ({ type: "divider" }))).ok).toBe(true);
    expect(errorsOf(blocks(Array.from({ length: 51 }, () => ({ type: "divider" }))))).toEqual({ content: "A campaign can have at most 50 blocks." });
    const invalid = { content: "The content couldn't be read. Reload and try again." };
    expect(errorsOf(blocks([{ type: "video", src: "" }]))).toEqual(invalid);
    expect(errorsOf(blocks([{ type: "divider", style: "x" }]))).toEqual(invalid);
    expect(errorsOf(blocks([{ type: "text" }]))).toEqual(invalid);
    expect(errorsOf(validateContent("blocks", "{not json", ""))).toEqual(invalid);
    expect(errorsOf(validateContent("blocks", '{"type":"text"}', ""))).toEqual(invalid);
    expect(errorsOf(validateContent("other", "", ""))).toEqual(invalid);
  });
  it("allows https, http and mailto links, https images and empty addresses; refuses the rest", () => {
    const button = (url: string) => errorsOf(blocks([{ type: "button", label: "Go", url }]));
    for (const url of ["https://example.test/dinner", "http://example.test/", "mailto:a@x.test", ""]) expect(button(url), url).toEqual({});
    for (const url of ["javascript:alert(1)", "ftp://x", "example.test", "data:text/html,x"]) {
      expect(button(url), url).toEqual({ "block.0": "Button: enter a web address starting with https://." });
    }
    const image = (src: string, url = "") => errorsOf(blocks([{ type: "image", src, alt: "", url }]));
    expect(image("https://x.test/a.png")).toEqual({});
    expect(image("http://x.test/a.png")).toEqual({ "block.0": "Image: enter a web address starting with https://." });
    expect(image("", "javascript:alert(1)")).toEqual({ "block.0": "Image: enter a web address starting with https://." });
  });
  it("turns heading line breaks into spaces; an empty list is no content", () => {
    const r = blocks([{ type: "heading", text: "One\ntwo\r\nthree" }]);
    expect(r.ok && r.content).toEqual({ kind: "blocks", blocks: [{ type: "heading", text: "One two three" }] });
    expect(blocks([])).toEqual({ ok: true, content: null });
    expect(validateContent("none", "", "")).toEqual({ ok: true, content: null });
  });
});

describe("validateContent: HTML (US4 scenario 3)", () => {
  it("keeps 500,000 code points as pasted and refuses 500,001", () => {
    const html = "😀".repeat(500_000);
    expect(validateContent("html", "", html)).toEqual({ ok: true, content: { kind: "html", html } });
    expect(errorsOf(validateContent("html", "", html + "x"))).toEqual({ content: "The HTML can be at most 500,000 characters." });
    expect(validateContent("html", "", "  \n ")).toEqual({ ok: true, content: null });
  });
});

describe("isEmptyContent", () => {
  it("is true for nothing, no blocks or blank HTML", () => {
    expect(isEmptyContent(null)).toBe(true);
    expect(isEmptyContent([])).toBe(true);
    expect(isEmptyContent("   ")).toBe(true);
    expect(isEmptyContent({ kind: "html", html: " " })).toBe(true);
    expect(isEmptyContent({ kind: "blocks", blocks: [{ type: "divider" }] })).toBe(false);
  });
});

describe("blocksToHtml (FR-011, US3 scenario 5)", () => {
  const typed: Block[] = [
    { type: "heading", text: "<b>Fake</b> https://example.test/h" },
    { type: "text", text: "Hi {{First name | there}},\n<b>Fake</b> see https://example.test/x." },
    { type: "button", label: "<b>Book</b>", url: "https://example.test/dinner?a=1&b=2" },
  ];
  it("shows typed markup as text, keeps line breaks, links addresses in text only, keeps tags", () => {
    const html = blocksToHtml(typed, keepTags);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;Fake&lt;/b&gt; https://example.test/h</h1>");
    expect(html).toContain('Hi {{First name | there}},<br>&lt;b&gt;Fake&lt;/b&gt; see <a href="https://example.test/x">https://example.test/x</a>.');
    expect(html).toContain('href="https://example.test/dinner?a=1&amp;b=2"');
    expect(html).toContain("&lt;b&gt;Book&lt;/b&gt;</a>");
    expect(html).toContain("max-width:600px");
  });
  it("fills tags with escaped values", () => {
    const fill = blockFill({ resolve: resolver([], mergeFields([])), values: { first_name: "<i>Fakey</i>" } });
    expect(blocksToHtml(typed, fill)).toContain("Hi &lt;i&gt;Fakey&lt;/i&gt;,<br>");
  });
});

describe("frameDocument (FR-017, US4 scenario 2)", () => {
  it("starts with the CSP and <base target=_blank> before the content and ends with the unsubscribe line", () => {
    const doc = frameDocument("<p>Hello</p>");
    const head =
      `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank">`;
    expect(doc.startsWith(head)).toBe(true);
    expect(doc.indexOf("<p>Hello</p>")).toBe(head.length);
    expect(doc.slice(doc.indexOf("<p>Hello</p>"))).toMatch(/Don't want these emails\? <a>Unsubscribe<\/a><\/p>$/);
  });
});
