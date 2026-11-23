# Data model: SF-108

No database change and no migration.

## Unread notification count (derived, read-only)

- Source: `unreadCount(userId)` in `src/server/notifications.ts` (SF-102): rows of `note_mentions` with
  `user_id = userId`, `mentioned_by <> user_id`, `read_at is null`, whose note's record is visible to the user now
  (`visiblePerson` / `visibleDeal`).
- Read when: every time a signed-in page opens — full load, soft navigation (by the `@unread` slot) and back/forward
  (by `router.refresh()`).
- Written by: unchanged — `openNotification`, `markAllRead`, note add/edit/delete (SF-102). Opening a page never writes.
- Shown as: `SidebarLink` with `count`: badge `.cnt` and accessible name `templates.notifications_label(n)` when
  `n > 0`; no badge and name "Notifications" when `n = 0`.
