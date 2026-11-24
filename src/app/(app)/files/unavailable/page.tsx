// Where a file address lands when it gives no file (SF-116 contracts/routes.md § Routes): a fixed message for the
// reason code (hidden → "doesn't exist or you can't see it", gone → "doesn't exist any more", unreachable → "can't be
// reached"; anything else → hidden) and a link home. Nothing from the address is shown.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";

const REASONS = { hidden: "file_not_found", gone: "file_gone", unreachable: "files_unreachable" } as const;

export default async function FileUnavailable({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const reason = (await searchParams).reason;
  const code = typeof reason === "string" && Object.hasOwn(REASONS, reason) ? REASONS[reason as keyof typeof REASONS] : "file_not_found";
  return (
    <div className="empty">
      <h1>{messages[code]}</h1>
      <Link className="btn" href="/">
        [ HOME ]
      </Link>
    </div>
  );
}
