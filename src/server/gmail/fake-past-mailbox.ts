// The fake mailbox of 100 conversations of SF-128 (data-model.md § Fake mailbox), used by the tests and the fake mailbox
// page (/dev/fake-gmail). Dates are relative to `now`, over the last 14 months. Only clearly fake addresses: the CRM
// side (Ana Fake at ana.fake@ and ana.home@, Ben Fake, private Pia, archived Arlo, and Nia Later once added) is made by
// the caller. A fetch copies 60 of them (groups A-F).
import type { FakeGoogleMail, NewMessage } from "@/server/gmail/fake-gmail";

export const PAST_ADDRESSES = {
  ana: "ana.fake@example.test",
  anaHome: "ana.home@example.test",
  ben: "ben.fake@example.test",
  pia: "pia.private@example.test",
  arlo: "arlo.archived@example.test",
  nia: "nia.later@example.test",
  news: "news@example.test",
  other: "other@example.test",
} as const;

const TEAMMATE = "sam.fake@barnacle.ai";
const TEAMMATE_2 = "team.fake@barnacle.ai";
const DAY = 24 * 60 * 60 * 1000;

export type PastGroup = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O";
export const COPIED_GROUPS: readonly PastGroup[] = ["A", "B", "C", "D", "E", "F"];

type Msg = Omit<NewMessage, "internalDate" | "threadId"> & { daysAgo: number };

// Puts the 100 conversations in `email`'s mailbox; returns their Gmail thread ids by group.
export function putPastMailbox(fake: FakeGoogleMail, email: string, o: { now: Date }): Record<PastGroup, string[]> {
  const me = email.trim().toLowerCase();
  const out = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"].map((g) => [g, [] as string[]])) as Record<PastGroup, string[]>;
  const conversation = (group: PastGroup, msgs: Msg[]) => {
    let threadId: string | null = null;
    for (const { daysAgo, ...m } of [...msgs].sort((a, b) => b.daysAgo - a.daysAgo)) {
      threadId = fake.addMessage(me, { ...m, internalDate: new Date(o.now.getTime() - daysAgo * DAY), threadId }).threadId;
    }
    out[group].push(threadId!);
  };
  const from = (who: string, daysAgo: number, extra: Partial<Msg> = {}): Msg => ({ from: who, to: me, subject: "Catching up", text: "Hello from a fake contact.", daysAgo, ...extra });
  const mine = (to: string, daysAgo: number, extra: Partial<Msg> = {}): Msg => ({ from: me, to, subject: "Re: Catching up", text: "Thanks, fake reply.", labels: ["SENT"], daysAgo, ...extra });

  // A: 40 with Ana or Ben at their first address, 1-3 messages within the 12 months, some with attachments.
  for (let i = 0; i < 40; i++) {
    const who = i % 2 === 0 ? `"Ana Fake" <${PAST_ADDRESSES.ana}>` : `Ben Fake <${PAST_ADDRESSES.ben}>`;
    const base = 5 + i * 8;
    const first = from(who, base, i % 4 === 0 ? { subject: `Proposal ${i}`, html: `<p>Proposal ${i}</p>`, attachments: [{ name: `proposal-${i}.pdf`, size: 1000 + i, type: "application/pdf" }] } : { subject: `Topic ${i}` });
    const msgs = [first];
    if (i % 3 >= 1) msgs.push(mine(i % 2 === 0 ? PAST_ADDRESSES.ana : PAST_ADDRESSES.ben, base - 1));
    if (i % 3 === 2) msgs.push(from(who, base - 2, { subject: `Re: Topic ${i}` }));
    conversation("A", msgs);
  }
  // B: 8 with Ana's second address.
  for (let i = 0; i < 8; i++) conversation("B", [from(`Ana Fake <${PAST_ADDRESSES.anaHome}>`, 20 + i * 40, { subject: `Weekend ${i}` })]);
  // C: 4 sent by the user to a teammate, the CRM person only in Cc (2) or Bcc (2).
  for (let i = 0; i < 4; i++) conversation("C", [mine(TEAMMATE, 15 + i * 30, i < 2 ? { cc: PAST_ADDRESSES.ben } : { bcc: PAST_ADDRESSES.ben })]);
  // D: 3 with 1 message 14 months ago and 2 last month.
  for (let i = 0; i < 3; i++) conversation("D", [from(PAST_ADDRESSES.ben, 425 + i), from(PAST_ADDRESSES.ben, 25 + i), mine(PAST_ADDRESSES.ben, 24 + i)]);
  // E: 3 with the address in another case.
  for (let i = 0; i < 3; i++) conversation("E", [from("ANA.FAKE@Example.test", 50 + i * 30, { subject: `Shouting ${i}` })]);
  // F: private Pia and archived Arlo.
  conversation("F", [from(PAST_ADDRESSES.pia, 60)]);
  conversation("F", [from(PAST_ADDRESSES.arlo, 90)]);
  // G: 5 newsletters.
  for (let i = 0; i < 5; i++) conversation("G", [from(`Fake News <${PAST_ADDRESSES.news}>`, 10 + i * 30, { subject: `Newsletter ${i}` })]);
  // H: 5 with Nia, not in the CRM until a test adds her.
  for (let i = 0; i < 5; i++) conversation("H", [from(PAST_ADDRESSES.nia, 12 + i * 40, { subject: `Intro ${i}` })]);
  // I: 8 between teammates only.
  for (let i = 0; i < 8; i++) conversation("I", [from(TEAMMATE, 7 + i * 30, { cc: TEAMMATE_2, subject: `Standup ${i}` })]);
  // J: 8 with a CRM person, every message 13-14 months old.
  for (let i = 0; i < 8; i++) conversation("J", [from(PAST_ADDRESSES.ana, 400 + i * 5), mine(PAST_ADDRESSES.ana, 399 + i * 5)]);
  // K: 4 with the CRM person only in a 14-month-old message; the recent ones between teammates.
  for (let i = 0; i < 4; i++) conversation("K", [from(PAST_ADDRESSES.ben, 425 + i), from(TEAMMATE, 30 + i, { subject: "Re: Catching up" })]);
  // L: 4 drafts to a CRM person.
  for (let i = 0; i < 4; i++) conversation("L", [mine(PAST_ADDRESSES.ana, 10 + i * 20, { labels: ["DRAFT"] })]);
  // M: 3 spam from a CRM person.
  for (let i = 0; i < 3; i++) conversation("M", [from(PAST_ADDRESSES.ben, 15 + i * 10, { labels: ["SPAM"] })]);
  // N: 2 in the bin, with a CRM person.
  for (let i = 0; i < 2; i++) conversation("N", [from(PAST_ADDRESSES.ana, 40 + i * 40, { labels: ["TRASH"] })]);
  // O: 1 with the display name "Ana Fake" and another address.
  conversation("O", [from(`"Ana Fake" <${PAST_ADDRESSES.other}>`, 33)]);
  return out;
}
