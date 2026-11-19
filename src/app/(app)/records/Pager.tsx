// Previous / next page links that keep the list's filters and sort.
import Link from "next/link";

export function Pager({ page, pages, prevHref, nextHref }: { page: number; pages: number; prevHref: string; nextHref: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? (
        <Link className="btn" href={prevHref}>
          [ PREVIOUS ]
        </Link>
      ) : (
        <span />
      )}
      <span className="label">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link className="btn" href={nextHref}>
          [ NEXT ]
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
