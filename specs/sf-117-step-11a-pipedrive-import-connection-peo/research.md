# Research: Pipedrive import — connection, people and organisations (SF-117 part a)

Every decision below is the factory's choice. Nothing is left as NEEDS CLARIFICATION. Where a choice affects what
users see or keep, it is also in spec.md § Clarifications ("decided by the factory, to confirm").

## 1. How the app talks to Pipedrive

- **Decision**: plain `fetch` from server code in `src/server/pipedrive/api.ts`, no library. The app sends the personal
  API token in the `x-api-token` header, never as the `api_token` query parameter. It calls six endpoints
  (contracts/pipedrive-api.md):
  `GET /v1/users/me`, `GET /v1/users`, `GET /api/v2/personFields`, `GET /api/v2/organizationFields`,
  `GET /api/v2/organizations`, `GET /api/v2/persons`.
- **Rationale**: the repo already calls Google and Supabase Storage with plain `fetch` (no SDK). Pipedrive's
  `pipedrive` npm client would add a large dependency for six GET calls. The v2 endpoints are current: Pipedrive has
  deprecated v1 persons and organizations. They page by cursor (`limit` ≤ 500, `additional_data.next_cursor`), they sort
  by `id`, and they return `custom_fields`, `visible_to`, `owner_id`, `emails`, `phones`, `label_ids` and
  `marketing_status` (through `include_fields`). Users and "who am I" exist only in v1. A header keeps the token out of
  URLs, so it stays out of Vercel's request logs and out of any error message that quotes a URL. The v2 schema declares
  the `x-api-token` header scheme, and Pipedrive accepts it on v1 too.
- **Alternatives**: the official `pipedrive` npm client was rejected (dependency weight, and it hides the 429 headers);
  v1 persons/organizations were rejected (deprecated, and offset paging can skip records added during an import).

## 2. Where Pipedrive is, and the fake

- **Decision**: a new setting, `PIPEDRIVE_URL`. When it is empty and `isFakeAllowed()` is true, the app uses the fake
  Pipedrive in process (`src/server/pipedrive/fake-pipedrive.ts`). When it is empty elsewhere, the app uses
  `https://api.pipedrive.com`. `pipedriveConfig()` in `env.ts` returns
  `{ mode: "real" | "fake", baseUrl, keyReady: boolean }`. Tests install the checked fake through
  `usePipedriveFetchForTests(fn)`, which only works with `APP_ENV=test`, as `useStorageFetchForTests` does.
- **Rationale**: only the server calls Pipedrive (the browser never does), so unlike the fake Storage no `/dev/...`
  route and no proxy change are needed. The kickoff requires that the factory never get a real token. FR-030 asks for a
  settable address.
- **The fake**: one class, `FakePipedrive`, holds companies, users, field definitions, organisations and persons, keyed
  by token. It answers the six calls with the v1/v2 shapes. It can be told to answer `429` with `Retry-After` every n
  calls, to fail (network error / `500`) on the next call, to refuse a token (`401`), and to add or delete records
  between calls. For local runs it builds a deterministic fake company. Token `fake-pipedrive-token` gives "Fake Person
  (Fakeco Pipedrive)" with 300 people and 60 organisations. Token `fake-pipedrive-other` gives a second company, "Otherco
  Pipedrive", for the "another company" case. Any other token is refused. All names are clearly fake ("… Fake",
  `@fake.example`). `tests/fakes/pipedrive.ts` wraps it and checks every request and answer against both pinned
  schemas (§9).

## 3. Keeping the token

- **Decision**: AES-256-GCM with `node:crypto`. The key comes from a new setting, `PIPEDRIVE_TOKEN_KEY`: 32 random bytes
  in base64 (`openssl rand -base64 32`). The stored value is one `bytea`: `version byte (1) ‖ 12-byte IV ‖ 16-byte tag ‖
  ciphertext`. The additional authenticated data is `pipedrive-token:<user id>`, so a value copied to another user's row
  does not decrypt. Only `src/server/pipedrive/crypto.ts` (`sealToken`, `openToken`) touches the key. Pages and actions
  never receive the token: `getConnection()` returns the user name, company and date only.
