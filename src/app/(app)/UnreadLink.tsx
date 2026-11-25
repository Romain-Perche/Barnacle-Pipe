"use client";
// SF-108, generalised by SF-118: the sidebar links whose state changes while the user moves around, the Notifications
// count (UnreadLink) and the Settings "!" while Gmail needs reconnecting (SettingsLink). The shared layout is not
// rendered again on client navigation, so after every navigation (a new address, or a click on a link to the page
// already open) the state is asked again (`currentSidebar`), once for both links. The layout's values (full load,
// refresh, revalidation) are the start values: the layout gives a new `key` on each render, so a fresh layout always
// wins. A reply that arrives after a newer request is dropped.
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentSidebar, type SidebarState } from "./notifications/actions";
import { SidebarLink } from "./SidebarLink";

// One request per navigation or click, shared by every live link.
let asked: { key: string; reply: Promise<SidebarState> } | null = null;
function ask(key: string): Promise<SidebarState> {
  if (asked?.key !== key) asked = { key, reply: currentSidebar() };
  return asked.reply;
}

function useSidebar<T>(initial: T, pick: (s: SidebarState) => T): T {
  const [value, setValue] = useState(initial);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const latest = useRef(0);
  const shown = useRef(`${pathname}?${search}`);
  const pickRef = useRef(pick);

  const update = useCallback((key: string) => {
    const mine = ++latest.current;
    void ask(key).then((s) => {
      if (mine === latest.current) setValue(pickRef.current(s));
    });
  }, []);

  useEffect(() => {
    const at = `${pathname}?${search}`;
    if (at === shown.current) return;
    shown.current = at;
    update(`nav:${at}`);
  }, [pathname, search, update]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = new URL(a.href);
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) update(`click:${e.timeStamp}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [update]);

  return value;
}

export function UnreadLink({ href, label, initial }: { href: string; label: string; initial: number }) {
  const count = useSidebar(initial, (s) => s.unread);
  return <SidebarLink href={href} label={label} count={count} />;
}

export function SettingsLink({ href, label, initial }: { href: string; label: string; initial: boolean }) {
  const warn = useSidebar(initial, (s) => s.gmailWarn);
  return <SidebarLink href={href} label={label} warn={warn} />;
}
