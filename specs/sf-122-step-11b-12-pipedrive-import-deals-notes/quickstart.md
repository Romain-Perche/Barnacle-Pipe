# Quickstart: validating the Pipedrive import of deals, notes, activities and files (SF-122)

## Prerequisites

- A local Postgres, with the setup from `README.md`.
- `npm run test:schemas` once. It fetches the pinned schemas, including the new `pipedrive_v1_full_openapi.yml`.
- `PIPEDRIVE_URL` empty and `SUPABASE_URL` empty (the fake Pipedrive and the fake file store). `PIPEDRIVE_TOKEN_KEY`
  is set in `.env.local` (README).

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run typecheck
```

Each test names what it covers (`// covers FR-005, US1 scenario 4`).

**Unit (pure)**:
- `htmlToText`: paragraphs, `<br>`, lists, links (same text / different address / `javascript:` dropped), entities,
  mentions, and `<a href="https://evil.example">Click</a>` → "Click (https://evil.example)" as text.
- `ukFromUtc`: GMT and BST, and across midnight.
- `durationMinutes`: "00:07" → 10, "24:00" → 1440, "25:00" → warning.
- `dealFromPipedrive`: each field, GBP and USD, lost with no reason / 501 characters, won and lost dates, owner-only,
  labels and the counting of missing ones.
- `targetOf`: deal > person > organisation, lead and project.
- `planPipelines`: match ignoring case and spaces, created at the end in order, merged warning, a 101-character name.
- `fileCheck`: 0 bytes, 25 MB exactly (allowed), 26.1 MB, a 256-character name, a Drive link, an email attachment.

**Integration (real Postgres, `installFakePipedrive()` plus the Storage fake, both schema-checked)**:
1. US1: the 3-pipeline / 40-deal set of the spec's Independent Test.
   - Board, list and deal page values.
   - The created pipeline and stage, with positions.
   - Stage bar seconds from `stage_change_time`.
   - The `pipedrive_imported` event only.
   - Private deal visibility.
   - Report lines.
   - A non-admin importer creates pipelines, and the admin functions still refuse them.
2. US2:
   - Notes on deal / person / organisation; a deal + person note appears once (on the deal).
   - A note on a person not imported is skipped with its reason; notes on leads are counted.
   - Author fallback and `created_at`.
   - No `note_mentions` row and no notification. Edit and delete through `notes.ts` work.
3. US3:
   - Types, the "deadline" type → task counted.
   - Due date and time in UK time, duration.
   - Done with `done_at` / `done_by`; Last contacted raised (never lowered).
   - No assignment notification (`notifications.ts` unread count unchanged for the assignee).
   - A card line from `cardLine`.
   - Skipped when the deal is not imported; unlinked when on nothing.
4. US4:
   - The bytes in the fake Storage equal Pipedrive's; `kind`, `added_at` and the FILE event date.
   - The 26 MB file is not stored and the Storage object count is unchanged.
   - The redirecting download never sends the token.
   - Storage off at start → `files_unreachable`, no import row.
   - Storage failing mid-part → paused `files_unreachable`, `file_cleanup` holds the path, no `files` row; after
     `[ CONTINUE ]` exactly one file.
5. US5:
   - The large set, scaled down to keep the test fast (300 people, 80 organisations, 200 deals, 1,000 notes, 800
     activities, 30 files) with `slowDownEvery(7)`.
   - Stop after a few parts, continue, finish, run again: every kind once, the counts equal the fake's records minus
     those not imported, and a second run counts all as already imported.
   - Two users of one company importing at once (interleaved parts) → one record each.
   - A note skipped for a missing person is imported by a later run once the person can be imported.
6. Edge cases: a deal deleted in Pipedrive between parts (no line), a deal deleted in the CRM (its notes give "Its
   deal was deleted in the CRM."), a private linked person (notes counted, not named), and an HTML file name shown as
   text.
7. `migrate.test.ts`: the new columns and constraints.

## By hand (development)

1. `npm run dev`, sign in with the fake Google, open Settings and save the token `fake-pipedrive-token`.
2. Open Import from Pipedrive and tick Files. People and Organisations become ticked and locked. Untick Files: they can
   be unticked again. The emails note is shown.
3. Tick all six, choose a consent, then `[ IMPORT ]`. Six progress lines appear in order.
4. On the report:
   - "Pipeline 'Fake Partners' added with 5 stages."
   - The USD warning and the 26 MB file "Over 25 MB (26.1 MB)."
   - "… 'deadline' activities imported as tasks."
   - "… notes on Pipedrive leads: not imported."
5. Open `/deals`: both pipelines with their deals and the next-activity lines. Open `/activities`: planned ones. Open a
   deal page: the stage bar, NOTE and FILE entries at Pipedrive's dates, and a file that previews and downloads.
6. `[ NEW IMPORT ]` with the same choices: everything is "already imported".
