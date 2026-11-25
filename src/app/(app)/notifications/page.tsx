// The Notifications page (SF-102 contracts/routes.md § /notifications): the user's own mentions, newest first,
// 50 at a time; each opens the record and is marked read. Only notifications whose record the user can see now.
// SF-109: activities assigned to the user by someone else are listed with them ("Ada Fake assigned you a call: …").
// SF-123: and the reminders of the user's planned activities from their reminder time ("Call: intro call at 10:00").
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { formatDue, TYPE_LABELS } from "@/server/activities/rules";
import { formatDateTime } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { listNotifications, type NotificationView } from "@/server/notifications";
import type { Params } from "@/server/records/list-query";
import { parseShown } from "@/server/records/notes-rules";
import { markAllNotificationsRead, openNotification } from "./actions";

// The line's id and the [ SHOW MORE ] anchor: n-<event id>, a-<activity id> or r-<activity id>.
function anchorOf(n: NotificationView): string {
  if (n.kind === "mention") return `n-${n.eventId}`;
  return `${n.kind === "assignment" ? "a" : "r"}-${n.id}`;
}

function titleOf(n: NotificationView): string {
  if (n.kind === "mention") return templates.mentioned_you(n.byName, n.recordName);
  if (n.kind === "assignment") return templates.assigned_you(n.byName, n.type, n.subject);
  return templates.reminder_title(TYPE_LABELS[n.type], n.subject, n.dueTime);
}

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
          {items.map((n) => {
            const key = anchorOf(n);
            return (
              <li key={key} id={key} className={n.read ? "notif" : "notif unread"}>
                <form action={openNotification}>
                  <input type="hidden" name="kind" value={n.kind} />
                  <input type="hidden" name="id" value={n.kind === "mention" ? n.eventId : n.id} />
                  <button type="submit" className="notif-open">
                    <span className="notif-top">
                      <span className="notif-title">
                        {titleOf(n)}
                      </span>
                      {!n.read && <span className="badge new">Unread</span>}
                      <span className="when">{formatDateTime(n.createdAt)}</span>
                    </span>
                    <span className="notif-preview">{n.kind === "mention" ? n.preview : templates.activity_due(formatDue(n))}</span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      {more && last && (
        <div className="more">
          <Link className="btn" href={`/notifications?shown=${shown + 50}#${anchorOf(last)}`} scroll={false}>
            [ SHOW MORE ]
          </Link>
        </div>
      )}
    </>
  );
}
