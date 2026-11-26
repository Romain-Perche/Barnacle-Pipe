# Contract: pages, actions and the background check (SF-128)

## Server actions (`src/app/(app)/settings/actions.ts`)

Both call `requireUser()` first and only ever touch the signed-in user's own connection; neither takes an id from the
form or returns email content or text.

| Action | Does | Answer |
|---|---|---|
| `startPastFetchAction()` | `startPastFetch(user.id, new Date())`: starts a fetch only on a `working` connection with no `running` fetch (data-model.md § State changes); otherwise nothing changes | `redirect("/settings")` (no flash, no query) |
| `runPastFetchPartAction()` | `runPastFetchPartFor(user.id, { now: new Date() })`: one part of the user's own fetch | `{ next: "again" } \| { next: "wait"; seconds: number } \| { next: "stop" }` |

`runPastFetchPartFor` answers `stop` when there is no `running` fetch or the connection is not `working`; `wait` with
the seconds left when Gmail's wait is not over or the part hit a slow-down, `wait` 30 after "can't be reached",
`wait` 5 when another part holds the lease; `again` after a part that left work to do; `stop` after the part that
ended the fetch (the page then shows the end message).

## Settings page (`src/app/(app)/settings/page.tsx`)

- `export const maxDuration = 60;` (a part from the page lasts ≤ 20 s of work plus one 10 s Google call).
- Reads `gmailSettings(user.id)`, which now includes `pastFetch` (data-model.md § Card state).

## Gmail card (`GmailCard.tsx`, design B)

After `<ul className="gm-lines">`, only when the card is connected (`working` or `needs_reconnect`) and Gmail is not off:

```html
<div class="gm-sub" aria-label="Past emails">
  <span class="label"><span class="c">//</span> PAST EMAILS</span>
  <!-- one of: -->
  <form action={startPastFetchAction}><button class="btn" type="submit">[ FETCH PAST EMAILS ]</button></form>
  <span class="gm-run" role="status"><span class="spin" aria-hidden="true"></span>FETCHING…</span>
</div>
<p class="gm-pd">…progress / done…</p>
<p class="gm-pd hint">…explain / leave / last fetched…</p>
<p class="gm-pd err">…paused / unreachable…</p>
```

Which lines show: data-model.md § Card state. `PastFetchRunner` is rendered inside the part while the fetch is running
on a `working` connection. New CSS in `src/app/globals.css` beside the `.gm-*` rules: `.gm-sub` (flex row, label left,
button right, top border `var(--line-soft)`, margin-top 12px, padding-top 10px), `.gm-pd` (14px, margin 6px 0 0),
`.gm-run` (muted, monospace like `.btn`), `.spin` (a small rotating ring; `prefers-reduced-motion: reduce` → no
animation), following `docs/DESIGN.md`.

## `PastFetchRunner.tsx` (client, `src/app/(app)/settings/`)

Props `{ waitSeconds: number }`. One loop while mounted: wait `waitSeconds` (first) or 1 s, call
`runPastFetchPartAction()`, `router.refresh()`, then: `again` → 1 s; `wait` → `seconds`; `stop` → end. A thrown action
→ `router.refresh()` and end. Renders nothing (the card's lines are server-rendered and refreshed). Closing the page
ends the loop; the fetch carries on through the background check.

## Background check (`GET /cron/gmail`, unchanged route)

`runGmailCheck(now)` (src/server/gmail/sync.ts), after its loop over the connections (unchanged), calls
`runPastFetches(now, deadline)` (src/server/gmail/past.ts) with `deadline = started + CHECK_BUDGET_MS`: every
`running` fetch whose connection is `working` and whose `wait_until` is over, oldest `started_at` first, parts back to
back while the deadline allows (one fetch's error never stops the others). Still `CRON_SECRET` only.

## Disconnect and deactivation

`forgetGmailInTx` (src/server/gmail/connections.ts) adds `delete from past_email_fetches where connection_id = <id>`
in its transaction. Nothing else changes in `disconnect` / `users.deactivate`.

## Fake mailbox page (`/dev/fake-gmail`, development and test only, 404 otherwise)

New controls (actions in `src/app/dev/fake-gmail/actions.ts`, guarded like the others):

| Control | Does |
|---|---|
| "Days ago" field on the put-a-message form | the message's `internalDate` is now − days (plus the existing minutes offset) |
| `[ PUT 100 PAST CONVERSATIONS ]` | `putPastMailbox(fake, user, { now })` (data-model.md § Fake mailbox) |
| `[ SLOW DOWN NEXT CALL ]` | `fake.slowDown(30)`: the next Gmail call answers 429 with `Retry-After: 30` |
| `[ GMAIL UNREACHABLE: ON / OFF ]` | `fake.setUnreachable(on)` |
| `[ RUN THE 15-MINUTE CHECK ]` | unchanged; now also carries fetches on |

Done notices are fixed strings in the page's `DONE` map (`past_mailbox`, `slowed`, `unreachable_on`, `unreachable_off`).
