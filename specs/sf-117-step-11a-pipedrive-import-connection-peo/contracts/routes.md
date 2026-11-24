# Contract: pages, actions, domain functions, messages

## Pages

| Address | Who | Shows |
|---|---|---|
| `/settings` | `requireUser()` | "// YOU", "Settings", "// PIPEDRIVE". If the key is not set up: "The Pipedrive import isn't set up yet." If there is no token: a password-type field "Pipedrive API token" (`autocomplete="off"`, never pre-filled), a note ("In Pipedrive: Personal preferences → API."), and `[ SAVE TOKEN ]`. If connected: "Connected to Pipedrive as <user> (<company>)." "Token saved on <date>.", `[ REPLACE TOKEN ]` (`?replace=1` shows the form), `[ REMOVE TOKEN ]` (`?remove-token=1` opens the confirmation box), and `[ IMPORT FROM PIPEDRIVE ]`. If an import is open, its line ("Import paused: Organisations 800 of 800, People 1,200 of 3,000." / "Import running.") links to the import page. `?error=<code>` / `?saved=1` / `?removed=1` notices use fixed codes only. |
| `/settings/pipedrive-import` | `requireUser()`; not connected → redirect `/settings` | Header: "← Settings", "// PIPEDRIVE", "Import from Pipedrive", the company name (from the connection, or from the import when one exists). Step bar `1 CHOOSE · 2 IMPORTING · 3 REPORT`. **Step 1** (no import, or `?new=1` after a finished or stopped one): "What to import", the People and Organisations checkboxes (unticked), the consent radios "Subscribed" / "Unsubscribed" shown when People is ticked (none chosen), the note on existing records, and `[ IMPORT ]`. **Step 2** (running, waiting or paused): the counts Imported / Linked to CRM records / Not imported, "// PROGRESS" with a bar and "<Kind> · <done> of <total>" per ticked kind, the state line, the note "Keep this page open: …", and `[ STOP IMPORT ]` (`?stop=1` opens the confirmation). When paused: the pause message and `[ CONTINUE ]`. **Step 3** (finished or stopped): the counts, "Already imported: n", "// NOT IMPORTED" (Pipedrive record, reason), the owner, list, field, choice and other warning lines, "Stopped by you before the end." when stopped, links to People and Organisations, and `[ NEW IMPORT ]` (`?new=1`). `export const maxDuration = 60`. |

The sidebar gets "Settings" (`footerNav` in `nav.ts`) at the bottom, above `[ SIGN OUT ]`.

## Server actions

All of them call `requireUser()` first, act only on the signed-in user's own connection and import, and redirect only
to fixed in-app paths.

| Action | File | Does |
|---|---|---|
| `saveTokenAction(form)` | `src/app/(app)/settings/actions.ts` | `saveToken(user.id, form.token)` → redirect `/settings?saved=1` or `?error=<code>` |
| `removeTokenAction()` | same | `removeToken(user.id)` → `/settings?removed=1` |
| `startPipedriveImportAction(form)` | `src/app/(app)/settings/pipedrive-import/actions.ts` | `startImport(user.id, { people, organisations, consent })` → errors `pipedrive_tick_something`, `pipedrive_consent_required`, `pipedrive_not_connected`, or an already open import (redirect to it); then redirect to the import page |
| `runPipedrivePartAction(importId)` | same (called by `ImportRunner.tsx`) | `runPart(user.id, importId)` → `{ next: "now" } \| { next: "wait"; seconds } \| { next: "stop" }` (stop: paused, finished, stopped, or not theirs). Returns no record data and no text. |
| `continuePipedriveImportAction()` | same | `continueImport(user.id)` → the import page |
| `stopPipedriveImportAction()` | same | `stopImport(user.id)` → the import page (step 3) |

## Domain functions (`src/server/pipedrive/`)

| File | Exports |
|---|---|
| `crypto.ts` | `sealToken(key, userId, token): Buffer`, `openToken(key, userId, sealed): string` (throws on a wrong key, user or value) |
| `api.ts` | the calls of contracts/pipedrive-api.md, the error classes, `usePipedriveFetchForTests` |
| `fake-pipedrive.ts` | `FakePipedrive`, `fakePipedrive()` |
| `connection.ts` | `getConnection(userId)`, `saveToken(userId, raw)`, `removeToken(userId)`, `tokenFor(userId)` (internal to the import), `deleteConnection(db, userId)` (used by `deactivate`) |
| `rules.ts` (pure) | `fieldKey`, `BUILT_IN_KEYS`, `phoneKind`/`emailKind`, `personFromPipedrive`, `organisationFromPipedrive`, `customCompatibility`, `readCustomValue`, `consentOf`, `isOwnerOnly`, `retrySeconds` |
| `page.ts` (pure) | `planOrganisationPage(records, lookups)`, `planPersonPage(records, lookups)` → adds / links / already / not imported / warnings / unsubscribes (like `imports/plan.ts`) |
| `imports.ts` | `startImport`, `runPart`, `continueImport`, `stopImport`, `getImportView(userId)` (state, effective paused, progress, counts, report) |
| `report.ts` (pure + one read) | `reportLines(report, names)`, `namesForReport(viewerId, report)` through `visiblePerson()` |

