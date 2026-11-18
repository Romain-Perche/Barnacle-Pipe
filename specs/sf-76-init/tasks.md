---

description: "Task list for SF-76: Initialize Project for the Factory"
---

# Tasks: Initialize Project for the Factory

**Input**: Design documents from `specs/sf-76-init/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/baseline-files.md, quickstart.md

**Tests**: The factory's `write-tests` step writes the tests and records them below as completed tasks. They are plain bash scripts: `bash tests/run.sh` runs them all (plan.md, Testing). Each story ends with a validation task that runs its test script and its section of [quickstart.md](quickstart.md).

**Organization**: Tasks are grouped by user story so each story can be done and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every path is relative to the repository root. There is no `src/`: this feature writes only Markdown files and one `.gitignore` line (plan.md, Technical Context).

## Global rules for every task

- Do not change the test files written by `write-tests` (`tests/run.sh`, `tests/lib.sh`, `tests/contract/`, `tests/integration/`, `tests/ai/us*.md`) to make them pass. Change the deliverable files instead.
- Do not change anything under `.claude/skills/`, `.specify/scripts/`, `.specify/templates/`, `.specify/extensions/`, and do not change `README.md` (FR-008, FR-010).
- If a target file already exists with real content (not template text), keep that content and add only the missing headings (research R8). Never add a heading, line or ignore rule that is already there (FR-009).
- Do not write anything about what Barnacle-Pipe does: no product description, users, features or stack (FR-002, FR-007, SC-006).
- The exact headings come from [contracts/baseline-files.md](contracts/baseline-files.md). Use them word for word.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the starting state before writing files.

- [ ] T001 Check the current state of every target path listed in plan.md "Repository files this feature writes" (`.gitignore`, `CLAUDE.md`, `.specify/memory/constitution.md`, `.factory/test-env.md`, `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, `specs/README.md`, `tests/README.md`, `tests/ai/README.md`), and note which ones are missing, pure template, or hold real content. Expected at plan time: only `.gitignore` exists (holding `.specify/feature.json`), and the constitution is a pure template. If this differs, apply the R8 merge rule in the tasks below.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None needed. The three stories write separate files and share no prerequisite. `CLAUDE.md` (T012) points at files from all stories, so it comes last within US3 (see Dependencies).

**Checkpoint**: Once T001 is done, the user story phases can start.

---

## Phase 3: User Story 1 - Factory runs read a real constitution (Priority: P1) 🎯 MVP

**Goal**: `.specify/memory/constitution.md` becomes the Barnacle-Pipe Constitution v1.0.0, with three process principles and no placeholders.

**Independent Test**: quickstart.md §1 prints nothing. A person finds 3 named principles, a Governance section and the version line with dates.

### Tests for User Story 1

- [X] T017 [US1] Contract test for all baseline file paths and headings in tests/contract/baseline_files.sh (covers FR-001, FR-003, FR-004, FR-005, FR-006, FR-007; contracts/baseline-files.md)
- [X] T018 [US1] Integration test for the constitution in tests/integration/us1_constitution.sh (covers FR-001, FR-002, SC-001, US1 scenario 1, 2, 3)
- [X] T019 [US1] AI test: read the constitution and run a Constitution Check with it in tests/ai/us1-real-constitution.md (covers FR-001, FR-002, US1 scenario 2, 3)

### Implementation for User Story 1

