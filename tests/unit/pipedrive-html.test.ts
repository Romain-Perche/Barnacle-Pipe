// covers SF-122 FR-010, US2 scenario 4, edge case "Pipedrive text such as <a href…>": note HTML → plain text
import { describe, expect, it } from "vitest";
import { htmlToText } from "@/server/pipedrive/html";

describe("htmlToText", () => {
  it("keeps paragraphs and line breaks, removes markup", () => {
    expect(htmlToText("<p>First <b>bold</b> line</p><p>Second<br>third</p>")).toBe("First bold line\nSecond\nthird");
    expect(htmlToText("<div>A</div><div><br></div><div><br></div><div><br></div><div>B</div>")).toBe("A\n\nB");
    expect(htmlToText("  plain text  ")).toBe("plain text");
    expect(htmlToText("<h2>Title</h2><table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>")).toBe("Title\nab\nc");
  });
  it("turns lists into '- ' lines", () => {
    expect(htmlToText("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  });
  it("keeps a link's text, and its address after it when they differ; drops non-web addresses", () => {
    expect(htmlToText('<a href="https://fake.example">https://fake.example</a>')).toBe("https://fake.example");
    expect(htmlToText('See <a href="https://fake.example/x">the doc</a>.')).toBe("See the doc (https://fake.example/x).");
    expect(htmlToText('<a href="mailto:ada@fake.example">Ada</a>')).toBe("Ada (mailto:ada@fake.example)");
    expect(htmlToText('<a href="javascript:alert(1)">Click</a>')).toBe("Click");
    expect(htmlToText('<a href="https://evil.example">Click</a>')).toBe("Click (https://evil.example)");
  });
  it("makes a mention plain text", () => {
    expect(htmlToText('Hi <span class="mention" data-id="3">@Jane Fake</span>, call back')).toBe("Hi @Jane Fake, call back");
  });
  it("decodes entities, so escaped markup stays text", () => {
    expect(htmlToText("&lt;b&gt; &amp; &quot;x&quot; &apos;y&#39; &#65;&#x42;&nbsp;z")).toBe("<b> & \"x\" 'y' AB z");
    expect(htmlToText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });
  it("drops script and style contents", () => {
    expect(htmlToText("<style>p{}</style><script>alert(1)</script><p>ok</p>")).toBe("ok");
  });
});
