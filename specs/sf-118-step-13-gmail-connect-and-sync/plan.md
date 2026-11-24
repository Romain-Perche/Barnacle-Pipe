# Implementation Plan: Gmail: connect and sync

**Branch**: `factory/sf-118-step-13-gmail-connect-and-sync` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-118-step-13-gmail-connect-and-sync/spec.md`

## Summary

Each user connects their own barnacle.ai Gmail from a new Settings page (design B: a "Settings" sidebar link for
everyone, a Gmail card, and an orange "!" on the link while Gmail needs reconnecting).

- **Connect**: a separate OAuth code flow on the existing Internal Google app asks for `gmail.readonly`, `gmail.send`
  and `gmail.labels` with offline access. It is checked against the cookie of the request the same user started. It is
  refused when a scope is missing or the account is not the user's sign-in address.
- **Key**: the refresh token is stored AES-256-GCM-encrypted (`GMAIL_TOKEN_KEY`). Access tokens are never stored.
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
- One migration (`0012_gmail.sql`). No new dependency.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, route handlers, server actions), React 19.3, `postgres` 4.1;
`node:crypto` (AES-256-GCM, RS256 JWT check, PKCE). All Google calls go through plain `fetch` (research.md §1).
Nothing added (`dependencies.json` = `[]`).

**Storage**: PostgreSQL. Migration `0012_gmail.sql` adds `gmail_connections`, `email_threads`, `email_messages` and
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

**Scale/Scope**: ≤ 10 users and mailboxes of a few thousand conversations each. 1 new page (`/settings`), 1 callback
route, 2 machine routes (`/gmail/push`, `/cron/gmail`), 2 dev-only fake pages, and the sidebar changed on every page.

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
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0012`: 4 `create table`, each followed by `enable row level security`, plus indexes | ✅ |
| Every outside service is reached through settings and has a fake (kickoff) | `GMAIL_*` and `CRON_SECRET` settings. `FakeGoogleMail` for dev and tests, checked against the pinned schemas | ✅ |
| Secrets out of the repo. A saved token is encrypted and never shown (kickoff, Pipedrive rule) | AES-256-GCM with the key in settings only. The cipher is never selected for pages | ✅ |
| Fake login and fake data only when `isFakeAllowed()`, clearly fake names | The fake pages and the seeder are gated, with "…-fake" names and fake people | ✅ |
| Private contact hides its emails (kickoff, DECISIONS 2026-11-24) | Nothing copied is shown in this issue, only the user's own counts. Private people's mail is copied, as the spec says | ✅ |
| Gmail sync copies only conversations with CRM people. Push plus a renewal and a 15-minute check. Past email is a button (DECISIONS 2026-11-24) | research.md §7-§8. Nothing before `connected_at` | ✅ |
| No long-running server (SF-80) | Vercel cron and push only. Leases instead of workers | ✅ |
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
migrations/0012_gmail.sql                          # data-model.md § Migration
scripts/fetch-schemas.mjs                          # + gmail-api.json, pubsub-api.json (pinned, sha256)
vercel.json                                        # new: the /cron/gmail schedule
src/proxy.ts                                       # PUBLIC: /gmail/push, /cron/gmail, the two fake pages
src/server/
├── env.ts                                         # gmailConfig()
├── messages.ts                                    # contracts/routes.md § Messages
├── users.ts                                       # deactivate → forgetGmailInTx
└── gmail/
    ├── rules.ts                                   # pure: scopes, addresses, headers, readMessage, decideCopy, buildMime
    ├── crypto.ts                                  # sealToken / openToken
    ├── google-api.ts                              # the fetch calls, errors, useGmailFetchForTests
    ├── push.ts                                    # verifyPushToken, receiveGmailPush
    ├── connections.ts                             # settings read, connect/reconnect, disconnect, needs_reconnect
    ├── sync.ts                                    # syncConnection, runGmailCheck
    ├── send.ts                                    # sendGmail
    └── fake-gmail.ts                              # FakeGoogleMail, MemoryStore / DiskStore
