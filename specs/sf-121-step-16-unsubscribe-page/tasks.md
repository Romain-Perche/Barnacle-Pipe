---

description: "Task list for SF-121 Unsubscribe page"
---

# Tasks: Unsubscribe page

**Input**: Design documents from `/specs/sf-121-step-16-unsubscribe-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: included. AGENTS.md has Build write unit and integration tests, run on the real local Postgres. Each test
names what it covers, e.g. `// covers FR-005, US1 scenario 2`. There are no browser tests (DECISIONS 2026-11-23).
Run the tests with:

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run typecheck
```

**Outside services**: only Supabase Postgres, which has no public schema. The tests have no fake for it: they use a
real local PostgreSQL 17, as recorded in `.factory/test-env.md`. Task T004 copies the Postgres behaviour that these
tests depend on.

**Blueprints**: `blueprints.json` is `[]`. There is no blueprint task and no DECISIONS exception line.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Check the highest migration number on `main` (`git ls-tree --name-only origin/main migrations/`). Name
  the new file `migrations/00NN_unsubscribe.sql`, with NN the next free number (`0012` if still free; SF-117 to
  SF-120 also plan 0012). Re-read the `timeline_events_kind_check` list of the last migration on `main` and note
  every kind it lists, for T003.

---

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Add the messages to `src/server/messages.ts`.
  - In `messages`:
    - `unsubscribe_lead`: "Stop receiving campaign emails from Barnacle Labs."
    - `unsubscribe_done`: "You're unsubscribed. You won't get any more campaign emails from us."
    - `unsubscribe_invalid`: "This unsubscribe link isn't valid any more. If you still get emails from us, reply to
      one and ask to be removed."
    - `unsubscribe_error`: "Something went wrong. Try again in a minute."
  - In `templates`:
    - `unsubscribed_link_event`: "Unsubscribed from campaigns through the unsubscribe link"
    - `unsubscribed_mail_app_event`: "Unsubscribed from campaigns through their mail app"
    - `consent_changed_event(from, to)`: "Consent: ${from} → ${to}"
  - Extend `tests/unit/messages.test.ts` with these exact texts.
- [x] T003 Write the migration `migrations/00NN_unsubscribe.sql` exactly as in data-model.md § Migration.
  - The new column:
    - `alter table persons add column unsubscribe_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') check (unsubscribe_token ~ '^[0-9a-f]{64}$')`
    - `persons_unsubscribe_token_key unique (unsubscribe_token)`
  - The kind check is rewritten. It lists every kind from T001 plus `'pipedrive_imported', 'pipedrive_unsubscribed'`
    plus `'unsubscribed_link', 'unsubscribed_mail_app', 'consent_changed'`.
  - `timeline_events_custom_check` is rewritten so that `consent_changed` holds `old_value` and `new_value` (both
    not null, with `actor_id` not null). `unsubscribed_link` and `unsubscribed_mail_app` have `actor_id is null and person_id is not null`.
  - Use only statements allowed in a transaction. No `create table`.
- [x] T004 Extend `tests/integration/migrate.test.ts`. Apply the new migration on a fresh database and check:
  - existing persons each get a distinct 64-hex token;
  - Postgres's own refusals: 23514 for a token `'abc'` or an uppercase-hex token, 23505 for a duplicate token, 23514
    for `consent_changed` with no `old_value`, and 23514 for `unsubscribed_link` with an `actor_id`.

  This is the Supabase Postgres task. There is no fake and no schema: the real local Postgres is the check. The
  behaviour copied comes from the PostgreSQL 17 documentation: "Constraints" (check 23514, unique 23505),
  "UUID Functions" (`gen_random_uuid`), and "Transaction Isolation" § Read Committed (a second `update` re-checks its
  `where` after the row lock, which the one-line guarantee relies on).
- [x] T005 [P] Add `"unsubscribed_link" | "unsubscribed_mail_app" | "consent_changed"` to `EventKind` in
  `src/server/records/timeline.ts`, with a `// SF-121` comment.
- [x] T006 [P] Write the pure rules in `src/server/records/unsubscribe-rules.ts`:
  - `isTokenShape(s)`: true when `s` matches `/^[0-9a-f]{64}$/`.
  - `unsubscribeLinks(base, token)`. It strips trailing slashes from `base` and returns:
    - `pageUrl` `${base}/unsubscribe/${token}`;
    - `listUnsubscribe` `<${base}/unsubscribe/${token}/one-click>`;
    - `listUnsubscribePost` `"List-Unsubscribe=One-Click"`.
  - `isOneClickBody(form: URLSearchParams | FormData)`: true when `get("List-Unsubscribe") === "One-Click"`.
  - Also export the types `UnsubscribeVia = "link" | "mail_app"` and `UnsubscribeLinks`.
