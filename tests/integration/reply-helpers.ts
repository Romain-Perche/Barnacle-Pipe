// SF-130 test helpers: a received email put in a fake mailbox and copied by the real sync, the shown copy of an email,
// and a reply sent through the real domain function (sendReply) with a fresh send key. The test file mocks
// next/headers, next/navigation and next/cache before importing this (as gmail-helpers.ts needs).
import { randomUUID } from "node:crypto";
import { sql } from "@/server/db";
import { sendReply, type ReplyInput } from "@/server/emails/reply";
import type { GmailFake } from "../fakes/gmail";
import type { NewMessage } from "@/server/gmail/fake-gmail";
import * as e from "./email-helpers";

export const ANA = "ana@example.test";
export const ANA_FROM = "Ana Example <ana@example.test>";
export const PRICING_AT = new Date("2026-11-27T14:05:00Z");

// A received email copied into the CRM: the mailbox's message, then its stored row and conversation.
export async function received(fake: GmailFake, mailbox: string, connectionId: number, o: Partial<NewMessage> = {}) {
  const g = fake.addMessage(mailbox, {
    from: ANA_FROM, to: mailbox, subject: "Pricing", text: "Hello,\n\nThe price is 10.", internalDate: PRICING_AT, messageId: `<pricing-${randomUUID()}@example.test>`, ...o,
  });
  await e.sync(connectionId);
  const [row] = await sql<{ id: number; conversation_id: number; rfc_message_id: string | null }[]>`
    select m.id::int as id, t.conversation_id::int as conversation_id, m.rfc_message_id
    from email_messages m join email_threads t on t.id = m.thread_id where m.connection_id = ${connectionId} and m.gmail_message_id = ${g.id}`;
  if (!row) throw new Error("the email was not copied");
  return { ...row, gmailId: g.id, threadId: g.threadId };
}

export function replyInput(messageId: number, o: Partial<ReplyInput> = {}): ReplyInput {
  return {
    mode: "reply", messageId, record: null, sendKey: randomUUID(), to: [ANA], cc: [], bcc: [], subject: "Re: Pricing",
    text: "Thanks Ana,\n\nAgreed.", fileIds: [], uploadIds: [], forwardIds: [], ...o,
  };
}

export const reply = (actorId: number, messageId: number, o: Partial<ReplyInput> = {}) => sendReply(actorId, replyInput(messageId, o));

export async function sends() {
  return sql<{ id: number; state: string; reply_message_id: number | null; deal_id: number | null; person_id: number | null; organisation_id: number | null; message_id: number | null }[]>`
    select id::int as id, state, reply_message_id::int as reply_message_id, deal_id::int as deal_id, person_id::int as person_id,
           organisation_id::int as organisation_id, message_id::int as message_id
    from email_sends order by id`;
}

// The conversation of a stored message.
export async function conversationOf(messageId: number): Promise<number | null> {
  const [r] = await sql<{ id: number | null }[]>`
    select t.conversation_id::int as id from email_messages m join email_threads t on t.id = m.thread_id where m.id = ${messageId}`;
  return r?.id ?? null;
}
