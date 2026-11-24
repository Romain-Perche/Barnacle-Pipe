# Contract: Supabase Storage calls, settings and the fake (SF-116)

Schema: `storage_v0_openapi.json`, Supabase Storage API, pinned at
https://github.com/supabase/supabase/blob/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json
(sha256 `bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311`). The info response is not described there
(only `4XX`); its body follows the Storage server's renderer
(https://github.com/supabase/storage/blob/3e5de789f7bb70085030396e6a048deb86bb73f1/src/storage/renderer/info.ts):
`size`, `content_type` among others.

## Settings (`src/server/env.ts` → `storageConfig()`, read at call time)

| Name | Needed | Meaning |
|---|---|---|
| `SUPABASE_URL` | production (files) | `https://<project>.supabase.co`. Empty + `isFakeAllowed()` → the fake. Empty otherwise → every file call answers `files_unreachable`; the rest of the app works. |
| `SUPABASE_SECRET_KEY` | with `SUPABASE_URL` | Supabase secret key (or legacy `service_role` key). Secret, server only, never sent to the browser. |
| `FILES_BUCKET` | optional | Bucket name, default `crm-files`. |

Every server call sends `authorization: Bearer <key>` and `apikey: <key>`. Base: `<SUPABASE_URL>/storage/v1`.
Time-out 10 s per call (`AbortSignal.timeout(10_000)`); a network error, time-out or `5xx` → `StorageUnreachable`.

## Bucket setup (once, by a person, documented in the README "Files" section)

A **private** bucket `crm-files` (Public off), file size limit **25 MB** (26214400), no allowed-types list, and no
Storage policies for `anon`/`authenticated` (only the secret key reaches it, like the database's RLS-with-no-policies
rule). The app never creates or changes buckets.

## Operations (`src/server/files/storage.ts`)

| Function | Request | Used answer |
|---|---|---|
| `createSignedUploadUrl(path)` | `POST /object/upload/sign/{bucket}/{path}` (no body, no `x-upsert`) | `200 { url }` → absolute `<SUPABASE_URL>/storage/v1` + `url` (the `token` is inside it) |
| (browser) | `PUT <that url>` with header `content-type`, body = the file | `200 { Key }`; `400/409` (exists, too big) → failed |
| `objectInfo(path)` | `GET /object/info/authenticated/{bucket}/{path}` | `200 { size, content_type }`; `400/404` "not found" → `null` |
| `readHead(path, n)` | `GET /object/authenticated/{bucket}/{path}` with `range: bytes=0-<n-1>` | `200`/`206` body, first `n` bytes kept (read at most `n` bytes, then cancel the stream) |
| `signedUrl(path, { download?: string })` | `POST /object/sign/{bucket}/{path}` `{ "expiresIn": 60 }` | `200 { signedURL }` → absolute `<SUPABASE_URL>/storage/v1` + `signedURL`, plus `&download=<encodeURIComponent(name)>` when downloading |
| `removeObjects(paths)` (≤ 100) | `DELETE /object/{bucket}` `{ "prefixes": [...] }` | `200` array of removed objects; any `200` counts as done for every path (absent ones are already gone) |

`{path}` is `files/<uuid>`: only `[0-9a-f-/]`, never URL-encoded data from a user.

## The fake (`src/server/files/fake-storage.ts`)

`new FakeStorage({ store, baseUrl, key, now? })`, `fetch(input, init) → Promise<Response>` implementing exactly the
five server operations above plus `PUT /object/upload/sign/...?token=` and `GET /object/sign/...?token=[&download=]`:

- Server operations require the configured key in `authorization` and `apikey` (`400 { statusCode: "403", error: "Unauthorized" }` otherwise, as Storage answers).
- Tokens: HMAC-SHA256 over `{ url: "<bucket>/<path>", exp, upsert: false }` with a per-process random secret; a token
  is valid for its path only; download tokens expire after `expiresIn`, upload tokens after 2 hours.
- Upload `PUT`: refuses an existing object (`409`, "The resource already exists"), a body over 26214400 bytes
  (`413`), keeps the body and the request's `content-type`.
- Signed `GET`: the stored bytes with the stored `content-type`; with `download` → `content-disposition:
  attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded>`; expired or wrong token → `400` "InvalidJWT".
- `range` on the authenticated `GET`: answers `206` with the asked bytes.
- Info / delete as in the table.
- Store: `MemoryStore` (tests) or `DiskStore(".fake-storage")` (development; one file per object plus a `.json` with
  the content type). Used when `isFakeAllowed()` and `SUPABASE_URL` is empty; `baseUrl` is
  `<appBaseUrl()>/dev/fake-storage` so the browser reaches it through `src/app/dev/fake-storage/[...path]/route.ts`,
  which forwards the request to the same `FakeStorage` (`404` unless `isFakeAllowed()`).

`tests/fakes/storage.ts` (`StorageFake`): installs a `FakeStorage` over a `MemoryStore` as the storage module's fetch
(test-only hook `useStorageFetchForTests(fn)`, which throws unless `APP_ENV=test`), and checks every request against
`.factory/schemas/storage_v0_openapi.json` — the path matches one of the schema's paths, the method exists on it,
query parameters and JSON body properties are declared (with their types and `required`), and each JSON response's
properties are in the schema's `200` response. Switches: `down()` (every call → network error), `failDeletes()`,
`objects()` (for byte-for-byte checks).

`scripts/fetch-schemas.mjs` downloads the second schema the same way (a list of `{ file, url, sha256 }`; the URL above
as `raw.githubusercontent.com/supabase/supabase/aa0fb9e84b9d128342f0127c7650d8cc5b240202/apps/docs/spec/storage_v0_openapi.json`).