- **No key set** (`PIPEDRIVE_TOKEN_KEY` empty, or not 32 bytes after base64 decoding): `keyReady` is false. The
  "// PIPEDRIVE" section shows "The Pipedrive import isn't set up yet.", no token can be saved, and no part runs. There
  is no built-in development key: a developer sets one in `.env.local`, and tests set one in their setup. This way a
  copied `.env.example` can never carry a usable key to production.
- **Logging**: no `console.*` of requests, headers or tokens. Error classes carry the HTTP status only.
- **Removal**: `removeToken` deletes the row. `deactivate()` in `users.ts` deletes the user's row in its transaction
  (FR-003).
- **Alternatives**: `pgcrypto` was rejected because the key would pass through SQL and could reach database logs.
  Supabase Vault was rejected because it is an outside service the tests could not fake, and the repo uses plain
  Postgres locally.

## 4. Checking the token (US1)

- `saveToken(userId, raw)`: trim. Empty → `pipedrive_token_required`. Longer than 200 characters →
  `pipedrive_token_refused`, without calling Pipedrive. Then `GET /v1/users/me`: `401`/`403` → refused; network error,
  timeout (10 s), `429` or `5xx` → `pipedrive_unreachable`. On `200`, read `data.id`, `data.name`, `data.company_id` and
  `data.company_name`. Then upsert `pipedrive_connections` with the sealed token and `saved_at = now()`. Nothing is
  written before Pipedrive accepts the token, so an earlier token stays in place on any failure.

## 5. Running in parts (US3)

- **Decision**: the import is a row in `pipedrive_imports` with a `step` and Pipedrive cursors. The browser moves it on.
  A client component (`ImportRunner.tsx`) on the import page calls the server action `runPipedrivePartAction()`, waits
  for its answer, then calls `router.refresh()` and calls it again 1 second later. When the answer says "wait n
  seconds", it shows the countdown and calls again after n seconds. No cron and no background job (SF-80: no
  long-running server).
- **One part** makes at most two Pipedrive calls and saves at most one page of 100 records:
  1. Read the import row (no lock) and its `step`/cursor. Stop when it is not `running`, or when `wait_until > now()`
     (then answer with the remaining wait).
  2. Open the token, then make the call for the step **outside any transaction** (AGENTS.md: no network call inside
     `sql.begin()`).
  3. `sql.begin()`: `select … for update` on the import row. When its step/cursor are no longer the ones read in 1
     (another tab ran the same part), throw the page away and change nothing. Otherwise save the page (§6) and move the
     cursor, counts and report in the same transaction. A failure rolls back the records, the cursor and the counts
     together. So each record is saved whole or not at all (FR-021), and the next part reads the same page again.
- **Steps**, in order (a step is skipped when its kind was not ticked):
  `prepare` (users, person fields, organisation fields: one call each, the three in one part, kept as a snapshot in the
  row) → `count_organisations` → `count_people` (pages of 500, counting only, for "<done> of <total>") →
  `organisations` → `people` (pages of 100, `sort_by=id&sort_direction=asc`) → `finished`. A record added in Pipedrive
  during the import has a higher id, so it comes in on a later page or on the next import. A record deleted before its
  page is read never comes in. When the count comes out lower than what was really read, the total shown is
  `max(total, done)`.
- **The person's organisation when only People is ticked (FR-012)**: in the `people` step, the organisation ids of the
  page that have no link yet are fetched in the same part with `GET /api/v2/organizations?ids=…` (the second call of
  the part). They are imported or linked first, in the same transaction. They are counted as organisations imported or
  linked, but there is no Organisations progress row. When Organisations was ticked, the same path catches
  organisations added after their step.
- **Time limit**: the import page sets `export const maxDuration = 60`. Each Pipedrive call has a 10-second timeout
  (`AbortSignal.timeout(10_000)`). A part of 100 records is a few bulk inserts, as the CSV import does with 5,000 rows.
  For SC-002, 3,800 records take about 8 counting parts and 38 import parts, at about 1–3 seconds each, so the whole
  import is well under 30 minutes.
