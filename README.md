# Barnacle-Pipe

The Barnacle CRM: a Next.js (App Router, TypeScript) app on Postgres. The team signs in with their
barnacle.ai Google account; admins manage who has access on the Users page. Everyone keeps the team's
people and organisations (`/people`, `/organisations`) and works its deals on a board per pipeline
(`/deals`), in a list (`/deals/list`) and on each deal's page (`/deals/<id>`: Won, Lost, Reopen, restore,
linked people, labels, followers); admins keep the lead source, label and deal label lists
(`/admin/lead-sources-and-labels`) and the
pipelines and their stages (`/admin/pipelines`). People and organisations can be imported from a CSV file
(`[ IMPORT CSV ]` on each list, see [CSV import](#csv-import)). Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, the team's choices in `docs/DECISIONS.md`.

You need **no Google, Vercel or Supabase account** to develop or test: a fake Google login, a fake file storage
and fake data stand in for them.

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
cp .env.example .env.local          # APP_ENV=development, DATABASE_URL=…/crm_dev, FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate                  # update the database structure
npm run db:seed                     # load fake data (fake users, people, organisations, pipelines, deals, notes and ambassadors)
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
| `/ambassadors` | everyone | Every ambassador you can see (people with the "Ambassador" tick on their form), A–Z: organisation, people and deals they referred, open and won totals (£), latest referral; archived ones marked "Archived". "Referred by" is set on the person and deal forms (only active ambassadors you can see are offered; the add deal form fills it from the main person) and filters the People list and the deal list (`?ref=<id>`) |
| `/ambassadors/<id>` | everyone (a private ambassador: their creator and owner) | The ambassador page: `[ PERSON PAGE ]`, contact details, a summary strip (people referred, deals referred, Open £, Won £, Lost), the people and deals they referred (50 at a time, `?people=` / `?deals=`) and the latest updates on them and what they referred (20 at a time, `?updates=`). Private records are never listed or counted for anyone they are hidden from |
| `/notifications` | everyone | Your @mentions in notes, newest first, 50 at a time (`?shown=100`): "<name> mentioned you in a note on <record>", the date and the start of the note; pressing one opens the record and marks it read; `[ MARK ALL AS READ ]`. The sidebar shows "Notifications" with the unread count, up to date on every page you open (links, forms, back and forward). In the app only, no email; a mention on a record you can no longer see is hidden. SF-109: also "<name> assigned you a <call|meeting|task>: <subject>" with "Due <date>" when someone else assigns you an activity (it goes when you are no longer the assignee); opening one goes to its deal, else person, else organisation, else the Activities list |
| `/deals/new`, `/deals/<id>/edit` | everyone (a private deal: its creator and owner) | Add a deal (`?pipeline=<id>&stage=<id>` pre-selects them), edit a deal and its deal labels (`?back=page` returns to the deal page) |
| `/admin/pipelines`, `/admin/pipelines/<id>` | admins | Add, rename, reorder (↑/↓) and delete pipelines and their stages; deleting one that holds deals moves them to a stage you choose |

## Tests

The tests need a local test database and `APP_ENV=test`. They refuse to run otherwise.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test             # Vitest: unit tests + integration tests against the test database (migrates it first)
npm run typecheck    # TypeScript
```

The test database is emptied and reloaded by the tests: never point `DATABASE_URL` at a database you care about.

The first `npm test` downloads the Google userinfo schema the fake Google sign-in is checked against, and Supabase
Storage's OpenAPI file the fake file storage is checked against (`npm run test:schemas`, pinned files from GitHub,
into the git-ignored `.factory/schemas/`): it needs network access once.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally. Never changes the database structure. |
| `npm run build` / `npm start` | Build / start the app. The build never touches the database. |
| `npm run vercel-build` | Vercel's build: runs `db:migrate` only when `VERCEL_ENV=production`, then `next build`. |
| `npm run db:migrate` | Apply the pending `migrations/*.sql`. Prints each one applied, or "Database is up to date.". Safe to run twice, or twice at once. |
| `npm run db:seed` | Load fake data. Only when `APP_ENV` is exactly `development` or `test` and `VERCEL_ENV` is not `production`/`preview`; otherwise prints "Fake data can only be loaded when APP_ENV is development or test." and exits 1. Safe to run again. |
| `npm test` | Unit and integration tests (runs `test:schemas` first). |
| `npm run test:schemas` | Download the pinned Google and Supabase Storage schemas into `.factory/schemas/` when missing; does nothing otherwise. |
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
| `SUPABASE_URL` | production (files) | `https://<project>.supabase.co`. Empty with `APP_ENV` `development`/`test`: the fake file storage is used. Empty otherwise: every file action answers "Files can't be reached right now. Try again in a minute."; the rest of the app works. |
| `SUPABASE_SECRET_KEY` | with `SUPABASE_URL` | Supabase secret key (or the legacy `service_role` key). Secret, server only, never sent to the browser. |
| `FILES_BUCKET` | optional | The private Storage bucket of file contents. Default `crm-files`. |
| `VERCEL_ENV` | set by Vercel | `preview`: sign-in off, no database. `production`: `vercel-build` migrates. `production` or `preview`: the fake login and fake data are refused, whatever `APP_ENV` says. |

There is no session secret: session tokens are random and only their SHA-256 is stored.

## CSV import

`[ IMPORT CSV ]` on the People and Organisations lists opens a four-step import (`/people/import`,
`/organisations/import`): file, columns, preview, report. Any signed-in user can import.

- **The file**: UTF-8 (with or without a byte order mark), headings on the first row, values separated by commas,
  semicolons or tabs (found from the first line), double-quoted values as usual in CSV. At most 5 MB and 5,000 rows.
  Excel files and other encodings are refused with a message. `[ DOWNLOAD EXAMPLE FILE ]` gives every recognised
  heading and two fake rows (`/people/import/example`, `/organisations/import/example`).
- **What is imported**: each row is checked with the person or organisation form's own rules; rows whose email
  address (people) or name (organisations) is already in the CRM are not imported and the existing record is left as
  it is. Lead sources, labels and owners are matched to what the CRM has; nothing is added to the lists. People with
  no consent in the file get the consent the user chooses on the preview (nothing is chosen in advance).
- **How long the file is kept**: the browser sends the file in parts of 512 KiB (Vercel refuses request bodies over
  4.5 MB) into the `csv_imports` table. The file is deleted when it is imported; an unfinished upload is deleted when
  the same user starts another import; any import, file and report, older than 24 hours is deleted the next time
  anyone starts one. Only the user who started an import can open its steps and report.

## Files

Deals, people and organisations have a `// FILES` section (up to 25 MB per file). Contents are kept in Supabase
Storage, never in the database. The browser sends a file straight to Storage through a write-only address made by
the app after its checks (Vercel refuses request bodies over 4.5 MB); the app lists the file only after reading it
back. Downloads and previews go through `/files/<id>/download` and `/files/<id>/preview`, which check the record's
private rules on every request and then redirect to a Storage address valid for 60 seconds.

- **Bucket setup (once, by a person)**: in the Supabase project, create a **private** bucket `crm-files` (Public
  off), file size limit **25 MB** (26214400 bytes), no allowed-types list, and **no Storage policies** (only the
  secret key reaches it, like the database's row level security with no policies). Set `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY` (server only) in Vercel. The app never creates or changes buckets.
- **Locally and in tests**: leave `SUPABASE_URL` empty. With `APP_ENV` `development` or `test` the app uses its fake
  storage (`src/server/files/fake-storage.ts`), reached by the browser at `/dev/fake-storage/...`; local contents go
  in `.fake-storage/` (git-ignored), tests keep them in memory. The fake data command adds a few fake files.
- **Clean-up**: contents of deleted files and records are removed from Storage right away, or by a later file action
  when Storage did not answer (table `file_cleanup`; there is no cron).

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
