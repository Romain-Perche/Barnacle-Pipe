// The notices of a page after an activity action (SF-109): "Activity deleted." (one-shot flash) and the allow-listed
// `?error=` codes of a refused tick, untick or delete. Nothing from the address is shown.
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";

export const ACTIVITY_ERRORS = ["activity_not_found", "activity_record_archived", "activity_conflict", "activity_gone"] as const;

export async function ActivityNotices({ error }: { error: string | undefined }) {
  const flash = await readFlash(["activity_deleted"]);
  const code = ACTIVITY_ERRORS.find((c) => c === error);
  return (
    <>
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {code && (
        <p className="err" role="alert">
          {messages[code]}
        </p>
      )}
    </>
  );
}