- **Pace and 429 (FR-022)**: at most two calls per part and at least 1 second between parts. That is far below
  Pipedrive's burst limit for one token (tens of requests per 2-second window, even on the smallest plan). On a `429`,
  the wait is `Retry-After` (seconds), else `x-ratelimit-reset`, else 10 seconds, kept within 1–300 seconds. The part
  sets `state = 'waiting'` and `wait_until`, and the page shows "Pipedrive asked us to slow down. Carrying on in <n>
  seconds." The page carries on by itself: the next part after `wait_until` sets `running` again.
- **Paused (FR-020)**: each part sets `seen_at = now()`. An import whose state is `running` or `waiting` and whose
  `seen_at` is older than 30 seconds is shown as **paused**, with no new state written. The page shows "Import paused:
  …" with `[ CONTINUE ]` and does not start parts by itself. `[ CONTINUE ]` sets `seen_at`, sets `state = 'running'`
  and starts the runner. Failures set `state = 'paused'` with a `pause_reason`: `unreachable` (network, timeout, 5xx),
  `token_refused` (401/403, or no token saved any more), `other_company` (the saved token's company is not the import's
  company). `[ CONTINUE ]` tries again. `other_company` keeps refusing with its message while the company differs.
- **Stop (FR-023)**: `state = 'stopped'`, `stop_reason = 'by_user'`, `finished_at = now()`. The report is shown with
  "Stopped by you before the end."
- **One import per user (FR-006)**: a partial unique index on `pipedrive_imports (user_id) where state in ('running',
  'waiting', 'paused')`. Starting an import while one is open redirects to the open one. Starting a new import deletes
  the user's finished or stopped imports in the same transaction, so only the latest report is kept.
- **Alternatives**: Vercel Cron or a queue was rejected (SF-80: no background jobs, and the spec assumes progress only
  while the page is open); a lease column was rejected because the row lock and the cursor check already make a
  repeated part harmless.

## 6. Saving a page: matching and the "exactly once" rule (FR-017, FR-018, SC-003)

- **Decision**: a new table, `pipedrive_links (company_id, kind, pipedrive_id)`, as the primary key, pointing at the
  CRM person or organisation. It records how the link came about (`imported`/`linked`) and the import that made it.
  Each page transaction first runs `lock table organisations, person_emails, pipedrive_links in share row exclusive
  mode`, as `runImport` does. Two imports of the same company (two users at once), an import and a hand-made add, or two
  tabs then save one page at a time, and every check sees the other's committed rows.
