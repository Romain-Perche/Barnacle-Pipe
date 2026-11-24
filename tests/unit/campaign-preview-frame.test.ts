// covers SF-119 FR-017, FR-016, SC-004, US4 scenario 2 (T033): the email is shown only inside one <iframe> sandboxed
// without scripts, same origin, forms or top navigation, with no referrer; the pasted HTML appears only escaped in its
// srcdoc; the From / subject lines are text. No file of the campaign pages uses dangerouslySetInnerHTML.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignPreview } from "@/app/(app)/campaigns/CampaignPreview";

const PASTED =
  `<script>document.title='x'</script><img src="x" onerror="alert(1)"><form action="/campaigns"><button>Go</button></form>` +
  `<a href="https://example.test/">Link</a>`;

describe("CampaignPreview", () => {
  const markup = renderToStaticMarkup(
    createElement(CampaignPreview, {
      senderName: "<b>Ada</b>", replyTo: "ada@example.test", subject: "<i>Hi</i>", previewText: "p", contentHtml: PASTED, unknown: [],
    }),
  );

  it("renders exactly one iframe with the sandbox flags, no referrer and the HTML only in srcdoc", () => {
    const frames = markup.match(/<iframe[^>]*>/g) ?? [];
    expect(frames).toHaveLength(1);
    const frame = frames[0] ?? "";
    expect(frame).toMatch(/ sandbox="allow-popups allow-popups-to-escape-sandbox"/);
    for (const flag of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-top-navigation"]) expect(markup).not.toContain(flag);
    expect(frame).toMatch(/ referrerPolicy="no-referrer"/i);
    expect(frame).toContain("&lt;script&gt;document.title=");
    expect(frame).toContain("Content-Security-Policy");
    const outside = markup.replace(frame, "");
    for (const bit of ["<script", "onerror", "<form", "example.test/\"", "<b>", "<i>"]) expect(outside, bit).not.toContain(bit);
    expect(outside).toContain("From: &lt;b&gt;Ada&lt;/b&gt;");
  });
});

describe("campaign pages", () => {
  it("never use dangerouslySetInnerHTML", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk("src/app/(app)/campaigns");
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
  });
});
