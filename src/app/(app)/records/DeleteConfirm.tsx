// Delete confirmation on a record page (?confirm=delete, admins only). No JavaScript dialog.
import Link from "next/link";
import { messages, templates } from "@/server/messages";

// `back` (deals, SF-95): where the delete returns, read through an allow-list by the action.
export function DeleteConfirm({
  name, id, action, cancelHref, back,
}: { name: string; id: number; action: (fd: FormData) => Promise<void>; cancelHref: string; back?: "list" }) {
  return (
    <div className="confirm" role="alertdialog" aria-label={messages.delete_confirm_label}>
      <p>{templates.delete_confirm(name)}</p>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        {back && <input type="hidden" name="back" value={back} />}
        <button className="btn danger-solid" type="submit">
          {messages.delete_for_good}
        </button>
      </form>
      <Link className="btn" href={cancelHref}>
        {messages.delete_cancel}
      </Link>
    </div>
  );
}
