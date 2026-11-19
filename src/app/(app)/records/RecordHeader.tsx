// Header of a person's or organisation's page (design C): name, badges, [ EDIT ], [ ARCHIVE ]/[ RESTORE ],
// and [ DELETE ] for admins only (the delete action checks again).
import Link from "next/link";

type Props = {
  kind: "PERSON" | "ORGANISATION";
  name: string;
  sub?: React.ReactNode;
  archived: boolean;
  isPrivate?: boolean;
  editHref: string;
  deleteHref: string | null;
  id: number;
  archive: (fd: FormData) => Promise<void>;
  restore: (fd: FormData) => Promise<void>;
};

export function RecordHeader({ kind, name, sub, archived, isPrivate, editHref, deleteHref, id, archive, restore }: Props) {
  return (
    <div className="page-head">
      <div>
        <div className="label">
          <span className="c">//</span> {kind}
        </div>
        <h1>
          {name}
          {archived && <span className="badge off tag">Archived</span>}
          {isPrivate && <span className="badge tag">Private</span>}
        </h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="head-acts">
        <Link className="btn" href={editHref}>
          [ EDIT ]
        </Link>
        <form action={archived ? restore : archive}>
          <input type="hidden" name="id" value={id} />
          <button className="btn" type="submit">
            {archived ? "[ RESTORE ]" : "[ ARCHIVE ]"}
          </button>
        </form>
        {deleteHref && (
          <Link className="btn danger" href={deleteHref}>
            [ DELETE ]
          </Link>
        )}
      </div>
    </div>
  );
}
