# Contract: the Pipedrive calls, the settings, the fake

## Settings (`.env.example`, README § Settings)

| Name | Needed | Meaning |
|---|---|---|
| `PIPEDRIVE_TOKEN_KEY` | to use the Pipedrive import | 32 random bytes, base64 (`openssl rand -base64 32`). Secret, server only. It encrypts saved Pipedrive tokens. When it is empty or invalid, Settings shows "The Pipedrive import isn't set up yet." Changing it makes saved tokens unreadable, and users then save them again. |
| `PIPEDRIVE_URL` | optional | Base address of Pipedrive's API. When it is empty with `APP_ENV` `development`/`test`, the app uses the fake Pipedrive (in process). When it is empty elsewhere, the app uses `https://api.pipedrive.com`. |

`pipedriveConfig()` in `src/server/env.ts` returns:
`{ mode: "real" | "fake"; baseUrl: string; key: Buffer | null }`. `key` is null when it is not set up. It is read at
call time and never at import.

## Calls (`src/server/pipedrive/api.ts`)

Every call is a `GET` with headers `x-api-token: <token>` and `accept: application/json`, and a 10-second timeout.
The token never goes in the URL. Results:

- `200` with `success: true` → the data;
- `401` / `403` → `throw new PipedriveRefused()`;
- `429` → `throw new PipedriveSlowDown(seconds)`. `seconds` comes from `Retry-After`, else `x-ratelimit-reset`, else
  10, kept within 1–300;
- `400` on the persons list with `include_fields` → `PipedriveBadRequest` (the caller asks again once without it);
- anything else, a network error or a timeout → `throw new PipedriveUnreachable()`.

The errors carry no URL, header or body text.

| Function | Request | Read from the answer |
|---|---|---|
| `whoAmI(token)` | `GET {base}/v1/users/me` | `data.id`, `data.name`, `data.company_id`, `data.company_name` |
| `listUsers(token)` | `GET {base}/v1/users` | `data[].id`, `name`, `email` |
| `listFields(token, "person" \| "organization", cursor)` | `GET {base}/api/v2/personFields` / `organizationFields` `?limit=500[&cursor=]` | `data[].field_code`, `field_name`, `field_type`, `is_custom_field`, `options[].id/label`; `additional_data.next_cursor` |
| `listOrganizations(token, { cursor, limit, ids? })` | `GET {base}/api/v2/organizations?limit=&sort_by=id&sort_direction=asc[&cursor=][&ids=1,2]` | `data[]`: `id`, `name`, `owner_id`, `visible_to`, `add_time`, `address.value`, `website`, `industry`, `employee_count`, `custom_fields`, `is_deleted`; `additional_data.next_cursor` |
| `listPersons(token, { cursor, limit, marketing })` | `GET {base}/api/v2/persons?limit=&sort_by=id&sort_direction=asc[&cursor=][&include_fields=marketing_status]` | `data[]`: `id`, `name`, `first_name`, `last_name`, `owner_id`, `org_id`, `add_time`, `emails[]{value,primary,label}`, `phones[]{value,primary,label}`, `visible_to`, `label_ids`, `job_title`, `marketing_status`, `custom_fields`, `is_deleted`; `additional_data.next_cursor` |

Records with `is_deleted: true` are passed over and not counted. Custom field values in `custom_fields[<code>]` are
read as follows: `enum` is an option id; `set` is an array of option ids; `monetary` is `{ value, currency }`; `date` is
`YYYY-MM-DD`; `double`/`int` is a number; `varchar`/`text` is a string. Any other shape is unreadable and gives a
warning. `visible_to`: `1` is owner only (private); anything else is shared.

`usePipedriveFetchForTests(fn | null)` swaps the `fetch` used by these calls. It throws unless `APP_ENV === "test"`.
In fake mode, without a test fetch, the calls go to `fakePipedrive().fetch` in process.

## The fake (`src/server/pipedrive/fake-pipedrive.ts`)

- `class FakePipedrive { fetch(url, init): Promise<Response> }` serves the six calls above for a set of companies:
  `addCompany({ token, user: { id, name, email }, companyId, companyName })`, `addUser`, `addField`,
  `addOrganization`, `addPerson`, `deletePerson`/`deleteOrganization`, and `refuseToken(token)`.
- Failure switches: `slowDownEvery(n, seconds)` (every nth call answers `429` with `Retry-After`), `failNext("network"
  | 500)`, and `noMarketingApp()` (`include_fields=marketing_status` → `400`).
- It pages by cursor (an opaque base64 of the last id), with `limit` ≤ 500 (more than that → `400`) and ids in
  ascending order. `ids` filters. An unknown token → `401`.
- `fakePipedrive()` is the development instance: deterministic data built on first use. Token `fake-pipedrive-token`
  gives user "Fake Person", company "Fakeco Pipedrive" (id 1001), 3 Pipedrive users (one whose email matches no CRM
  user: "Jane Fake", `jane@fake.example`), 60 organisations and 300 people. The data covers every case of the spec:
  several emails and phones, labels, "Job title", "Lead source", "LinkedIn", "Budget" (double), "Favourite colour"
  (varchar), unsubscribed / subscribed / no_consent statuses, owner-only people, a duplicate email, and an
  over-long organisation name. Token `fake-pipedrive-other` gives "Otherco Pipedrive" (id 1002). Any other token is
  refused. All names are clearly fake.

## Test wrapper (`tests/fakes/pipedrive.ts`)

`installFakePipedrive(): FakePipedrive` builds a fresh `FakePipedrive` and installs it with
`usePipedriveFetchForTests`. It checks every request and answer against the pinned schemas:

- `/api/v2/*` against `.factory/schemas/pipedrive_v2_openapi.json` (server path `/api/v2` stripped). The path and method
  must exist. Each query parameter must be declared, and an enum value must be in its enum (for example `sort_by`,
  `include_fields`). `limit` must not exceed the declared maximum. Each property of a `200` answer's `data[]` items and
  `additional_data` must be declared. The `x-api-token` header must be present (the v2 `api_key` scheme).
- `/v1/*` against `.factory/schemas/pipedrive_v1_openapi.yml` (parsed with `yaml`; server path `/v1` stripped): the
  path, the method, the query parameters, and each property of the `200` answer's `data` declared.
- A request or answer the schema does not allow throws, and the test fails. A missing schema file throws too: the
  tests fail and are never skipped.

## Schemas (`scripts/fetch-schemas.mjs`, `.factory/schemas/`)

| file | url | sha256 |
|---|---|---|
| `pipedrive_v2_openapi.json` | `https://raw.githubusercontent.com/soenneker/soenneker.pipedrive.openapiclient/77695f9076c899e2ba1e7e8eb029aabb28abed27/openapi.json` | `0974486d220a6462ea2e7f03acc440f5e6cba215ec875551544c83de685807c2` |
| `pipedrive_v1_openapi.yml` | `https://raw.githubusercontent.com/Zenika/zenpipe/1cb3fb1bab5a5b1b735fccd95b54713c0493b9d4/pipedrive-api/src/main/resources/openapi.yml` | `9d309b9bf5f520b5f4d5ca95baad2660cd8705404b8940b20ab9d6bbba662e01` |

Both were downloaded and checked during planning (2026-11-24).
