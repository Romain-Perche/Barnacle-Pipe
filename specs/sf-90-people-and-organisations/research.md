# Research: People and organisations

No item in Technical Context was left as NEEDS CLARIFICATION; each decision below records a choice made
for this plan. Choices that belong to a person are in spec.md § Clarifications (marked "decided by the
factory, to confirm").

## 1. No new dependency

- **Decision**: build with what the repo has (Next.js server actions, `useActionState`, postgres.js, plain CSS).
- **Rationale**: every need is small: validation is a handful of regexes and `new URL()`; the organisation
  picker filters ≤ 500 names already in the page; tables, paging and the drawer are server-rendered HTML.
- **Alternatives considered**: zod (validation; not worth a dependency for ~10 fields), a combobox library
  (picker; 40 lines of client code), a data-grid library (lists; server-rendered tables match the Users page).

## 2. Visibility of private people: one SQL predicate

- **Decision**: `src/server/records/visibility.ts` exports `visiblePerson(viewerId, alias)` returning the
  postgres.js fragment `(not p.private or p.created_by = ${viewerId})`. Every read of `persons` (lists,
  counts, search, filters' "values in use", organisation page, organisation people count, drawer, record page,
  org timeline events about a person, duplicate-email naming) uses it. Writes (edit, archive, restore,
  delete) load the person through the same predicate first, inside the transaction, so a request for an
  invisible person behaves exactly like a missing one ("Page not found.").
- **Rationale**: one place to review; SC-005 is tested by an integration test that creates a private person
  and calls every read function as another user and as an admin.
- **Alternatives considered**: Postgres RLS policies with a session variable (the app connects as one role
  through a transaction pooler, and DECISIONS keeps RLS on with no policies as a Data API lock — mixing the
  two purposes is confusing); a view per viewer (not parameterisable).

## 3. Duplicate detection by email address

- **Decision**: `person_emails.email` is stored trimmed and lowercased with `unique` across all people
  (archived and private included). The save first looks up conflicts to build the message (name + link when
  the conflicting person is visible to the user, otherwise `duplicate_email_hidden`); the unique index is
  the final guard against two saves at once (a `23505` on that index is mapped to the same message).
- **Rationale**: SC-004 needs "whatever the case, spacing, archived or private status"; the database is the
  only race-free check. A deleted person's rows are gone (cascade), so their address can be reused.
- **Alternatives considered**: `citext` (an extension; lowercase storage is enough and the product wants
  addresses shown lowercase anyway).

## 4. Forms: client components with `useActionState`

- **Decision**: `PersonForm` and `OrganisationForm` are client components calling server actions through
  `useActionState`. The action returns `{ errors: Record<field, code>, values }` on refusal (the form keeps
  every typed value and shows each message next to its field) and redirects to the record page on success.
  Repeatable email/phone rows (add, remove, move up/down, kind select) are client state submitted as
  ordered `emails[i].value`/`emails[i].kind` form fields; the server re-validates everything.
- **Rationale**: FR spec asks for messages next to fields and that "nothing is saved"; a redirect with
  `?error=` would lose what the user typed.
- **Alternatives considered**: plain server forms with `?error=` (loses input), a separate API route (more
  surface, same checks).

## 5. Search, filters, sort, paging

- **Decision**: the list address holds all state (contracts/list-query.md). `list-query.ts` parses it into a
  validated object (unknown values dropped, page clamped). SQL: one `count(*)` and one page query with
  `limit 50 offset …`; search is `ilike '%' || term || '%'` on `first_name || ' ' || last_name`, on
  `last_name || ' ' || first_name`, on any `person_emails.email` (exists), and on the organisation name,
  with `%`, `_` and `\` escaped (`escapeLike`). Sorting has a stable tie-breaker (`id`); "last contacted"
  sorts nulls last in both directions. A page beyond the last shows the last page.
- **Rationale**: at 2,000 rows, sequential scans run in milliseconds (SC-002/003); everything is
  bookmarkable (FR-014).
- **Alternatives considered**: `pg_trgm` index (unnecessary at this size; can be added later without a
  change of behaviour), full-text search (does not match partial emails).

## 6. Preview drawer and row selection without JavaScript

- **Decision**: `?open=<id>` in the list address renders the drawer server-side. Each row holds a
  full-row "stretched" link to the same list address plus `open=<id>` (visually hidden text "Preview
  <name>"); the name link sits above it (z-index) and goes to the record page. `[ CLOSE ]` is a link to the
  address without `open`. An `open` id the viewer cannot see (private, missing) renders no drawer (FR-028).
- **Rationale**: no client component for the list; reload/bookmark/share keep the drawer (US3 scenario 8).
- **Alternatives considered**: a client row with `router.push` (needs JS, harder to make keyboard-accessible).

## 7. Organisation picker

- **Decision**: the person form gets the non-archived organisations (`id`, `name`) embedded by the server
  page; `OrganisationPicker` filters them as the user types and offers, when no name matches exactly
  (ignoring case and surrounding spaces), "Add organisation '<typed>'". It submits either `organisationId`
  or `newOrganisationName`. The server resolves `newOrganisationName` against all organisations (archived
  included): an existing name is refused with `organisation_exists` + link; otherwise the organisation is
  created in the same transaction, owned by the user.
- **Rationale**: one step, no endpoint to secure; ≤ 500 names is a few KB.
- **Alternatives considered**: a search endpoint (another access-checked route), native `<datalist>`
  (cannot show the "Add organisation" choice).

## 8. Messages, notices and the delete flash

- **Decision**: errors in forms come back from the action as codes. Page-level messages use `?error=<code>`
  / `?notice=<code>` looked up in `messages.ts` with an allow-list per page (as the Users page does). The
  only message with a name taken from data, "<name> was deleted.", uses a short-lived `crm_flash` cookie
  (httpOnly, sameSite lax, path `/`, max-age 60 s) set by the delete action with `{code, name}` and read by
  the list page; the name is the server's copy of the deleted record, never the URL. The text is built from a
  message template (`deleted: (name) => \`${name} was deleted.\``).
