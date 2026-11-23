// The done box of an activity (SF-109 contracts/routes.md § Components): a one-button form that works without
// JavaScript. Ticking on a record page or the deal drawer posts `followup=1`, so "Schedule a follow-up?" opens next.
import { tickActivity, untickActivity } from "./actions";

export function DoneBox({ id, done, back, followup = false }: { id: number; done: boolean; back: string; followup?: boolean }) {
  return (
    <form action={done ? untickActivity : tickActivity} className="doneform">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      {!done && followup && <input type="hidden" name="followup" value="1" />}
      <button type="submit" className={done ? "box done" : "box"} aria-label={done ? "Mark not done" : "Mark done"} aria-pressed={done} />
    </form>
  );
}
