"use server";
// The fake mailbox page's buttons (SF-118 research.md §14, FR-018), development and tests only: put a message in a
// user's fake mailbox (with or without its notice, which goes through the same receiveGmailPush as /gmail/push), run
// the 15-minute check, and the switches. Back to the page with a fixed code.
import { notFound, redirect } from "next/navigation";
import { gmailConfig, isFakeAllowed } from "@/server/env";
import { fakeGmail } from "@/server/gmail/fake-gmail";
import { receiveGmailPush } from "@/server/gmail/push";
import { runGmailCheck } from "@/server/gmail/sync";

const str = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

function guard(form: FormData): string {
  if (!isFakeAllowed() || gmailConfig().mode !== "fake") notFound();
  return str(form, "user").toLowerCase();
}

const back = (user: string, done: string) => redirect(`/dev/fake-gmail?user=${encodeURIComponent(user)}&done=${done}`);

// "name:size" lines → attachments (a name may be empty: "(no name)" once copied).
function attachments(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.lastIndexOf(":");
      const size = Number(l.slice(at + 1));
      return { name: at < 0 ? l : l.slice(0, at).trim(), size: Number.isFinite(size) && size >= 0 ? Math.floor(size) : 0 };
    });
}

export async function putFakeMessage(form: FormData): Promise<void> {
  const user = guard(form);
  if (!user) back(user, "no_user");
  const sent = str(form, "direction") === "sent";
  const label = ["INBOX", "SPAM", "DRAFT", "TRASH"].includes(str(form, "label")) ? str(form, "label") : "INBOX";
  const labels = label === "DRAFT" ? ["DRAFT"] : sent ? (label === "INBOX" ? ["SENT"] : ["SENT", label]) : label === "INBOX" ? ["INBOX", "UNREAD"] : [label];
  const minutes = Number(str(form, "offset") || "0");
  const fake = fakeGmail();
  fake.addMessage(user, {
    from: str(form, "from") || (sent ? user : "someone@example.test"),
    to: str(form, "to") || (sent ? "" : user),
    cc: str(form, "cc") || undefined,
    bcc: str(form, "bcc") || undefined,
    subject: str(form, "subject"),
    text: str(form, "text") || null,
    html: str(form, "html") || null,
    attachments: attachments(str(form, "attachments")),
    labels,
    internalDate: new Date(fake.now() + (Number.isFinite(minutes) ? minutes : 0) * 60_000),
    threadId: str(form, "thread") || null,
    messageId: str(form, "messageId") || undefined,
  });
  if (form.get("deliver") === "on") {
    const n = fake.notice(user);
    if (n) await receiveGmailPush(n.authorization, n.body);
    back(user, n ? "delivered" : "no_watch");
  }
  back(user, "dropped");
}

export async function runFakeCheck(form: FormData): Promise<void> {
  const user = guard(form);
  await runGmailCheck(new Date());
  back(user, "checked");
}

export async function refuseFakeKey(form: FormData): Promise<void> {
  const user = guard(form);
  fakeGmail().refuseKey(user);
  back(user, "refused");
}

export async function toggleFakeRenewals(form: FormData): Promise<void> {
  const user = guard(form);
  const fake = fakeGmail();
  fake.failWatch(!fake.isFailingWatch());
  back(user, "renewals");
}

export async function forgetFakeHistory(form: FormData): Promise<void> {
  const user = guard(form);
  fakeGmail().forgetHistory();
  back(user, "forgot");
}
