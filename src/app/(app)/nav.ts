// REGISTRY of the sidebar links. A later feature adds one line here for its page:
// mainNav for everyone, adminNav for the "// Admin" group (shown to admins only).
export type NavItem = { href: string; label: string };

export const mainNav: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/deals", label: "Deals" },
  { href: "/people", label: "People" },
  { href: "/organisations", label: "Organisations" },
];

export const adminNav: NavItem[] = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/lead-sources-and-labels", label: "Lead sources and labels" },
  { href: "/admin/pipelines", label: "Pipelines" },
];
