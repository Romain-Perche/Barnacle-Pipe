# Implementation Plan: Gmail: connect and sync

**Branch**: `factory/sf-118-step-13-gmail-connect-and-sync` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-118-step-13-gmail-connect-and-sync/spec.md`

## Summary

Each user connects their own barnacle.ai Gmail from the Settings page SF-117 added (merged from `origin/main` first):
Gmail is a second card after the Pipedrive section (design B), and an orange "!" goes on SF-117's one "Settings" link at
the bottom of the sidebar while Gmail needs reconnecting. No second Settings page or link (plan review 2026-11-24).

- **Connect**: a separate OAuth code flow on the existing Internal Google app asks for `gmail.modify` and `gmail.send`
  with offline access (plan review 2026-11-24: the later Inbox needs `gmail.modify`, so nobody reconnects). It is checked against the cookie of the request the same user started. It is
  refused when a scope is missing or the account is not the user's sign-in address.
- **Key**: the refresh token is stored AES-256-GCM-encrypted through one seal/open module shared with Pipedrive
  (`src/server/crypto/seal.ts`, moved from `pipedrive/crypto.ts`, same format, a purpose in the additional data), with
  its own `GMAIL_TOKEN_KEY`. Access tokens are never stored.
- **Sync**:
  - Gmail `watch` sends notices to a Pub/Sub topic, and the push subscription POSTs to `/gmail/push` with a
    Google-signed OIDC token, checked with node:crypto against Google's keys;
  - one Vercel cron route, `/cron/gmail` every 15 minutes (`CRON_SECRET`), runs the catch-up check and renews each watch
    once a day;
  - both go through `syncConnection`: Gmail history since the stored `historyId` (full listing since the last sync
    when the history is gone), then the pure rules decide, then storage. Only messages after `connected_at`, not
    drafts, spam or trash, with a CRM person's address or in a thread already copied, are stored, at most once per
    account (unique index): headers, text, HTML, and attachment names, types and sizes, never their contents.
- **Send**: `sendGmail` sends RFC 5322 mail through `messages.send`, in a thread when asked. The test email uses it.
- **Disconnect and deactivation** forget the key (`users.stop` and revoke after commit) and keep what was copied. A key
  Google refuses marks the connection `needs_reconnect`.
- **Fakes**: one fake Google Mail (consent screen, token, revoke, certs, Gmail, push) serves local runs and tests,
  checked against the pinned Gmail and Pub/Sub discovery files. A fake mailbox page lets testers put in mail and run
  the check.
- One migration (`0013_gmail.sql`, after SF-117's `0012_pipedrive.sql`). No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, route handlers, server actions), React 19.3, `postgres` 4.1;
`node:crypto` (AES-256-GCM through the shared seal module, RS256 JWT check, PKCE). All Google calls go through plain `fetch` (research.md §1).
Nothing added (`dependencies.json` = `[]`).

**Storage**: PostgreSQL. Migration `0013_gmail.sql` adds `gmail_connections`, `email_threads`, `email_messages` and
`email_attachments` (data-model.md). The fake Gmail's state is kept in memory in tests and in `.fake-gmail/state.json`
in development.

**Testing**: Vitest unit and integration on the real local Postgres. `tests/fakes/gmail.ts` is checked against
`gmail-api.json` and `pubsub-api.json` (pinned). No browser tests (DECISIONS 2026-11-23).

**Target Platform**: Vercel serverless functions (Node runtime) on the Pro plan (cron every 15 minutes, functions up
to 300 s), and desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**:
- SC-002: within 2 minutes with push (one sync per notice, ≤ 60 s function) and within 15 minutes through the cron.
- Per run, at most 300 `messages.get`; the rest is carried to the next run without loss.
- Settings reads 1 row plus 1 count.

**Constraints**:
- No secret on any page, in a log or in a message (SC-004). Only `loadKey` reads the cipher.
- Pooler rules: no session state; every change is one `sql.begin()` with no network call inside. Overlapping syncs
  are kept apart by a lease column, not a lock.
- Every message comes from `messages.ts`. Google's text is never shown.
- Pub/Sub retries anything that is not 2xx, so the push route answers `204` except for bad proof (403) or a bad
  body (400).

**Scale/Scope**: ≤ 10 users and mailboxes of a few thousand conversations each. No new page: a card on SF-117's `/settings`, 1 callback
route, 2 machine routes (`/gmail/push`, `/cron/gmail`), 2 dev-only fake pages, and the "!" on the existing Settings link of every page.

No NEEDS CLARIFICATION is left. The factory's choices are in spec.md § Clarifications ("to confirm").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no gate can fail. The binding rules are
`docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | The Settings page, card and confirmation are server-rendered. The only client part is the sidebar refresh, the existing SF-108 `UnreadLink`, generalised to carry the "!" | ✅ |
| Every page `requireUser()`, every action `requireUser()` first | `/settings`, the callback and the 3 actions do. The machine routes need `CRON_SECRET` or Google's proof (FR-015). The fake pages give 404 outside dev/test | ✅ |
| Messages from `messages.ts`, never text from the URL, redirects through `isSafeNext` | contracts/routes.md § Messages. `?gmail=` is a code in a fixed list. Redirects go to the fixed `/settings` | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0013`: 4 `create table`, each followed by `enable row level security`, plus indexes | ✅ |
| Every outside service is reached through settings and has a fake (kickoff) | `GMAIL_*` and `CRON_SECRET` settings. `FakeGoogleMail` for dev and tests, checked against the pinned schemas | ✅ |
| Secrets out of the repo. A saved token is encrypted and never shown (kickoff, Pipedrive rule) | AES-256-GCM in the one shared seal module, with `GMAIL_TOKEN_KEY` (separate from `PIPEDRIVE_TOKEN_KEY`) in settings only. The cipher is never selected for pages | ✅ |
| Fake login and fake data only when `isFakeAllowed()`, clearly fake names | The fake pages and the seeder are gated, with "…-fake" names and fake people | ✅ |
| Private contact hides its emails (kickoff, DECISIONS 2026-11-24) | Nothing copied is shown in this issue, only the user's own counts. Private people's mail is copied, as the spec says | ✅ |
| Gmail sync copies only conversations with CRM people. Push plus a renewal and a 15-minute check. Past email is a button (DECISIONS 2026-11-24) | research.md §7-§8. Nothing before `connected_at` | ✅ |
| No long-running server (SF-80) | Vercel cron and push only. Leases instead of workers | ✅ |
| Build on SF-117, no second Settings page or link (plan review) | Gmail card added to `settings/page.tsx`; the "!" on `footerNav`'s link; Pipedrive's crypto moved, not copied | ✅ |
| One way to call Google (repo pattern) | `src/server/gmail/` beside `auth/google.ts`, which is unchanged | ✅ |

**Post-design re-check**: still passes. No violations, and Complexity Tracking is empty. A blueprint check is not
possible: there is no blueprint index in this run (`$WS/blueprints/INDEX.md` is missing), so `blueprints.json` stays
`[]` and there is no "Departs from blueprint" line.

## Project Structure

### Documentation (this feature)

```text
specs/sf-118-step-13-gmail-connect-and-sync/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, state changes, copy rules, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── routes.md        # pages, routes, actions, domain functions, messages
│   └── google.md        # Google calls, settings, Google Cloud setup, the fake and its checks
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/0013_gmail.sql                          # data-model.md § Migration (0012 is SF-117's)
scripts/fetch-schemas.mjs                          # + gmail-api.json, pubsub-api.json (pinned, sha256)
vercel.json                                        # new: the /cron/gmail schedule
src/proxy.ts                                       # PUBLIC: /gmail/push, /cron/gmail, the two fake pages
src/server/
├── env.ts                                         # gmailConfig(), readTokenKey() shared with pipedriveConfig()
├── crypto/seal.ts                                 # shared sealToken / openToken (moved from pipedrive/crypto.ts)
├── pipedrive/connection.ts                        # imports the shared seal module, purpose "pipedrive-token"
├── messages.ts                                    # contracts/routes.md § Messages
├── users.ts                                       # deactivate → forgetGmailInTx (beside SF-117's deleteConnection)
└── gmail/
    ├── rules.ts                                   # pure: scopes, addresses, headers, readMessage, decideCopy, buildMime
    ├── google-api.ts                              # the fetch calls, errors, useGmailFetchForTests
    ├── push.ts                                    # verifyPushToken, receiveGmailPush
    ├── connections.ts                             # settings read, connect/reconnect, disconnect, needs_reconnect
    ├── sync.ts                                    # syncConnection, runGmailCheck
    ├── send.ts                                    # sendGmail
    └── fake-gmail.ts                              # FakeGoogleMail, MemoryStore / DiskStore
