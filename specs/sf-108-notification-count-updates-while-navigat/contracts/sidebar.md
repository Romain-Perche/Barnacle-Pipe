# Contract: the sidebar's Notifications link (SF-108)

Applies to every page under `src/app/(app)/` (every signed-in page).

| How the page is reached | Count shown |
|---|---|
| Full load / reload | `unreadCount(user)` at that request |
| Sidebar link (another page or the current one) | `unreadCount(user)` at that navigation's request |
| Link inside a page (lists, board, record pages, notifications, `[ SHOW MORE ]`) | same |
| Result of a form (server action redirect or revalidate) | same |
| Browser back / forward | cached page first, then `unreadCount(user)` after the `router.refresh()` that follows `popstate` |
| Not-found page inside the layout (`[...missing]`, `notFound()`) | `unreadCount(user)` at that request |
| Session gone | sign-in page (redirect from `requireUser()`); no sidebar |

Rendering (unchanged from SF-102): `n > 0` → link name `Notifications (n)` and badge `n`; `n = 0` → name
`Notifications`, no badge, never "0". The link keeps its place (after Organisations) and `aria-current="page"` on
`/notifications…`.

Routing pieces:

- `src/app/(app)/@unread/page.tsx`, `@unread/[...path]/page.tsx`, `@unread/default.tsx` → `<UnreadLink />`.
- `src/app/(app)/layout.tsx` receives the slot as prop `unread` and renders it in place of the `/notifications` item
  of `mainNav`.
- `src/app/(app)/RefreshOnHistory.tsx`: `popstate` → `router.refresh()`.
