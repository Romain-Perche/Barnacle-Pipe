# Contract: the new Pipedrive calls, the fake and the schemas (SF-122)

The SF-117 rules still apply (`specs/sf-117-…/contracts/pipedrive-api.md`):
- plain `fetch` through `get()` in `src/server/pipedrive/api.ts`;
- the token in `x-api-token` only, never in an address;
- a 10-second time-out (20 seconds for a download);
- `success: true` required on JSON answers;
- 401 / 403 → `PipedriveRefused`, 429 → `PipedriveSlowDown(retrySeconds)`, 400 → `PipedriveBadRequest`, any other
  non-200 or network error → `PipedriveUnreachable`.

Every function reads with the existing `num` / `str` / `list` / `obj` helpers, so a missing or odd field never throws.

## Calls (all GET)

| Function | Address and query | Returns |
|---|---|---|
| `listFields(token, "deal", cursor)` | `/api/v2/dealFields?limit=500&cursor` | `Page<PdField>` (existing function, new kind) |
| `listPipelines(token, cursor)` | `/api/v2/pipelines?limit=500&cursor&sort_by=id&sort_direction=asc` | `Page<{ id, name, order: order_nr, deleted: is_deleted }>` |
| `listStages(token, cursor)` | `/api/v2/stages?limit=500&cursor&sort_by=id&sort_direction=asc` | `Page<{ id, pipelineId: pipeline_id, name, order: order_nr, deleted: is_deleted }>` |
| `listDeals(token, { archived, cursor, limit })` | `/api/v2/deals` or `/api/v2/deals/archived`, `limit`, `cursor`, `sort_by=id`, `sort_direction=asc`, `include_fields=followers_count,participants_count` | `Page<PdDeal>` |
| `dealFollowers(token, dealId)` | `/api/v2/deals/{id}/followers?limit=500&cursor` (all pages, at most 5) | `number[]` (Pipedrive user ids) |
| `dealParticipants(token, dealId)` | `/v1/deals/{id}/participants?start&limit=500` (all pages, at most 5) | `{ personId, name }[]`, where `personId` = `person_id.value`, else `person_id` if a number, else `id` |
| `listActivities(token, { cursor, limit })` | `/api/v2/activities`, `limit`, `cursor`, `sort_by=id`, `sort_direction=asc` | `Page<PdActivity>` |
| `listActivityTypes(token)` | `/v1/activityTypes` | `{ key: key_string, name }[]` |
| `listNotes(token, { start, limit })` | `/v1/notes?start&limit&sort=id ASC` | `{ items: PdNote[]; next: number \| null }` (`additional_data.pagination.next_start` when `more_items_in_collection`) |
| `listFiles(token, { start, limit })` | `/v1/files?start&limit&sort=id ASC` | `{ items: PdFile[]; next: number \| null }` |
| `downloadFile(token, id, maxBytes)` | `/v1/files/{id}/download`, `redirect: "manual"` | `{ bytes: Uint8Array }`, `"gone"` (404 / 410) or `"too_large"` (more than `maxBytes` read: the read stops there) |

`downloadFile` rules:
- A 3xx with a `Location` is followed **once**, with no `x-api-token` header, and still `redirect: "manual"`.
- 401 / 403 / 429 are handled as above.
- A body is read with a byte cap (`MAX_FILE_BYTES + 1`).

```ts
type PdDeal = {
  id: number; title: string; ownerId: number | null; personId: number | null; orgId: number | null; stageId: number | null;
  value: number | null; currency: string; addTime: string; updateTime: string; stageChangeTime: string;
  status: string; lostReason: string; visibleTo: number | null; wonTime: string; lostTime: string; closeTime: string;
  expectedCloseDate: string; labelIds: number[]; archived: boolean; deleted: boolean;
  followersCount: number | null; participantsCount: number | null; custom: Record<string, unknown>;
};
type PdActivity = {
  id: number; subject: string; type: string; ownerId: number | null; deleted: boolean; addTime: string; updateTime: string;
  dealId: number | null; leadId: string; personId: number | null; orgId: number | null; projectId: number | null;
  dueDate: string; dueTime: string; duration: string; done: boolean; doneTime: string; note: string;
};
type PdNote = {
  id: number; active: boolean; addTime: string; content: string; dealId: number | null; personId: number | null;
  orgId: number | null; leadId: string; userId: number | null;
};
type PdFile = {
  id: number; active: boolean; addTime: string; name: string; size: number | null; userId: number | null;
  dealId: number | null; personId: number | null; orgId: number | null; leadId: string; mailMessageId: string;
  remoteLocation: string;
};
// PdFile.name = `name` when not empty, else `file_name`.
```

