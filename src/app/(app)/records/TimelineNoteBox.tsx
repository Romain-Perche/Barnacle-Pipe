// The note box of a record page (SF-102 design B), first in the right column above // NEXT ACTIVITIES, // FILES and
// // TIMELINE (SF-127 FR-015; it was the top of RecordTimeline). Not on archived records; never in the deal drawer.
import { mentionCandidates, type NoteTarget } from "@/server/records/notes";
import { addNote } from "./note-actions";
import { NoteBox } from "./NoteBox";
import { targetId, targetKind } from "./note-target";

export async function TimelineNoteBox({ viewerId, target, archived }: { viewerId: number; target: NoteTarget; archived: boolean }) {
  if (archived) return null;
  const candidates = await mentionCandidates(viewerId, target);
  return (
    <section aria-label="Add a note" className="notecol">
      <NoteBox action={addNote} target={targetKind(target)} targetId={targetId(target)} candidates={candidates} />
    </section>
  );
}
