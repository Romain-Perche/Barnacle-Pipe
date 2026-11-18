# Data Model: Initialize Project for the Factory (SF-76)

This feature has no runtime data. Its "entities" are baseline files. Each entry lists the path, required structure, validation rules and lifecycle. Exact headings are fixed in [contracts/baseline-files.md](contracts/baseline-files.md).

## Constitution

- **Path**: `.specify/memory/constitution.md`
- **Fields**: project name (`Barnacle-Pipe`), principles (≥3, each: number + name, MUST rules, rationale), Factory Run Rules section, Development Workflow section, Governance section, version line (`Version`, `Ratified`, `Last Amended`).
- **Validation**: 0 matches for `\[[A-Z][A-Z0-9_]*\]`; no `<!--` comments; principles cover spec-first, test-first, simplicity (FR-002); no language, framework or platform named.
- **Lifecycle**: `1.0.0` ratified 2026-11-18 → amended only through `/speckit-constitution`, with semantic versioning (MAJOR: principle removed/redefined; MINOR: principle or section added; PATCH: wording). `Ratified` never changes; `Last Amended` updates on each amendment.
- **Read by**: speckit-plan, speckit-analyze, plan-review.

## Test recipe

- **Path**: `.factory/test-env.md`
- **Fields**: `## Services` (one line per outside service: fake, schema, real account wanted), `## Schemas` (file name: URL), `## Real runs` (one line per real-run choice). Optional later sections added by `write-tests`: `## Smoke checks`, `## Docker images`.
- **Validation**: three required headings present once each; each initially has `- None yet.`; tracked by git.
- **Lifecycle**: empty → `write-tests` / `plan-review` / `plan-fix` add lines and remove `- None yet.` from a section once it has a real entry.

## Schema cache

- **Path**: `.factory/schemas/` (not created by this feature)
- **Validation**: ignored by git (`git check-ignore` succeeds for any file inside).
- **Lifecycle**: filled per run by `write-tests` via the factory fetch; never committed.

## Feature pointer

- **Path**: `.specify/feature.json` — already ignored; rule kept as is.

## Agent guidance file

- **Path**: `CLAUDE.md` (repo root)
- **Fields**: repo purpose (Barnacle-Pipe), folder layout (`specs/`, `tests/`, `tests/ai/`, `docs/`, `.factory/`, `.specify/`, `.claude/skills/`), pipeline order, pointers (constitution, test recipe, three product docs), run rules (fresh VM, no earlier session memory, commit but do not push, do not edit factory tooling outside a tooling change).
- **Validation**: answers the 4 orientation questions of SC-004; no product description beyond the name.

## Product documents

- **Paths**: `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`
- **Fields**: title naming Barnacle-Pipe, one-line purpose, `##` sections each with `- None yet.`
- **Validation**: only headings, the purpose line and `- None yet.` entries (SC-006).
- **Lifecycle**: people (or clarify, from people's answers) replace `- None yet.` with real entries.

## Folder READMEs

- **Paths**: `specs/README.md`, `tests/README.md`, `tests/ai/README.md`
- **Fields**: title + purpose (what goes in the folder, naming pattern where one exists: `specs/<branch>/`, `tests/ai/us<N>-<slug>.md`).

## Relationships

```text
CLAUDE.md ──points to──▶ constitution, test recipe, docs/*.md, folder layout
constitution ──governs──▶ every plan.md Constitution Check
test recipe ──names files in──▶ .factory/schemas/ (ignored)
tests/ai/README.md ──describes──▶ tests/ai/us<N>-<slug>.md (written by write-tests)
```
