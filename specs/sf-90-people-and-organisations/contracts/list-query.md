# Contract: list addresses (FR-012 – FR-015)

Parsed by `src/server/records/list-query.ts` (pure). Unknown parameters and invalid values are ignored
(treated as absent), never echoed as messages. Only `q` is shown back, inside the search field.

## `/people`

| Param | Values | Default | Meaning |
|---|---|---|---|
| `q` | text, trimmed, ≤ 200 chars | none | part of the name (either order), any email address, or the organisation name; `%`, `_`, `\` are literal |
| `owner` | user id | none | owner |
| `label` | label id | none | has this label |
| `source` | lead source id | none | lead source |
| `org` | organisation id | none | linked to this organisation |
| `consent` | `subscribed` \| `unsubscribed` | none | consent status |
| `sort` | `name` \| `organisation` \| `added` \| `contacted` | `name` | sort column |
| `dir` | `asc` \| `desc` | `asc` | direction; ties broken by id; null organisation / last contacted always last |
| `page` | integer ≥ 1 | 1 | 50 rows per page; beyond the last page → last page |
| `archived` | `1` | absent | include archived records (marked "Archived") |
| `open` | person id | none | preview drawer for that person if visible, else no drawer |

Filter options: owner = active users plus any user owning a visible person; label/lead source =
non-removed entries plus removed ones still used by a visible person; organisation = organisations with
at least one visible person, plus the selected one.

Count line: `// N PEOPLE` (`countLabel`), the total matching the filters. No match: "No people match these
filters." with `[ CLEAR FILTERS ]` → `/people` (keeps nothing).

Row: name (link to `/people/<id>`) with the main email beneath; organisation (link, "Archived" mark when
archived); role; owner (with "(deactivated)"); labels; lead source; consent; last contacted
("Never" or "19 Nov 2026"). The rest of the row links to the same address with `open=<id>`.

## `/organisations`

| Param | Values | Default |
|---|---|---|
| `q` | name or website contains | none |
| `owner` | user id | none |
| `sector` | exact sector text (case-insensitive), from sectors in use | none |
| `size` | one of the five bands | none |
| `sort` | `name` \| `people` \| `added` | `name` |
| `dir`, `page`, `archived`, `open` | as for people | |

Row: name (link), website (link, host shown), sector, size, location, owner, number of people (visible,
non-archived). Count line `// N ORGANISATIONS`; no match: "No organisations match these filters."

## Links built by the pages

Every link that changes one setting keeps the others (`withParams(current, {…})`), and changing a filter,
search, sort or "Show archived" resets `page` and removes `open`. Filter form: GET to the list path; the
`AutoSubmit` client component submits on change; `[ APPLY ]` works without JavaScript.
