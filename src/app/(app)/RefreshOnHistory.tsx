"use client";
// SF-108: back and forward restore a page from the client cache; fetch it again so the sidebar count is current.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshOnHistory() {
  const router = useRouter();
  useEffect(() => {
    const on = () => router.refresh();
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, [router]);
  return null;
}
