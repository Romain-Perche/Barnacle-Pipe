# Contracts: pages, actions, domain functions, messages (SF-114)

Everything is server-rendered unless marked client. Every page calls `requireUser()`; every action calls
`requireUser()` first; every domain function re-checks visibility in its own query or transaction. Nothing is
admin-only (FR-012). Nothing from the page address is shown (FR-015): query values are parsed to numbers and only
select among options.

## Pages

| Route | File | Shows |
|---|---|---|
| `/ambassadors` | `src/app/(app)/ambassadors/page.tsx` | `// CONTACTS` label, h1 "Ambassadors", design C table (`listAmbassadors`): Name (link `/ambassadors/<id>`, "Archived" badge), Organisation, People, Deals, Open (£), Won (£), Latest referral. Empty: `messages.ambassadors_empty`. |
| `/ambassadors/[id]` | `src/app/(app)/ambassadors/[id]/page.tsx` | Design B (one column). `RecordHeader`-like head: kind "AMBASSADOR", name, "<role> at <organisation>", badges "Archived" / "No longer an ambassador" / "Private", `[ PERSON PAGE ]` → `/people/<id>`. Details: email addresses, phone numbers, owner. Summary strip (`.strip` as the deal page): People referred, Deals referred, Open £, Won £ (green), Lost (red). `// PEOPLE REFERRED` table (Name+Archived, Organisation, Owner, Added), empty `messages.no_people_referred`. `// DEALS REFERRED` table (Deal+Archived, Pipeline · stage, Value or "—", Status Open/Won/Lost, Owner), empty `messages.no_deals_referred`. `// LATEST UPDATES` (`LatestUpdates.tsx`): day groups, tags NOTE / CHANGE / PERSON / DEAL, time, record name link. Each list has `[ SHOW MORE ]` when there are more. |
| `/ambassadors/[id]` not found | `src/app/(app)/ambassadors/[id]/not-found.tsx` | `messages.ambassador_not_found`, `[ AMBASSADORS ]` → `/ambassadors`. 404. |
| `/people/[id]` | changed | "Ambassador" badge next to the name and `[ AMBASSADOR PAGE ]` when `is_ambassador`; Details gains "Referred by": link to the ambassador page (or `/people/<id>` if they have none for the viewer), `messages.referred_by_private`, or "—". |
| `/people/new`, `/people/[id]/edit` | `PersonForm.tsx` changed | "Ambassador" checkbox; "Referred by" `ReferrerPicker` (the person left out of the options), error under it. |
| `/deals/[id]` | changed | "Referred by" in the details, as on the person page. |
| Deal drawer (board, deal list) | `DealDrawer.tsx` changed | "Referred by" line, same rendering. |
| `/deals/new`, `/deals/[id]/edit` | `DealForm.tsx` changed | "Referred by" `ReferrerPicker`; on add, pre-filled from the picked main person (research.md §11). |
| `/people` | changed | Filter row gains a "Referred by" `Select` (`ref`). |
| `/deals/list` | changed | Filter row gains a "Referred by" `Select` (`ref`); count and total follow it. |
| Sidebar | `nav.ts` | `{ href: "/ambassadors", label: "Ambassadors" }` after Organisations. |

### Query parameters

| Page | Param | Parse | Meaning |
|---|---|---|---|
| `/ambassadors/[id]` | `people` | `parseShown` (50, 100, …) | people referred shown |
| `/ambassadors/[id]` | `deals` | `parseShown` | deals referred shown |
| `/ambassadors/[id]` | `updates` | `parseShownBy(v, 20)` | latest updates shown |
| `/people`, `/deals/list` | `ref` | `parseId` | filter by referrer |

`[ SHOW MORE ]` links keep the other two counts and end with an anchor on the last shown row
(`#person-<id>`, `#deal-<id>`, `#entry-<id>`), `scroll={false}`, like `RecordTimeline`.

## Server actions (changed, no new action)

- `createPerson` / `updatePerson` (`src/app/(app)/people/actions.ts`): `personFormFromData` reads `ambassador`
  (checkbox `"on"`) and `referredBy`. Field error key `referredBy` with codes `referrer_self`, `referrer_invalid`.
