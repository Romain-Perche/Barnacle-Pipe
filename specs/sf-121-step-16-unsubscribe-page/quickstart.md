# Quickstart: Unsubscribe page (SF-121)

## Prerequisites

The local Postgres must be running (README "Set up and run"). Apply the migrations first:

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate
```

## Automated checks

```bash
npm test && npm run typecheck
```

The test files are named after the parts they cover:

- `tests/unit/unsubscribe-rules.test.ts`
  - The token shape check.
  - `unsubscribeLinks` builds the page link, `<…/one-click>` and `List-Unsubscribe=One-Click`, and handles a trailing
    slash on the base.
  - `isOneClickBody`.
- `tests/integration/unsubscribe.test.ts` (real Postgres):
  - Two people get different 64-hex tokens, with no id in them.
  - Page state: `ready`, then `done` after the button (US1-1, US1-2).
  - A GET writes nothing (US1-3).
  - A changed, cut short or extended token gives `not_found` and changes nobody (US3-2).
  - Repeats leave one line, also with two `unsubscribeByToken` calls run in parallel (US3-3, FR-015).
  - A deleted person gives `not_found` (US3-4).
  - Archived and private people can unsubscribe, and the line is seen only by the creator or owner (US3-5).
  - After a re-subscribe, the old link works again and a second line is written (US4-3).
  - No `note_mentions` and no unread count change (FR-018).
  - `version` is unchanged, so a stale edit form (opened while Subscribed) saved with a changed Role succeeds, keeps
    Consent `unsubscribed` and writes `edited: ["Role"]` and no `consent_changed` (US4-4, FR-019).
- The route handlers are called directly with `Request` objects (`tests/integration/unsubscribe-routes.test.ts`):
  - The confirm POST gives `303` to the page.
  - One-click gives `200`, `400` for a missing or wrong body, `404` for an unknown or deleted token (the same body
    each time), and `405` for a GET.
  - A database failure gives `503`, or `?error=unavailable` from the confirm route.
- `tests/unit/proxy-matcher.test.ts` (extended): with no cookie, `/unsubscribe/<token>`, its `/confirm` and `/one-click`, and
  `/dev/unsubscribe-links` are not sent to `/sign-in`.
- `tests/integration/people.test.ts` (changed): a Consent edit (`consent` ≠ `consentShown`) writes `consent_changed`
  ("Consent: Unsubscribed → Subscribed by <name>"), and no longer writes `edited: ["Consent"]`. `consent` equal to
  `consentShown`, or no `consentShown`, keeps the stored Consent and writes no consent line (US4-5, FR-019). A refused
  save then a second save with the same `consentShown` keeps it too (edge case).
- `tests/unit/form-data.test.ts` (or the existing form-data test): `consentShown` is read, empty when absent.

## By hand (development)

```bash
APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev npm run db:seed && npm run dev
```

1. Open `http://localhost:3000/dev/unsubscribe-links` (no sign-in needed). Copy a subscribed person's page link.
2. In a private window, open the link. Expect: wordmark, `// EMAIL PREFERENCES`, "Unsubscribe", the lead line,
   `[ UNSUBSCRIBE ]`.
3. Press the button. Expect the blue notice "You're unsubscribed…" and no button. Reload: same.
4. Sign in with the fake login and open the person. Expect Consent "Unsubscribed" and the CHANGE line "Unsubscribed
   from campaigns through the unsubscribe link" with no name.
5. Try one-click. It should answer `200`:
   `curl -i -X POST -d 'List-Unsubscribe=One-Click' http://localhost:3000/unsubscribe/<token>/one-click`.
   Without `-d`, expect `400`. With one character changed, expect `404`.
6. Change one character of the page link. Expect the orange "This unsubscribe link isn't valid any more…".
7. As a teammate, set Consent back to Subscribed. Expect "Consent: Unsubscribed → Subscribed by <name>". Open the old
   link: `[ UNSUBSCRIBE ]` is shown again.
8. Open a subscribed person's edit form. In another window, unsubscribe them through their link. Change the Role in
   the open form and save. Expect Consent "Unsubscribed", "Edited by <name>: Role" and no consent line.
