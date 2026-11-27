// SF-129 test helpers: a send from a record through the real domain function (sendFromRecord) with a fresh send key,
// the ledger rows, and the email entries of a record. The test file mocks next/headers, next/navigation and next/cache
// before importing this (as gmail-helpers.ts needs).
import { randomUUID } from "node:crypto";
import { sql } from "@/server/db";
import { sendFromRecord, type ComposeTarget, type SendInput } from "@/server/emails/compose";

export const ANA = "ana@example.test";

export function input(target: ComposeTarget, o: Partial<SendInput> = {}): SendInput {
  return {
    target, sendKey: randomUUID(), to: [ANA], cc: [], bcc: [], subject: "Next steps", text: "Hi Ana,\n\nHere is the plan.",
    fileIds: [], uploadIds: [], ...o,
  };
}

export async function send(actorId: number, target: ComposeTarget, o: Partial<SendInput> = {}) {
  return sendFromRecord(actorId, input(target, o));
}

export async function ledger() {
  return sql<{ id: number; state: string; deal_id: number | null; person_id: number | null; organisation_id: number | null; message_id: number | null; gmail_message_id: string | null }[]>`
    select id::int as id, state, deal_id::int as deal_id, person_id::int as person_id, organisation_id::int as organisation_id,
           message_id::int as message_id, gmail_message_id from email_sends order by id`;
}

export async function messageRows() {
  return sql<{ id: number; direction: string; from_name: string | null; from_address: string | null; rfc_message_id: string | null; gmail_message_id: string; linked_at: Date | null; subject: string; text_body: string | null }[]>`
    select id::int as id, direction, from_name, from_address, rfc_message_id, gmail_message_id, linked_at, subject, text_body
    from email_messages order by id`;
}

export async function handLinks() {
  return sql<{ deal_id: number | null; person_id: number | null; organisation_id: number | null; changed_by: number | null; removed: boolean }[]>`
    select deal_id::int as deal_id, person_id::int as person_id, organisation_id::int as organisation_id, changed_by::int as changed_by, removed
    from email_links where how = 'manual' order by id`;
}
