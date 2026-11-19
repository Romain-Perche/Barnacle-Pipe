// Delete confirmation on a record page (?confirm=delete, admins only). No JavaScript dialog.
import Link from "next/link";

export function DeleteConfirm({ name, id, action, cancelHref }: { name: string; id: number; action: (fd: FormData) => Promise<void>; cancelHref: string }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm delete">
      <p>Delete {name} for good? This can&apos;t be undone.</p>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button className="btn danger-solid" type="submit">
          [ DELETE FOR GOOD ]
        </button>
      </form>
      <Link className="btn" href={cancelHref}>
        [ CANCEL ]
      </Link>
    </div>
  );
}
