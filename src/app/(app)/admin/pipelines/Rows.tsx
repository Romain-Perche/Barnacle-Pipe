// Rows of the Pipelines admin pages (design A, like Users): rename field + [ RENAME ], [ ↑ ], [ ↓ ], [ DELETE ].
// Plain forms: they work with a keyboard and without JavaScript.
import Link from "next/link";
import { messages, templates } from "@/server/messages";

type Action = (fd: FormData) => Promise<void>;
type Row = { id: number; name: string; href?: string; deals?: number };

function Hidden({ extra }: { extra: Record<string, string | number> }) {
  return (
    <>
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export function AddRow({ label, button, action, extra = {} }: { label: string; button: string; action: Action; extra?: Record<string, string | number> }) {
  return (
    <form action={action} className="addrow">
      <Hidden extra={extra} />
      <input className="input" name="name" type="text" aria-label={label} placeholder={label} autoComplete="off" maxLength={100} />
      <button className="btn solid" type="submit">
        {button}
      </button>
    </form>
  );
}

export function OrderRows({
  rows, rename, move, deleteHref, extra = {},
}: { rows: Row[]; rename: Action; move: Action; deleteHref: (id: number) => string; extra?: Record<string, string | number> }) {
  return (
    <table className="users order">
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="nm">{r.href ? <Link href={r.href}>{r.name}</Link> : r.name}</td>
            <td>
              <form action={rename} className="inline">
                <Hidden extra={{ ...extra, id: r.id }} />
                <input className="input" name="name" type="text" defaultValue={r.name} aria-label={`Name of ${r.name}`} maxLength={100} />
                <button className="btn link" type="submit" aria-label={`Rename ${r.name}`}>
                  [ RENAME ]
                </button>
              </form>
            </td>
            {r.deals !== undefined && <td className="muted">{templates.deal_count(r.deals)}</td>}
            <td className="acts">
              <form action={move}>
                <Hidden extra={{ ...extra, id: r.id, direction: "up" }} />
                <button className="btn link" type="submit" aria-label={`Move ${r.name} up`} disabled={i === 0}>
                  [ ↑ ]
                </button>
              </form>
              <form action={move}>
                <Hidden extra={{ ...extra, id: r.id, direction: "down" }} />
                <button className="btn link" type="submit" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1}>
                  [ ↓ ]
                </button>
              </form>
              <Link className="btn link red" href={deleteHref(r.id)} aria-label={`Delete ${r.name}`}>
                [ DELETE ]
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Delete confirmation (?delete=<id>): a plain one when nothing holds deals, else "<name> has <n> deals. Move them to:"
// with the stages they can go to.
export function DeleteBlock({
  name, id, deals, targets, action, cancelHref, extra = {}, noTarget,
}: {
  name: string; id: number; deals: number; targets: { id: number; name: string; stages: { id: number; name: string }[] }[];
  action: Action; cancelHref: string; extra?: Record<string, string | number>; noTarget: string;
}) {
  const usable = targets.filter((t) => t.stages.length > 0);
  return (
    <div className="confirm" role="alertdialog" aria-label={messages.delete_confirm_label}>
      <form action={action} className="confirm-form">
        <Hidden extra={{ ...extra, id }} />
        {deals === 0 ? (
          <p>{templates.pipeline_delete_confirm(name)}</p>
        ) : usable.length === 0 ? (
          <p>{noTarget}</p>
        ) : (
          <label className="pick">
            <span>{templates.pipeline_has_deals(name, deals)}</span>
            <select className="input sel" name="targetStageId" aria-label="Move the deals to">
              {usable.map((t) => (
                <optgroup key={t.id} label={t.name}>
                  {t.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t.name} · {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {(deals === 0 || usable.length > 0) && (
          <button className="btn danger-solid" type="submit">
            {deals === 0 ? messages.delete_for_good : "[ MOVE DEALS AND DELETE ]"}
          </button>
        )}
      </form>
      <Link className="btn" href={cancelHref}>
        {messages.delete_cancel}
      </Link>
    </div>
  );
}
