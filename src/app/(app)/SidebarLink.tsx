"use client";
// Highlights the current page's link; `count` (SF-102: unread notifications) shows as a badge from 1; `warn` (SF-118:
// Gmail needs reconnecting) shows an orange "!" on the Settings link.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { messages, templates } from "@/server/messages";

export function SidebarLink({ href, label, count = 0, warn = false }: { href: string; label: string; count?: number; warn?: boolean }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} aria-label={count > 0 ? templates.notifications_label(count) : undefined}>
      {label}
      {count > 0 && <span className="cnt">{count}</span>}
      {warn && (
        <span className="warn" role="img" aria-label={messages.gmail_settings_warn} title={messages.gmail_settings_warn}>
          !
        </span>
      )}
    </Link>
  );
}