src/app/
├── (app)/layout.tsx, (app)/SidebarLink.tsx, (app)/UnreadLink.tsx, (app)/notifications/actions.ts   # "!" on footerNav's Settings link
├── (app)/settings/page.tsx                        # SF-117's page: + the Gmail card after PipedriveSection
├── (app)/settings/GmailCard.tsx (new), (app)/settings/actions.ts (SF-117's: + 3 Gmail actions)
├── (app)/settings/gmail/callback/route.ts
├── (app)/admin/users/actions.ts                   # afterGmailForgotten after deactivate
├── gmail/push/route.ts, cron/gmail/route.ts
├── dev/fake-google/gmail/page.tsx + actions.ts    # fake consent screen
├── dev/fake-gmail/page.tsx + actions.ts           # fake mailbox page
└── globals.css                                    # .dot, .dot.bad, .warn on the sidebar link, settings card
src/seed/gmail.ts, src/seed/index.ts
tests/fakes/gmail.ts, tests/support/reset.ts, tests/unit/…, tests/integration/…   # quickstart.md
.env.example, README.md, AGENTS.md, docs/DECISIONS.md, .gitignore (.fake-gmail/)
```

**Structure Decision**: the same single Next.js project. Gmail code gets its own `src/server/gmail/` folder because it
has its own outside service, like `src/server/files/`. Copied emails are not records yet, so they are not under
`records/`. Later issues add visibility (`visibleEmail…`) in `records/visibility.ts` when emails are shown.

## Build steps (in order)

0. **Merge `origin/main`** (SF-117: `/settings`, `footerNav`, `pipedrive/crypto.ts`, `0012_pipedrive.sql`) into the
   branch before anything else, and build on it.
1. **Schema download**: in `scripts/fetch-schemas.mjs`, add the two entries of contracts/google.md § Schemas (URL at
   commit `3f740bc15212818d4d0eb041b02c951457ff63fa`, sha256). Update the head comment and the README command line
   ("Google, Gmail, Pub/Sub and Supabase Storage schemas"), and any fetch-schemas test that lists files.
2. **Migration**: write `migrations/0013_gmail.sql` exactly as in data-model.md. Add the four tables to
   `tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists tables). Extend `migrate.test.ts` (quickstart.md).
