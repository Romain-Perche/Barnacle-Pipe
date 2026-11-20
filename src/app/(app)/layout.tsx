// Design B: the shared layout of every signed-in page.
import { Wordmark } from "@/app/Wordmark";
import { requireUser } from "@/server/auth/session";
import { unreadCount } from "@/server/notifications";
import { signOut } from "./actions";
import { adminNav, mainNav } from "./nav";
import { SidebarLink } from "./SidebarLink";

// Every signed-in page is rendered per request, whatever the build's settings (previews included).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await unreadCount(user.id);
  return (
    <div className="shell">
      <aside className="side" aria-label="Sidebar">
        <Wordmark />
        <nav aria-label="Main">
          {mainNav.map((item) => (
            <SidebarLink key={item.href} {...item} count={item.href === "/notifications" ? unread : 0} />
          ))}
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
          <form action={signOut}>
            <button type="submit">[ Sign out ]</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