- `createDeal` / `updateDeal` (`src/app/(app)/deals/actions.ts`): `dealFormFromData` reads `referredBy`; error code
  `referrer_invalid` under `referredBy`.
- `deletePerson`: unchanged action; the domain function does the clean-up (data-model.md § State changes).

## Domain functions

`src/server/records/ambassadors.ts` (new):

```ts
export type AmbassadorOption = { id: number; name: string; detail: string };      // detail: "Org · first email"
export type AmbassadorRow = { id: number; name: string; organisation: { id: number; name: string } | null;
  archived: boolean; people: number; deals: number; openPence: number; wonPence: number; latestReferral: Date | null };
export type AmbassadorSummary = { people: number; deals: number; openPence: number; wonPence: number; lost: number };
export type AmbassadorPage = { person: PersonView; former: boolean; summary: AmbassadorSummary;
  people: { rows: ReferredPerson[]; more: boolean }; deals: { rows: ReferredDeal[]; more: boolean } };

listAmbassadors(viewerId): Promise<AmbassadorRow[]>
ambassadorOptions(db, viewerId, excludeId?: number): Promise<AmbassadorOption[]>   // offered: ticked, not archived, visible
isOfferedAmbassador(db, actorId, id): Promise<boolean>
getAmbassadorPage(viewerId, id, shown: { people: number; deals: number }): Promise<AmbassadorPage | null>
readAmbassadorUpdates(viewerId, id, limit): Promise<TimelinePage>                 // research.md §10
referrerOptions(viewerId): Promise<Option[]>                                      // list filters, research.md §13
referrerOf(db, viewerId, referredById: number | null): Promise<Referrer>          // for PersonView / DealView
```

`src/server/records/referral-rules.ts` (new, pure): `parseReferredBy`, `decideReferrer`, `referralEvent`
(data-model.md § Validation). `src/server/records/notes-rules.ts`: `parseShownBy`.

`src/server/records/timeline.ts`: `EventKind` + the five kinds; `recordEvent` accepts `fromPersonId`; `TimelineEvent`
gains `fromPerson: { id; name } | null`; `TimelineEntry` gains `person`; internal `selectEntries` shared by
`readTimeline` and `readAmbassadorUpdates`; hidden-person filter covers `from_person_id`.
`src/server/records/timeline-view.ts`: `EntryTag` + `"PERSON"`.
`src/server/records/people.ts`: `getPerson` (ambassador, referredBy), `createPerson`, `updatePerson`, `deletePerson`,
`listPeople` (`ref`), `personFormChoices` (+ `ambassadors`), `personToForm`.
`src/server/deals/deals.ts`: `getDeal`, `dealFormChoices` (+ `ambassadors`, `people[].referredById`), `dealToForm`,
`createDeal`, `updateDeal`. `src/server/deals/list.ts`: `listDeals` (`ref`), `dealFilterOptions` (+ `referrers`).
`src/server/records/list-query.ts`: `ref` on `PeopleQuery` and `DealsQuery`, `hasFilters`, `hasDealFilters`,
`knownDealsQuery` (+ `referrers`).

## Messages (`src/server/messages.ts`)

| Code | Text |
|---|---|
| `ambassadors_empty` | No ambassadors yet. Tick Ambassador on a person to add one. |
| `ambassador_not_found` | This ambassador doesn't exist or you can't see them. |
| `referrer_self` | A person can't be their own referrer. |
| `referrer_invalid` | Choose an ambassador from the list. |
| `no_people_referred` | No people referred yet. |
| `no_deals_referred` | No deals referred yet. |
| `no_longer_ambassador` | No longer an ambassador |
| `referred_by_private` | Referred by a private person |
| `referrer_cleared_deleted` | Referred by cleared (a deleted person) |

Templates: `referred_by(name)` "Referred by <name>", `referrer_set_event(name)` "Referred by set to <name>",
`referrer_changed_event(from, to)` "Referred by changed from <from> to <to>". Fixed lines: "Made an ambassador",
"No longer an ambassador", "Referred by cleared", "a deleted person". Every name is a React text node (edge case:
markup in names shows as text).
