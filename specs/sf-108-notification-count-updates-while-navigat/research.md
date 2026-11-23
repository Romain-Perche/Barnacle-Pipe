# Research: Notification count updates while navigating (SF-108)

Sources: the Next.js 16.4.6 docs shipped in `node_modules/next/dist/docs/` (glossary "Client Cache",
`next-config-js/staleTimes.md`, `file-conventions/parallel-routes.md`, `functions/use-router.md`) and the current code
(`src/app/(app)/layout.tsx`, `SidebarLink.tsx`, `src/server/notifications.ts`).

## 1. Why the count is stale today

- Decision: the cause is Next's partial rendering plus the client cache, not caching of the query.
- Rationale: `layout.tsx` already has `dynamic = "force-dynamic"` and reads the count per request, but
  `staleTimes.md` says "shared layouts won't automatically be refetched on every navigation, only the page segment
  that changes", and the glossary says pages "are reused during browser back/forward navigation". The `(app)` layout
  is shared by every signed-in page, so after the first load it is only re-rendered by a full load or an action that
  calls `revalidatePath("/", "layout")` (opening a notification, marking all read, saving a note).

## 2. Where to work out the count: a parallel route slot

- Decision: render the Notifications link from a parallel route slot `src/app/(app)/@unread/` with `page.tsx` (for
  `/`), `[...path]/page.tsx` (every other URL) and `default.tsx`; the layout places the slot where the link was.
- Rationale: a slot's matching page is a leaf segment; on a soft navigation the server renders it again for the new
  URL (parallel-routes.md: "changing the subpage within the slot"), and leaf pages are always rendered (pages are not
  kept in the client cache: `staleTimes.dynamic` defaults to 0). The catch-all makes it match every URL, so it never
  keeps an old subpage. The count then comes in the same request as the new page: no extra round trip, no client
  fetching code, no API route, and the count is the server's view at the moment the page opens (FR-001), even if the
  link was prefetched earlier (the slot reads cookies, so it is dynamic and not prefetched).
- Same-URL click (US1 scenario 3) and form results (US2-3): a click on the current page's link is a navigation that
  fetches the dynamic page again, which includes the slot's leaf; a server action with `redirect()` or
  `revalidatePath()` returns a fresh tree. **Risk to verify in the e2e test**: if the same-URL click turns out not to
  refetch, Build adds to `SidebarLink` an `onClick` that calls `router.refresh()` when the link is the current page,
  and notes it here.
- Alternatives considered:
  - Client component that fetches the count (server action or route handler) on every `usePathname()` change: an
    extra request per navigation, a visible delay where the old count shows, and it misses same-URL clicks and
    search-param-only changes unless more hooks are added. Rejected.
  - `router.refresh()` on every navigation: re-renders the whole tree twice per click. Rejected (FR-006).
  - Count rendered by every page and pushed into the sidebar via context: touches every page, easy to forget in a
    new page. Rejected.
  - `template.tsx`: re-mounts on navigation but its server output is part of the shared parent segment, so it is not
    re-rendered by the server. Rejected.
  - Polling or push (live updates): out of scope (FR-003).

**Changed during Build (SF-108):** the slot was built and dropped. Two findings in Next.js 16.4.6: (a) the slot's
catch-all must be named `[...missing]` like the `(app)/[...missing]` page, else the build fails with "Ambiguous app
routes"; (b) with it, the e2e test showed stale counts: the server did send the new slot (its response held the new
count) but the client router kept the slot it had (its state tree still named the catch-all value of an earlier URL,
e.g. `organisations/1` while on `/organisations/6`), on sequences such as `/organisations/1` → `/organisations` →
`/organisations/6` → `/people`, more often without a pause between clicks. Built instead: the alternative above, as a
client `UnreadLink.tsx` that keeps the layout's count as start value (new `key` on each layout render, so a full load,
`router.refresh()` or `revalidatePath` always wins) and calls the read-only server action `currentUnread()`
(`requireUser()` first) when the address (path or query) changes and on a click on a link to the page already open;
an older reply arriving after a newer request is dropped. Cost: one small POST per navigation, after the page shows
(the old count can show for that moment).

## 3. Back and forward

- Decision: a client component `RefreshOnHistory` in the layout calls `router.refresh()` on `popstate`.
- Rationale: the glossary and `staleTimes.md` say back/forward restores from the client cache to keep the scroll
  position and avoid layout shift, so neither the layout nor the slot is fetched again. `router.refresh()` asks the
  server for the current route again (layout, slot and page) and keeps client state and scroll; it is one request per
  back/forward. Hash-only history moves (`#entry-…`, `#n-…`) also fire `popstate`; refreshing there is harmless.
- Effect the user sees: after back/forward, the restored page shows its cached content first and then the current
  content and count. A record that became hidden meanwhile is no longer shown after the refresh (see spec
  Clarifications).
- Alternatives considered: a server action that returns only the count on `popstate` (lighter, but a second way of
  producing the count next to the slot, and the page body would stay old); `useRouter().bfcacheId` (only resets
  client state, does not refetch). Rejected.

## 4. Reads and safety

- Decision: keep `unreadCount(userId)` as is (SF-102 rules: own unread mentions on visible records, FR-002); call
  `requireUser()` in the slot. `requireUser()` is wrapped in React `cache`, so the session is looked up once per
  request even though the slot and the page both call it. The catch-all `path` param is never read.
- Opening a page never writes (FR-004): the slot only reads.

## 5. Dependencies, outside services, blueprints

- No new or upgraded package (`dependencies.json` is `[]`).
- Outside services: only the app's own Postgres, as in SF-102 (see plan.md).
- Blueprints: no blueprint index is available in this run; `blueprints.json` from Specify stays `[]`.
