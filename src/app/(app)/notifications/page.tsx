// The Notifications page (SF-102 contracts/routes.md § /notifications): the user's own mentions, newest first,
// 50 at a time; each opens the record and is marked read. Only notifications whose record the user can see now.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { formatDateTime } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { listNotifications } from "@/server/notifications";
import type { Params } from "@/server/records/list-query";
import { parseShown } from "@/server/records/notes-rules";
import { markAllNotificationsRead, openNotification } from "./actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const shown = parseShown((await searchParams).shown);
  const { items, more } = await listNotifications(user.id, shown);
  const unread = items.some((n) => !n.read);
  const last = items[items.length - 1];
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> NOTIFICATIONS
          </div>
          <h1>Notifications</h1>
        </div>
        {unread && (
          <form action={markAllNotificationsRead}>
            <button className="btn" type="submit">
              [ MARK ALL AS READ ]
            </button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <p className="empty">{messages.no_notifications}</p>
      ) : (
        <ul className="notifs" aria-label="Notifications">
          {items.map((n) => (
            <li key={n.eventId} id={`n-${n.eventId}`} className={n.read ? "notif" : "notif unread"}>
              <form action={openNotification}>
                <input type="hidden" name="eventId" value={n.eventId} />
                <button type="submit" className="notif-open">
                  <span className="notif-top">
                    <span className="notif-title">{templates.mentioned_you(n.byName, n.recordName)}</span>
                    {!n.read && <span className="badge new">Unread</span>}
                    <span className="when">{formatDateTime(n.createdAt)}</span>
                  </span>
                  <span className="notif-preview">{n.preview}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {more && last && (
        <div className="more">
          <Link className="btn" href={`/notifications?shown=${shown + 50}#n-${last.eventId}`} scroll={false}>
            [ SHOW MORE ]
          </Link>
        </div>
      )}
    </>
  );
}
