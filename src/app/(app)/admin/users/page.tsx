// Users page, design A: a table with the actions on each row (spec Clarifications, design-options.html).
import { requireAdmin } from "@/server/auth/session";
import { countLabel, formatLastSignIn } from "@/server/format";
import { messageFor } from "@/server/messages";
import { listUsers } from "@/server/users";
import { Forbidden } from "../../Forbidden";
import { addUser, deactivate, makeAdmin, reactivate, removeAdmin } from "./actions";

const PAGE_ERRORS = new Set(["invalid_domain", "duplicate", "last_admin", "self_deactivate"]);

type Props = { searchParams: Promise<{ error?: string }> };

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

  const { error } = await searchParams;
  const message = error && PAGE_ERRORS.has(error) ? messageFor(error) : undefined;
  const users = await listUsers();
  const admins = users.filter((u) => u.role === "admin" && u.status === "active").length;

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

      <form action={addUser} className="addrow">
        <input className="input" name="email" type="text" placeholder="name@barnacle.ai" aria-label="Email address" autoComplete="off" />
        <button className="btn solid" type="submit">
          [ ADD USER ]
        </button>
      </form>

      {message && (
        <p className="err" role="alert">
          {message}
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
                <td>{active ? "Active" : <span className="badge off">Deactivated</span>}</td>
                <td>{formatLastSignIn(u.last_sign_in_at)}</td>
                <td className="acts">
                  {active && u.role === "admin" && <RowAction action={removeAdmin} userId={u.id} label="[ REMOVE ADMIN ]" />}
                  {active && u.role === "user" && <RowAction action={makeAdmin} userId={u.id} label="[ MAKE ADMIN ]" />}
                  {active && u.id !== me.id && <RowAction action={deactivate} userId={u.id} label="[ DEACTIVATE ]" red />}
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
