"use client";
// SF-108: the sidebar's Notifications link. The shared layout is not rendered again on client navigation, so after
// every navigation (a new address, or a click on a link to the page already open) the count is asked again
// (`currentUnread`). The layout's count (full load, refresh, revalidation) is the start value: the layout gives a new
// `key` on each render, so a fresh layout always wins. A reply that arrives after a newer request is dropped.
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUnread } from "./notifications/actions";
import { SidebarLink } from "./SidebarLink";

export function UnreadLink({ href, label, initial }: { href: string; label: string; initial: number }) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const latest = useRef(0);
  const shown = useRef(`${pathname}?${search}`);

  const update = useCallback(() => {
    const mine = ++latest.current;
    void currentUnread().then((n) => {
      if (mine === latest.current) setCount(n);
    });
  }, []);

  useEffect(() => {
    const at = `${pathname}?${search}`;
    if (at === shown.current) return;
    shown.current = at;
    update();
  }, [pathname, search, update]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = new URL(a.href);
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) update();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [update]);

  return <SidebarLink href={href} label={label} count={count} />;
}
