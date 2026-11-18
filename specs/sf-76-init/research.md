# Research: Initialize Project for the Factory (SF-76)

**Date**: 2026-11-18 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

The Technical Context had no open "NEEDS CLARIFICATION" items: the spec's clarification session settled scope (product docs in scope, README out, process-only constitution). The items below are the design choices the plan made itself, because nobody can answer questions in a factory run.

## R1. How to apply the initialization (script vs. committed files)

- **Decision**: Write the baseline files directly as committed content. No init script.
- **Rationale**: The feature runs once per repository. Committed files are the end state the spec describes; idempotency (FR-009) then holds by construction: re-applying means "file already matches, change nothing". A script would itself need tests, a language choice and a home in the tooling folders FR-008 forbids touching.
- **Alternatives considered**: A bash `init.sh` that writes files only when missing — rejected (YAGNI, adds a language/tooling choice the constitution must not make yet). Running `/speckit-constitution` interactively for the constitution — rejected as a mechanism, but the constitution keeps that skill's template structure so the skill can amend it later.

## R2. Constitution structure and content

- **Decision**: Follow `.specify/templates/constitution-template.md` section by section: `# Barnacle-Pipe Constitution`, `## Core Principles` with three principles (I. Specification Before Code, II. Tests Before Code, III. Keep It Simple), `## Factory Run Rules` (template's SECTION_2), `## Development Workflow` (SECTION_3), `## Governance`, and a final `**Version**: 1.0.0 | **Ratified**: 2026-11-18 | **Last Amended**: 2026-11-18` line. Each principle uses MUST/SHOULD statements plus a one-line rationale so a plan's Constitution Check can mark it pass/fail.
- **Rationale**: FR-001/FR-002 and the spec's assumption that the constitution step must be able to amend it later. Three principles are exactly what the clarification asked for; more would invent rules.
- **No HTML comments**: drop the template's example comments and do not add a Sync Impact Report comment. A Sync Impact Report usually quotes placeholder names, which would break SC-001 (`\[[A-Z][A-Z0-9_]*\]` must find 0 matches); git history already records the change.
- **Alternatives considered**: Five principles to fill every template slot — rejected (invents rules nobody stated). Adding a technology section — rejected by FR-002.

## R3. Test recipe sections

- **Decision**: `.factory/test-env.md` has `# Test environment` and exactly `## Services`, `## Schemas`, `## Real runs`, each with one line `- None yet.` (plus a short note of what goes there).
- **Rationale**: FR-003 and `write-tests` §0/§3, which read these three headings. The skill's example also shows `## Smoke checks` and `## Docker images`; the skill adds `## Docker images` "only when a test needs a service in Docker", and smoke checks only exist per schema. Leaving them out keeps the file to what the spec requires; `write-tests` adds them when the first service appears.
- **Alternatives considered**: Including empty `## Smoke checks` / `## Docker images` — rejected (not required, and an empty Docker images list adds nothing).

## R4. Ignore rules

- **Decision**: Append `.factory/schemas/` to the existing `.gitignore` (which already holds `.specify/feature.json`). Do not ignore `.factory/` as a whole.
- **Rationale**: FR-004 and the edge case: ignoring `.factory/` would hide `.factory/test-env.md`. A trailing-slash directory pattern matches only the schemas folder. Checking the line exists before appending keeps it idempotent.
- **Verification**: `git check-ignore -q .factory/schemas/x.graphql` succeeds; `git check-ignore -q .factory/test-env.md` fails.

## R5. Agent guidance file

- **Decision**: Root `CLAUDE.md`.
- **Rationale**: `.specify/integration.json` lists `claude` as the only integration; Claude Code loads `CLAUDE.md` at session start (US3 scenario 1). Keep it short (one screen) so SC-004's 2-minute read holds.
- **Alternatives considered**: `AGENTS.md` (or both, with one linking the other) — rejected: no second agent is installed; one file avoids drift.

## R6. Keeping empty folders tracked

- **Decision**: `specs/README.md`, `tests/README.md`, `tests/ai/README.md`, each a title plus one or two lines of purpose.
- **Rationale**: FR-005. Checked against the tooling: `create-new-feature.sh` loops over `specs/*` but skips non-directories, and `write-tests` names scenarios `tests/ai/us<N>-<slug>.md`, so `README.md` does not collide with either.
- **Alternatives considered**: `.gitkeep` files — rejected: FR-005 asks for a README that says what goes in the folder.

## R7. Product documents

- **Decision**: `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, each `# Barnacle-Pipe — <Product|Design|Decisions>`, a one-line purpose, then a fixed set of `##` sections each holding `- None yet.` Section names describe *kinds* of decisions, never answers (SC-006).
- **Sections chosen** (factory choice, to confirm):
  - PRODUCT: What it is, Users, Product rules, Out of scope.
  - DESIGN: Look and feel, Wording and tone, Accessibility.
  - DECISIONS: Decisions (dated log entries: date, decision, why).
- **Rationale**: Gives clarify a stable place to look up and record answers without inventing content.
- **Alternatives considered**: One combined `docs/PRODUCT.md` — rejected by FR-007.

## R8. Existing content and re-runs

- **Decision**: Before writing each file, check it: if missing or a pure template, write the baseline; if it holds real content, keep it and add only missing headings. Currently only `.gitignore` (one real rule) and `README.md` (out of scope, untouched) exist; the constitution is a pure template and is replaced.
- **Rationale**: Spec edge cases and FR-009.