- **Per Pipedrive organisation**, in page order:
  - a link exists → "already imported";
  - else the name matches a CRM organisation (`lower(btrim(name))`, archived included) → link it (`how = 'linked'`)
    and leave it unchanged, with a warning when it is archived. This covers two Pipedrive organisations with one name:
    the second is linked to the first;
  - else validate with `validateOrganisation` (values left out per FR-015; a name refused → not imported with the
    form's message) → insert.
- **Per Pipedrive person**:
  - a link exists → "already imported" (consent rule below still applies);
  - else take its email addresses, normalised with `normaliseEmail`, and find the CRM people who have them
    (archived and private included):
    - two or more CRM people → not imported, reason `pipedrive_email_many_people`, nothing changes;
    - one CRM person who already has a link from **another** Pipedrive person of the same company → not imported,
      reason `pipedrive_email_other_person` ("Another Pipedrive person, <name>, has the same email address."). This is
      the "same email on two Pipedrive people" edge case across parts. Within one page, the first one seen wins in the
      same way;
    - one CRM person → link it (`how = 'linked'`), unchanged;
  - else validate and insert (§7).
- **Consent on existing people (US2-14, FR-018)**: for a person linked now or already imported whose Pipedrive
  `marketing_status` is `unsubscribed` and whose CRM consent is `subscribed`, run `update persons set consent =
  'unsubscribed', version = version + 1`, add the timeline event `pipedrive_unsubscribed` (actor = the importing
  user), and add a report line. The update never goes the other way.
- **Deleted CRM records**: links have `on delete set null` and are kept. A Pipedrive record whose CRM record an admin
  deleted is counted as "already imported" and never added again (spec.md § Clarifications: a deletion may be an
  erasure request).

## 7. Field mapping (FR-007 … FR-016)

All of it is pure, in `src/server/pipedrive/rules.ts`, with unit tests. It reuses the CSV import and form helpers:
`splitFullName`, `parseSize`, `normaliseEmail`/`isValidEmail`, `normalisePhone`, `normaliseWebsite`,
`normaliseLinkedIn`, `validatePerson`, `validateOrganisation`, and the custom-field `readValue`/`parseNumber`. That way
the import accepts exactly what the forms accept.

- **Name**: `first_name`/`last_name` when either is non-empty, else `splitFullName(name)`. If the name is still empty
  → not imported, "No name.". A name the form refuses (too long) → not imported with the form's message.
- **Emails/phones**: Pipedrive order, the `primary: true` one moved first. Kind from `label`: `work` → work; `home`,
  `mobile` → personal; anything else or none → other. An invalid value is left out with a warning per value, never cut.
  A duplicate inside one person is dropped silently, as the form does.
- **Role / lead source / LinkedIn (FR-009)**: the key is the field name in lower case with every non-letter/digit
  removed. Role comes from `job_title` (built in, v2) when present, else a field keyed `jobtitle` or `role`. Lead
  source comes from a field keyed `leadsource` or `source`. LinkedIn comes from a field keyed `linkedin`,
  `linkedinprofile` or `linkedinurl`. For an option field, the value is the option's label. These fields are never
  reported as unmatched custom fields and never fill a CRM custom field (edge case).
- **Lead source and labels (FR-010)**: matched to `lead_sources` / `labels` where `removed_at is null`, by
  `lower(btrim(name))`. Person label names come from the options of the person field whose `field_code` is `label_ids`
  (or `label`). An unmatched value adds to a report counter `{ list, value } → count`, shown once.
- **Owner (FR-011)**: Pipedrive users from `GET /v1/users` (snapshot in `prepare`): id → name, email. Matched to an
  active CRM user by `lower(email)`. No match → the importing user, plus a report counter per Pipedrive owner.
- **Privacy (FR-013)**: `visible_to = 1` ("Owner only") → `private = true` and `created_by = the CRM owner`, which is
  the importing user when the owner has no CRM user. Any other value (3, 5, 7) → shared, `created_by = the importing
  user`. Organisations are always shared. The report counts owner-only organisations, and counts private people that
  the importing user cannot see (`created_by` and `owner_id` are not them).
- **Consent (FR-014)**: `unsubscribed` → unsubscribed; `subscribed` → subscribed; anything else or absent → the user's
  choice made at the start. When `include_fields=marketing_status` is refused with `400` (no marketing app), the part
  asks again without it once, and remembers that in `options.noMarketingStatus`. Every person then gets the user's
  choice, which is why FR-005 asks for the choice whenever People is ticked.
- **Organisation**: website → `normaliseWebsite`. `industry` (option id) → the option label of the organisation field
  `industry` → sector. `employee_count` → `parseSize(String(n))`. `address.value` → location. `owner_id` → owner. Any
  refused value is left out with a warning.
- **Date added**: `persons.created_at = add_time` (a Pipedrive UTC timestamp `YYYY-MM-DD HH:MM:SS` or ISO; when it
  cannot be read, `now()`). Organisations keep `now()`: the spec asks for this on people only.
- **Custom fields (FR-016)**: for each Pipedrive custom field (`is_custom_field: true`) that is not one of the built-in
  name keys above, find the CRM field of the same kind by `lower(btrim(name))`. Compatibility:
  `varchar`/`varchar_auto` → text; `text` → long_text, or text when every value fits in 255 characters (checked per
  value: a value too long for a text field is left out with a warning); `double`/`int` → number;
  `monetary` → money (`currency = 'GBP'` only, other currencies left out with a warning); `date` → date;
  `enum` → single_choice, or yes_no when its options are exactly Yes and No (in any case); `set` → multiple_choice.
  Pipedrive types with no CRM equivalent (`address`, `user`, `org`, `people`, `phone`, `time`, `timerange`,
  `daterange`, and any type not listed) → listed once as "'<name>' is a <type> field in Pipedrive: not imported.".
  No CRM field of that name → "No CRM field named '<name>'.". A type mismatch → "'<name>' is a <x> field in Pipedrive
  and a <y> field in the CRM.". Options are matched to current (not removed) choices by name, ignoring case. The values
  go in with the CSV import's bulk insert of `custom_values`, with no timeline entry per value.

## 8. Timeline and report

- Two new timeline kinds: `pipedrive_imported` ("Imported from Pipedrive by <name>") and `pipedrive_unsubscribed`
  ("Unsubscribed by the Pipedrive import of <name>"), both with `actor_id` set. They are rendered as CHANGE lines like
  `imported`. Linking an imported person to an organisation adds `person_linked` on the organisation, as the CSV import
  does (FR-026). Linked records get nothing.
- The report is `jsonb` on the import row, built up part by part under the row lock (data-model.md § Report). Text is
  made at display time from codes in `messages.ts` / `templates`. Pipedrive values appear only inside quotes, as React
  text nodes (FR-028). CRM people are named only through `visiblePerson()` at display time (FR-019).

## 9. The schemas the fake is checked against

- **Pipedrive API v2**: `openapi.json` from `soenneker/soenneker.pipedrive.openapiclient` at commit
  `77695f9076c899e2ba1e7e8eb029aabb28abed27`, sha256
  `0974486d220a6462ea2e7f03acc440f5e6cba215ec875551544c83de685807c2`. It is a daily, unmodified copy of Pipedrive's
  own `https://developers.pipedrive.com/docs/api/v1/openapi-v2.yaml`, converted to JSON. Pipedrive's own GitHub
  organisation publishes only generated clients (`pipedrive/client-nodejs`, `pipedrive/client-php`) with no spec file.
- **Pipedrive API v1** (`/users/me`, `/users`): `pipedrive-api/src/main/resources/openapi.yml` from `Zenika/zenpipe` at
  commit `1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4`, sha256
  `9d309b9bf5f520b5f4d5ca95baad2660cd8705404b8940b20ab9d6bbba662e01`. It is a copy of Pipedrive's v1 `openapi.yaml`,
  and has `company_id`/`company_name` on `/users/me`. `photz/pipedrive-openapi` (2022) is an older copy of the same
  file. The v1 file says the token goes in the `api_token` query parameter. The app sends the `x-api-token` header
  instead (§1), so the v1 check covers paths, methods, parameters and answer properties, not the auth scheme.
- Both are added to `scripts/fetch-schemas.mjs` as `pipedrive_v2_openapi.json` and `pipedrive_v1_openapi.yml`. The v1
  file is YAML, so the fake needs a YAML parser to read it: `yaml@2.9.1` as a **devDependency** (dependencies.json).
  It has no dependencies of its own, and it is never part of the app bundle.

## 10. UI

- Design B (spec Clarifications). The sidebar gets a "Settings" link at the bottom, above `[ SIGN OUT ]`: a
  `footerNav` entry in `nav.ts`, rendered by `layout.tsx`.
- `/settings`: "// YOU", title "Settings", then "// PIPEDRIVE": the token form or the connection,
  `[ REPLACE TOKEN ]` (shows the form again), `[ REMOVE TOKEN ]` (confirmation box from `?remove-token=1`), and
  `[ IMPORT FROM PIPEDRIVE ]`. An open import is shown as "Import paused: …" / "Import running" with a link to the
  import page.
- `/settings/pipedrive-import`: "← Settings", "// PIPEDRIVE", "Import from Pipedrive", the company name in the
  header, and a step bar reusing the CSV `StepBar` with a `steps` prop. Step 1 is the choose form. Step 2 has the three
  counts, "// PROGRESS", the bars, the state line, the note and `[ STOP IMPORT ]` (confirmation from `?stop=1`). Step 3
  has the counts, "// NOT IMPORTED" and the warnings. `?new=1` on a finished import shows step 1 again. The only client
  parts are `ImportRunner.tsx` (the part loop and the countdown) and the "Subscribed/Unsubscribed" radios. The radios
  are shown only when People is ticked; this is plain CSS `:has()` with no JavaScript, and the server checks it again.
