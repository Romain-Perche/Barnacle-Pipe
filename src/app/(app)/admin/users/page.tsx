// Users page, design A: a table with the actions on each row (spec Clarifications, design-options.html).
// SF-92: a deactivated user's row shows how many private people they own and [ HAND OVER ], which opens the
// design-B panel above the add row (`?handover=<id>`). The panel shows a count, never who the people are.
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { countLabel, formatLastSignIn } from "@/server/format";
import { messageFor, messages, templates } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { listUsers } from "@/server/users";
import { Forbidden } from "../../Forbidden";
import { addUser, deactivate, handOver, makeAdmin, reactivate, removeAdmin } from "./actions";
import { HandOverPanel } from "./HandOverPanel";

const PAGE_ERRORS = new Set(["invalid_domain", "duplicate", "last_admin", "self_deactivate", "handover_choose_user", "handover_not_deactivated"]);
const ID = /^[1-9][0-9]{0,15}$/;

type Props = { searchParams: Promise<{ error?: string; handover?: string }> };

function RowAction({ action, userId, label, red }: { action: (f: FormData) => Promise<void>; userId: number; label: string; red?: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className={red ? "btn link red" : "btn link"}>
        {label}
      </button>
    </form>
  );
}

export default async function UsersPage({ searchParams }: Props) {
  const { user: me, isAdmin } = await requireAdmin();
  if (!isAdmin) return <Forbidden />;

  const { error, handover } = await searchParams;
  const message = error && PAGE_ERRORS.has(error) ? messageFor(error) : undefined;
  const users = await listUsers();
  const admins = users.filter((u) => u.role === "admin" && u.status === "active").length;
  const handoverId = typeof handover === "string" && ID.test(handover) ? Number(handover) : null;
  const from = users.find((u) => u.id === handoverId && u.status === "deactivated" && u.private_people > 0);
  const recipients = users
    .filter((u) => u.status === "active" && u.id !== from?.id)
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  // "Choose an active user." belongs inside the open panel; every other error sits above the table.
  const panelError = from && error === "handover_choose_user" ? message : undefined;
  const pageError = panelError ? undefined : message;
  const flash = await readFlash(["handed_over", "handover_none"]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ADMIN
          </div>
          <h1>Users</h1>
        </div>
        <div className="label">
          {countLabel(users.length, "USER")} · {countLabel(admins, "ADMIN")}
        </div>
      </div>

      {from && (
        <HandOverPanel fromUserId={from.id} fromName={from.name} count={from.private_people} users={recipients} error={panelError} action={handOver} />
      )}

      <form action={addUser} className="addrow">
        <input className="input" name="email" type="text" placeholder="name@barnacle.ai" aria-label="Email address" autoComplete="off" />
        <button className="btn solid" type="submit">
          [ ADD USER ]
        </button>
      </form>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}

      {pageError && (
        <p className="err" role="alert">
          {pageError}
        </p>
      )}

      <table className="users">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last sign-in</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const active = u.status === "active";
            return (
              <tr key={u.id} className={active ? undefined : "off"}>
                <td>
                  {u.name}
                  <span className="em">{u.email}</span>
                </td>
                <td>
                  <span className={u.role === "admin" ? "badge admin" : "badge"}>{u.role === "admin" ? "Admin" : "User"}</span>
                </td>
                <td>
                  {active ? (
                    "Active"
                  ) : (
                    <>
                      <span className="badge off">Deactivated</span>
                      {u.private_people > 0 && <span className="pp">{templates.private_people(u.private_people)}</span>}
                    </>
                  )}
                </td>
                <td>{formatLastSignIn(u.last_sign_in_at)}</td>
                <td className="acts">
                  {active && u.role === "admin" && <RowAction action={removeAdmin} userId={u.id} label="[ REMOVE ADMIN ]" />}
                  {active && u.role === "user" && <RowAction action={makeAdmin} userId={u.id} label="[ MAKE ADMIN ]" />}
                  {active && u.id !== me.id && <RowAction action={deactivate} userId={u.id} label="[ DEACTIVATE ]" red />}
                  {!active && u.private_people > 0 && (
                    <Link className="btn link" href={`/admin/users?handover=${u.id}`}>
                      {messages.handover_button}
                    </Link>
                  )}
                  {!active && <RowAction action={reactivate} userId={u.id} label="[ REACTIVATE ]" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
