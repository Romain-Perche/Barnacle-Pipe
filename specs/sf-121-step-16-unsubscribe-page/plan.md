# Implementation Plan: Unsubscribe page

**Branch**: `factory/sf-121-step-16-unsubscribe-page` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-121-step-16-unsubscribe-page/spec.md`

## Summary

A public unsubscribe page, plus RFC 8058 one-click unsubscribe, with no sign-in.

- **Links**: each person gets a random 64-hex `unsubscribe_token` (a new `persons` column with a database default, so
  every existing and future insert path gets one). There is no secret setting.
- **Page and button**: `GET /unsubscribe/<token>` is a read-only page in the sign-in page's layout (design A). Its
  `[ UNSUBSCRIBE ]` button posts to the route handler `/unsubscribe/<token>/confirm`. That handler unsubscribes and
  redirects back with a 303.
- **One-click**: mail apps POST `List-Unsubscribe=One-Click` to `/unsubscribe/<token>/one-click`.
- **Writing the change**: one conditional `update … where consent = 'subscribed' returning id` sets consent and writes
  at most one timeline line (`unsubscribed_link` / `unsubscribed_mail_app`, no actor). It is safe to repeat and safe
  when two requests arrive at once, and it never bumps `version`.
- **Teammate edits**: a teammate's Consent edit now writes a `consent_changed` line ("Consent: Unsubscribed →
  Subscribed by <name>"). The edit form sends the Consent value it was opened with (`consentShown`); a save changes
  Consent only when the field was changed on that form, so a stale form never subscribes a person again (FR-019,
  research.md §5b).
- **For campaign sending**: `unsubscribeLinksFor(personId)` returns the page link and both headers.
- **Dev page**: `/dev/unsubscribe-links` shows those values, in development and test only.
- One migration, no new dependency, no outside service.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router pages and route handlers), React 19.3, `postgres` 4.1, all already
in the repo. Nothing added (`dependencies.json` = `[]`).

**Storage**: PostgreSQL. The migration adds `persons.unsubscribe_token`, three timeline kinds and a rewritten
`timeline_events_custom_check` (data-model.md).

**Testing**: Vitest unit and integration tests on the real local Postgres. Route handlers are called directly with
`Request` objects. No browser tests (DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless functions (Node runtime); any browser; mail apps' one-click POSTs.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-001: one indexed lookup and one small transaction per click. Well under 10 s.

**Constraints**:

- A GET never writes.
- No CRM data on the page.
- No text from the address is shown.
- One line per actual change, even when two requests arrive at once.
- One-click answers directly (no redirect), over https in production.

**Scale/Scope**: a few thousand people. Unsubscribes are rare events. Adds 3 routes and 1 dev page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the blank template. The gates are the rules of `AGENTS.md` and
`docs/DECISIONS.md`.

| Rule | How this plan meets it | ✅ |
|---|---|---|
| Server components by default | The page and the dev page are server components. The button is a plain HTML form, with no client component | ✅ |
| Every signed-in page calls `requireUser()`; every server action calls `requireUser()` first | These pages are **public by design** (FR-001), listed in `src/proxy.ts` like `/sign-in`. No server action is used: the button posts to a route handler, so the server-action rule stays intact (research.md §2) | ✅ |
| User-facing text from `messages.ts`; never text from a URL | Four `messages` and three `templates` (contracts/routes.md § Messages). The only query value read is `error=unavailable`, from a closed set | ✅ |
| `isSafeNext` for redirect targets | The only redirect is to `/unsubscribe/<token>`, built from a token that already matched `^[0-9a-f]{64}$` (bad shapes redirect with the token percent-encoded as one path segment). No `next` parameter | ✅ |
| Migrations: transaction-safe statements; RLS after every `create table` | `alter table` only, no new table | ✅ |
| Every `persons` read uses `visiblePerson()` | **Justified exception** (Complexity Tracking): the token is the only authority, with no viewer. The public reads return only consent, never shown CRM data. `unsubscribeLinksFor` reads only the token. Timeline reads stay unchanged, so the line follows the person's visibility (FR-010) | ✅ |
| Fake pages and fake data only when `isFakeAllowed()` | `/dev/unsubscribe-links` calls `notFound()` otherwise | ✅ |
| No secrets in the repo; settings in `.env.example` and README | There is no new setting. The README's `APP_URL` row also mentions unsubscribe links | ✅ |
| Timeline kind check lists the kinds of parallel steps (DECISIONS, SF-115) | Lists SF-117's `pipedrive_imported` / `pipedrive_unsubscribed` too (research.md §5) | ✅ |
| Campaigns via Gmail; the CRM serves unsubscribe and one-click itself (DECISIONS 2026-11-24) | Exactly this. No mailto, no third party | ✅ |
| Each test names what it covers | Plan step 9 | ✅ |

**Post-design re-check**: it still passes. The only exception is the one in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/sf-121-step-16-unsubscribe-page/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/routes.md
├── dependencies.json      # []
├── blueprints.json        # [] (no blueprint index in this run)
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
migrations/0012_unsubscribe.sql                      # NEW (next free number at build time): data-model.md
src/proxy.ts                                         # PUBLIC += unsubscribe routes, /dev/unsubscribe-links
src/server/messages.ts                               # 4 messages, 3 templates
src/server/records/unsubscribe-rules.ts              # NEW, pure: isTokenShape, unsubscribeLinks, isOneClickBody
src/server/records/unsubscribe.ts                    # NEW: unsubscribeByToken, unsubscribePageState, unsubscribeLinksFor, listUnsubscribeLinks
src/server/records/timeline.ts                       # EventKind += unsubscribed_link | unsubscribed_mail_app | consent_changed
src/server/records/people.ts                         # Consent edit → consent_changed; keep stored consent unless changed on the form
src/server/records/rules.ts, form-data.ts            # PersonForm += consentShown
src/app/(app)/records/PersonForm.tsx                 # hidden consentShown (edit mode, from initial)
src/app/(app)/records/Timeline.tsx                   # Lines for the three kinds
src/app/unsubscribe/[token]/page.tsx                 # NEW: the page (design A)
src/app/unsubscribe/[token]/confirm/route.ts         # NEW: POST (button)
src/app/unsubscribe/[token]/one-click/route.ts       # NEW: POST (RFC 8058)
src/app/dev/unsubscribe-links/page.tsx               # NEW: dev/test only
README.md, AGENTS.md                                 # Docs (step 10)
tests/unit/unsubscribe-rules.test.ts                 # NEW
tests/unit/proxy-matcher.test.ts                     # extended
tests/integration/unsubscribe.test.ts                # NEW
tests/integration/unsubscribe-routes.test.ts         # NEW
tests/integration/people.test.ts                     # changed (Consent edit line, consentShown)
```

