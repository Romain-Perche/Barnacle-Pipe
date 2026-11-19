"use client";
// The only client component: highlights the current page's link.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {label}
    </Link>
  );
}
