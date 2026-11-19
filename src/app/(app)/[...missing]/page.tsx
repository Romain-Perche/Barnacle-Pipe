import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";

// Any address no page matches: "Page not found." inside the app shell.
export default async function Missing() {
  await requireUser();
  notFound();
}
