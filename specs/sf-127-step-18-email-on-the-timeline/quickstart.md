# Quickstart: validating Email on the timeline (SF-127)

## Prerequisites

Local Postgres, `.env.local` as in `README.md` (fake Google sign-in, `GMAIL_TOKEN_KEY` set, no `GMAIL_PUBSUB_TOPIC`, so
Gmail is the fake). Schemas: `npm run test:schemas`.

## Automated

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate
npx vitest run tests/unit/emails-rules.test.ts tests/integration/emails-*.test.ts   # while working
npm test && npm run typecheck                                                        # before handing over
```

What the tests must show (each names the FR / US it covers):

| Scenario | Expected |
|---|---|
| Ada connected; fake message from ana@example.test with figures.pdf (240 KB); sync | EMAIL entry on Ana's, Example Ltd's and the deal's timeline and in the drawer; line "Ana Example → Ada Fake", subject, preview, "figures.pdf · 240 KB" (US1, US3) |
| Same message to Ada and Bob, both synced | one conversation, one entry per timeline, one email on the page (US1 AS6, FR-003) |
| HTML-only body with `<script>`, `<img>`, `<style>` | preview and page show only text; page HTML has no email `<script`/`<img`/`<style`; `<b>` shown escaped (FR-004) |
| Ana on two open deals / only Won deals / one linked deal | no deal / no deal / that deal (US3 AS2-5) |
| Person added later with an address in a copied conversation | linked with their organisation and deal (US3 AS7) |
| Unlink deal, then a new email in the conversation | deal stays unlinked (US4 AS4, SC-005) |
| Private Pia (Ada's) in a conversation with Ana | Ada sees it; Bob gets no entry, 404 on `/emails/<id>` and on the attachment route (US5) |
| Pia made shared | Bob sees it (US5 AS4) |
| Last contacted 25 Nov, email of 22 Nov | stays 25 Nov; later email raises it; Bcc person raised (US6) |
| Download through the fake | 200, bytes equal, `content-disposition: attachment`, `application/octet-stream`, `nosniff` |
| Mailbox disconnected / fake down / message gone; another working copy | 303 with `notice=attachment-unavailable`; with a second working copy: 200 through it (US2 AS4) |
| Rows inserted with `linked_at` null, then `runGmailCheck` | linked, Last contacted raised, `linked_at` set (emails copied before SF-127) |
| Two mailboxes' threads first separate, then a shared Message-ID arrives | conversations merged, links kept by the merge rule |

## By hand (development)

```bash
npm run db:migrate && npm run db:seed && npm run dev
```

1. Sign in as Ada Fake, open a fake person of the seed's Gmail conversations ("Fake proposal"): the person page shows
   details on the left, note box, // NEXT ACTIVITIES, // FILES and // TIMELINE on the right, with EMAIL entries in
   blue-edged boxes.
2. Click an entry's subject: the conversation page shows "← <PERSON>", "CONVERSATION · 2 EMAILS", // LINKED TO and the
   emails oldest first. [ DOWNLOAD ] on proposal-fake.pdf downloads the fake bytes.
3. [ UNLINK ] the organisation, [ LINK DEAL ] a deal: the entries leave / appear on those records' timelines.
4. Put a new message in the fake mailbox at `/dev/fake-gmail`, run the Gmail check (`/cron/gmail` with `CRON_SECRET`):
   the new entry appears; the person's Last contacted moves forward.
5. Narrow the window under 1000 px: the columns stack, details first.