- [x] T007 [P] Write `tests/unit/unsubscribe-rules.test.ts` (covers FR-002, FR-006, FR-012). Check:
  - `isTokenShape` for a valid token and for one with a character changed to `g`, cut to 63, extended to 65,
    uppercase, and empty;
  - `unsubscribeLinks` with and without a trailing slash on the base;
  - `isOneClickBody` for `One-Click`, `one-click`, a missing key and another key.
- [x] T008 Write `unsubscribeByToken(token, via)` in `src/server/records/unsubscribe.ts`:
  - Return `"not_found"` with no query when `!isTokenShape(token)`.
  - In one `sql.begin`, run
    `update persons set consent = 'unsubscribed' where unsubscribe_token = ${token} and consent = 'subscribed' returning id::int as id`.
  - When a row comes back, call `recordEvent(db, { personId, kind: via === "link" ? "unsubscribed_link" : "unsubscribed_mail_app", actorId: null })`
    and return `"done"`.
  - Otherwise run `select 1 from persons where unsubscribe_token = ${token}`: `"done"` if a row exists, else
    `"not_found"`.
  - Never change `version`, never touch `note_mentions` or the notification columns, and let database errors throw.
  - Add a header comment: these are the only `persons` reads without `visiblePerson()`, because the token is the
    authority (plan Complexity Tracking).

**Checkpoint**: the migration is applied, the rules are tested, and the domain write is ready.

---

## Phase 3: User Story 1 - A contact unsubscribes from the unsubscribe page (Priority: P1) 🎯 MVP

**Goal**: the public page `/unsubscribe/<token>` with `[ UNSUBSCRIBE ]`. Opening it changes nothing; pressing the
button unsubscribes.

**Independent Test**: take a seeded person's link, GET the page (still Subscribed), POST the confirm route, and check
Consent Unsubscribed plus one `unsubscribed_link` line with no actor.

### Tests for User Story 1

- [x] T009 [P] [US1] In `tests/integration/unsubscribe.test.ts`, test `unsubscribeByToken(token, "link")` for a
  subscribed person (covers FR-005, US1 scenario 2). Check:
  - the result is `"done"` and the consent is `unsubscribed`;
  - `readTimeline` shows one `unsubscribed_link` entry with `actorName` null;
  - `version` is unchanged;
  - the owner's unread count (`src/server/notifications.ts`) is the same before and after (FR-018).
- [x] T010 [P] [US1] In `tests/integration/unsubscribe.test.ts`, check that `unsubscribePageState` returns `"ready"`
  for a subscribed person and that calling it writes nothing: consent stays `subscribed` and there is no timeline
  line (covers FR-004, US1 scenarios 1 and 3).
- [x] T011 [P] [US1] In `tests/integration/unsubscribe-routes.test.ts`, call `POST` from
  `src/app/unsubscribe/[token]/confirm/route.ts` with a `Request` and `{ params: Promise.resolve({ token }) }`. Check:
  - with a valid token: `303`, `Location` ending `/unsubscribe/<token>`, the person unsubscribed, and no `set-cookie`;
  - with a stubbed throwing `unsubscribeByToken` (`vi.mock` of `@/server/records/unsubscribe`): `303` to
    `/unsubscribe/<token>?error=unavailable`.

  Covers FR-005 and the edge case where the database is down.
- [x] T012 [P] [US1] Extend `tests/unit/proxy-matcher.test.ts`. With no session cookie, `proxy()` on
  `/unsubscribe/<64 hex>` and `/unsubscribe/<64 hex>/confirm` returns no redirect to `/sign-in`, and
  `/unsubscribeX` or `/unsubscribe` alone still redirects (covers FR-001).

### Implementation for User Story 1

- [x] T013 [US1] Add `unsubscribePageState(token)` to `src/server/records/unsubscribe.ts`. It returns
  `"error"` when `isPreview()` (before any query) and `"not_found"` when the shape is bad. Otherwise it runs
  `select consent from persons where unsubscribe_token = ${token}` and returns `ready` (subscribed), `done`
  (unsubscribed) or `not_found` (no row). It catches database errors and returns `"error"`.