## The fake (`src/server/pipedrive/fake-pipedrive.ts`)

Per company, beside SF-117's users, fields, organisations and persons:
- `dealFields`, `pipelines`, `stages`, `deals` (with `is_archived`), `followers` (deal id → user ids), `participants`
  (deal id → person ids), `activities`, `activityTypes`, `notes`, `files` (metadata and bytes).
- Seeding helpers: `addPipeline`, `addStage`, `addDeal`, `addNote`, `addActivity`, `addFile(meta, bytes)`, with the
  existing defaults pattern. `deleteDeal` / `deleteNote` / `deleteActivity` / `deleteFile` serve the "deleted between
  two parts" tests.
- It answers the new addresses:
  - v2 lists page by cursor (base64 of the last id), as for persons. `/deals` leaves out archived deals and
    `/deals/archived` serves only them. `include_fields` adds `followers_count` / `participants_count`. Deleted
    records are left out.
  - v1 lists page by `start` / `limit` with `additional_data.pagination` (`start`, `limit`, `more_items_in_collection`,
    `next_start`) and honour `sort=id ASC`. `limit` > 500 → 400.
  - `/v1/files/{id}/download` answers 200 `application/octet-stream` with the bytes, 404 for an unknown or removed
    file. With `redirectDownloads(true)` it answers 302 to `https://files.fake-pipedrive.invalid/<id>`, which the same
    fake serves only when **no** `x-api-token` header is sent (else 400, so a leaked token fails the test).
- `slowDownEvery`, `failNext` and the 401 rules apply to every new address, the download too.

The development instance (`fakePipedrive()`, tokens `fake-pipedrive-token` / `fake-pipedrive-other`) gets a small set
for trying the screens by hand:
- 2 pipelines ("Fake Sales", "Fake Partners") with 4–5 stages;
- 30 deals (open, won, lost, one owner-only, one in USD, one archived);
- 40 notes (one with HTML and a mention, one on a lead);
- 30 activities (each type, done and planned, a "deadline");
- 6 files (a PDF, a PNG, a 26 MB one built from a repeated byte, an empty one, a Drive link, an email attachment).

Every name is clearly fake ("… Fake", `@fake.example`).

## Schemas

`scripts/fetch-schemas.mjs` gains a third Pipedrive entry, and its head comment names it:

| file | url | sha256 |
|---|---|---|
| `pipedrive_v1_full_openapi.yml` | `https://raw.githubusercontent.com/konfig-sdks/openapi-examples/161ab49c45e45825ca3832945c59a3ba904321ba/pipedrive/openapi.yaml` | `24230787d0c71b1e528a2824e8aa6d3137db26aa57973e65f3819b1fce825665` |

`tests/fakes/pipedrive-schema.ts`: `PIPEDRIVE_V1_FULL_PATH` and `loadPipedriveV1Full()`.

`tests/fakes/pipedrive.ts`:
- A `/v1/*` request is checked against `pipedrive_v1_openapi.yml` when that file declares the path and method, else
  against `pipedrive_v1_full_openapi.yml`. The file name goes in the error text.
- A 200 answer whose content type is not JSON (the download) is checked only for status and content type (the operation
  must declare that content type), never parsed.
- A request to `files.fake-pipedrive.invalid` is not schema-checked, but fails if it carries `x-api-token`.
- `tests/unit/fetch-schemas.test.ts` checks that the new file has `paths["/deals/{id}/participants"]` and
  `paths["/files/{id}/download"]`.
