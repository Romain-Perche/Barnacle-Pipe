// The notices of a person's or organisation's page after a note action (SF-102): "Note deleted." (one-shot flash)
// and the allow-listed `?error=` codes. Nothing from the address is shown.
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";

const ERRORS = ["note_not_found", "note_record_archived"] as const;

export async function NoteNotices({ error }: { error: string | undefined }) {
  const flash = await readFlash(["note_deleted"]);
  const code = ERRORS.find((c) => c === error);
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
