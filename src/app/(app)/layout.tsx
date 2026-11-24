// Design B: the shared layout of every signed-in page.
import { Wordmark } from "@/app/Wordmark";
import { requireUser } from "@/server/auth/session";
import { gmailNeedsReconnect } from "@/server/gmail/connections";
import { unreadCount } from "@/server/notifications";
import { signOut } from "./actions";
import { adminNav, footerNav, mainNav } from "./nav";
import { RefreshOnHistory } from "./RefreshOnHistory";
import { SidebarLink } from "./SidebarLink";
import { SettingsLink, UnreadLink } from "./UnreadLink";

// Every signed-in page is rendered per request, whatever the build's settings (previews included).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, gmailWarn] = await Promise.all([unreadCount(user.id), gmailNeedsReconnect(user.id)]);
  return (
    <div className="shell">
      <RefreshOnHistory />
      <aside className="side" aria-label="Sidebar">
        <Wordmark />
        <nav aria-label="Main">
          {mainNav.map((item) =>
            item.href === "/notifications" ? (
              // SF-108: kept up to date on client navigation; a new key on each render of the layout.
              <UnreadLink key={`${item.href}#${crypto.randomUUID()}`} {...item} initial={unread} />
            ) : (
              <SidebarLink key={item.href} {...item} />
            ),
          )}
        </nav>
        {user.role === "admin" && (
          <>
            <div className="grp">
              <span className="slashes">//</span> ADMIN
            </div>
            <nav aria-label="Admin">
              {adminNav.map((item) => (
                <SidebarLink key={item.href} {...item} />
              ))}
            </nav>
          </>
        )}
        <div className="me">
          <div className="n">{user.name}</div>
          {/* SF-117: "Settings" at the bottom, above [ SIGN OUT ]; SF-118: with an orange "!" while Gmail needs reconnecting. */}
          <nav aria-label="You" className="me-nav">
            {footerNav.map((item) =>
              item.href === "/settings" ? (
                <SettingsLink key={`${item.href}#${crypto.randomUUID()}`} {...item} initial={gmailWarn} />
              ) : (
                <SidebarLink key={item.href} {...item} />
              ),
            )}
          </nav>
          <form action={signOut}>
            <button type="submit">[ Sign out ]</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
