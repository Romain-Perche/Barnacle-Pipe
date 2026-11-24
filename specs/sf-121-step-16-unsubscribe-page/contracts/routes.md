# Contracts: addresses, domain functions, messages (SF-121)

None of these addresses needs a user. They are listed as public in `src/proxy.ts`:
`/^\/unsubscribe\/[^/]+(\/(confirm|one-click))?\/?$/` and `/^\/dev\/unsubscribe-links\/?$/`. With no cookie they never
redirect to sign-in. A signed-in browser sees exactly the same page (no sidebar, no link into the app).

A token is valid only if it matches `/^[0-9a-f]{64}$/`. Any other value is "not found" and causes no database access.
No text from the address is ever shown.

## `GET /unsubscribe/<token>` (page, design A)

Layout: `<main className="outside"><div className="panel">`, the sign-in page's twin. It shows `<Wordmark centre="#FAF6F1" />`,
the label `// EMAIL PREFERENCES`, then `<h1>Unsubscribe</h1>`. What comes next depends on `unsubscribePageState(token)`:

| State | When | Shows |
|---|---|---|
| `ready` | the token's person exists and is `subscribed` | `<p className="lead">` `unsubscribe_lead`; `<form method="post" action="/unsubscribe/<token>/confirm">` with `<button className="btn primary" type="submit">[ UNSUBSCRIBE ]</button>` |
| `done` | the token's person exists and is `unsubscribed` | `<p className="notice" role="status">` `unsubscribe_done`; no button |
| `not_found` | bad shape, unknown token, or the person was deleted | `<p className="err" role="alert">` `unsubscribe_invalid`; no button |
| `error` | `isPreview()`, or a database error while reading | `<p className="err" role="alert">` `unsubscribe_error`; no button |

When the state is `ready` and `?error=unavailable` is present (the only code read), the page also shows
`unsubscribe_error` in `.err` above the button. Any other query parameter is ignored. The page never shows a name, an
email or a link into the app, and never offers a way to subscribe again. It has `export const dynamic = "force-dynamic"`
and the metadata `robots: { index: false }`. It writes nothing.

## `POST /unsubscribe/<token>/confirm` (the button)

- It calls `unsubscribeByToken(token, "link")`.
  - `done` or `not_found` → `303` to `/unsubscribe/<token>`. The page then reads the state again and shows either
    done or not valid.
  - A thrown database error → `303` to `/unsubscribe/<token>?error=unavailable`.
- A token with the wrong shape → `303` to `/unsubscribe/<token>` (shown as not valid), and nothing is read.
- No cookie is read or set. `GET` is not exported, so a GET answers `405`.

## `POST /unsubscribe/<token>/one-click` (RFC 8058)

The checks run in this order:

| Case | Status | Body |
|---|---|---|
| the body (form data, or urlencoded text when no content type is sent) does not hold `List-Unsubscribe` = `One-Click` | `400` | `Bad request` |
| the token has the wrong shape, is unknown, or its person was deleted | `404` | `Not found` |
| the person was unsubscribed by this request, or already was | `200` | `Unsubscribed` |
| a database error | `503` | `Try again later` |

Every answer is `text/plain` with `Cache-Control: no-store`. There is no redirect and no cookie. Only `POST` is
exported, so other methods answer `405`.

## `GET /dev/unsubscribe-links` (development and test only)

- `notFound()` unless `isFakeAllowed()`.
- The page is a table of every person (archived and private included), ordered by `lower(last_name), lower(first_name), id`.
  Its columns are: Name, Page link (an `<a>` to it), `List-Unsubscribe`, `List-Unsubscribe-Post`, all three from
  `unsubscribeLinksFor`. It uses the `outside` layout, with the label
  `// UNSUBSCRIBE LINKS · DEVELOPMENT AND TEST ONLY`, like `/dev/fake-google`.

## Domain functions

`src/server/records/unsubscribe-rules.ts` (pure):

- `isTokenShape(s: string): boolean`: true when `s` matches `/^[0-9a-f]{64}$/`.
- `unsubscribeLinks(baseUrl: string, token: string): UnsubscribeLinks`. It returns:
  - `pageUrl` = `${base}/unsubscribe/${token}`;
  - `listUnsubscribe` = `<${base}/unsubscribe/${token}/one-click>`;
  - `listUnsubscribePost` = `"List-Unsubscribe=One-Click"`.

  `base` has its trailing slashes removed.
- `isOneClickBody(form: URLSearchParams | FormData): boolean`: true when `get("List-Unsubscribe") === "One-Click"`.

`src/server/records/unsubscribe.ts` (database):

- `unsubscribeByToken(token, via: "link" | "mail_app"): Promise<"done" | "not_found">`. It runs in one
  `sql.begin`: `update … where unsubscribe_token = $1 and consent = 'subscribed' returning id`, then
  `recordEvent(db, { personId, kind: via === "link" ? "unsubscribed_link" : "unsubscribed_mail_app", actorId: null })`.
  When no row is updated, it checks whether the token exists. It does not change `version`, and it sends no
  notification. A database error is thrown.
- `unsubscribePageState(token): Promise<"ready" | "done" | "not_found" | "error">`. It is read-only and catches
  database errors.
- `unsubscribeLinksFor(personId: number): Promise<UnsubscribeLinks | null>`. This is **the** function for campaign
  sending (FR-012). It reads `unsubscribe_token` for the id, returns `null` when there is no such person, and builds
  the links on `appBaseUrl()`.
- `listUnsubscribeLinks(): Promise<{ id: number; name: string; links: UnsubscribeLinks }[]>`. It is only for the dev
  page, and is called only after `isFakeAllowed()`.

## Person edit (changed, `src/server/records/people.ts`)

The edit form (`PersonForm.tsx`, edit mode only) sends a hidden `consentShown` with the Consent value of `initial`
(the value the form was opened with; not `state.values`, so it survives a refused save). `personFormFromData` reads
it as `consentShown` (empty when absent; the field is optional on `PersonForm`, so create and imports are unchanged). In `updatePerson`:

```ts
consent: form.consent !== "" && (form.consentShown ?? "") !== "" && form.consent !== form.consentShown
  ? value.consent      // the teammate changed the field on this form
  : current.consent,   // otherwise keep what is stored (FR-019)
```

When `before.consent !== after.consent`, the edit writes
`recordEvent(db, { personId: id, kind: "consent_changed", actorId, oldValue: CONSENT_LABELS[before.consent], newValue: CONSENT_LABELS[after.consent] })`.
"Consent" is then left out of that save's `edited` field list. When Consent was the only change, no `edited` line is
written.

## Messages (`src/server/messages.ts`)

`messages`:

- `unsubscribe_lead`: "Stop receiving campaign emails from Barnacle Labs."
- `unsubscribe_done`: "You're unsubscribed. You won't get any more campaign emails from us."
- `unsubscribe_invalid`: "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed."
- `unsubscribe_error`: "Something went wrong. Try again in a minute."

`templates`:

- `unsubscribed_link_event`: "Unsubscribed from campaigns through the unsubscribe link"
- `unsubscribed_mail_app_event`: "Unsubscribed from campaigns through their mail app"
- `consent_changed_event(from, to)`: `Consent: ${from} → ${to}`. `Timeline.tsx` follows it with `by(actorName)`.