src/app/
├── (app)/nav.ts, (app)/layout.tsx, (app)/SidebarLink.tsx, (app)/UnreadLink.tsx, (app)/notifications/actions.ts
├── (app)/settings/page.tsx                        # design B card, notices, disconnect confirmation
├── (app)/settings/GmailCard.tsx, (app)/settings/actions.ts
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

1. **Schema download**: in `scripts/fetch-schemas.mjs`, add the two entries of contracts/google.md § Schemas (URL at
   commit `3f740bc15212818d4d0eb041b02c951457ff63fa`, sha256). Update the head comment and the README command line
   ("Google, Gmail, Pub/Sub and Supabase Storage schemas"), and any fetch-schemas test that lists files.
2. **Migration**: write `migrations/0012_gmail.sql` exactly as in data-model.md. Add the four tables to
   `tests/support/reset.ts` (and `.factory/run/reset-db.sh` if it lists tables). Extend `migrate.test.ts` (quickstart.md).
3. **Settings**:
   - `gmailConfig()` in `env.ts` (research.md §12);
   - `.env.example`: add `GMAIL_PUBSUB_TOPIC=`, `GMAIL_TOKEN_KEY=`, `GMAIL_PUSH_SERVICE_ACCOUNT=`,
     `GMAIL_PUSH_AUDIENCE=`, `GMAIL_PUSH_SUBSCRIPTION=` and `CRON_SECRET=` empty, with comments;
   - README § Settings: add the rows of contracts/google.md, and a "Gmail" section with the Google Cloud setup and the
     fake;
   - add `.fake-gmail/` to `.gitignore`.
4. **Pure code**:
   - `src/server/gmail/rules.ts` and `crypto.ts` (research.md §4, §5, §9, §10; contracts/routes.md § Domain functions);
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
   - `nav.ts`: add `{ href: "/settings", label: "Settings" }` last in `mainNav`, with a `// SF-118` comment;
   - `/settings` page, `GmailCard.tsx` and `actions.ts` (contracts/routes.md), following `design-options.html` option B:
     card heading with `.dot` / `.dot.bad` and the buttons on the right, a body of label/value lines, and the
     confirmation box reusing the existing delete-confirm look;
   - notices through `setFlash` for success, `?gmail=` for errors;
   - sidebar: `SidebarLink` `warn` prop (`<span className="warn">!</span>`, orange `var(--orange)`, with
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
    - `AGENTS.md` § Layout: `src/server/gmail/` (only `loadKey` reads `token_cipher`; no Google call inside
      `sql.begin()`), the settings pages, the machine routes, `tests/fakes/gmail.ts`, and the seeder;
    - at the end of `docs/DECISIONS.md`, one line per choice of spec.md § Clarifications, after the person confirms the
      factory ones at plan review:
      - "Gmail settings use design B: a Settings link for everyone, a Gmail card, an orange "!" on the link while
        Gmail needs reconnecting (SF-118)";
      - "Emails copied from a user's Gmail are kept when they disconnect or are deactivated (SF-118)";
      - "The 15-minute Gmail check and the daily renewal run as Vercel cron jobs on the Pro plan (SF-118)";
      - the factory choices as confirmed.
    - `.factory/test-env.md` is written by Build and the AI review, not here.
    - No blueprint exception, so no "Departs from blueprint" line.

## Outside services

- Gmail API (users.getProfile, watch, stop, history.list, messages.list/get/send, threads.get): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Google Cloud Pub/Sub (push delivery of Gmail notices to `/gmail/push`, `PubsubMessage`): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/pubsub/v1/pubsub-api.json
- Google OAuth 2.0 token and revoke endpoints and Google's signing keys (oauth2.googleapis.com/token, /revoke, www.googleapis.com/oauth2/v3/certs): no public schema found on GitHub (looked in github.com/googleapis/google-api-go-client oauth2/v1 and oauth2/v2, whose `oauth2-api.json` only describes userinfo and tokeninfo; the fake follows RFC 6749, RFC 7009 and RFC 7517 instead)
- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; this change only adds tables to the app's own database, and tests use a real local Postgres rather than a fake)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
