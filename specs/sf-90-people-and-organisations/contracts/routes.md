# Contract: pages, actions and messages

All paths are inside the design B shell (`src/app/(app)/`). "Signed in" = `requireUser()`; "admin" =
`requireAdmin()` for pages, `assertAdminForAction()` for actions (a non-admin is sent to `/admin/users`,
which shows "You don't have access to this page."). An `id` that is not `^[1-9][0-9]{0,15}$`, does not
exist, or is a person the viewer cannot see → `notFound()` ("Page not found." in the shell, HTTP 404).

## Pages

| Path | Access | Behaviour |
|---|---|---|
| `/people` | signed in | List (contracts/list-query.md). Head: `// CONTACTS`, "People", count, `[ ADD PERSON ]`. Shows the `crm_flash` notice "<name> was deleted." when present. Drawer (`open`): name, organisation and role, main email, main phone, lead source, consent, `[ OPEN PAGE ]`, `[ CLOSE ]`. |
| `/people/new` | signed in | `PersonForm` empty: owner = user, consent Subscribed, Private unticked, one empty email row and one empty phone row. |
| `/people/[id]` | signed in, visible | Header: name, "Archived"/"Private" badges, `[ EDIT ]`, `[ ARCHIVE ]` or `[ RESTORE ]`, `[ DELETE ]` (admins only). `// DETAILS` in two columns: emails (kind, main first), phones, organisation (link, "Archived" mark), role, lead source, LinkedIn (link), owner ("(deactivated)"), labels, consent, date added ("19 Nov 2026"), last contacted ("Never"). `// TIMELINE` newest first: "Added by <name>", "Edited by <name>: <fields>", "Archived by <name>", "Restored by <name>", each with "19 Nov 2026, 09:12" (UK). `?confirm=delete` (admins) shows "Delete <name> for good? This can't be undone." with `[ DELETE FOR GOOD ]` and `[ CANCEL ]`. `?error=<code>` from the allow-list shows that message. |
| `/people/[id]/edit` | signed in, visible | `PersonForm` filled, with hidden `version`; "Private" shown only to the creator. |
| `/organisations` | signed in | List. Head: `// CONTACTS`, "Organisations", count, `[ ADD ORGANISATION ]`. Drawer: name, website, sector, size, location, owner, number of people, `[ OPEN PAGE ]`, `[ CLOSE ]`. |
| `/organisations/new` | signed in | `OrganisationForm` empty, owner = user. |
| `/organisations/[id]` | signed in | Header as person (no Private). `// DETAILS`: website, sector, size, location, owner, date added. `// PEOPLE`: visible non-archived people (name link, role, main email) or "No people yet.". `// TIMELINE`: as person plus "<person> linked by <name>" / "<person> unlinked by <name>" for visible people. |
| `/organisations/[id]/edit` | signed in | `OrganisationForm` filled, hidden `version`. |
| `/admin/lead-sources-and-labels` | admin; non-admin sees Forbidden (403) | `// ADMIN`, "Lead sources and labels". Two sections, `// LEAD SOURCES` and `// LABELS`: an add field + `[ ADD ]`, then one row per non-removed entry with a rename field + `[ RENAME ]` and `[ REMOVE ]`. Empty label list shows only the add field. `?error=<code>` shown above. |

Sidebar (`nav.ts`): main `Home`, `People` (`/people`), `Organisations` (`/organisations`); admin `Users`,
`Lead sources and labels`.

## Server actions

Every action: `requireUser()` (or `assertAdminForAction()`) first; domain function re-checks visibility
and rights inside one transaction; `revalidatePath` on the affected paths.

### `src/app/(app)/people/actions.ts`

| Action | Input | Success | Refusal |
|---|---|---|---|
| `createPerson(prev, form)` | firstName, lastName, `emails[i].value/kind`, `phones[i].value/kind` (order = position), organisationId or newOrganisationName, role, leadSourceId, linkedin, ownerId, `labelIds[]`, consent, private | redirect `/people/<new id>` | returns `{ errors: {field: code}, values }`: `name_required`, `email_invalid`, `email_twice`, `phone_invalid`, `linkedin_invalid`, `duplicate_email` (+ `{name, href}` of the visible person), `duplicate_email_hidden`, `organisation_exists` (+ `{name, href}`) |
| `updatePerson(prev, form)` | as create + `id`, `version`; `private` accepted only from the creator | redirect `/people/<id>` | as create, plus `edit_conflict`; invisible/missing → not found |
| `archivePerson(form)` / `restorePerson(form)` | `id` | redirect `/people/<id>` | invisible/missing → not found |
| `deletePerson(form)` | `id` | `assertAdminForAction()`; sets `crm_flash` `{code: "person_deleted", name}`; redirect `/people` | non-admin → forbidden page, nothing deleted; invisible → not found |

### `src/app/(app)/organisations/actions.ts`

| Action | Input | Success | Refusal |
|---|---|---|---|
| `createOrganisation(prev, form)` | name, website, sector, size, location, ownerId | redirect `/organisations/<id>` | `organisation_name_required`, `website_invalid`, `organisation_exists` (+ name, href) |
| `updateOrganisation(prev, form)` | as create + `id`, `version` | redirect `/organisations/<id>` | as create + `edit_conflict_organisation` |
| `archiveOrganisation` / `restoreOrganisation` | `id` | redirect `/organisations/<id>` | missing → not found |
| `deleteOrganisation(form)` | `id` | admin; flash `{code: "organisation_deleted", name}`; redirect `/organisations`; people unlinked | non-admin → forbidden page |

### `src/app/(app)/admin/lead-sources-and-labels/actions.ts`

`addLeadSource`, `renameLeadSource`, `removeLeadSource`, `addLabel`, `renameLabel`, `removeLabel`:
`assertAdminForAction()`, admin re-checked in the transaction, then redirect to the page or
`?error=choice_exists` / `?error=choice_name_required`.

## Messages (`src/server/messages.ts`, exact text)

| Code | Where | Text |
|---|---|---|
| `name_required` | person form | Enter a first or last name. |
| `email_invalid` | person form | Enter a valid email address. |
| `email_twice` | person form | This email address is listed twice. |
| `phone_invalid` | person form | Enter a valid phone number. |
| `linkedin_invalid` | person form | Enter a LinkedIn profile link (linkedin.com/…). |
| `website_invalid` | organisation form | Enter a valid website address. |
| `duplicate_email` | person form | `<name> already has this email address.` (template; name from the database, linked) |
| `duplicate_email_hidden` | person form | Another person already has this email address. |
| `organisation_exists` | both forms | `<name> already exists.` (template; linked) |
| `organisation_name_required` | organisation form | Enter the organisation's name. |
| `edit_conflict` | person form | Someone else changed this person while you were editing. Reload to see their changes. |
| `edit_conflict_organisation` | organisation form | Someone else changed this organisation while you were editing. Reload to see their changes. |
| `person_deleted` / `organisation_deleted` | lists (flash) | `<name> was deleted.` (template) |
| `choice_exists` | admin page | This name is already on the list. |
| `choice_name_required` | admin page | Enter a name. |
| `no_people_match` | People list | No people match these filters. |
| `no_organisations_match` | Organisations list | No organisations match these filters. |
| `no_people_yet` | organisation page | No people yet. |
| `forbidden`, `not_found` | existing | unchanged |

Template messages are functions in `messages.ts` taking the record name from the database; React escapes
the text. No message ever includes text from the page address.