- **Rationale**: FR-025 and AGENTS.md ("never show text taken from a URL").
- **Alternatives considered**: `?deleted=<name>` (URL text, forbidden), a generic message without the name
  (spec requires the name).

## 9. Concurrent edits

- **Decision**: `persons.version` and `organisations.version` (int, starts at 1). Forms carry the version
  they loaded; `update … where id = $id and version = $v … set version = version + 1`. Zero rows on a
  visible record → `edit_conflict` / `edit_conflict_organisation`, nothing written. Email/phone/label rows are
  replaced inside the same transaction only after the guarded update succeeded.
- **Rationale**: spec edge case "the second save … does not overwrite the first".
- **Alternatives considered**: `updated_at` comparison (clock precision issues), row locks held across the
  user's think time (impossible over HTTP).

## 10. Timeline

- **Decision**: one `timeline_events` table with nullable `person_id` / `organisation_id` (exactly one set),
  `kind`, `actor_id`, `fields text[]` (edit), `related_person_id` (organisation link/unlink events). Edits
  record the human field names that changed (`changedFields()` compares normalised before/after values,
  ordered as on the form). Events cascade-delete with their record; organisation events about a person
  cascade-delete with that person and are filtered by the visibility predicate. Times shown with the
  existing UK formatter ("19 Nov 2026, 09:12").
- **Rationale**: later features (notes, emails, deals) add kinds and nullable columns to the same table.
- **Alternatives considered**: separate tables per record type (two timelines to merge later), JSON payload
  only (harder to filter by visibility).

## 11. Lead sources and labels

- **Decision**: two tables of the same shape (`id`, `name`, `removed_at`), unique on `lower(name)` over all
  rows. Remove = set `removed_at` (people keep the value; pickers offer only non-removed; filters offer
  non-removed plus any removed value still in use by a visible person). Adding a name that matches a removed
  entry brings that entry back (see spec Clarifications); matching a current entry → `choice_exists`.
  Rename updates the one row, so every person shows the new name (FR-022). Admin rights are re-checked
  inside the transaction (`users.role = 'admin' and status = 'active'`).
- **Alternatives considered**: hard delete with `on delete set null` (people would lose the value — spec
  says they keep it).

## 12. Delete

- **Decision**: delete actions call `assertAdminForAction()` (a non-admin is sent to `/admin/users`, which
  shows "You don't have access to this page.", the existing pattern), then the domain function re-checks
  admin + visibility in the transaction. Delete is confirmed on the record page (`?confirm=delete` renders
  the confirmation with `[ DELETE FOR GOOD ]` and `[ CANCEL ]`; no JS dialog). Person delete cascades to
  emails, phones, labels and events; organisation delete sets its people's `organisation_id` to null.
- **Alternatives considered**: soft delete (spec: "for good", and the address must be reusable).

## 13. Address validation

- **Decision** (pure, in `rules.ts`): trim; if the text has no scheme (`^[a-z][a-z0-9+.-]*:` absent) prefix
  `https://`; parse with `new URL()`; accept only `http:`/`https:`, a hostname with a dot, no spaces, no
  credentials; store `url.href` without a trailing slash added to bare hosts (`https://fakeco.example`).
  LinkedIn: hostname `linkedin.com` or ending `.linkedin.com`. Links are rendered with
  `rel="noopener noreferrer" target="_blank"`. Email: trim, lowercase, `^[^\s@]+@[^\s@]+\.[^\s@]+$`,
  ≤ 254 chars. Phone: trim, `^[0-9 +().-]+$` with at least one digit, ≤ 40 chars, stored as typed.
- **Rationale**: spec edge cases (`javascript:alert(1)` refused, `not a site` refused).
