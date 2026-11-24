# Research: Unsubscribe page (SF-121)

No item of the Technical Context was left as NEEDS CLARIFICATION. The points below record the choices made.

## 1. What makes a link unguessable and unforgeable

- **Decision**: each person gets a random token, stored in a new column `persons.unsubscribe_token`: 64 lowercase hex
  characters, `not null unique`. A column default fills it, so every insert path gets one with no code change (form,
  CSV import, seed, SF-117 Pipedrive import). The default is
  `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`: 244 random bits, built into Postgres 13+,
  no extension needed. The link is `/unsubscribe/<token>`. A lookup is `where unsubscribe_token = $1` on the unique
  index, and nothing else is accepted.
- **Rationale**: the token carries no CRM number, name or email (FR-002). Changing a character gives a token that no
  row has (2^-244 odds), so it cannot lead to another person. The link never expires (FR-003) and stays the same when
  the person is subscribed again. Deleting the person removes the row, which gives the neutral answer with no trace
  (FR-008). There is no secret to keep or rotate (FR-014 holds trivially; nothing to add to `.env.example`).
- **Alternatives considered**: an HMAC-signed person id with an `UNSUBSCRIBE_SECRET` setting. It needs no column, but
  the id is still in the link (encoded, not hidden) unless it is also encrypted. It needs a new secret in every
  environment, and changing the secret breaks every link already sent. A per-campaign or per-address token was
  rejected because consent is per person (spec Assumptions).
- **Timing**: an indexed equality lookup on a 244-bit random value leaks nothing useful. No constant-time compare is
  needed, because the value is never compared in app code.

## 2. Public page, button and one-click: which Next.js pieces

- **Decision**:
  - `GET /unsubscribe/[token]` is a server-component page (`src/app/unsubscribe/[token]/page.tsx`). It only reads.
  - The `[ UNSUBSCRIBE ]` button is a plain `<form method="post" action="/unsubscribe/<token>/confirm">` handled by a
    **route handler** `src/app/unsubscribe/[token]/confirm/route.ts`. That handler answers `303` to
    `/unsubscribe/<token>` (and to `/unsubscribe/<token>?error=unavailable` when the database fails).
  - One-click: a route handler `src/app/unsubscribe/[token]/one-click/route.ts` (POST only, RFC 8058).
- **Rationale**: AGENTS.md says every server action calls `requireUser()` first, and this button has no user, so it
  cannot be a server action. A route handler keeps that rule intact. Post-redirect-get means a reload never posts
  again. The "done" state is read from the database (consent is `unsubscribed`), not from the address. So the address
  never decides what is shown (FR-013), except `?error=unavailable`. That is a fixed code from a closed set, the same
  pattern as the sign-in page's `?error=`. A page load never writes, so link scanners that only GET change nothing
  (FR-004, US1-3).
- **Alternatives considered**: one address for the page link and for one-click (Gmail POSTs to the List-Unsubscribe
  address). Rejected: a page and a POST route cannot share one App Router segment, and keeping two addresses makes the
  "page" and "mail app" timeline lines easy to tell apart. A server action was rejected for the reason above.

## 3. RFC 8058 one-click

- **Decision**: the `List-Unsubscribe` header is `<{APP_URL}/unsubscribe/<token>/one-click>` and the
  `List-Unsubscribe-Post` header is `List-Unsubscribe=One-Click`. The route reads the body as form data
  (`application/x-www-form-urlencoded` or `multipart/form-data`, as RFC 8058 §3.1 allows). It also falls back to
  `URLSearchParams(await req.text())` when no content type is sent. The answers, checked in this order:
  1. the body has no `List-Unsubscribe` = `One-Click` (or it cannot be read) → `400`, no database access;
  2. the token is the wrong shape, unknown, or its person was deleted → `404`, the same empty body each time;
  3. the person is unsubscribed (now or already) → `200`;
  4. the database fails → `503`, so the mail app retries.
  Only `POST` is exported, so any other method gets Next's `405`. No cookies are read or set. The response bodies are
  short fixed strings with no CRM data.
- **Rationale**: matches spec US2. RFC 8058 needs HTTPS and no redirects. The address is on `APP_URL`, which is
  https in production. It answers directly with no redirect.
- **No mailto**: DECISIONS 2026-11-24 (spec Assumptions).

## 4. One timeline line, even at the same moment (FR-007, FR-015, SF-004)

