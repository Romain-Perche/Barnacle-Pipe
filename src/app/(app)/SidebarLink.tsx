"use client";
// Highlights the current page's link; `count` (SF-102: unread notifications) shows as a badge from 1.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { templates } from "@/server/messages";

export function SidebarLink({ href, label, count = 0 }: { href: string; label: string; count?: number }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} aria-label={count > 0 ? templates.notifications_label(count) : undefined}>
      {label}
      {count > 0 && <span className="cnt">{count}</span>}
    </Link>
  );
}
