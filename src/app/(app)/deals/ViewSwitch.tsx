// "Board / List" switch at the head of both views of Deals (SF-95 research.md §4); the current one is marked.
import Link from "next/link";

export function ViewSwitch({ current }: { current: "board" | "list" }) {
  return (
    <nav className="view-switch" aria-label="Deals view">
      <Link className="btn" href="/deals" aria-current={current === "board" ? "page" : undefined}>
        [ BOARD ]
      </Link>
      <Link className="btn" href="/deals/list" aria-current={current === "list" ? "page" : undefined}>
        [ LIST ]
      </Link>
    </nav>
  );
}
