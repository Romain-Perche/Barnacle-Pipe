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
                                    # (Pipedrive import: also PIPEDRIVE_TOKEN_KEY=$(openssl rand -base64 32))
                                    # (Gmail, fake: also GMAIL_TOKEN_KEY=$(openssl rand -base64 32), another key)
npm run db:migrate                  # update the database structure
npm run db:seed                     # load fake data (fake users, people, organisations, pipelines, deals, Ada Fake's fake Gmail, notes, ambassadors and custom fields)
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
notification), her task next week on Bob Placeholder and a call Grace Fake assigned to Ada Fake (read); most open deals keep no planned activity.
SF-123 gives Ada Fake three reminders already shown ("Fake call: reminder test call" due in a few minutes and "Fake task:
reminder test task", unread; "Fake meeting: reminder already seen", read); her later activities have reminders still to come. SF-119 adds five fake campaign drafts:
"Exec dinner – March (fake)" (Text with a button), "Welcome note (fake)" (Blank), "Event recap (fake)" (Text, a "Diet (fake)" merge
tag), "Newsletter – winter (fake)" (Newsletter) and "Pasted HTML sample (fake)", whose HTML holds a harmless script, an
`onerror` image and a form that do nothing in the preview. A fresh
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
| `/campaigns` | everyone | Campaign drafts (SF-119), shared by the whole team, most recently edited first: Name, Subject ("—" when empty), Status DRAFT, Created by, Last edited; `[ NEW CAMPAIGN ]` (`?new=1`) asks for a name and opens the new draft; per row `[ DUPLICATE ]` ("Copy of <name>") and `[ DELETE ]` (`?delete=<id>`, confirmed in a box) |
| `/campaigns/<id>` | everyone | The draft's edit page: `[ SAVE ]` `[ DUPLICATE ]` `[ DELETE ]` (`?delete=1`); // DETAILS (name, sender name, reply-to, subject, preview text), // CONTENT built from a layout (Blank, Text, Text with a button, Newsletter; heading, text, button, image and divider blocks, at most 50) or pasted HTML (up to 500,000 characters, kept as pasted); merge tags `{{First name}}` / `{{First name \| there}}` from `[ INSERT MERGE TAG ]` (person fields and people custom fields; custom field tags follow renames); "Still empty: …" and "Unknown merge tags: …"; // PREVIEW FOR a person you can see (not archived): the email filled with their values, live as you type, inside a sandboxed frame where pasted HTML cannot run scripts, send forms or reach the app. A save made from an older version is refused. Sending comes later |
| `/ambassadors` | everyone | Every ambassador you can see (people with the "Ambassador" tick on their form), A–Z: organisation, people and deals they referred, open and won totals (£), latest referral; archived ones marked "Archived". "Referred by" is set on the person and deal forms (only active ambassadors you can see are offered; the add deal form fills it from the main person) and filters the People list and the deal list (`?ref=<id>`) |
| `/ambassadors/<id>` | everyone (a private ambassador: their creator and owner) | The ambassador page: `[ PERSON PAGE ]`, contact details, a summary strip (people referred, deals referred, Open £, Won £, Lost), the people and deals they referred (50 at a time, `?people=` / `?deals=`) and the latest updates on them and what they referred (20 at a time, `?updates=`). Private records are never listed or counted for anyone they are hidden from |
| `/notifications` | everyone | Your @mentions in notes, newest first, 50 at a time (`?shown=100`): "<name> mentioned you in a note on <record>", the date and the start of the note; pressing one opens the record and marks it read; `[ MARK ALL AS READ ]`. The sidebar shows "Notifications" with the unread count, up to date on every page you open (links, forms, back and forward). In the app only, no email; a mention on a record you can no longer see is hidden. SF-109: also "<name> assigned you a <call|meeting|task>: <subject>" with "Due <date>" when someone else assigns you an activity (it goes when you are no longer the assignee); opening one goes to its deal, else person, else organisation, else the Activities list. SF-123: also a reminder of each of your planned activities, "<Type>: <subject> at <HH:MM>" with "Due <date>", from 15 minutes before it (09:00 UK time on its due date when it has no time) until it is done, moved, reassigned or deleted; opening it goes to the same record |
| `/deals/new`, `/deals/<id>/edit` | everyone (a private deal: its creator and owner) | Add a deal (`?pipeline=<id>&stage=<id>` pre-selects them), edit a deal and its deal labels (`?back=page` returns to the deal page) |
| `/admin/pipelines`, `/admin/pipelines/<id>` | admins | Add, rename, reorder (↑/↓) and delete pipelines and their stages; deleting one that holds deals moves them to a stage you choose |
| `/settings` | everyone | Your own settings (SF-117), linked at the bottom of the sidebar above `[ SIGN OUT ]`: "// PIPEDRIVE" with your Pipedrive API token (checked with Pipedrive before it is saved, stored encrypted, never shown again), "Connected to Pipedrive as <user> (<company>)." with the date saved, `[ REPLACE TOKEN ]` (`?replace=1`), `[ REMOVE TOKEN ]` (`?remove-token=1`, confirmed), `[ IMPORT FROM PIPEDRIVE ]`, and the line of an open import. Then (SF-118) the Gmail card: `[ CONNECT GMAIL ]`; connected: "Connected as …", last sync, conversations copied, copying since, `[ SEND ME A TEST EMAIL ]`, `[ DISCONNECT ]` (`?disconnect=1`, confirmed); `[ RECONNECT GMAIL ]` when Google no longer accepts the key (the sidebar's Settings link then shows an orange "!" on every page). See "Gmail" below |
| `/settings/gmail/callback` | everyone | Where Google's consent screen sends the browser back (SF-118); then `/settings` |
| `/settings/pipedrive-import` | everyone with a saved token | The Pipedrive import (SF-117, SF-122, design B): step bar 1 CHOOSE · 2 IMPORTING · 3 REPORT. Choose People, Organisations, Deals, Notes, Activities and Files (the last four tick and lock People and Organisations; and the consent of people with no status in Pipedrive), watch the progress (counts, bars, waits, pause, `[ CONTINUE ]`, `[ STOP IMPORT ]` with `?stop=1`), then the report (`[ NEW IMPORT ]` with `?new=1`). See "Pipedrive import" below |
| `/admin/custom-fields` | admins | Custom fields of people, organisations and deals (a tab per kind, `?kind=people\|organisations\|deals`): add (`?field=new`), rename, reorder (↑/↓), "Show in list" (at most 8 per kind), choices of choice fields, delete after a confirmation that counts the records with a value (`?delete=<id>`). Eight types: text, long text, number, money (£), date, single choice, multiple choice, yes/no; the type never changes. Values are filled in under "// MORE DETAILS" on the add and edit forms, shown on record pages and the deal drawer, logged on the timeline, shown as columns and filters of the lists (`?cf<id>=…`, `?cf<id>_from=…&cf<id>_to=…`, `?sort=cf<id>`) and can be mapped in the CSV import |

## Tests

The tests need a local test database and `APP_ENV=test`. They refuse to run otherwise.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test             # Vitest: unit tests + integration tests against the test database (migrates it first)
npm run typecheck    # TypeScript
```

The test database is emptied and reloaded by the tests: never point `DATABASE_URL` at a database you care about.

The first `npm test` downloads the Google userinfo schema the fake Google sign-in is checked against, Supabase
Storage's OpenAPI file the fake file storage is checked against, and Pipedrive's v2 (JSON) and v1 (YAML, plus a fuller
v1 copy for deal participants and file downloads) OpenAPI files the fake Pipedrive is checked against, and Gmail's and
Cloud Pub/Sub's discovery files the fake Gmail is checked against
(`npm run test:schemas`, pinned files from GitHub, into the git-ignored
`.factory/schemas/`): it needs network access once.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally. Never changes the database structure. |
| `npm run build` / `npm start` | Build / start the app. The build never touches the database. |
| `npm run vercel-build` | Vercel's build: runs `db:migrate` only when `VERCEL_ENV=production`, then `next build`. |
| `npm run db:migrate` | Apply the pending `migrations/*.sql`. Prints each one applied, or "Database is up to date.". Safe to run twice, or twice at once. |
| `npm run db:seed` | Load fake data. Only when `APP_ENV` is exactly `development` or `test` and `VERCEL_ENV` is not `production`/`preview`; otherwise prints "Fake data can only be loaded when APP_ENV is development or test." and exits 1. Safe to run again. |
| `npm test` | Unit and integration tests (runs `test:schemas` first). |
| `npm run test:schemas` | Download the pinned Google, Gmail, Pub/Sub, Supabase Storage and Pipedrive (v2, v1 and the full v1 copy) schemas into `.factory/schemas/` when missing; does nothing otherwise. |
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
| `APP_URL` | real Google sign-in | Public base URL, e.g. `http://localhost:3000`. The OAuth redirect URI is `${APP_URL}/auth/google/callback`. Also anchors the check of the return path after sign-in (`http://localhost:3000` when unset), and is also the base of unsubscribe links (https in production). |
| `SUPABASE_URL` | production (files) | `https://<project>.supabase.co`. Empty with `APP_ENV` `development`/`test`: the fake file storage is used. Empty otherwise: every file action answers "Files can't be reached right now. Try again in a minute."; the rest of the app works. |
| `SUPABASE_SECRET_KEY` | with `SUPABASE_URL` | Supabase secret key (or the legacy `service_role` key). Secret, server only, never sent to the browser. |
| `FILES_BUCKET` | optional | The private Storage bucket of file contents. Default `crm-files`. |
| `PIPEDRIVE_TOKEN_KEY` | to use the Pipedrive import | 32 random bytes in base64 (`openssl rand -base64 32`). Secret, server only. It encrypts the Pipedrive tokens users save (AES-256-GCM). Empty or not 32 bytes: Settings says "The Pipedrive import isn't set up yet." and no token can be saved; there is no built-in key, also locally. Changing it makes saved tokens unreadable: users save them again. |
| `PIPEDRIVE_URL` | optional | Base address of Pipedrive's API. Empty with `APP_ENV` `development`/`test`: the fake Pipedrive (in process) is used. Empty otherwise: `https://api.pipedrive.com`. |
| `GMAIL_PUBSUB_TOPIC` | production (Gmail) | `projects/<project>/topics/<topic>` Gmail sends its notices to (SF-118). Empty with `APP_ENV` `development`/`test`: the fake Gmail is used. Empty otherwise: "Gmail can't be connected right now." (the rest of the app works). |
| `GMAIL_TOKEN_KEY` | with Gmail, also locally | 32 random bytes in base64 (`openssl rand -base64 32`), its own key, never `PIPEDRIVE_TOKEN_KEY`'s value. Secret, server only. Encrypts the Gmail keys users give (AES-256-GCM). No built-in value: without it Gmail is off, in development too. Changing it makes every user reconnect Gmail. |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | with `GMAIL_PUBSUB_TOPIC` | The service account email the Pub/Sub push subscription signs its notices with. |
| `GMAIL_PUSH_AUDIENCE` | optional | The push token's audience. Default `${APP_URL}/gmail/push`. |
| `GMAIL_PUSH_SUBSCRIPTION` | optional | `projects/<project>/subscriptions/<name>`. When set, notices from any other subscription are refused. |
| `CRON_SECRET` | production | At least 16 characters. Secret. Vercel sends it to `/cron/gmail` as `Authorization: Bearer …`; without it the route answers 401. |
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

## Pipedrive import

Any signed-in user can bring their Pipedrive people, organisations, deals, notes, activities and files into the CRM
(SF-117, SF-122). Pipedrive emails are not imported: email will come from Gmail.

- **The token**: each user pastes their own API token (Pipedrive: Personal preferences → API) on `/settings`. The app
  checks it with `GET /v1/users/me` before saving it, stores it encrypted with `PIPEDRIVE_TOKEN_KEY` (bound to its
  user), sends it to Pipedrive in the `x-api-token` header only (never in an address or a log) and never shows it again.
  Removing it, or deactivating the user, deletes it. Nobody, admins included, can see or use another user's token.
- **What is imported**: people with their names, every email address and phone number (primary first; work → Work,
  home and mobile → Personal, others → Other), organisation, role ("Job title"/"Role"), lead source ("Lead
  source"/"Source"), LinkedIn ("LinkedIn", "LinkedIn profile", "LinkedIn URL"), labels, owner, consent, privacy and Date
  added; organisations with their website, industry (sector), number of employees (size band), address (location) and
  owner; custom fields that match a CRM custom field of the same name and a compatible type. Values a form would refuse
  are left out with a warning, never cut. Lists are matched, never added to. Owners are matched by email to active CRM
  users, else the importing user gets the record. An "Owner only" person is private, owned and created by its owner;
  organisations are always shared. People without a consent status in Pipedrive get the consent the user chooses.
- **Deals, notes, activities and files** (SF-122): ticking any of them ticks People and Organisations, which stay
  ticked (the server enforces it too). A deal, note, activity or file comes in only on a CRM record the import brought in
  (imported or linked); otherwise it is listed with why, and a later import can still bring it in.
  - **Pipelines and stages** are matched by name (ignoring case and surrounding spaces); the ones the CRM lacks are
    created at the end, in Pipedrive's order, by any user's import (the one exception to admins-only pipelines); none
    is ever renamed, reordered or deleted.
  - **Deals**: title, value (GBP only), stage, owner, main person, organisation, other linked people (participants),
    followers (active CRM users), labels (matched to offered deal labels), expected close date, status (Won / Lost with
    Pipedrive's dates and lost reason, or "No reason given in Pipedrive."), Date added, archived, privacy ("Owner only" →
    private, created by its owner) and matched custom fields. The stage bar starts at Pipedrive's last stage change; the
    timeline has one "Imported from Pipedrive by …" entry.
  - **Notes** go once on their deal, else person, else organisation, as plain text (line breaks and link text kept), at
    Pipedrive's date, by their author; mentions are plain text and notify nobody.
  - **Activities**: calls, meetings and tasks (any other type comes in as a task, counted per type), due date and time in
    UK time, duration, note, links, assignee and done date; an import notifies nobody. Done calls and meetings raise
    Last contacted.
  - **Files** are copied into the CRM's file store (25 MB limit) and listed once, like notes, with Pipedrive's name,
    date and uploader. Larger, empty, linked (Google Drive…) and email files are left out and listed or counted. A
    file's path is queued for clean-up before its upload and listed in the same commit that takes it off the queue, so
    nothing is ever half-stored. A download redirect is followed without the token. Ticking Files needs the file store:
    "Files can't be reached right now." otherwise.
- **Matching and linking**: a person whose email address one CRM person already has, or an organisation whose name a
  CRM organisation already has, is linked to it and left as it is (only a Subscribed person unsubscribed in Pipedrive
  becomes Unsubscribed). Every record imported or linked keeps its Pipedrive company and ID (`pipedrive_links`), so a
  Pipedrive record never leads to two CRM records, whether imports are repeated, resumed or run by two users at once; a
  record deleted in the CRM is not added back (its later notes, activities and files are listed as on a deleted record).
- **Parts, waits and pauses**: the import runs in parts (100 people or organisations, 20 deals, 200 notes or activities,
  files one at a time for up to 15 seconds or 25 MB) while its page is open (one part about
  every second; no background job). When Pipedrive answers "too many requests" the page waits the time Pipedrive asks
  for (at most 5 minutes) and carries on. Closing the page pauses the import (after 30 seconds without a part);
  `[ CONTINUE ]` carries on from where it stopped; a failed part saves nothing and pauses with the reason.
- **The report**: counts per kind (imported, linked, already imported, not imported), the pipelines and stages added,
  every record not imported with why, the owners without a CRM user, private records of other owners (counted, never
  named), list values, custom fields and choices left out, activity types imported as tasks, notes, activities and files
  on Pipedrive leads, projects and emails, and the other warnings, with links to People, Organisations, Deals and
  Activities. The latest report
  stays on the import page until the user starts another import.
- **Locally and in tests**: leave `PIPEDRIVE_URL` empty and set a `PIPEDRIVE_TOKEN_KEY`. The fake Pipedrive
  (`src/server/pipedrive/fake-pipedrive.ts`, nothing to seed) accepts `fake-pipedrive-token` ("Fake Person", "Fakeco
  Pipedrive": 60 organisations, 300 people, 2 pipelines, 30 deals, 40 notes, 30 activities and 6 files (a PDF, a PNG, a
  26 MB one, an empty one, a Drive link, an email attachment); its owners match the fake users ada@ and margaret@, plus
  "Jane Fake" who has no CRM user) and `fake-pipedrive-other` ("Otherco Pipedrive"); any other token is refused. Files
  go to the fake file store (`SUPABASE_URL` empty).

## Gmail

Each user connects their own barnacle.ai Gmail on `/settings` (SF-118). The CRM asks Google, through the same Internal
OAuth app as sign-in, for `gmail.modify` (read mail, change its labels and read state; this issue changes nothing in
Gmail) and `gmail.send`, with offline access. The connection is refused when a permission is unticked or the account is
not the user's sign-in address. Only the refresh key is stored, sealed with `GMAIL_TOKEN_KEY`, never shown or logged.

- **What is copied**: from the moment of connecting (Gmail's own date), every message sent or received with a CRM person
  (any of their addresses, in From, To, Cc or Bcc; private and archived people included), or in a conversation already
  copied: headers, text, HTML, and the names, types and sizes of attachments (never their contents). Not drafts, spam or
  bin. Each message is copied once per account. Disconnecting or deactivating a user keeps what was copied.
- **How**: Gmail tells the CRM about new mail through Google Cloud Pub/Sub (`POST /gmail/push`, proved by a Google-signed
  token). `vercel.json` runs `GET /cron/gmail` every 15 minutes (Vercel Pro, `CRON_SECRET`): it checks every working
  connection for anything missed and renews each one's Gmail notices once a day. At most 300 messages are read per run;
  the rest follow on the next notice or check.
- **Google Cloud setup before go-live**:
  1. In the Internal OAuth app's project, enable the Gmail API and the Cloud Pub/Sub API; add the scopes `gmail.modify`
     and `gmail.send` to the consent screen; add the redirect URI `${APP_URL}/settings/gmail/callback`.
  2. Create the topic (`GMAIL_PUBSUB_TOPIC`) and grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher
     role on it.
  3. Create a service account for push (no keys needed), then a push subscription to `${APP_URL}/gmail/push` with
     authentication on that service account (`GMAIL_PUSH_SERVICE_ACCOUNT`), audience `GMAIL_PUSH_AUDIENCE` (default
     `${APP_URL}/gmail/push`) and an acknowledgement deadline of 60 s.
  4. Set the settings above in Vercel.
- **Locally and in tests**: leave `GMAIL_PUBSUB_TOPIC` empty and set a `GMAIL_TOKEN_KEY`. The fake Google and Gmail
  (`src/server/gmail/fake-gmail.ts`, state in the git-ignored `.fake-gmail/`) answer in process: `[ CONNECT GMAIL ]` opens
  the fake consent screen `/dev/fake-google/gmail`, and `/dev/fake-gmail` puts received or sent mail in a user's fake
  mailbox (with or without delivering its notice), runs the 15-minute check, refuses the key, fails renewals and forgets
  Gmail's history. `npm run db:seed` connects Ada Fake with three copied conversations. The tests set their own key.

## Unsubscribe

Every person has a random unsubscribe token (64 hex characters, `persons.unsubscribe_token`, made by the database, no
expiry). The addresses need no sign-in; the token is the only authority:

- `/unsubscribe/<token>`: the page. Opening it changes nothing; `[ UNSUBSCRIBE ]` posts to `/unsubscribe/<token>/confirm`,
  which sets Consent to Unsubscribed and adds "Unsubscribed from campaigns through the unsubscribe link" to the person's
  timeline (no actor, nobody notified).
- `/unsubscribe/<token>/one-click`: RFC 8058 one-click for mail apps (`POST` with `List-Unsubscribe=One-Click`; answers
  `200`, `400`, `404` or `503` in plain text).
- Campaign sending takes the page link and both headers (`List-Unsubscribe`, `List-Unsubscribe-Post`) from
  `unsubscribeLinksFor(personId)` in `src/server/records/unsubscribe.ts`, built on `APP_URL`.
- `/dev/unsubscribe-links` (development and test only) lists every person's link and headers.

There is no setting. Only a teammate can subscribe a person again, from the edit form ("Consent: Unsubscribed →
Subscribed by <name>"); the form changes Consent only when the field was changed on it.

## Production notes

- **Vercel production**: `vercel-build` runs `npm run db:migrate` before `next build`. A failed migration fails the deploy.
- **Migrations through Supabase's pooler**: each migration runs in its own transaction under
  `pg_advisory_xact_lock`, which Postgres releases at commit or rollback. No lock outlives the command,
  so the transaction-mode pooler is safe. The app connects with `prepare: false` for the same pooler.
- **Row Level Security**: every table has Row Level Security on with no policies, so Supabase's Data API
  cannot read or write app data. The app's own database user owns the tables and is not affected.
- **Previews** only build the app: no `DATABASE_URL`, nobody can sign in, the sign-in page says so.
- **Fake login and fake data** are never available on Vercel production or preview deployments.
- **Request size**: `next.config.ts` raises the server action body limit to 4 MB (`experimental.serverActions.bodySizeLimit`):
  a campaign draft's pasted HTML (500,000 characters) can be up to 2 MB as UTF-8. It stays under Vercel's 4.5 MB request limit.
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
