# Contract: changed pages, the handover action, notices and messages

Changes to `specs/sf-90-people-and-organisations/contracts/routes.md`; everything not listed stays as it is.
"Visible" now means: not private, or the viewer is the creator or the owner.

## Pages

| Path | Access | Change |
|---|---|---|
| `/people` | signed in | Also shows the `crm_flash` notice `person_no_longer_visible`: "You can no longer see <name>: only their creator and owner can." |
| `/people/[id]` | signed in, visible | Timeline: "Handed to <new owner> by <admin>" with date and time. |
| `/people/[id]/edit` | signed in, visible | "Private (only the creator and the owner can see this person)" shown to the creator **and** the owner. |
| `/organisations/[id]` | signed in | Timeline: an event about a deleted person reads "A deleted person was linked by <user>" / "A deleted person was unlinked by <user>", plain text, original date and time. Events about a person private when deleted are gone. |
| `/admin/users` | admin (`requireAdmin()`; others see "You don't have access to this page.") | Deactivated user with ≥ 1 private person: "1 private person" / "N private people" after the Deactivated badge, and `[ HAND OVER ]` (link to `/admin/users?handover=<id>`) before `[ REACTIVATE ]`. Active users and deactivated users with none: neither. |
| `/admin/users?handover=<id>` | admin | When `<id>` (`^[1-9][0-9]{0,15}$`) is a deactivated user with ≥ 1 private person: the hand-over panel above the add row (design B). Otherwise the page as usual. |

### Hand-over panel (`HandOverPanel`, design B)

- Question line: empty until a user is chosen; then "Hand <from>'s N private people to <chosen>?"
  ("1 private person" for one).
- `<select name="toUserId">`: first option "Choose a user" (value ""), then active users except `<from>`
  (the signed-in admin included), by name.
- `[ HAND OVER ]` (submits), `[ CANCEL ]` (link to `/admin/users`, nothing changes).
- Explanation: "They stay private. <chosen> becomes their owner and can see them. You will not see who they
  are." — before a choice: "They stay private. The user you choose becomes their owner and can see them. You
  will not see who they are."
- `?error=handover_choose_user` shows "Choose an active user." inside the panel.
- Never shows names, emails or any other detail of the people.

## Server actions

### `src/app/(app)/people/actions.ts`

| Action | Change |
|---|---|
| `updatePerson(prev, form)` | `private` accepted from the creator or the current owner. Result `saved` with `visible: false` → `crm_flash {code: "person_no_longer_visible", name}`, redirect `/people`. |
| `deletePerson(form)` | Unchanged contract; organisation events about the person kept anonymously (removed when the person was private). |

### `src/app/(app)/admin/users/actions.ts` — NEW `handOver(formData)`

Input: `userId` (deactivated user), `toUserId`. First `assertAdminForAction()` (a non-admin is redirected to
`/admin/users`, which shows "You don't have access to this page."; nothing changes). `toUserId` empty or not
an id → redirect `/admin/users?handover=<userId>&error=handover_choose_user`. Then
`handOverPrivatePeople(actor.id, userId, toUserId)` (re-checks everything, data-model.md § Handover):

| Result | Response |
|---|---|
| `handed` (count, toName) | `crm_flash {code: "handed_over", name: toName, count}`; redirect `/admin/users` → "N private people handed to <name>." |
| `none` (fromName) | `crm_flash {code: "handover_none", name: fromName}`; redirect `/admin/users` → "<from> has no private people to hand over." |
| `choose_user` | redirect `/admin/users?handover=<userId>&error=handover_choose_user` |
| `not_deactivated` | redirect `/admin/users?error=handover_not_deactivated` |
| `forbidden` | redirect `/admin/users` (Forbidden page) |

Then `revalidatePath("/admin/users")` and `revalidatePath("/people")`.

## Flash codes (`src/server/records/flash.ts`)

`person_deleted`, `organisation_deleted` (unchanged), `person_no_longer_visible` (name),
`handed_over` (name, count 1–10,000), `handover_none` (name). Each page reads only the codes it shows.

## Messages (`src/server/messages.ts`, exact text)

| Code | Kind | Text |
|---|---|---|
| `private_label` | message | Private (only the creator and the owner can see this person) |
| `deleted_person_linked` | message | A deleted person was linked |
| `deleted_person_unlinked` | message | A deleted person was unlinked |
| `handover_choose` | message | Choose a user |
| `handover_choose_user` | message | Choose an active user. |
| `handover_not_deactivated` | message | Only a deactivated user's private people can be handed over. |
| `handover_explain_unchosen` | message | They stay private. The user you choose becomes their owner and can see them. You will not see who they are. |
| `handover_button` | message | [ HAND OVER ] |
| `handover_cancel` | message | [ CANCEL ] |
| `handover_to_label` | message | Hand over to (select's accessible name) |
| `private_people(n)` | template | 1 private person / N private people |
| `handover_question(from, n, to)` | template | Hand <from>'s N private people to <to>? |
| `handover_explain(to)` | template | They stay private. <to> becomes their owner and can see them. You will not see who they are. |
| `handed_over(name, n)` | template | N private people handed to <name>. |
| `handover_none(name)` | template | <name> has no private people to hand over. |
| `handed_over_event(name)` | template | Handed to <name> (the timeline appends " by <admin>") |
| `person_no_longer_visible(name)` | template | You can no longer see <name>: only their creator and owner can. |

Timeline lines append `by(actor)` (" by <name>") exactly as SF-90's lines do.