- [x] T014 [US1] Add `/^\/unsubscribe\/[^/]+(\/(confirm|one-click))?\/?$/` to `PUBLIC` in `src/proxy.ts`, and add a
  comment (SF-121: public, the token is the authority).
- [x] T015 [US1] Write `src/app/unsubscribe/[token]/confirm/route.ts` with `export const dynamic = "force-dynamic"`
  and `POST(req, { params })`.
  - It calls `unsubscribeByToken(token, "link")` and answers
    `NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, appBaseUrl()), 303)`.
  - When the call throws, it adds `?error=unavailable` to that address.
  - It never reads or sets cookies and exports no `GET`.
- [x] T016 [US1] Write `src/app/unsubscribe/[token]/page.tsx` (design A, contracts/routes.md):
  - `export const dynamic = "force-dynamic"` and `export const metadata = { robots: { index: false, follow: false } }`.
  - The layout: `<main className="outside"><div className="panel"><Wordmark centre="#FAF6F1" />`, then the label
    `// EMAIL PREFERENCES` (`<span className="c">//</span>`), then `<h1>Unsubscribe</h1>`.
  - By state:
    - `ready`: `<p className="lead">{messages.unsubscribe_lead}</p>`. When `searchParams.error === "unavailable"`,
      also `<p className="err" role="alert">{messages.unsubscribe_error}</p>`. Then
      `<form method="post" action={`/unsubscribe/${token}/confirm`}><button className="btn primary" type="submit">[ UNSUBSCRIBE ]</button></form>`.
    - `done`: `<p className="notice" role="status">{messages.unsubscribe_done}</p>`.
    - `not_found`: `.err` `unsubscribe_invalid`.
    - `error`: `.err` `unsubscribe_error`.
  - It shows no name, no email and no link into the app, and offers no way to subscribe again. It uses no
    `requireUser`.
- [x] T017 [US1] Show the two unsubscribe kinds in `src/app/(app)/records/Timeline.tsx`. `unsubscribed_link` →
  `<>{templates.unsubscribed_link_event}</>` and `unsubscribed_mail_app` →
  `<>{templates.unsubscribed_mail_app_event}</>`, with no `by()`. The tag stays CHANGE (no change to
  `timeline-view.ts`).

**Checkpoint**: US1 works end to end through the page.

---

## Phase 4: User Story 2 - One-click unsubscribe from the mail app (Priority: P1)

**Goal**: RFC 8058 `POST /unsubscribe/<token>/one-click`.

**Independent Test**: POST `List-Unsubscribe=One-Click` with no cookies and get `200`, Unsubscribed and one
`unsubscribed_mail_app` line. Send it again: `200` and still one line.

### Tests for User Story 2

- [x] T018 [P] [US2] In `tests/integration/unsubscribe-routes.test.ts`, call `POST` from
  `src/app/unsubscribe/[token]/one-click/route.ts`. Check:
  - urlencoded body `List-Unsubscribe=One-Click` → `200`, `text/plain`, `Cache-Control: no-store`, and one
    `unsubscribed_mail_app` line with no actor;
  - the same body sent as `multipart/form-data` → `200`;
  - an empty body, or `List-Unsubscribe=Yes` → `400`, with no change and no line;
  - an unknown token, a token with one character changed, a bad shape, and a deleted person's token → `404`, with
    an identical body for all four;
  - a stubbed throwing `unsubscribeByToken` → `503`.

  Covers FR-006, FR-008, US2 scenarios 1-3 and the database-down edge case.
- [x] T019 [P] [US2] Extend `tests/unit/proxy-matcher.test.ts`: with no cookie,
  `POST /unsubscribe/<64 hex>/one-click` is not redirected (covers US2 scenario 1).

### Implementation for User Story 2

- [x] T020 [US2] Write `src/app/unsubscribe/[token]/one-click/route.ts` with `export const dynamic = "force-dynamic"`
  and `POST` only.
  - Read the body with `req.formData()`. When that fails, or there is no content type, use
    `new URLSearchParams(await req.text())`. Call `isOneClickBody`: false → `400 "Bad request"`.
  - Then call `unsubscribeByToken(token, "mail_app")`: `not_found` → `404 "Not found"`; `done` →
    `200 "Unsubscribed"`; a throw → `503 "Try again later"`.
  - Every answer is `text/plain; charset=utf-8` with `Cache-Control: no-store`. There is no redirect and no cookie.

