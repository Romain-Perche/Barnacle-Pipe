// covers SF-129 FR-006, FR-013, research.md §7: buildMime with the sender's name, the CRM's Message-ID and attachments
// (multipart/mixed, RFC 2231 file names, base64 in 76-character lines); CR/LF never reaches a header.
import { describe, expect, it } from "vitest";
import { BadHeader, buildMime } from "@/server/gmail/rules";

const plain = { from: "ada@barnacle.ai", to: ["ana@example.test"], subject: "Next steps", text: "Hi Ana", date: new Date("2026-11-27T10:00:00Z") };

function parts(mime: string) {
  const boundary = /boundary="([^"]+)"/.exec(mime)![1];
  return mime
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const [head, ...rest] = chunk.replace(/^\r\n/, "").split("\r\n\r\n");
      return { head, body: rest.join("\r\n\r\n").replace(/\r\n$/, "") };
    });
}

describe("buildMime, SF-129 additions", () => {
  it("From with the sender's name: plain, quoted, or RFC 2047", () => {
    expect(buildMime({ ...plain, fromName: "Ada Fake" })).toContain("From: Ada Fake <ada@barnacle.ai>\r\n");
    expect(buildMime({ ...plain, fromName: "Fake, Ada" })).toContain('From: "Fake, Ada" <ada@barnacle.ai>\r\n');
    const zoe = buildMime({ ...plain, from: "zoe@barnacle.ai", fromName: "Zoë Fake" });
    const word = /From: (=\?UTF-8\?B\?([^?]+)\?=) <zoe@barnacle\.ai>\r\n/.exec(zoe)!;
    expect(Buffer.from(word[2], "base64").toString("utf8")).toBe("Zoë Fake");
  });
  it("Message-ID only when given (the Settings test email is unchanged)", () => {
    expect(buildMime({ ...plain, messageId: "<crm-abc@barnacle.ai>" })).toContain("Message-ID: <crm-abc@barnacle.ai>\r\n");
    expect(buildMime(plain)).not.toMatch(/Message-ID/i);
    expect(buildMime(plain)).toBe(buildMime({ ...plain, attachments: [], fromName: null, messageId: null }));
  });
  it("attachments: multipart/mixed, the text first, each file byte for byte", () => {
    const pdf = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const mime = buildMime({
      ...plain,
      attachments: [
        { name: "proposal.pdf", contentType: "application/pdf", bytes: pdf },
        { name: "café “plan”.docx", contentType: "application/octet-stream", bytes: new Uint8Array([1, 2, 3]) },
      ],
    });
    expect(mime).toMatch(/\r\nContent-Type: multipart\/mixed; boundary="crm-[0-9a-f]{24}"\r\n/);
    const [text, file1, file2] = parts(mime);
    expect(text.head).toBe('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64');
    expect(Buffer.from(text.body, "base64").toString("utf8")).toBe("Hi Ana");
    expect(file1.head).toBe(
      'Content-Type: application/pdf; name="proposal.pdf"\r\nContent-Disposition: attachment; filename="proposal.pdf"; filename*=UTF-8\'\'proposal.pdf\r\nContent-Transfer-Encoding: base64',
    );
    for (const line of file1.body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(new Uint8Array(Buffer.from(file1.body, "base64"))).toEqual(pdf);
    expect(file2.head).toContain('filename="caf_ _plan_.docx"');
    const star = /filename\*=UTF-8''(\S+)/.exec(file2.head)![1];
    expect(decodeURIComponent(star)).toBe("café “plan”.docx");
    expect([...Buffer.from(file2.body, "base64")]).toEqual([1, 2, 3]);
  });
  it("a file name, type or sender name with CR/LF throws BadHeader", () => {
    const bytes = new Uint8Array([1]);
    expect(() => buildMime({ ...plain, attachments: [{ name: "a\r\nBcc: x@example.test", contentType: "text/plain", bytes }] })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, attachments: [{ name: "a.txt", contentType: "text/plain\r\nX: y", bytes }] })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, fromName: "Ada\nBcc: x@example.test" })).toThrow(BadHeader);
    expect(() => buildMime({ ...plain, messageId: "<a>\r\nBcc: x@example.test" })).toThrow(BadHeader);
  });
});