- [ ] T002 [US1] Replace the template in `.specify/memory/constitution.md` with the Barnacle-Pipe Constitution. Follow the heading list in contracts/baseline-files.md exactly: `# Barnacle-Pipe Constitution`, `## Core Principles`, `### I. Specification Before Code`, `### II. Tests Before Code`, `### III. Keep It Simple`, `## Factory Run Rules`, `## Development Workflow`, `## Governance`, then the last line `**Version**: 1.0.0 | **Ratified**: 2026-11-18 | **Last Amended**: 2026-11-18`. Each principle gets MUST statements plus one `**Rationale**:` line, so a plan's Constitution Check can mark it pass or fail. Content:
  - I: every change starts from an approved `spec.md` under `specs/<branch>/`; plan and tasks follow the spec; nothing the spec does not ask for is added.
  - II: tests are written from the spec's acceptance scenarios and seen failing before the implementation; outside services are tested through fakes listed in `.factory/test-env.md`.
  - III: build the simplest solution that meets the spec; no speculative features or dependencies; extra complexity is justified in the plan's Complexity Tracking table.
  - Factory Run Rules: each step runs in a fresh VM; never rely on an earlier session's memory; steps commit but never push (the factory pushes); factory tooling (`.claude/skills/`, `.specify/scripts/`, `.specify/templates/`, `.specify/extensions/`) changes only in a feature about tooling.
  - Development Workflow: specify → clarify → plan → tasks → write-tests → plan review → build (implement) → AI review.
  - Governance: the constitution overrides other practices; amendments go through `/speckit-constitution` with semantic versioning ("MAJOR: principle removed/redefined; MINOR: principle or section added; PATCH: wording"); `Ratified` never changes and `Last Amended` updates on each amendment; every plan's Constitution Check evaluates each principle.
  - Constraints: "0 matches for `\[[A-Z][A-Z0-9_]*\]`", "no `<!--` comments" (so no Sync Impact Report comment, research R2), and no language, framework, database, platform or hosting choice is named.
- [ ] T003 [US1] Validate US1: run `bash tests/integration/us1_constitution.sh` (must print `ok`) and quickstart.md §1 from the repo root (must print nothing). Also read `.specify/memory/constitution.md` once to confirm no technology is named. Fix `.specify/memory/constitution.md` if anything fails.

**Checkpoint**: Later plans can run a real Constitution Check (US1 scenario 3).

---

## Phase 4: User Story 2 - Test steps find a valid test recipe (Priority: P2)

**Goal**: An empty but valid test recipe exists and is tracked, and downloaded schemas can never be committed.

**Independent Test**: quickstart.md §2 prints nothing. In particular, a probe file under `.factory/schemas/` does not show in `git status`.

### Tests for User Story 2

- [X] T020 [US2] Integration test for the test recipe and schema ignore rule in tests/integration/us2_test_recipe.sh (covers FR-003, FR-004, SC-003, US2 scenario 1, 2, 3)

### Implementation for User Story 2

- [ ] T004 [P] [US2] Create `.factory/test-env.md` with exactly these lines: `# Test environment`, then `## Services`, `## Schemas` and `## Real runs`, each heading present once and each followed by the literal line `- None yet.`. A one-line italic note under each heading is allowed: Services = "one line per outside service: its fake, its schema, real test account wanted yes/no"; Schemas = "file name in `.factory/schemas/`: source URL"; Real runs = "one line per real-run choice". Do not add `## Smoke checks` or `## Docker images`; `write-tests` adds them when needed (research R3).
- [ ] T005 [P] [US2] Add the line `.factory/schemas/` to `.gitignore`, only if it is not already there. Keep the existing `.specify/feature.json` line. Each line must appear exactly once. Do not add `.factory/` or `.factory/*`, because they would hide `.factory/test-env.md` (FR-004, research R4).
- [ ] T006 [US2] Validate US2: `git add .factory/test-env.md .gitignore`, then run `bash tests/integration/us2_test_recipe.sh` (must print `ok`; it removes its own probe file) and quickstart.md §2 (must print nothing). Fix `.factory/test-env.md` or `.gitignore` if anything fails.

**Checkpoint**: `write-tests` can read the recipe and download schemas safely.

---

## Phase 5: User Story 3 - Agents and people understand the repository at a glance (Priority: P3)

**Goal**: Tracked folder READMEs, three empty product documents, and a root `CLAUDE.md` that orients any agent session.

