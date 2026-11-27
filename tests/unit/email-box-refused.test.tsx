// @vitest-environment happy-dom
// SF-129 fix round 2: the real EmailBox in a browser-like page. Google refusing the Gmail key at send time keeps the form
// and everything typed, even after router.refresh() re-renders the box with the connection now read as needs_reconnect.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailBox as Box } from "@/server/emails/compose";
import { messages } from "@/server/messages";

const page = vi.hoisted(() => ({ refresh: () => {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => page.refresh(), push: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/(app)/records/email-actions", () => ({
  sendEmailFromRecord: vi.fn(async () => ({ status: "gmail", state: "needs_reconnect" })),
  startEmailUpload: vi.fn(),
}));
vi.mock("@/app/(app)/records/file-actions", () => ({ finishFileUpload: vi.fn(), startFileUpload: vi.fn() }));

const { EmailBox } = await import("@/app/(app)/records/EmailBox");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opened: Box = {
  gmail: "ok",
  from: "ada@barnacle.ai",
  to: ["ana@example.test"],
  files: [{ id: 7, name: "proposal.pdf", size: 1000 }],
  sendKey: "11111111-1111-4111-8111-111111111111",
  record: { kind: "deal", id: 1, name: "Fake deal" },
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function show(box: Box) {
  act(() => root.render(<EmailBox box={box} back="/deals/1" />));
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
}

describe("EmailBox after Google refuses the Gmail key", () => {
  // covers US4 scenario 3, FR-008, SC-006
  it("keeps the addresses, subject, text and attachments after the page refresh, with the message and no [ SEND ]", async () => {
    // The real refresh re-renders the page: the server now reads the connection as needs_reconnect.
    page.refresh = () => root.render(<EmailBox box={{ ...opened, gmail: "needs_reconnect" }} back="/deals/1" />);
    show(opened);
    type(host.querySelector<HTMLInputElement>("#email-subject")!, "Next steps");
    type(host.querySelector<HTMLTextAreaElement>("#email-text")!, "Hi Ana");
    act(() => buttonNamed("proposal.pdf")!.click());
    const cc = host.querySelector<HTMLInputElement>('input[aria-label="Cc addresses"]')!;
    type(cc, "ben@example.test");
    act(() => cc.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(host.querySelector<HTMLInputElement>("#email-subject")?.value).toBe("Next steps");
    expect(host.querySelector<HTMLTextAreaElement>("#email-text")?.value).toBe("Hi Ana");
    const chips = [...host.querySelectorAll(".chip")].map((c) => c.textContent ?? "");
    expect(chips.some((c) => c.includes("ana@example.test"))).toBe(true);
    expect(chips.some((c) => c.includes("ben@example.test"))).toBe(true);
    expect(host.querySelector(".attachlist")?.textContent).toContain("proposal.pdf");
    expect(host.textContent).toContain(messages.compose_reconnect_gmail);
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(buttonNamed(messages.compose_send)).toBeUndefined();
  });

  // covers US4 scenario 2
  it("opened without a working Gmail shows the message only", () => {
    show({ ...opened, gmail: "needs_reconnect" });
    expect(host.textContent).toContain(messages.compose_reconnect_gmail);
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(host.querySelector("#email-subject")).toBeNull();
  });
});
