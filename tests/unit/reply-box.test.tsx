// @vitest-environment happy-dom
// covers SF-130 US1 scenario 1, US4 scenarios 1, 3 and 6, FR-003, FR-006, FR-008, FR-009, FR-019, SC-006 (T015, T041):
// the real EmailBox with a reply: the heading, To named from the CRM (the address in `title`), Subject prefilled, an
// empty text, the quote read-only as text under it, [ CANCEL ] back; a refusal keeps everything; a forward shows its
// attachments as removable chips counted in the 25 MB, and [ SEND ] calls nothing while over the limit.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailBox as Box } from "@/server/emails/compose";
import { messages } from "@/server/messages";

const sent = vi.hoisted(() => ({ calls: [] as unknown[], answer: { status: "refused", errors: [{ code: "compose_send_failed" }] } as unknown }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/(app)/records/email-actions", () => ({
  sendEmailFromRecord: vi.fn(),
  sendEmailReply: vi.fn(async (input: unknown) => {
    sent.calls.push(input);
    return sent.answer;
  }),
  startEmailUpload: vi.fn(),
}));
vi.mock("@/app/(app)/records/file-actions", () => ({ finishFileUpload: vi.fn(), startFileUpload: vi.fn() }));

const { EmailBox } = await import("@/app/(app)/records/EmailBox");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUOTE = "On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:\n> <b>prix</b> 🎉\n>\n> Bye";
const reply: Box = {
  gmail: "ok",
  from: "ada@barnacle.ai",
  to: ["ana@example.test"],
  cc: [],
  names: { "ana@example.test": "Ana Fake" },
  files: [],
  sendKey: "11111111-1111-4111-8111-111111111111",
  record: null,
  reply: { mode: "reply", messageId: 12, heading: "// REPLY · Pricing", subject: "Re: Pricing", quote: QUOTE, forwarded: [] },
};
const MB = 1024 * 1024;
const forward: Box = {
  ...reply,
  to: [],
  names: {},
  record: { kind: "deal", id: 3, name: "Fake deal" },
  files: [{ id: 7, name: "proposal.pdf", size: 1000 }],
  reply: {
    mode: "forward", messageId: 12, heading: "// FORWARD · Pricing", subject: "Fwd: Pricing", quote: "---------- Forwarded message ---------",
    forwarded: [{ id: 21, name: "quote.pdf", size: 2 * MB }, { id: 22, name: "plan.png", size: 300 * 1024 }],
  },
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  sent.calls.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (box: Box) => act(() => root.render(<EmailBox box={box} back="/emails/4" />));
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = async () =>
  act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const chips = () => [...host.querySelectorAll(".attachlist .chip")].map((c) => c.textContent ?? "");

describe("the reply box", () => {
  it("heading, To named with the address in title, Subject, an empty text, the quote as a read-only text node, [ CANCEL ] back", () => {
    show(reply);
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Reply");
    expect(host.querySelector(".hd span")?.textContent).toBe("// REPLY · Pricing");
    const to = host.querySelector<HTMLElement>(".chips .chip")!;
    expect(to.firstChild?.textContent).toBe("Ana Fake");
    expect(to.title).toBe("ana@example.test");
    expect(host.querySelector<HTMLInputElement>("#email-subject")!.value).toBe("Re: Pricing");
    expect(host.querySelector<HTMLTextAreaElement>("#email-text")!.value).toBe("");
    const pre = host.querySelector("pre.quote")!;
    expect(pre.textContent).toBe(QUOTE);
    expect(pre.querySelector("b")).toBeNull();
    expect(host.textContent).toContain(messages.reply_quote_label);
    expect(host.textContent).toContain(messages.reply_footer);
    expect([...host.querySelectorAll("a")].find((a) => a.textContent === messages.compose_cancel)?.getAttribute("href")).toBe("/emails/4");
    expect(host.textContent).not.toContain("FILE ▾");
  });
  it("sends mode, message id, no record, the typed text (never the quote); a refusal keeps everything", async () => {
    show(reply);
    type(host.querySelector<HTMLTextAreaElement>("#email-text")!, "Thanks Ana");
    await submit();
    expect(sent.calls).toEqual([
      expect.objectContaining({ mode: "reply", messageId: 12, record: null, to: ["ana@example.test"], cc: [], subject: "Re: Pricing", text: "Thanks Ana", forwardIds: [], back: "/emails/4" }),
    ]);
    expect(JSON.stringify(sent.calls[0])).not.toContain("wrote:");
    expect(host.querySelector<HTMLTextAreaElement>("#email-text")!.value).toBe("Thanks Ana");
    expect(host.textContent).toContain(messages.compose_send_failed);
  });
  it("missing: the message and [ CLOSE ] only", () => {
    show({ ...reply, reply: null, to: [], missing: true });
    expect(host.textContent).toContain(messages.email_not_found);
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain(messages.compose_close);
  });
});

describe("the forward box", () => {
  it("the forwarded chips (name · size, removable), 2.3 MB of 25 MB; the record's files offered; forwardIds sent", async () => {
    show(forward);
    expect(chips()).toEqual([`${messages.reply_forwarded_label} quote.pdf · 2 MB×`, `${messages.reply_forwarded_label} plan.png · 300 KB×`]);
    expect(host.textContent).toContain("2.3 MB of 25 MB");
    expect(host.textContent).toContain("[ ATTACH A DEAL FILE ▾ ]");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Remove plan.png"]')!.click());
    expect(chips()).toEqual([`${messages.reply_forwarded_label} quote.pdf · 2 MB×`]);
    expect(host.textContent).toContain("2 MB of 25 MB");
    await submit();
    expect(sent.calls[0]).toMatchObject({ mode: "forward", record: { target: "deal", id: 3 }, forwardIds: [21] });
  });
  it("over 25 MB: the size message, and [ SEND ] calls nothing until enough are removed", async () => {
    show({ ...forward, reply: { ...forward.reply!, forwarded: [{ id: 21, name: "big.bin", size: 20 * MB }, { id: 22, name: "more.bin", size: 6 * MB }] } });
    expect(host.textContent).toContain(messages.compose_attachments_too_large);
    await submit();
    expect(sent.calls).toEqual([]);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Remove more.bin"]')!.click());
    expect(host.textContent).not.toContain(messages.compose_attachments_too_large);
    await submit();
    expect(sent.calls).toHaveLength(1);
  });
});
