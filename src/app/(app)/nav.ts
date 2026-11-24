// REGISTRY of the sidebar links. A later feature adds one line here for its page:
// mainNav for everyone, adminNav for the "// Admin" group (shown to admins only).
export type NavItem = { href: string; label: string };

export const mainNav: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/deals", label: "Deals" },
  { href: "/people", label: "People" },
  { href: "/organisations", label: "Organisations" },
  // SF-114: the Ambassadors page.
  { href: "/ambassadors", label: "Ambassadors" },
  // SF-109: the Activities list.
  { href: "/activities", label: "Activities" },
  // SF-120: saved segments (campaigns will join them later).
  { href: "/segments", label: "Segments" },
  // SF-102: the layout adds the unread count; SF-108: UnreadLink.tsx keeps it up to date on client navigation.
  { href: "/notifications", label: "Notifications" },
];

export const adminNav: NavItem[] = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/lead-sources-and-labels", label: "Lead sources and labels" },
  { href: "/admin/pipelines", label: "Pipelines" },
  // SF-115: custom fields of people, organisations and deals.
  { href: "/admin/custom-fields", label: "Custom fields" },
];