**Structure Decision**: this is the existing single Next.js project. The domain code goes in `src/server/records/`
beside `people.ts`, because consent and the timeline live there. The public pages go under `src/app/unsubscribe/`,
outside `(app)`, so they get no sidebar layout. The dev page goes under `src/app/dev/`.

## Build steps

1. **Migration**: write `migrations/0012_unsubscribe.sql` (number: next free on `main`) exactly as in data-model.md.
   Before writing it, re-read the kind check of the last migration on `main` and keep every kind listed there.
   `tests/support/reset.ts` needs no change (it truncates `persons`).
2. **Pure rules** (`unsubscribe-rules.ts`): `isTokenShape`, `unsubscribeLinks(base, token)`, `isOneClickBody`, as in
   contracts/routes.md.
3. **Domain** (`unsubscribe.ts`):
   - `unsubscribeByToken` (one `sql.begin`; the conditional update, then `recordEvent` with `actorId: null`; no
     `version` change; no notification);
   - `unsubscribePageState` (read-only, catches errors → `error`; `isPreview()` → `error` before any query);
   - `unsubscribeLinksFor(personId)` on `appBaseUrl()`;
   - `listUnsubscribeLinks()`.

   Add a header comment that these are the only `persons` reads without `visiblePerson()` and explain why.