**Checkpoint**: US1 and US2 both work.

---

## Phase 5: User Story 3 - Links that are unique, cannot be guessed or changed, and harmless to repeat (Priority: P1)

**Goal**: the link properties that the token, the conditional update and the neutral answers provide.

**Independent Test**: the tests below, all on the real Postgres.

### Tests for User Story 3

- [x] T021 [P] [US3] In `tests/integration/unsubscribe.test.ts`, check two people (covers FR-002, US3 scenario 1):
  - they have different tokens, each matching `^[0-9a-f]{64}$`;
  - `unsubscribeLinksFor` contains neither the id, the name nor the email;
  - reading the token again gives the same value.
- [x] T022 [P] [US3] In `tests/integration/unsubscribe.test.ts`, change a token by one character, add one, and
  remove one (covers FR-008, US3 scenario 2, SC-002). For each:
  - `unsubscribePageState` returns `"not_found"`;
  - `unsubscribeByToken` returns `"not_found"`;
  - nobody's consent changes.
- [x] T023 [P] [US3] In `tests/integration/unsubscribe.test.ts`, check repeats (covers FR-007, FR-015, US3
  scenario 3, SC-004):
  - unsubscribe twice in sequence: `"done"` both times and one line;
  - `Promise.all` of two `unsubscribeByToken` calls on a fresh person: both `"done"` and exactly one line;
  - a mix of `"link"` and `"mail_app"` at the same moment: one line.
- [x] T024 [P] [US3] In `tests/integration/unsubscribe.test.ts`, delete a person through the existing person delete,
  then check that `unsubscribePageState` and `unsubscribeByToken` return `"not_found"`, exactly as for a made-up
  token (covers FR-008, US3 scenario 4, SC-005).
- [x] T025 [P] [US3] In `tests/integration/unsubscribe.test.ts`, check an archived person and a private person
  (covers FR-010, US3 scenario 5):
  - both can be unsubscribed;
  - the creator's or owner's `readTimeline` shows the line;
  - for the private person, another teammate cannot read the person, so the line is not shown to them
    (`visiblePerson`).
- [x] T026 [P] [US3] Render the page component with `searchParams` `{ next: "https://evil", message: "<b>x</b>" }`
  and check that neither value appears in the output (`renderToStaticMarkup` of the awaited page, in
  `tests/integration/unsubscribe-routes.test.ts`). Also check that for each state the output has no `href` into the
  app and no person name or email (covers FR-009, FR-013, US1 scenario 4).

### Implementation for User Story 3

- [x] T027 [US3] Make any fix the T021-T026 tests need in `src/server/records/unsubscribe.ts` (expected: none
  beyond Phase 2).

---

## Phase 6: User Story 4 - Only a teammate can subscribe a person again (Priority: P2)

**Goal**: the page never offers a way to subscribe again. A teammate's Consent edit writes
"Consent: Unsubscribed → Subscribed by <name>". The edit form changes Consent only when the teammate changed the field
on that form (FR-019): a form opened before the person unsubscribed never subscribes them again.

**Independent Test**:
1. Unsubscribe a person through the link.
2. Edit them back to Subscribed: the `consent_changed` line appears with the teammate's name.
3. Use the old link again: the page is `ready`, and after the button there is a second unsubscribe line.
4. Open the edit form, unsubscribe through the link, save the form with a changed Role: Consent stays Unsubscribed.

### Tests for User Story 4