3. **Settings**:
   - `gmailConfig()` in `env.ts` (research.md §12);
   - `readTokenKey(raw)` in `env.ts`, used by `pipedriveConfig()` (same behaviour) and `gmailConfig()`;
   - `.env.example`: add, after the Pipedrive block, `GMAIL_PUBSUB_TOPIC=`, `GMAIL_TOKEN_KEY=` (its own key, never
     `PIPEDRIVE_TOKEN_KEY`'s value), `GMAIL_PUSH_SERVICE_ACCOUNT=`,
     `GMAIL_PUSH_AUDIENCE=`, `GMAIL_PUSH_SUBSCRIPTION=` and `CRON_SECRET=` empty, with comments;
   - README § Settings: add the rows of contracts/google.md, and a "Gmail" section with the Google Cloud setup and the
     fake;
   - add `.fake-gmail/` to `.gitignore`.
4. **Pure code**:
   - `src/server/gmail/rules.ts` (research.md §5, §9, §10; contracts/routes.md § Domain functions), with
     `GMAIL_SCOPES` = `gmail.modify` + `gmail.send`;
   - move `src/server/pipedrive/crypto.ts` to `src/server/crypto/seal.ts` with a `purpose` argument (research.md §4);
     point `pipedrive/connection.ts` (purpose `"pipedrive-token"`) and `tests/unit/pipedrive-crypto.test.ts` at it,
     rename that test `seal.test.ts`, and add a fixed SF-117-sealed sample that must still open;
   - the messages and templates in `messages.ts`.
5. **Google calls and the fake**: `google-api.ts` as in contracts/google.md § Calls, with the `testFetch` / fake-mode
   switch copied from `files/storage.ts`. Then:
   - `fake-gmail.ts` (§ Fake);
   - `tests/fakes/gmail.ts` with the schema checks;
   - `push.ts` (research.md §6) with the JWKS cache.
6. **Domain**:
   - `connections.ts` (data-model.md § State changes): only `loadKey` selects `token_cipher`; every Google call is
     outside `sql.begin()`;
   - `sync.ts` (research.md §8, data-model.md § Copy rules);
   - `send.ts` (research.md §10);
   - `users.deactivate` calls `forgetGmailInTx` in its transaction and returns the cipher; the admin action calls
     `afterGmailForgotten` after commit.
7. **Routes**:
   - `/settings/gmail/callback` (research.md §3);
   - `/gmail/push` (`maxDuration = 60`);
   - `/cron/gmail` (`maxDuration = 300`, constant-time `CRON_SECRET` check with `crypto.timingSafeEqual` on the SHA-256
     of both values);
   - `vercel.json`;
   - the four `PUBLIC` patterns in `src/proxy.ts` (and the proxy-matcher test).
8. **UI**:
   - `nav.ts` unchanged: SF-117's `footerNav` Settings link is the one that gets the "!";
   - SF-117's `/settings` page renders `<GmailCard>` after `<PipedriveSection>`; `GmailCard.tsx` is new and the three
     Gmail actions go into SF-117's `actions.ts` (contracts/routes.md), following `design-options.html` option B:
     card heading with `.dot` / `.dot.bad` and the buttons on the right, a body of label/value lines, and the
     confirmation box reusing the existing delete-confirm look;
   - notices through `setFlash` for success, `?gmail=` for errors;
   - sidebar: `SidebarLink` `warn` prop, given to the footer Settings link in `layout.tsx` (`<span className="warn">!</span>`, orange `var(--orange)`, with
     `aria-label` from `messages.gmail_settings_warn`);
   - `currentUnread` becomes `currentSidebar()` → `{ unread, gmailWarn }`, and `UnreadLink` is generalised (a
     `SidebarState` client part renders the Notifications and Settings links) so both refresh after client
     navigation. The layout passes the start values.
9. **Fake pages**: `/dev/fake-google/gmail` (consent) and `/dev/fake-gmail` (mailbox, deliver or drop a notice, run the
   check, refuse the key, fail renewals, forget history, list messages, key and watch status), as in research.md §14.
   Both give 404 unless `isFakeAllowed()` and the mode is `fake`.
10. **Fake data**: `src/seed/gmail.ts` (data-model.md § Fake data), registered in `src/seed/index.ts` after `people` and
    `deals`.
11. **Docs**:
    - `AGENTS.md` § Layout: `src/server/crypto/seal.ts` (shared token sealing), `src/server/gmail/` (only `loadKey` reads `token_cipher`; no Google call inside
      `sql.begin()`), the settings pages, the machine routes, `tests/fakes/gmail.ts`, and the seeder;
    - at the end of `docs/DECISIONS.md`, one line per choice of spec.md § Clarifications, after the person confirms the
      factory ones at plan review:
      - "Gmail settings use design B: a Gmail card on the Settings page after Pipedrive, an orange "!" on the one
        Settings link while Gmail needs reconnecting (SF-118)";
      - "Gmail asks for gmail.modify and gmail.send, so the later Inbox can mark mail read and change labels without a
        reconnect (SF-118)";
      - "Saved tokens of outside services are sealed by one shared AES-256-GCM module, each service with its own key
        (PIPEDRIVE_TOKEN_KEY, GMAIL_TOKEN_KEY) (SF-118)";
      - "Emails copied from a user's Gmail are kept when they disconnect or are deactivated (SF-118)";
      - "The 15-minute Gmail check and the daily renewal run as Vercel cron jobs on the Pro plan (SF-118)";
      - the four factory choices confirmed at plan review (no gap copy after a reconnect; Gmail's own time decides;
        deactivation cancels the key at Google; one 15-minute job that also renews daily).
    - `.factory/test-env.md` is written by Build and the AI review, not here.
    - No blueprint exception, so no "Departs from blueprint" line.

## Fix round 1

**Problem (AI review, US1 scenarios 2, 4, 5, US4 scenario 3, Edge case 10):** on the fake consent screen
`/dev/fake-google/gmail`, `[ ALLOW ]` always ends on Settings with "Gmail was not connected.", whatever the account
and the ticked boxes. Locally (FR-018) no one can connect Gmail through the screen. Real Google is not affected: it
sends the browser to the callback with a full navigation.

**Cause:** `[ ALLOW ]` and `[ CANCEL ]` are server actions (`src/app/dev/fake-google/gmail/actions.ts`) that call
`redirect()` to the app's own `/settings/gmail/callback`. For a same-app address, Next does not send the browser
there: it renders the target inside the action's own request, whose path is `/dev/fake-google/gmail`. The browser
sends the `crm_gmail_oauth` cookie (path `/settings/gmail`, set by `startGmailConnect`) only to `/settings/gmail/*`,
so the callback finds no cookie and `connectFromCallback` answers `not_connected`. The integration test called the
action and then the callback by hand with the cookie jar, so it never went through the browser's cookie path rule.

**Fix (option A, recommended):** the two consent buttons post a plain HTML form to a route handler
`src/app/dev/fake-google/gmail/answer/route.ts` (`POST`). It runs the same checks as today (404 unless
`isFakeAllowed()` and Gmail mode `fake`; 404 unless `redirect_uri` is exactly `${appBaseUrl()}/settings/gmail/callback`),
reads the button pressed (`decision=allow` or `decision=cancel`), makes the fake code (allow) or sets
`error=access_denied` (cancel), adds `state`, and answers **303** with `Location:` the callback address. The browser
then loads the callback as a full navigation, exactly as after real Google, and sends the cookie. The page keeps its
look and its fields; only the forms change (`action="/dev/fake-google/gmail/answer" method="post"`, one form with
two submit buttons `name="decision"`, or two forms each with a hidden `decision`). `actions.ts` is deleted. No change
to the cookie, to the callback or to the real Google flow.

Options not chosen:
- B: set the `crm_gmail_oauth` cookie on path `/`. It would work, but widens the cookie of the real flow to every
  page only to suit a development screen.
- C: make the callback accept a missing cookie in fake mode. It removes the check that the return belongs to the
  request the same user started (FR-002) from the very flow the tests run.

**Files:** `src/app/dev/fake-google/gmail/answer/route.ts` (new), `src/app/dev/fake-google/gmail/page.tsx`,
`src/app/dev/fake-google/gmail/actions.ts` (deleted), `tests/integration/gmail-dev-fake.test.ts`, `AGENTS.md` (the
fake consent screen line, if it names the actions).

**Test (first):** in `tests/integration/gmail-dev-fake.test.ts`, the tester's run goes through what the browser
does: the rendered consent page's forms post to `/dev/fake-google/gmail/answer` with `method="post"` (no server
action); a `POST` of the form to the route answers 303 whose `Location` is the callback with `code` and `state`
(allow) or `error=access_denied` and `state` (cancel); the callback, given only the cookies a browser sends to that
`Location` path (the `crm_gmail_oauth` cookie included because the path is `/settings/gmail/callback`), connects
Linus. Also: 404 from the route outside fake mode and for another `redirect_uri`; an unticked box and another
account reach the callback and give `missing_scopes` / `wrong_account`. It fails now (no route, the forms use a
server action) and passes after the fix. No new spec scenario: US1 scenarios 2-5, US4 scenario 3 and Edge case 10
already cover it and the AI review runs them by clicking `[ ALLOW ]`.

**Not changed (review note, not blocking):** when Gmail's history is gone, the catch-up lists from one hour before
the last successful sync (`CATCH_UP_MARGIN_MS`), so a message skipped in that hour because its sender was not yet a
CRM person can be copied then. The margin protects against losing mail Gmail dated just before the last sync but
had not yet reported; losing mail is worse than copying one extra conversation that the later "Fetch past emails"
would copy anyway. It only happens on the rare history-gone path. Kept as is.

## Outside services

- Gmail API, scopes `gmail.modify` and `gmail.send` (users.getProfile, watch, stop, history.list, messages.list/get/send, threads.get): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Google Cloud Pub/Sub (push delivery of Gmail notices to `/gmail/push`, `PubsubMessage`): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/pubsub/v1/pubsub-api.json
- Google OAuth 2.0 token and revoke endpoints and Google's signing keys (oauth2.googleapis.com/token, /revoke, www.googleapis.com/oauth2/v3/certs): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, RFC 7009 and RFC 7517 instead)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; this change only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
