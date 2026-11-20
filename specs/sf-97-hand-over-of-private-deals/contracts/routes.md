# Contract: Users page hand-over (changes to SF-92 `contracts/routes.md`)

## `GET /admin/users` (admin only; others see "You don't have access to this page.")

Row of a deactivated user with `private_people + private_deals > 0`:
- status cell: `Deactivated` badge and the counts, e.g. "2 private people · 1 private deal", "1 private deal";
- actions: `[ HAND OVER ]` link to `/admin/users?handover=<id>`.

`?handover=<id>` opens the panel only for such a user. Panel:
- question (after choosing): "Hand <from>'s <N private people> and <M private deals> to <to>?" (non-zero kinds only);
- explanation: "They stay private. <to> becomes their owner and can see them. You will not see what they are."
  (deals included) / SF-92 text with "who they are" (people only).

Never shown to the admin: any deal id, title, value, organisation, person or stage.

## Server action `handOver(formData)` (form fields unchanged: `userId`, `toUserId`)

| Outcome | Redirect | Notice |
|---------|----------|--------|
| handed | `/admin/users` | "<counts joined by ' and '> handed to <to>." |
| nothing to hand over at confirm time | `/admin/users` | "<from> has no private people or deals to hand over." |
| no / inactive recipient | `/admin/users?handover=<id>&error=handover_choose_user` | "Choose an active user." in the panel |
| user not deactivated | `/admin/users?error=handover_not_deactivated` | "Only a deactivated user's private records can be handed over." |
| not an admin | `/admin/users` | "You don't have access to this page." |

Revalidates `/admin/users`, `/people`, `/deals`.

## Flash cookie (`handed_over`)

`{ code: "handed_over", name: <to name from DB>, count: <people>, deals: <deals> }`; rejected unless both
counts are integers in 0..10 000 with a sum ≥ 1 (`deals` missing = 0).
