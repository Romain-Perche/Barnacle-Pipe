# Research: SF-126

- **Decision**: one delegated `dblclick` listener in a render-less client component; rows/cards carry `data-page`.
  **Rationale**: tables are server components; making each row a client component costs bundle and complexity.
  **Alternatives**: client `Row` wrapper (heavier); `onDoubleClick` on each `Link` (cards only, rows have many cells);
  delaying the single click to tell clicks apart (rejected: FR-004 forbids delay).
- **Decision**: `router.push`. **Rationale**: same tab, Back works. **Alternative**: `replace` (would drop the list from history).
- **Decision**: links inside a row are skipped by the listener. **Rationale**: FR-006; the browser follows the link itself.
- No outside service involved; no unknowns left.
