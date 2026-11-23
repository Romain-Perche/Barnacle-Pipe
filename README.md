# Barnacle-Pipe

The Barnacle CRM: a Next.js (App Router, TypeScript) app on Postgres. The team signs in with their
barnacle.ai Google account; admins manage who has access on the Users page. Everyone keeps the team's
people and organisations (`/people`, `/organisations`) and works its deals on a board per pipeline
(`/deals`), in a list (`/deals/list`) and on each deal's page (`/deals/<id>`: Won, Lost, Reopen, restore,
linked people, labels, followers); admins keep the lead source, label and deal label lists
(`/admin/lead-sources-and-labels`) and the
pipelines and their stages (`/admin/pipelines`). Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, the team's choices in `docs/DECISIONS.md`.

You need **no Google, Vercel or Supabase account** to develop or test: a fake Google login and fake
data stand in for them.

## Prerequisites

- Node.js 24 (22.12 or newer works) and npm.
- A local PostgreSQL (any recent version) with two empty databases, for example `crm_dev` and `crm_test`:

  ```bash
  createdb crm_dev
  createdb crm_test
  ```

## Set up and run

```bash
npm install
npx playwright install chromium     # browser for the browser tests
cp .env.example .env.local          # APP_ENV=development, DATABASE_URL=…/crm_dev, FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate                  # update the database structure
npm run db:seed                     # load fake data (fake users, people, organisations, pipelines and deals)
npm run dev                         # http://localhost:3000
```

`npm run db:migrate` and `npm run db:seed` read `.env.local` when it exists. A variable set in the
shell wins over the file (`APP_ENV=production npm run db:seed` is refused even with `.env.local`).

