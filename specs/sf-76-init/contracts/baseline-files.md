# Contract: Baseline Files

The interface this feature exposes is a set of files that factory skills and people read. This contract fixes paths and required headings; prose wording is free as long as it stays within the rules.

Legend: **must** = checked by [quickstart.md](../quickstart.md); `- None yet.` is the literal empty marker.

## `.specify/memory/constitution.md`

```text
# Barnacle-Pipe Constitution
## Core Principles
### I. Specification Before Code
### II. Tests Before Code
### III. Keep It Simple
## Factory Run Rules
## Development Workflow
## Governance
**Version**: 1.0.0 | **Ratified**: 2026-11-18 | **Last Amended**: 2026-11-18
```

- must: 0 matches for `\[[A-Z][A-Z0-9_]*\]`, 0 `<!--`.
- must: no technology stack (no language, framework, database or hosting choice).
- Principle content (MUST rules):
  - I: every change starts from an approved `spec.md` under `specs/<branch>/`; plan and tasks follow the spec; code that no spec asks for is not added.
  - II: tests are written from the spec's acceptance scenarios and seen failing before implementation; outside services are tested through fakes listed in `.factory/test-env.md`.
  - III: the simplest solution that meets the spec; no speculative features or dependencies; extra complexity is justified in the plan's Complexity Tracking table.
- Factory Run Rules: each step runs in a fresh VM; no reliance on earlier session memory; steps commit but never push; factory tooling (`.claude/skills/`, `.specify/scripts/`, `.specify/templates/`, `.specify/extensions/`) is changed only by a feature about tooling.
- Development Workflow: specify → clarify → plan → tasks → write-tests → plan review → build (implement) → AI review.
- Governance: constitution overrides other practice; amendments through `/speckit-constitution` with version bump rules (MAJOR/MINOR/PATCH); every plan's Constitution Check evaluates each principle.

## `.factory/test-env.md`

```text
# Test environment
## Services
- None yet.
## Schemas
- None yet.
## Real runs
- None yet.
```

- A one-line italic note under each heading saying what goes there is allowed.

## `.gitignore`

Must contain each line exactly once:

```text
.specify/feature.json
.factory/schemas/
```

- must not contain a rule that ignores `.factory/test-env.md` (e.g. `.factory/` or `.factory/*`).

## `CLAUDE.md`

```text
# Barnacle-Pipe
## Layout
## Factory pipeline
## Rules for every run
## Key files
```

- must mention: `Barnacle-Pipe`, `specs/`, `tests/`, `tests/ai/`, `docs/`, `.factory/`, `.specify/`, `.specify/memory/constitution.md`, `.factory/test-env.md`, `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, and "do not push".

## `docs/PRODUCT.md`

```text
# Barnacle-Pipe — Product
## What it is
## Users
## Product rules
## Out of scope
```

## `docs/DESIGN.md`

```text
# Barnacle-Pipe — Design
## Look and feel
## Wording and tone
## Accessibility
```

## `docs/DECISIONS.md`

```text
# Barnacle-Pipe — Decisions
## Decisions
```

- Each `##` section in the three docs holds exactly `- None yet.`; only a one-line purpose sentence under the title is allowed besides.

## Folder READMEs

| Path | Title | Says |
|------|-------|------|
| `specs/README.md` | `# Specs` | one folder per feature, `specs/<branch>/`, made by `/speckit-specify` |
| `tests/README.md` | `# Tests` | deterministic tests, folders set by each feature's `plan.md` |
| `tests/ai/README.md` | `# AI test scenarios` | one file per user story, `us<N>-<slug>.md`, written by `write-tests`, run by AI review |

## Untouched

`README.md`, `.claude/skills/**`, `.specify/scripts/**`, `.specify/templates/**`, `.specify/extensions/**`.