**Independent Test**: quickstart.md §3 prints nothing. Reading only `CLAUDE.md` answers the 4 orientation questions (quickstart.md §5).

### Tests for User Story 3

- [X] T021 [US3] Integration test for CLAUDE.md, product docs and folder READMEs in tests/integration/us3_orientation.sh (covers FR-005, FR-006, FR-007, SC-006, US3 scenario 1, 2, 3)
- [X] T022 [US3] AI test: new agent session and 2-minute orientation read in tests/ai/us3-orientation.md (covers FR-006, SC-004, US3 scenario 1)

### Implementation for User Story 3

- [ ] T007 [P] [US3] Create `specs/README.md`: title `# Specs`, then one or two lines: one folder per feature, `specs/<branch>/`, created by `/speckit-specify`, holding spec.md, plan.md, tasks.md and the design files.
- [ ] T008 [P] [US3] Create `tests/README.md`: title `# Tests`, then one or two lines: deterministic tests live here, in the subfolders each feature's `plan.md` sets (now `tests/contract/` and `tests/integration/`, run all with `bash tests/run.sh`), written by `write-tests` before the code; AI scenarios are in `tests/ai/`.
- [ ] T009 [P] [US3] Create `tests/ai/README.md`: title `# AI test scenarios`, then one or two lines: one file per user story, named `us<N>-<slug>.md`, written by `write-tests` and run by AI review after Build. Do not name this file `us*.md`.
- [ ] T010 [P] [US3] Create `docs/PRODUCT.md`: line 1 `# Barnacle-Pipe — Product`, line 2 blank, line 3 one purpose sentence ("Product rules for Barnacle-Pipe that the factory must follow and not ask about again."), then the sections `## What it is`, `## Users`, `## Product rules`, `## Out of scope`, each holding exactly `- None yet.`. Nothing else. The quickstart.md §3 check expects title, blank line, purpose line, then only headings, `- None yet.` and blank lines.
- [ ] T011 [P] [US3] Create `docs/DESIGN.md` and `docs/DECISIONS.md` in the same layout as T010 (title on line 1, blank line 2, purpose sentence on line 3, then sections each holding exactly `- None yet.`):
  - `docs/DESIGN.md`: title `# Barnacle-Pipe — Design`, purpose "Look and feel of Barnacle-Pipe.", sections `## Look and feel`, `## Wording and tone`, `## Accessibility`.
  - `docs/DECISIONS.md`: title `# Barnacle-Pipe — Decisions`, purpose "Other decisions about Barnacle-Pipe, newest first, each with date, decision and why.", section `## Decisions`.
- [ ] T012 [US3] Create the root `CLAUDE.md` (depends on T002, T004, T007–T011, so every path it names exists). Keep it to about one screen. Use the headings `# Barnacle-Pipe`, `## Layout`, `## Factory pipeline`, `## Rules for every run`, `## Key files`:
  - Intro: this repository is for the product Barnacle-Pipe, built by the factory. No description of what the product does.
  - Layout: `specs/` (one folder per feature), `tests/` (deterministic tests), `tests/ai/` (AI scenarios), `docs/` (product documents), `.factory/` (test recipe; `.factory/schemas/` is downloaded per run and gitignored), `.specify/` (Spec Kit settings and the constitution), `.claude/skills/` (factory skills; do not edit outside a tooling feature).
  - Factory pipeline: specify → clarify → plan → tasks → write-tests → plan review → build (implement) → AI review.
  - Rules for every run: each step runs in a fresh VM; do not rely on earlier session memory; commit your work but do not push (the factory pushes); follow the constitution.
  - Key files: `.specify/memory/constitution.md` (project rules), `.factory/test-env.md` (test recipe), `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`.