Sign in: open http://localhost:3000, press `[ FAKE GOOGLE LOGIN ]` and pick **Ada Fake** (an admin).
The fake data team is Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users) and
Alan Fake (deactivated), all `@barnacle.ai`. On the fake login you can also type any email and name.
The fake data also has 35 fake people (`@example.com` / `@example.net`, one archived, one private person
created by Ada Fake; private Pat Privatefake, created by Ada Fake and owned by Linus Fake; private Robin and
Sam Leftfake, owned by deactivated Alan Fake, to try the hand-over), 9 fake organisations (one archived), the labels
Hot, Investor and Partner, and the pipelines Sales, Ambassadors, Fractional CTO, Exec Dinner and "Ada Fake's
pipeline" with 46 fake open deals (Sales "Closing" left empty, one archived deal, two private deals created by Ada Fake,
and two private Sales deals created and owned by Alan Fake, "Fake leaver deal" and the archived "Fake leaver old deal",
for the hand-over), plus (SF-95) the deal labels Hot, Warm, Cold, Big ticket and Renewal on nine deals, three won and
four lost Sales deals with stage histories over several days (the lost ones with fake reasons; "Old fake tender (lost)"
is also archived), other linked people on six deals and followers on six (deactivated Alan Fake follows one), and (SF-102)
seven fake notes: on "Fakeco website" (mentions Linus Fake: an unread notification), "Fakeco AI pilot" (edited by Grace
Fake), two shared people (one mentions Ada Fake: a read notification), Fakeco Ltd, the private deal "Fake secret project"
and the private person Pat Privatefake, and (SF-109) twelve fake activities (subjects start "Fake call:", "Fake meeting:" or
"Fake task:"), dated from the day the seed runs: Ada Fake's call overdue on "Fakeco website", her task and meeting due today,
later ones, a task with no link, three done ones on timelines (one sets a person's Last contacted), one on the private deal
"Fake secret project" and one on the private person Gus Lorem, a meeting Ada Fake assigned to Grace Fake (an unread
notification), her task next week on Bob Placeholder and a call Grace Fake assigned to Ada Fake (read); most open deals keep no planned activity. A fresh
database (no fake data) starts with the six lead sources Duncan's LinkedIn, Referral, Exec dinner, Inbound,
Event and Ambassador, and no labels.

| Page | Who | What |
|---|---|---|
| `/people`, `/organisations` | everyone | Lists: search, filters, sort, "Show archived", preview drawer (`?open=<id>`); all in the address |
| `/people/new`, `/people/<id>`, `/people/<id>/edit` | everyone (a private person: only their creator and their owner) | Add, view, edit, archive/restore; admins delete (events about a deleted person stay on organisations as "A deleted person …"). The // TIMELINE (SF-102) holds the person's notes and changes and those of the deals they are linked to (tag DEAL, read-only there), grouped by day, 50 at a time (`?timeline=100`, `[ SHOW MORE ]`); the note box above it adds a note, `@` mentions a teammate who can see the record; `[ EDIT ]` (`?note=<id>`) and `[ DELETE ]` (`?delete-note=<id>`, confirmed) on its own notes. No note changes on an archived record |
| `/organisations/new`, `/organisations/<id>`, `/organisations/<id>/edit` | everyone | Same for organisations, with their people (the timeline shows the organisation's own deals' entries) |
| `/admin/lead-sources-and-labels` | admins | Add, rename and remove lead sources, people labels and deal labels (a removed label stays on the people and deals that have it) |
| `/admin/users` | admins | Add, make admin, deactivate, reactivate; `[ HAND OVER ]` on a deactivated user who owns private people gives all of them to one active user (the admin sees only how many) |
| `/deals` | everyone | The board of one pipeline (`?pipeline=<id>`, first pipeline by default): a column per stage with "<n> deals · £total", drag a card to move it; the deal drawer (`?open=<id>`) shows details, "Move to", edit, archive, delete (admins) and its newest 50 timeline entries, read-only. A private deal is seen only by its creator and its owner |
| `/deals/list` | everyone | Every deal you can see across pipelines: search, Pipeline, Stage, Owner, Label, sort by any column, "<n> deals · £total" of every match, "Show closed deals" (won and lost, with a Status filter), "Show archived deals", `[ CLEAR ]`, the deal drawer (`?open=<id>`); all in the address. `[ BOARD ]` / `[ LIST ]` switch between the two views |
| `/deals/<id>`, `/people/<id>`, `/organisations/<id>`, the deal drawer | as the record | SF-109: "// NEXT ACTIVITIES" above the timeline: the record's planned activities, earliest first, with a box to mark one done (then "Schedule a follow-up?" opens with the same links, `?followup=<id>`), `[ SCHEDULE ACTIVITY ]` (pre-fills the deal, its person and organisation, or the person and their organisation), `[ EDIT ]`, `[ DELETE ]`; done ones are ACTIVITY entries on the timeline. Not on archived records. A done call or meeting sets the person's Last contacted. Board cards end with "⚠ No next activity" or "Next: 25 Nov · Call" |
| `/deals/<id>` | everyone (a private deal: its creator and owner) | The deal page: `[ WON ]`, `[ LOST ]` (asks why), `[ REOPEN ]`; the stage bar with whole days per stage (press a stage to move an open deal); edit, archive, delete (admins), `[ RESTORE ]` for an archived deal; other linked people, labels, follow/unfollow and the // TIMELINE with notes (as on people). Won and lost deals leave the board |
| `/activities` | everyone | The Activities list (SF-109): your planned calls, meetings and tasks, overdue first (red edge, "Overdue") then by due date and time, 50 per page with "// <n> ACTIVITIES"; quick filters Overdue / Today / This week (UK Monday–Sunday) / Planned / Done (`?when=`), Assignee (`?assignee=<id>` or `all`) and Type (`?type=`), all in the address; tick the box to mark one done; `[ SCHEDULE ACTIVITY ]` (`?activity=new`), `[ EDIT ]` (`?activity=<id>`) and `[ DELETE ]` (`?delete-activity=<id>`) open a box over the page. Activities linked to a record you cannot see are never shown or counted |
| `/notifications` | everyone | Your @mentions in notes, newest first, 50 at a time (`?shown=100`): "<name> mentioned you in a note on <record>", the date and the start of the note; pressing one opens the record and marks it read; `[ MARK ALL AS READ ]`. The sidebar shows "Notifications" with the unread count. In the app only, no email; a mention on a record you can no longer see is hidden. SF-109: also "<name> assigned you a <call|meeting|task>: <subject>" with "Due <date>" when someone else assigns you an activity (it goes when you are no longer the assignee); opening one goes to its deal, else person, else organisation, else the Activities list |
| `/deals/new`, `/deals/<id>/edit` | everyone (a private deal: its creator and owner) | Add a deal (`?pipeline=<id>&stage=<id>` pre-selects them), edit a deal and its deal labels (`?back=page` returns to the deal page) |
| `/admin/pipelines`, `/admin/pipelines/<id>` | admins | Add, rename, reorder (↑/↓) and delete pipelines and their stages; deleting one that holds deals moves them to a stage you choose |

## Tests

Both test commands need a local test database and `APP_ENV=test`. They refuse to run otherwise.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test             # Vitest: unit tests + integration tests against the test database (migrates it first)
npm run test:e2e     # Playwright: builds and starts the app, migrates and seeds, then runs the browser tests
npm run typecheck    # TypeScript
```

The test database is emptied and reloaded by the tests: never point `DATABASE_URL` at a database you care about.

The first `npm test` downloads the Google userinfo schema the fake Google sign-in is checked against
(`npm run test:schemas`, a pinned file from GitHub, into the git-ignored `.factory/schemas/`): it needs
network access once. The test commands ignore `.env.local`: the browser tests start the app from a
temporary folder without any `.env*` file, so it sees only the settings the tests give it.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally. Never changes the database structure. |
| `npm run build` / `npm start` | Build / start the app. The build never touches the database. |
| `npm run vercel-build` | Vercel's build: runs `db:migrate` only when `VERCEL_ENV=production`, then `next build`. |
| `npm run db:migrate` | Apply the pending `migrations/*.sql`. Prints each one applied, or "Database is up to date.". Safe to run twice, or twice at once. |
| `npm run db:seed` | Load fake data. Only when `APP_ENV` is exactly `development` or `test` and `VERCEL_ENV` is not `production`/`preview`; otherwise prints "Fake data can only be loaded when APP_ENV is development or test." and exits 1. Safe to run again. |
| `npm test` | Unit and integration tests (runs `test:schemas` first). |
| `npm run test:schemas` | Download the pinned Google schema into `.factory/schemas/` when it is missing; does nothing otherwise. |
| `npm run test:e2e` | Browser tests. |
| `npm run typecheck` | `tsc --noEmit`. |

## Settings

Environment variables. `.env.example` lists them all, with no secret values. Secrets go in `.env.local`
(git-ignored) locally and in Vercel's environment settings in production. Never commit them.

| Name | Needed | Meaning |
|---|---|---|
| `APP_ENV` | always | `development`, `test` or `production`. Only exactly `development` or `test` turns on the fake Google login and the fake data command. Anything else, or not set, turns them off. |
| `DATABASE_URL` | not on previews | Postgres URL. Local: `postgres://…@localhost:5432/crm_dev` (tests: `crm_test`). Production: Supabase's connection pooler URL. Secret. |
| `FIRST_ADMIN_EMAIL` | production | barnacle.ai address of the first admin. Their first sign-in creates them as an admin. Empty with no users: the sign-in page says the CRM isn't set up yet. |
| `GOOGLE_CLIENT_ID` | real Google sign-in | From the Internal OAuth app in the barnacle.ai Google Workspace. |
| `GOOGLE_CLIENT_SECRET` | real Google sign-in | Secret. |
| `APP_URL` | real Google sign-in | Public base URL, e.g. `http://localhost:3000`. The OAuth redirect URI is `${APP_URL}/auth/google/callback`. Also anchors the check of the return path after sign-in (`http://localhost:3000` when unset). |
| `VERCEL_ENV` | set by Vercel | `preview`: sign-in off, no database. `production`: `vercel-build` migrates. `production` or `preview`: the fake login and fake data are refused, whatever `APP_ENV` says. |

There is no session secret: session tokens are random and only their SHA-256 is stored.

## Production notes

- **Vercel production**: `vercel-build` runs `npm run db:migrate` before `next build`. A failed migration fails the deploy.
- **Migrations through Supabase's pooler**: each migration runs in its own transaction under
  `pg_advisory_xact_lock`, which Postgres releases at commit or rollback. No lock outlives the command,
  so the transaction-mode pooler is safe. The app connects with `prepare: false` for the same pooler.
- **Row Level Security**: every table has Row Level Security on with no policies, so Supabase's Data API
  cannot read or write app data. The app's own database user owns the tables and is not affected.
- **Previews** only build the app: no `DATABASE_URL`, nobody can sign in, the sign-in page says so.
- **Fake login and fake data** are never available on Vercel production or preview deployments.
- **First admin**: set `FIRST_ADMIN_EMAIL`; that person signs in once and then adds the team on the Users page.
- **Google**: create an Internal OAuth client in the barnacle.ai Workspace with the redirect URI
  `${APP_URL}/auth/google/callback`, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL`.

## Adding a feature

The skeleton has four places where a new feature plugs in:

1. **A page**: add it under `src/app/(app)/…`. It gets the sidebar layout. Call `requireUser()` (or
   `requireAdmin()`) from `src/server/auth/session.ts` at the top of the page, and `requireUser()` or
   `assertAdminForAction()` at the top of every server action.
2. **A sidebar link**: add `{ href, label }` to `mainNav` or `adminNav` in `src/app/(app)/nav.ts`.
3. **Fake data**: add a seeder to the list in `src/seed/index.ts`. It must be safe to run twice.
4. **Database tables**: add a numbered SQL file to `migrations/`. Only statements allowed inside a
   transaction, and `alter table … enable row level security` after every `create table` (a test fails otherwise).

User-facing messages live in `src/server/messages.ts`.