4. **Timeline**: add the three kinds to `EventKind`. In `Timeline.tsx`:
   - `unsubscribed_link` → `templates.unsubscribed_link_event`;
   - `unsubscribed_mail_app` → `templates.unsubscribed_mail_app_event`;
   - `consent_changed` → `templates.consent_changed_event(e.oldValue, e.newValue)` + `by(e.actorName)`.

   `readTimeline` already selects `old_value` / `new_value`. Check that it maps them for every kind, not only for
   custom ones. The tag stays CHANGE.
5. **Person edit** (FR-019, research.md §5b, contracts/routes.md § Person edit):
   - add an optional `consentShown?: string` to `PersonForm` (`rules.ts`) and read it in `personFields` (`form-data.ts`), empty
     when absent;
   - `PersonForm.tsx`: in edit mode (`id !== undefined`), `<input type="hidden" name="consentShown"
     value={initial.consent}>`, from `initial`, never from `state.values`;
   - `people.ts` update path: `consent` = the form's value only when `consent` and `consentShown` are both set and
     differ, else `current.consent`. When the result differs from the stored value, record `consent_changed` with
     `CONSENT_LABELS` and drop `"Consent"` from `fields` before the `edited` event.

   Creating a person and the imports are unchanged. Update the existing assertion at
   `tests/integration/people.test.ts:163` (send `consentShown`).
6. **Routes**:
   - `confirm/route.ts`: `export async function POST(req, { params })` → 303 as in contracts/routes.md (use
     `new URL(path, appBaseUrl())` for `Location`).
   - `one-click/route.ts`: `POST` with the order 400 → 404 → 200 / 503, `text/plain`, `Cache-Control: no-store`.

   Both have `export const dynamic = "force-dynamic"` and never touch cookies.
7. **Page** (`src/app/unsubscribe/[token]/page.tsx`): design A per contracts/routes.md, with `className`s from
   `globals.css` (`outside`, `panel`, `label`, `lead`, `notice`, `err`, `btn primary`). Add
   `export const metadata = { robots: { index: false, follow: false } }`. No new CSS unless the design shows a
   difference.
8. **Proxy and dev page**:
   - Add `/^\/unsubscribe\/[^/]+(\/(confirm|one-click))?\/?$/` and `/^\/dev\/unsubscribe-links\/?$/` to `PUBLIC` in
     `src/proxy.ts`.
   - Write `src/app/dev/unsubscribe-links/page.tsx` (`notFound()` unless `isFakeAllowed()`).
9. **Tests**: as listed in quickstart.md. Each test names what it covers (`// covers FR-005, US1 scenario 2`). For
   the parallel test, run two `unsubscribeByToken` calls with `Promise.all` and expect one line. For the database
   failure test, point the domain call at an unreachable database, or stub `sql.begin` to throw, the way existing
   tests simulate it.
10. **Docs**:
    - README: in the `APP_URL` row, add "also the base of unsubscribe links (https in production)". Add a short
      "Unsubscribe" section: the routes, the dev page, and `unsubscribeLinksFor` for campaign sending.
    - AGENTS.md Layout: add `records/unsubscribe.ts` / `unsubscribe-rules.ts` and `src/app/unsubscribe/`.
    - `docs/DECISIONS.md`: add a line at the end, "Unsubscribe links are a random token per person stored in the
      CRM, with no expiry; no teammate is told when someone unsubscribes; a teammate's Consent change is shown as
      'Consent: <old> → <new>'; the edit form changes Consent only when the field was changed on that form (SF-121)".

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in
  github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file
  for Supavisor's own management API). This change only adds a column and timeline kinds to the app's own database,
  and tests use a real local Postgres rather than a fake.

No other outside service. Mail apps (Gmail, Apple Mail, Outlook) *call* the one-click address. The new code reaches
nothing over the network, and the RFC 8058 request format is fixed by the RFC.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `persons` read and updated without `visiblePerson()` (unsubscribe routes, `unsubscribeLinksFor`, dev page) | There is no viewer: the unguessable token is the authority (FR-001, FR-002). Archived and private people must be unsubscribable (FR-010) | Applying `visiblePerson()` needs a user, and the page has none by design |
