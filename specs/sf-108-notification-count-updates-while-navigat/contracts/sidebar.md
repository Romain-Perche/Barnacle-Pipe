# Contract: the sidebar's Notifications link (SF-108)

Applies to every page under `src/app/(app)/` (every signed-in page).

| How the page is reached | Count shown |
|---|---|
| Full load / reload | `unreadCount(user)` at that request |
| Sidebar link (another page or the current one) | layout's count first, then `currentUnread()` right after the page shows |
| Link inside a page (lists, board, record pages, notifications, `[ SHOW MORE ]`) | same |
| Result of a form (server action redirect or revalidate) | forms that revalidate: the layout's fresh count; otherwise as links |
| Browser back / forward | cached page first, then `unreadCount(user)` after the `router.refresh()` that follows `popstate` |
| Not-found page inside the layout (`[...missing]`, `notFound()`) | layout's count first, then `currentUnread()` right after the page shows |
| Session gone | sign-in page (redirect from `requireUser()`); no sidebar |

Rendering (unchanged from SF-102): `n > 0` → link name `Notifications (n)` and badge `n`; `n = 0` → name
`Notifications`, no badge, never "0". The link keeps its place (after Organisations) and `aria-current="page"` on
`/notifications…`.

Routing pieces:

- `src/app/(app)/layout.tsx`: computes `unreadCount(user)` and renders `<UnreadLink initial={n} />` in place of the
  `/notifications` item of `mainNav`, with a new `key` on each layout render (a fresh layout count always wins).
- `src/app/(app)/UnreadLink.tsx` (client): starts at `initial`; calls `currentUnread()` when the path or query changes
  and on a click on a link to the page already open; a reply older than the latest request is dropped.
- `currentUnread()` in `src/app/(app)/notifications/actions.ts`: `requireUser()` first, then `unreadCount(user)`; read
  only.
- `src/app/(app)/RefreshOnHistory.tsx`: `popstate` → `router.refresh()`.
