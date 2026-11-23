# Research: CSV import of people and organisations (SF-103)

Each point: **Decision**, **Rationale**, **Alternatives considered**. Nothing in the Technical Context is left as
NEEDS CLARIFICATION. Choices a person should confirm are also in `spec.md` § Clarifications ("decided by the factory,
to confirm").

## §1 CSV reading: own small parser, no dependency

**Decision**: a pure module `src/server/imports/csv.ts` (about 100 lines):

- `decodeUtf8(bytes: Uint8Array): string | null` — `new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })`
  (a leading BOM is dropped by the decoder); a decode error → `null` → `import_not_utf8`. A file whose first bytes are
  a ZIP header (`PK\x03\x04`, an `.xlsx`) or that contains a NUL byte is refused the same way.
- `detectDelimiter(text): "," | ";" | "\t"` — count each candidate on the first line *outside double quotes*; the
  most frequent wins, ties in the order `,` `;` `\t`; none → `,` (a one-column file).
- `parseCsv(text, delimiter): string[][]` — RFC 4180 state machine: `""` inside quotes is one `"`, quoted values keep
  delimiters and line breaks, line ends `\r\n`, `\n` or `\r`; a final line end does not add a row. Values are returned
  as read (trimming happens in the row rules, §5). An unclosed quote at the end of the file → `import_not_csv`.

**Rationale**: the format the spec needs (FR-003, edge cases on delimiters and quotes) is small and fully specified;
a parser in the repo is unit-tested line by line with the spec's examples, keeps the dependency list empty and works
the same on the server and in tests.

**Alternatives considered**: `papaparse` or `csv-parse` (correct, but a new dependency for ~100 lines, and their
delimiter guessing differs from the spec's "same people with commas, semicolons or tabs"); reading Excel files
(out of scope, spec Assumptions).

## §2 Getting a 5 MB file to the server on Vercel

**Decision**: the file step is a small client component (`FileStep.tsx`). It checks the size in the browser (larger
than 5 MB → `import_too_large`, nothing sent), then calls the server action `startImport(kind, fileName, size)`, which
creates a `csv_imports` row (status `uploading`), and sends the file in parts of at most 512 KiB
(`file.slice(...)`, in order) to the server action `uploadPart(id, index, part: Blob)`, which appends the bytes
(`content = content || $part`) only when `index` is the next part, the import is the user's and still `uploading`,
and the total stays ≤ 5 MB. Then `finishUpload(id)` reads the whole content, decodes and parses it (§1), checks
rows and headings (FR-003 messages), suggests the column fields (§4), stores them in `mapping`, sets status `ready`
and redirects to the columns step. A refusal deletes the row and shows the message on step 1.

**Rationale**: a Vercel function accepts request bodies up to 4.5 MB, and Next.js server actions accept 1 MB by
default; a single 5 MB upload cannot work in production. 512 KiB parts stay under both limits without changing
`next.config.ts`, and the decoding/validation stays on the server (one place, same rules as tests).

**Alternatives considered**: one upload with `serverActions.bodySizeLimit = "6mb"` (refused by Vercel above 4.5 MB);
gzip in the browser with `CompressionStream` (one request, but a poorly compressible file would still fail, and a
second code path); parsing in the browser and sending rows (validation split between browser and server); Vercel
Blob or Supabase Storage (a new outside service, and the file would be kept outside the database, against FR-017's
spirit).

## §3 Where the import lives between steps, and for how long (FR-016, FR-017, FR-023)

**Decision**: one table `csv_imports` (data-model.md). The steps are separate pages addressed by the import id:
`/people/import` (1 FILE), `/people/import/[id]/columns`, `/people/import/[id]/preview`,
`/people/import/[id]/report` (same under `/organisations/import`). The row holds the file bytes while the import is
open, the column fields chosen (`mapping`), and after the import the report (`report`). Each step re-reads the file
from the row and parses it again (5 MB parses in well under a second).

- After `[ IMPORT ]` the bytes are removed in the same transaction (`content = null`, status `done`).
- Abandoned imports: `purgeImports()` runs at the start of `startImport` and deletes (a) the same user's other imports
  that are not `done` and (b) every import created more than 24 hours ago, `done` ones included (their report holds
  names and email addresses from the file). No cron job.
- Only the user who started an import can open its steps; any other id, or another user's, shows "Page not found."

**Rationale**: serverless functions keep nothing between requests, so the file has to be in the database; one row
per import gives `[ BACK ]` with the choices kept (FR-023), a report that survives a reload (edge case), and the
"imported once" guard (§8).

**Alternatives considered**: keeping the file in the browser and sending it again at every step (5 MB × 3 requests,
and the import request would still need the 4.5 MB workaround); a cookie or the URL (far too small).

To confirm (spec.md § Clarifications): how long an abandoned upload and a report are kept.

## §4 Fields and suggested matches (FR-004, FR-005)

**Decision**: `src/server/imports/columns.ts` (pure):

- `PERSON_IMPORT_FIELDS` and `ORGANISATION_IMPORT_FIELDS`: each `{ key, label, multiple, aliases }`. Keys (people):
  `first_name`, `last_name`, `full_name`, `email` (with a kind `work|personal|other`), `phone` (with a kind),
  `organisation`, `role`, `lead_source`, `labels`, `linkedin`, `owner`, `consent`; (organisations): `name`, `website`,
  `sector`, `size`, `location`, `owner`. `multiple: true` for `email`, `phone`, `labels`. Plus `skip` ("Don't import").
- `headingKey(text)`: lower case, remove everything but `a-z0-9` (so "E-mail", "e mail", "EMAIL" → `email`).
- Aliases (after `headingKey`): first name `firstname, first, givenname, forename`; last name `lastname, last, surname,
  familyname`; full name `name, fullname, contact, contactname, person`; email `email, emailaddress, mail, workemail`
  (work), `personalemail` (personal), `otheremail` (other); phone `phone, phonenumber, telephone, tel, workphone,
  officephone` (work), `mobile, mobilephone, cell, cellphone, personalphone` (personal), `otherphone` (other);
  organisation `organisation, organization, company, companyname, org, account, employer`; role `role, jobtitle, title,
  position`; lead source `leadsource, source`; labels `labels, label, tags, tag`; LinkedIn `linkedin, linkedinurl,
  linkedinprofile`; owner `owner, owneremail, ownername`; consent `consent, emailconsent, subscribed, marketingconsent,
  optin`. Organisations: name `name, organisation, organization, company, companyname, account`; website `website, web,
  url, domain, site`; sector `sector, industry`; size `size, companysize, employees, headcount`; location `location,
  city, country, address, hq`; owner as for people.
- `suggest(headings)`: each heading gets its alias's field; a single-value field already suggested for an earlier
  column, and every heading with no alias (for example "Date added", "Last contacted", "Notes"), get `skip`.
- `checkMapping(kind, mapping)` → a message code or ok: `import_one_column` (template with the field label, "Only one
  column can be set to Lead source."), `import_person_name_column`, `import_organisation_name_column`. A people
  mapping with `full_name` and a first or last name column: `full_name` is ignored (spec: "when no first or last name
  column is set"); the column step shows this as a hint, not an error.
- A column with no heading is shown as "Column 3"; two columns with the same heading are both listed.

**Rationale**: one table of fields drives the select options, the suggestions, the example file (§10) and the checks.

## §5 From a row to a record: the same rules as the forms (FR-008, FR-014)

**Decision**: `src/server/imports/rows.ts` (pure) turns one row and the mapping into a `PersonForm` /
`OrganisationForm` and calls the existing `validatePerson` / `validateOrganisation`, so the refusal messages are the
form's (`name_required`, `email_invalid`, `email_twice`, `phone_invalid`, `linkedin_invalid`, `website_invalid`,
`organisation_name_required`). Before that:

- Every value is trimmed; a row with more values than headings → `import_too_many_values`; missing values are empty;
  a row whose values are all empty is skipped (not counted, not reported).
- Email and phone cells are split on `,` and `;`; values are appended in column order, then cell order; the first is
  the main one (position 0).
- Full name: split at the first run of spaces: "Ada May Example" → "Ada" / "May Example"; one word → first name.
- Lengths: the forms cut long values silently (`cut()` in `rules.ts`); an import refuses them instead, so nothing is
  lost without telling: first name, last name 100, role 200, organisation name 200, sector 100, location 100,
  organisation name (organisation import) 200 → `templates.import_too_long(fieldLabel, max)` ("Keep the role under 200
  characters.", the same wording as `deal_title_too_long`). Email (254), phone (40), LinkedIn and website (2000) are
  already refused by the form's own checks.
- Labels cells are split on `,` and `;`; empty parts dropped.
- Consent words (after trim, lower case): `unsubscribed, no, false, opted out, opt out, optedout, n, 0` →
  unsubscribed; `subscribed, yes, true, opted in, opt in, optedin, y, 1` → subscribed; empty → "no value" (the
  user's choice, FR-007); any other value → the row is refused with `import_consent_unknown` ("Consent not recognised:
  '<value>'. Use Subscribed or Unsubscribed."), never guessed (SC-004).
- Size: the band as written, or with `-` for `–` ("11-50"), or `1000+`/`1,000+`; else a whole number (commas and
  spaces removed) put in its band (1–10, 11–50, 51–200, 201–1,000, 1,001+ → "1,000+"; 0 or less → not recognised);
  else size empty and a warning `import_size_unknown`.
- Website goes through `normaliseWebsite` inside `validateOrganisation` (`fakeco.example` → `https://fakeco.example`).
- Values are stored as typed: `=SUM(A1:A2)` and `@admin` stay as they are (the CRM does not export to spreadsheets in
  this step, so no formula escaping is applied).

**Rationale**: FR-008 / SC-005 ask for the same rules as the forms; calling the same validators is the only way to
stay in step with them.

## §6 Matching against the CRM (FR-009 – FR-013)

**Decision**: `src/server/imports/plan.ts` is pure: `planPeople(rows, mapping, lookups)` /
`planOrganisations(...)` return `{ adds, skipped, warnings, newOrganisations, withoutEmail, needsConsent }`.
`lookups` is loaded by `src/server/imports/imports.ts` with one query per kind, whatever the row count:

- Existing emails: `select e.email, p.id, visiblePerson(...) as visible from person_emails e join persons p … where
  e.email = any($emails)` (archived and private people included; the name is never loaded here, §9).
- Organisations: `select id, name, archived from organisations where lower(name) = any($names)`.
- Lead sources and labels with `removed_at is null`, keyed by `lower(btrim(name))`.
- Active users `id, lower(email), lower(name)`; an owner value matching an email wins; a name shared by two active
  users counts as no match (warning, importer owns).
- In the file: an email already used by an earlier *imported* row → `import_duplicate_in_file` (template "Row 4 has
  the same email address."); organisation rows: a name used by an earlier row → `import_duplicate_in_file_org`.
- Organisation names on person rows: `lower(btrim(name))`; existing (archived → linked plus warning
  `import_organisation_archived`), else one new organisation per distinct name, the name as first written.
- Warnings group per value: lead source and label (one line per value with all its rows), owner (`import_owner_unknown`
  per value), size, archived organisation (per row).

**Rationale**: pure planning is unit-tested without a database; the same function runs for the preview and, again,
inside the import transaction (§8), so the report says what really happened.

## §7 Consent for rows without one (FR-007)

**Decision**: the preview form has two radio buttons "Subscribed" / "Unsubscribed" with `required` and nothing
checked, and the line "<n> people have no consent in the file." It is shown only when `needsConsent > 0`. The import
action refuses a missing or unknown value with `import_consent_required` ("Choose Subscribed or Unsubscribed for the
people with no consent in the file.") and imports nothing. Rows with a consent value always keep it.

## §8 The import itself: all or nothing, once (FR-016, SC-002, SC-006)

**Decision**: `runImport(actorId, id, consent)` in one `sql.begin` transaction:

1. `select … from csv_imports where id = $id and user_id = $actor for update`; none → not found; status `done` →
   return `{ status: "done" }` (the action redirects to the report: a second `[ IMPORT ]` or a reload adds nothing);
   status not `ready` → not found.
2. `lock table organisations, person_emails in share row exclusive mode` (people imports; organisations imports lock
   `organisations` only). Other users' adds wait for the import (seconds) instead of racing it, and two imports run one
   after the other. Reads are not blocked.
3. Load the lookups and run the plan again (rows added by others since the preview are reported as duplicates).
4. Bulk inserts, in chunks of 1,000 rows (postgres.js multi-row `insert … ${sql(rows)}`): new organisations, then
   persons, `person_emails`, `person_phones`, `person_labels`, then `timeline_events` (`imported` on each person and
   each new organisation, `person_linked` on each linked organisation). Ids are taken first with
   `select nextval(pg_get_serial_sequence('persons', 'id')) from generate_series(1, $n)` and inserted with
   `overriding system value`, so each row's children use its known id without relying on `returning` order.
5. `update csv_imports set status = 'done', content = null, report = $report, imported_at = now()`.

Any error rolls everything back; the action shows `import_failed` ("The import failed. Nothing was imported. Try
again.") on the preview step, and the import stays `ready`.

**Rationale**: ~30,000 single-row statements for 5,000 people would take about a minute through Supabase's pooler;
about 30 bulk statements take a few seconds (SC-002). The table lock makes the duplicate check exact without
per-row savepoints.

**Alternatives considered**: one transaction per row (partial imports, against FR-016); savepoints per row (slow);
a unique-violation retry loop (complex, and the report could still be wrong).

## §9 Privacy in the preview and the report (FR-009, FR-020, SC-007)

**Decision**: plans and reports store only ids and codes for existing records: a duplicate stores
`{ code: "import_duplicate_email", personId }`. The preview and report pages load names with
`select id, name from persons p where id = any($ids) and visiblePerson(p)`; a person not returned is shown with
`duplicate_email_hidden` ("Another person already has this email address.") and no link. Organisations are always
shared and are named with links. The "from the row" column shows the row's own name or email (data the user
uploaded). Everything from the file is rendered as React text, never as a link or HTML (FR-018, FR-021).

## §10 Example files (FR-002)

**Decision**: route handlers `GET /people/import/example` and `GET /organisations/import/example` (no `.csv` in the
path: `src/proxy.ts` skips paths with a file extension, and these must stay behind it). Each calls `requireUser()` and
answers `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="people-example.csv"`, a BOM (so
Excel opens it as UTF-8), the headings `First name, Last name, Email, Phone, Organisation, Job title, Lead source,
Labels, LinkedIn, Owner, Consent` (organisations: `Name, Website, Sector, Size, Location, Owner`) and two rows with
clearly fake values (`Ada`, `Example`, `ada@fakeco.example`, `Fakeco Ltd`, …). Built by a pure `exampleCsv(kind)` in
`columns.ts`, quoted with the same rules as §1.

## §11 Timeline (FR-019)

**Decision**: a new event kind `imported`, written instead of `added` for each imported person and each organisation
added by an import (both the organisation import and organisations added from person rows). `Timeline.tsx` shows
"Imported from CSV by <name>". Linking a person to an organisation writes the existing `person_linked` event on the
organisation, as the form does.

## §12 Row numbers shown to the user

**Decision**: the row number is the spreadsheet row: the heading row is row 1, the first data row is row 2, and
empty rows still take their number (so "row 7" is row 7 when the file is opened in Excel). A quoted value with line
breaks keeps one row number. To confirm (spec.md § Clarifications).

## §13 UI (design B, FR-022, FR-023)

**Decision**: server pages for steps 2–4, one client component for step 1 (the file needs the browser), plain forms
and server actions for the rest. Shared UI in `src/app/(app)/records/import/`: `StepBar.tsx` (server: four
`<span>`s, `done` with " ✓", `on` for the current one, `aria-current="step"`), `ImportHeader.tsx` ("← People" link,
title, file name and row count), `ColumnsStep.tsx`, `PreviewStep.tsx`, `ReportStep.tsx`, `FileStep.tsx`
(`"use client"`). The people and organisations pages are thin wrappers passing `kind`. CSS in `globals.css`: `.steps`
as `design-options.html` B (mono 11px uppercase, `--blue` current step, `--line` borders), count tiles reuse the
existing strip styles. `[ IMPORT CSV ]` is an outline button (`.btn`) left of the solid `[ ADD PERSON ]` /
`[ ADD ORGANISATION ]`.

`[ BACK ]`: on columns → `/people/import?id=<id>` shows step 1 with "Chosen: <file name> (n rows)" and `[ NEXT ]`
(keeps the file; choosing another file starts a new import); on preview → the columns page reads `mapping` from the
row, so the choices are kept.

## §14 Dependencies and outside services

No new package (§1, §2). No new outside service: the import reads a file the user uploads and writes to the app's own
Postgres database (Supabase in production, through its pooler, already used).
