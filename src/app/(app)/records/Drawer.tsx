// Preview drawer on the right of a list (?open=<id>), design C. Server-rendered: reload and share keep it.
import Link from "next/link";

export function Drawer({ kind, name, openHref, closeHref, children }: { kind: string; name: string; openHref: string; closeHref: string; children: React.ReactNode }) {
  return (
    <aside className="drawer" aria-label="Preview">
      <div className="label">
        <span className="c">//</span> {kind}
      </div>
      <h2>{name}</h2>
      <dl>{children}</dl>
      <div className="drawer-acts">
        <Link className="btn solid" href={openHref}>
          [ OPEN PAGE ]
        </Link>
        <Link className="btn" href={closeHref} scroll={false}>
          [ CLOSE ]
        </Link>
      </div>
    </aside>
  );
}

export function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children ?? "—"}</dd>
    </>
  );
}
