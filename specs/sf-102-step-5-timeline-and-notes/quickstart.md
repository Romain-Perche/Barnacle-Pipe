# Quickstart: validate the timeline and notes

## Prerequisites

Local Postgres and the app as in `README.md`; then:

```bash
export APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev
npm run db:migrate       # applies migrations/0007_notes_mentions.sql
npm run db:seed          # fake users, people, deals, now with notes, mentions and notifications
npm run dev
```

Sign in through the fake Google login. The spec's "Bob Fake" is played by an existing fake user: "Ada Fake" (admin)
writes, "Linus Fake" (not admin) is mentioned, "Grace Fake" (admin) checks privacy.

## Scenarios

1. **Notes (US1)** — as Ada Fake, open a deal page: `// TIMELINE` (no more `// HISTORY`), the note box with
   `[ CANCEL ] [ ADD NOTE ]`. `[ ADD NOTE ]` empty → "Write something before adding the note.". Type two lines
   "Called Ada, wants a proposal by Friday" + a second line → the note is first under "// TODAY · <date>", tag NOTE,
   "Ada Fake", the time, both lines; the box is empty. Do the same on a person and an organisation. `[ EDIT ]`, change
   the text, `[ SAVE ]` → same place, "edited by Ada Fake". `[ DELETE ]` → "Delete this note? This can't be undone." →
   `[ DELETE ]` → "Note deleted.". Two tabs: edit in one, save in the other → "Someone else changed this note while you
   were editing. Reload to see their changes.". Archive the record: notes stay, no box, no `[ EDIT ]`/`[ DELETE ]`;
   restore: back.
2. **One timeline (US2)** — link a person to a deal (main person or `[ LINK PERSON ]`) and give the deal an
   organisation; add a note on the deal and move it to another stage. On the person's and the organisation's pages
   both appear, tag DEAL, under the deal's title (a link), in date order with their own entries. Unlink the person:
   the deal's entries leave their timeline. With > 50 entries, `[ SHOW MORE ]` adds the next 50 with no day heading
   twice.
3. **Mentions (US3)** — as Ada Fake, type "@Li" in a deal's note box: "Linus Fake" offered; choose, add the note:
   "@Linus Fake" highlighted. Type "ada@example.fake" in another note: plain text. Sign in as Linus Fake: sidebar
   "Notifications" with a badge 1; `/notifications` lists "Ada Fake mentioned you in a note on <deal title>", the date
   and the start of the note; press it → the deal page, badge gone. `[ MARK ALL AS READ ]` clears the rest. Ada edits
   the note to remove "@Linus Fake" → Linus's notification is gone.
4. **Privacy (US4)** — as Ada Fake, make a deal private, add a note on it. As Grace Fake (admin), open its organisation
   and main person: no entry of that deal. As Ada, type "@Gr" in that deal's box: Grace not offered. A note mentioning
   Linus on a shared deal, then the deal made private: Linus's notification and count disappear; shared again: back.
5. **Address tricks** — `/deals/<id>?timeline=abc&note=999999&delete-note=x` shows the page normally (50 entries, no
   edit box, no confirmation, no text from the address).

## Automated

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run test:e2e && npm run typecheck
```

Expected to pass: unit (note text rules, tokenize/detokenize/segments, preview, day grouping and headings, `parseShown`,
messages), integration (add/edit/delete with archived, conflict, gone and not-visible refusals SC-006; deal entries
exactly once on each linked person's and organisation's timeline and on no other SC-004; relink; privacy on timelines,
mention candidates, refusals and notifications SC-005; notification add/edit/delete rules; record delete cascade;
hand-over carries notes; 1,000-entry timeline first page < 2 s SC-003; seed idempotent; RLS on `note_mentions`;
migrate) and Playwright (US1–US4).
