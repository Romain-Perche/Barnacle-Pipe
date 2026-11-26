"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { pageToOpen } from "@/server/records/double-click";

// SF-126: a double-click on a card or row (`data-page`) opens the record's page.
export default function OpenOnDoubleClick() {
  const router = useRouter();
  useEffect(() => {
    const onDoubleClick = (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const address = pageToOpen(target);
      if (address) router.push(address);
    };
    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, [router]);
  return null;
}