- [ ] T013 [US3] Validate US3: `git add CLAUDE.md docs specs/README.md tests`, then run `bash tests/integration/us3_orientation.sh` and `bash tests/contract/baseline_files.sh` (both must print `ok`) and quickstart.md §3 (must print nothing). Then do the quickstart.md §5 orientation read on `CLAUDE.md` alone (4/4 answers). Fix the failing file if anything fails.

**Checkpoint**: All three stories work on their own.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature checks: tooling untouched, idempotent, all success criteria met.

- [X] T023 Integration test for tooling untouched, README untouched and no duplicates in tests/integration/repo_invariants.sh (covers FR-008, FR-009, FR-010, SC-005)
- [ ] T014 Run `bash tests/integration/repo_invariants.sh` (must print `ok`) and quickstart.md §4. Nothing under the tooling folders or `README.md` may differ from the parent of the commit that added `specs/sf-76-init/spec.md`, counting committed, staged, unstaged and untracked changes. Do not compare with `main`: the factory tooling commit is on this branch only. Each `.gitignore` rule must appear exactly once.
- [ ] T015 Idempotency check (FR-009): go through T002, T004, T005 and T007–T012 again against the files as they now are. Each must result in no edit, and `git status --porcelain` must show no new change. Then run `bash tests/run.sh` (exit code 0, every line `ok`) and quickstart.md §1–§4 once more as a full pass.
- [ ] T016 Commit the feature files (`.specify/memory/constitution.md`, `.factory/test-env.md`, `.gitignore`, `CLAUDE.md`, `docs/`, `specs/README.md`, `tests/`, `specs/sf-76-init/tasks.md` with the finished tasks marked `[X]`) on the current branch `factory/sf-76-init`. Do not push.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 has no dependencies.
- **Foundational (Phase 2)**: Empty. Nothing blocks the stories beyond T001.
- **US1 / US2 / US3 (Phases 3–5)**: Each can start after T001.
- **Polish (Phase 6)**: Depends on all three stories.

### User Story Dependencies

- **US1 (P1)**: Independent.
- **US2 (P2)**: Independent. T004 and T005 touch different files.
- **US3 (P3)**: T007–T011 are independent. Only T012 (`CLAUDE.md`) waits for T002 and T004 so its pointers name existing files. Without US1 and US2 done, CLAUDE.md can still be written but quickstart.md §3 passes regardless, since it only checks CLAUDE.md's text.

### Within Each User Story

- Write the files, then run the story's validation task (T003, T006, T013).

### Parallel Opportunities

- T002 (US1), T004 + T005 (US2) and T007–T011 (US3) all touch different files and can run at the same time after T001.
- Within US3: T007, T008, T009, T010, T011 in parallel; then T012.

---

## Parallel Example: User Story 3

```bash
Task: "Create specs/README.md (T007)"
Task: "Create tests/README.md (T008)"
Task: "Create tests/ai/README.md (T009)"
Task: "Create docs/PRODUCT.md (T010)"
Task: "Create docs/DESIGN.md and docs/DECISIONS.md (T011)"
# then
Task: "Create CLAUDE.md (T012)"
```

## Parallel Example: User Story 2

```bash
Task: "Create .factory/test-env.md (T004)"
Task: "Add .factory/schemas/ to .gitignore (T005)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001
2. T002 → T003: the constitution is real, so every later Constitution Check works.
3. **Stop and validate** with quickstart.md §1.

### Incremental Delivery

1. US1 (constitution) → validate §1
2. US2 (test recipe + ignore rule) → validate §2
3. US3 (READMEs, docs, CLAUDE.md) → validate §3, §5
4. Polish: §4, idempotency, commit

---

## Notes

- 16 implementation tasks, all on Markdown files and `.gitignore`. No product code. Test tasks recorded by `write-tests` follow T016 in numbering.
- Decisions made by the factory (no one to ask): test tasks come from `write-tests`; no Foundational tasks; one commit at the end (T016) instead of one per task, since the files are small and related.
