// SF-126: which page a double-click opens. Pure and client-safe (no server imports).
type Anchor = { classList: { contains(name: string): boolean } };
type Row = { getAttribute(name: string): string | null };
export type ClickTarget = { closest(sel: string): unknown };

const ADDRESS = /^\/(deals|people|organisations)\/\d+$/;

export function pageToOpen(target: ClickTarget | null): string | null {
  if (!target) return null;
  const row = target.closest("[data-page]") as Row | null;
  if (!row) return null;
  const link = target.closest("a") as Anchor | null;
  // A name, organisation or person link strictly inside the row keeps its own behaviour; a board card is itself the link.
  if (link && (link as unknown) !== row && !link.classList.contains("cell-link")) return null;
  const address = row.getAttribute("data-page");
  return address && ADDRESS.test(address) ? address : null;
}