- [x] T028 [P] [US4] In `tests/integration/people.test.ts`, change the assertion at line 163. Every edit in this file
  now sends `consentShown` (the stored value). A Consent-only edit (`consent` ≠ `consentShown`) now writes
  `{ kind: "consent_changed", actorName: "Linus Fake", oldValue: "Subscribed", newValue: "Unsubscribed" }` and no
  `edited` entry. An edit of Consent and Role writes `edited` with `fields: ["Role"]` (or the role field's label) plus
  `consent_changed` (covers FR-011). Also (covers FR-019, US4 scenario 5):
  - an unsubscribed person saved with `consent` = `consentShown` = `unsubscribed` and a changed Role keeps
    `unsubscribed`, with no consent line;
  - an edit with no `consentShown` and `consent` `subscribed` on an unsubscribed person keeps `unsubscribed`.

  In the existing form-data unit test (or a new `tests/unit/form-data.test.ts`), check that `personFormFromData`
  reads `consentShown`, and gives `""` when it is absent.
- [x] T029 [P] [US4] In `tests/integration/unsubscribe.test.ts`, run the full cycle (covers US4 scenarios 2-3, FR-003):
  1. unsubscribe through the link;
  2. run `updatePerson` with consent `subscribed` and `consentShown` `unsubscribed` → `consent_changed`
     "Unsubscribed" → "Subscribed";
  3. `unsubscribePageState` → `"ready"`;
  4. `unsubscribeByToken` → a second `unsubscribed_link` line.
- [x] T030 [P] [US4] In `tests/integration/unsubscribe.test.ts`, test the stale-form case (covers FR-019, US4
  scenario 4, Edge Cases):
  1. read the subscribed person's form `version`;
  2. unsubscribe through the link;
  3. save the edit with that old `version`, a changed Role, Consent `subscribed` and `consentShown` `subscribed`.

  Expect `status: "saved"` (no `edit_conflict`), the new Role, consent `unsubscribed`, an `edited` line with
  `["Role"]` and no `consent_changed`. Then a save with an empty first name (refused) followed by a valid save with
  the same `consentShown` `subscribed`: consent still `unsubscribed`, no `consent_changed`.
- [x] T031 [P] [US4] In `tests/integration/unsubscribe-routes.test.ts`, check that the rendered page has no form or
  link containing "subscribe" other than the `[ UNSUBSCRIBE ]` form, in states `ready`, `done` and `not_found`
  (covers US4 scenario 1).

### Implementation for User Story 4

- [x] T032 [US4] Keep the stored Consent unless the form changed it (FR-019, contracts/routes.md § Person edit):
  - add an optional `consentShown?: string` to `PersonForm` in `src/server/records/rules.ts` (create forms and imports leave it out);
  - read it in `personFields` in `src/server/records/form-data.ts` (`text(fd, "consentShown")`);
  - in `src/app/(app)/records/PersonForm.tsx`, edit mode only (`id !== undefined`), add
    `<input type="hidden" name="consentShown" value={initial.consent} />`, from `initial`, never `state.values`;
  - in the update path of `src/server/records/people.ts`, set `after.consent` to `value.consent` only when
    `form.consent` and `form.consentShown` are both non-empty and differ (absent counts as empty); else `current.consent`.

  Then in the same update path:
  - When `before.consent !== after.consent`, remove `"Consent"` from `fields` before the `edited` event. Write no
    `edited` event when nothing is left.
  - Then call `recordEvent(db, { personId: id, kind: "consent_changed", actorId, oldValue: CONSENT_LABELS[before.consent], newValue: CONSENT_LABELS[after.consent] })`.
  - Leave person create and the imports unchanged.
- [x] T033 [US4] Add `case "consent_changed"` to `src/app/(app)/records/Timeline.tsx`:
  `<>{templates.consent_changed_event(e.oldValue ?? "", e.newValue ?? "")}{by(e.actorName)}</>`.

---

## Phase 7: User Story 5 - The campaign sending issue gets the link and the headers from one place (Priority: P2)

**Goal**: `unsubscribeLinksFor(personId)`, plus the development links page.

**Independent Test**: call the function and use both of the addresses it returns. Open `/dev/unsubscribe-links` in
test and production modes.

### Tests for User Story 5

- [x] T034 [P] [US5] In `tests/integration/unsubscribe.test.ts`, test `unsubscribeLinksFor(id)` with
  `APP_URL=https://crm.example.test/` (covers FR-012, US5 scenarios 1-2, SC-006). Check:
  - `pageUrl` is `https://crm.example.test/unsubscribe/<token>`;
  - `listUnsubscribe` is `<https://crm.example.test/unsubscribe/<token>/one-click>`;
  - `listUnsubscribePost` is `List-Unsubscribe=One-Click`;
  - a person id that does not exist gives `null`;
  - the token taken from each address, used with `unsubscribeByToken`, unsubscribes only that person.
- [x] T035 [P] [US5] In `tests/integration/unsubscribe-routes.test.ts`, check the dev page `src/app/dev/unsubscribe-links/page.tsx`
  (covers FR-017):
  - with `APP_ENV=test`, it renders every person's three values;
  - with `APP_ENV=production`, and with `VERCEL_ENV=preview`, it calls `notFound()` (expect the
    `NEXT_HTTP_ERROR_FALLBACK;404` throw);
  - `tests/unit/proxy-matcher.test.ts`: `/dev/unsubscribe-links` is public.

### Implementation for User Story 5

- [x] T036 [US5] Add to `src/server/records/unsubscribe.ts`:
  - `unsubscribeLinksFor(personId: number): Promise<UnsubscribeLinks | null>`: it reads only `unsubscribe_token`
    by id and returns `unsubscribeLinks(appBaseUrl(), token)`, with a doc comment "the one function campaign
    sending uses";
  - `listUnsubscribeLinks()`: every person, ordered by `lower(last_name), lower(first_name), id`, as
    `{ id, name, links }`.
- [x] T037 [US5] Add `/^\/dev\/unsubscribe-links\/?$/` to `PUBLIC` in `src/proxy.ts`. Write
  `src/app/dev/unsubscribe-links/page.tsx`:
  - It calls `notFound()` unless `isFakeAllowed()`, before any query.
  - It uses the `outside` / `panel` layout with the label `// UNSUBSCRIBE LINKS · DEVELOPMENT AND TEST ONLY`.
  - It shows a table with the columns Name | Page link (`<a href>`) | List-Unsubscribe | List-Unsubscribe-Post.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T038 [P] Update `README.md`. In the `APP_URL` row of § Settings, add "also the base of unsubscribe links (https
  in production)". Add a short `## Unsubscribe` section covering:
  - `/unsubscribe/<token>`, `/confirm` and `/one-click` (RFC 8058);
  - `/dev/unsubscribe-links`;
  - `unsubscribeLinksFor` for campaign sending;
  - that there is no setting.
