// SF-127 test helpers: teammates' mailboxes connected through the real connect path (gmail-helpers.ts), synced by the
// real sync, and the records of the spec's examples (Ana at Example Ltd with one open deal, Ben at Other Co). The test
// file mocks next/headers, next/navigation and next/cache before importing this (as gmail-helpers.ts needs).
import { sql } from "@/server/db";
import { syncConnection } from "@/server/gmail/sync";
import { readTimeline, type Target } from "@/server/records/timeline";
import type { GmailFake } from "../fakes/gmail";
import { makeOrganisation, makePerson, makeUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import * as h from "./gmail-helpers";

export const ADA = "ada@barnacle.ai";
export const BOB = "bob@barnacle.ai";

// Connects the user's Gmail (signed in as them in `jar`) and lets every email since 2020 be copied (Gmail's time of a
// test email may then be any fixed date). Returns the connection id.
export async function connect(fake: GmailFake, jar: Map<string, string>, userId: number): Promise<number> {
  await h.signInAs(jar, userId);
  const to = await h.connectGmail(fake);
  if (to !== "/settings") throw new Error(`connect answered ${to}`);
  const c = (await h.connectionOf(userId))!;
  await sql`update gmail_connections set connected_at = '2020-01-01T00:00:00Z' where id = ${c.id}`;
  return c.id;
}

export async function sync(connectionId: number) {
  const r = await syncConnection(connectionId);
  if (!("copied" in r)) throw new Error(`sync skipped: ${JSON.stringify(r)}`);
  return r.copied;
}

export type World = {
  ada: number; bob: number; exampleLtd: number; otherCo: number; ana: number; ben: number; stage: number; pilot: number;
  adaConn: number; bobConn: number;
};

// Ada and Bob connected; Ana (ana@example.test, ana.example@mail.test) at Example Ltd, main person of the one open deal
// "Example Ltd – pilot"; Ben (ben@example.test) at Other Co, on no deal.
export async function world(fake: GmailFake, jar: Map<string, string>): Promise<World> {
  const ada = (await makeUser({ email: ADA, name: "Ada Fake" })).id;
  const bob = (await makeUser({ email: BOB, name: "Bob Fake" })).id;
  const exampleLtd = await makeOrganisation({ name: "Example Ltd", ownerId: ada });
  const otherCo = await makeOrganisation({ name: "Other Co", ownerId: ada });
  const ana = await makePerson({ firstName: "Ana", lastName: "Example", createdBy: ada, organisationId: exampleLtd, emails: ["ana@example.test", "ana.example@mail.test"] });
  const ben = await makePerson({ firstName: "Ben", lastName: "Example", createdBy: ada, organisationId: otherCo, emails: ["ben@example.test"] });
  const stage = (await makePipeline("Sales", ["Lead", "Proposal"])).stages[0];
  const pilot = await makeDeal({ title: "Example Ltd – pilot", stageId: stage, createdBy: ada, personId: ana, organisationId: exampleLtd });
  const adaConn = await connect(fake, jar, ada);
  const bobConn = await connect(fake, jar, bob);
  return { ada, bob, exampleLtd, otherCo, ana, ben, stage, pilot, adaConn, bobConn };
}

export async function emailEntries(viewerId: number, target: Target, limit = 50) {
  return (await readTimeline(viewerId, target, limit)).entries.filter((e) => e.kind === "email");
}

export async function linksOf(conversationId: number) {
  return sql<{ person_id: number | null; organisation_id: number | null; deal_id: number | null; how: string; removed: boolean }[]>`
    select person_id::int as person_id, organisation_id::int as organisation_id, deal_id::int as deal_id, how, removed
    from email_links where conversation_id = ${conversationId} order by id`;
}

export async function conversationIds(): Promise<number[]> {
  return (await sql<{ id: number }[]>`select id::int as id from email_conversations order by id`).map((r) => r.id);
}

export async function lastContacted(personId: number): Promise<Date | null> {
  const [r] = await sql<{ at: Date | null }[]>`select last_contacted_at as at from persons where id = ${personId}`;
  return r.at;
}

// The HTML of a server component tree (async components included), as the browser would get it, without React's text
// separators (<!-- -->) and React's own form-replay script (added for server action forms, never from an email).
export async function html(node: import("react").ReactNode): Promise<string> {
  const { prerender } = await import("react-dom/static");
  const { prelude } = await prerender(node);
  const out = (await new Response(prelude).text()).replaceAll("<!-- -->", "");
  return out.replace(/<script>addEventListener\("submit",[^<]*<\/script>$/, "");
}

// Text as React writes it into HTML.
export const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");