- **Decision**: one transaction does this:
  `update persons set consent = 'unsubscribed' where unsubscribe_token = $1 and consent = 'subscribed' returning id`.
  When a row comes back, it inserts the timeline event (`actor_id` null) in the same transaction. When none comes
  back, `select 1 from persons where unsubscribe_token = $1` decides between "already done" and "not found".
- **Rationale**: under READ COMMITTED, a second concurrent `update` waits on the row lock. It then re-checks
  `consent = 'subscribed'` against the committed row and updates nothing, so it writes no second line. No advisory
  lock is needed.
- **`version` is not bumped**: `persons.version` guards the edit form ("Someone else changed this person…"). The spec
  edge case wants a teammate's open form, saved with Subscribed after the person unsubscribed, to succeed and write
  "Consent: Unsubscribed → Subscribed". The edit reads the locked row inside its transaction, so `before.consent` is
  `unsubscribed` and the change is recorded. Bumping `version` would refuse that save instead.

## 5. Timeline kinds and lines

- **Decision**: three new kinds:
  - `unsubscribed_link`: "Unsubscribed from campaigns through the unsubscribe link"
  - `unsubscribed_mail_app`: "Unsubscribed from campaigns through their mail app"
  - `consent_changed`: a teammate's edit of Consent, "Consent: Unsubscribed → Subscribed by <name>" (`old_value` /
    `new_value` hold the labels of the time; `actor_id` set)

  All three are tagged CHANGE (the `entryTag` default). The two unsubscribe kinds have `actor_id` null, so no name is
  shown. A person edit that changes consent writes `consent_changed`, and "Consent" is left out of that edit's
  `edited` field list, so the change is not reported twice. This applies to both directions of the change
  (spec Clarifications, decided by the factory).
- **Migration and kind check**: the timeline kind check is rewritten. It lists every existing kind, the three new
  ones, and the kinds of the steps planned in parallel that rewrite the same check: SF-117's `pipedrive_imported` and
  `pipedrive_unsubscribed`. Whichever merges first then drops none (DECISIONS, SF-115 rule). The `timeline_events_custom_check`
  constraint (0010) forces `old_value`/`new_value` to be null outside the custom kinds. It is rewritten to allow them
  on `consent_changed` too, with `field_name` still only on custom kinds.
- **Migration number**: SF-117 (`0012_pipedrive.sql`), SF-118 (`0012_gmail.sql`), SF-119 (`0012_campaigns.sql`) and
  SF-120 (`0012_segments.sql`) all plan `0012`. Build takes the next free number on `main` at build time. The file is
  `00NN_unsubscribe.sql`, written as `0012_unsubscribe.sql` in this plan. Before writing it, Build re-reads the kind
  check of the last migration on `main` and keeps every kind listed there.

## 6. Visibility

- **Decision**: the public reads and writes go by token, with no viewer, so `visiblePerson()` does not apply. This is
  a documented exception (plan Constitution Check): the page shows no CRM data at all (FR-009), and the token is the
  only authority (FR-002). The timeline line is an ordinary person event, so the existing reads show it only to those
  who can see the person (FR-010). `unsubscribeLinksFor(personId)` reads only the token column. It is called by
  campaign sending (a later issue) for recipients that issue has already chosen, and by the dev links page.
- **Notifications**: nothing is written to `note_mentions` or the activity notification columns, so the
  Notifications page and the sidebar count are unchanged (FR-018).

## 7. Development links page

- **Decision**: `/dev/unsubscribe-links` calls `notFound()` unless `isFakeAllowed()`. It is listed as public in
  `src/proxy.ts`, like `/dev/fake-google`, so "page not found" is what a signed-out visitor sees outside dev/test
  (spec Edge Cases). It lists every person (archived and private included, fake data only), ordered by name, with the
  three values from `unsubscribeLinksFor`.

## 8. Preview deployments and a missing database

- `isPreview()` or any database error on page load → the page shows "Something went wrong. Try again in a minute."
  in the orange error box, with no button.
- `APP_URL` unset → links are built on `appBaseUrl()` (`http://localhost:3000`). The README says production must set
  `APP_URL` to the https address. It already must, for Google sign-in.

## Outside services

None new. The routes are *called by* mail apps (incoming HTTP). The new code reaches nothing over the network except
the app's own Postgres.