`users.ts` `deactivate()` calls `deleteConnection(db, userId)` inside its transaction.

## Messages (`src/server/messages.ts`)

Fixed messages (`messages`):

| code | text |
|---|---|
| `pipedrive_not_set_up` | The Pipedrive import isn't set up yet. |
| `pipedrive_token_required` | Paste your Pipedrive API token. |
| `pipedrive_token_refused` | Pipedrive did not accept this token. Copy it again from Pipedrive and try again. |
| `pipedrive_unreachable` | Pipedrive can't be reached right now. Try again in a minute. |
| `pipedrive_token_note` | In Pipedrive: Personal preferences → API. |
| `pipedrive_tick_something` | Tick what to import. |
| `pipedrive_consent_required` | Choose the email consent of people with no consent status in Pipedrive. |
| `pipedrive_existing_note` | Records already in the CRM (a person with the same email address, an organisation with the same name) are linked to the Pipedrive record and left as they are. |
| `pipedrive_keep_open` | Keep this page open: the import moves on while it is open. Closing it pauses the import. |
| `pipedrive_stopped_unreachable` | The import stopped: Pipedrive can't be reached right now. |
| `pipedrive_token_no_longer` | Pipedrive no longer accepts your token. Save a new token in Settings, then continue. |
| `pipedrive_other_company` | This import is from another Pipedrive company. Stop it, or save the token of that company again. |
| `pipedrive_stopped_by_you` | Stopped by you before the end. |
| `pipedrive_no_name` | No name. |
| `pipedrive_email_many_people` | Its email addresses belong to more than one person in the CRM. |
| `pipedrive_linked_hidden` | A person already in the CRM has this email address: linked, not changed. |
| `pipedrive_unsubscribed_hidden` | A person already in the CRM is unsubscribed in Pipedrive: now Unsubscribed in the CRM. |
| `pipedrive_saved`, `pipedrive_removed`, `pipedrive_remove_confirm`, `pipedrive_stop_confirm` | short confirmations and questions |

Templates (`templates`; Pipedrive values are always quoted data):

| code | text |
|---|---|
| `pipedrive_connected(user, company)` | Connected to Pipedrive as <user> (<company>). |
| `pipedrive_saved_on(date)` | Token saved on <date>. |
| `pipedrive_slow_down(n)` | Pipedrive asked us to slow down. Carrying on in <n> seconds. |
| `pipedrive_paused(parts)` | Import paused: Organisations 800 of 800, People 1,200 of 3,000. |
| `pipedrive_progress(kind, done, total)` | <Kind> · <done> of <total> |
| `pipedrive_owner_missing(name, email, n)` | Owner <name> (<email>) has no CRM user: <n> records given to you. |
| `pipedrive_private_others(n)` | <n> private people of other owners imported. |
| `pipedrive_owner_only_orgs(n)` | <n> owner-only organisations imported as shared. |
| `pipedrive_list_missing(list, value, n)` | Lead source not on the list: '<value>' (<n> people) / Label not on the list: '<value>' (<n> people) |
| `pipedrive_choice_missing(field, value, n)` | '<value>' is not a choice of '<field>': left out (<n> records). |
| `pipedrive_field_no_match(name)` | No CRM field named '<name>'. |
| `pipedrive_field_type_mismatch(name, pd, crm)` | '<name>' is a <pd> field in Pipedrive and a <crm> field in the CRM. |
| `pipedrive_field_unsupported(name, pd)` | '<name>' is a <pd> field in Pipedrive: not imported. |
| `pipedrive_linked(name)` | <name> was already in the CRM: linked, not changed. |
| `pipedrive_unsubscribed(name)` | <name> is unsubscribed in Pipedrive: now Unsubscribed in the CRM. |
| `pipedrive_email_other_person(name)` | Another Pipedrive person, <name>, has the same email address. |
| `pipedrive_value_invalid(field, value)` | <Field> '<value>' is not valid: left out. |
| `pipedrive_value_too_long(field, max)` | <Field> longer than <max> characters: left out. |
| `pipedrive_org_archived(name)` | <name> is archived. |
| `pipedrive_org_not_imported(name)` | Its organisation '<name>' was not imported: imported without an organisation. |
| `pipedrive_currency(field, currency)` | '<field>': amount in <currency>, not GBP: left out. |
| `pipedrive_imported_by(name)` / `pipedrive_unsubscribed_by(name)` | timeline: Imported from Pipedrive by <name> / Unsubscribed by the Pipedrive import of <name> |

The Pipedrive type words are fixed: `varchar` "text", `text` "large text", `double` "numerical", `monetary`
"monetary", `date` "date", `enum` "single option", `set` "multiple options", `address` "address", `user` "user",
`org` "organisation", `people` "person", `phone` "phone", `time` "time", `timerange` "time range", `daterange` "date
range". Any other type is "other".