- [x] T039 [P] Update the `AGENTS.md` Layout. Add an SF-121 line:
  - `records/unsubscribe-rules.ts` (pure) and `records/unsubscribe.ts` (the token reads without `visiblePerson()`,
    `unsubscribeLinksFor` for campaigns);
  - `src/app/unsubscribe/[token]/` (page, `confirm/`, `one-click/`) and `src/app/dev/unsubscribe-links/`;
  - the kinds `unsubscribed_link`, `unsubscribed_mail_app` and `consent_changed`.
- [x] T040 [P] Add a line at the end of `docs/DECISIONS.md`: "- Unsubscribe links are a random token per person
  stored in the CRM, with no expiry; no teammate is told when someone unsubscribes; a teammate's Consent change is
  shown as 'Consent: <old> → <new>'; the edit form changes Consent only when the field was changed on that form
  (SF-121)".
- [x] T041 Run `npm test && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`
  and fix any failure. Then walk through quickstart.md § By hand.
- [x] T042 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its
  schema) and `## Schemas` (each schema's GitHub URL at its commit).
  - Extend the existing "Supabase Postgres" line in `## Services` (no fake, a real local PostgreSQL 17, no public
    schema). Mention the new migration's column `persons.unsubscribe_token` and the three kinds, and the 23514/23505
    refusals checked by `migrate.test.ts`.
  - Note that mail apps' one-click POSTs are covered by RFC 8058 and called straight on the route handler: there is no
    outside service.
  - `## Schemas` gains nothing (Supabase Postgres has no public schema). Keep the existing entries.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002-T008)** → all stories.
- **US1 (T009-T017)** is the MVP. US2, US3 and US5 depend only on Foundational:
  - US2 uses the `/one-click` proxy pattern from T014. If US2 is done first, add that pattern to `PUBLIC` in `src/proxy.ts` then.
  - US3's page-render test (T026) needs T016.
- **US4 (T028-T033)** depends on Foundational only. T029 and T030 need T013.
- **Polish (T038-T042)** comes after all stories. T042 is last.
- Within a story, write the tests first and see them fail, then implement.

## Parallel Opportunities

- Foundational: T002, T005, T006 and T007 can run in parallel (different files). T003 → T004 and T008 are sequential.
- US1: T009-T012 run in parallel. Then T013 → T014 → T015/T016/T017 (T015, T016 and T017 touch different files, so
  they can run in parallel).
- After Foundational, US2 (T018-T020), US4 (T028-T033) and US5 (T034-T037) can be done in parallel by different
  people. `src/proxy.ts` is shared by T014 and T037, and `Timeline.tsx` by T017 and T033, so merge those
  carefully.
- Polish: T038, T039 and T040 run in parallel.

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1. A contact can unsubscribe from the page.
2. Add US2 (needed before campaign sending: Gmail and Yahoo one-click), then US3 (the hardening tests).
3. Add US4 (the consent line), then US5 (the function for campaign sending, and the dev page).
4. Polish; the test recipe is last.
