# Implementation Plan: Initialize Project for the Factory

**Branch**: `factory/sf-76-init` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/sf-76-init/spec.md`

## Summary

Add the baseline project files the factory reads, so every later run starts from a known state: a real Barnacle-Pipe constitution (three process principles, v1.0.0), an empty test recipe at `.factory/test-env.md`, an ignore rule for `.factory/schemas/`, tracked `specs/`, `tests/` and `tests/ai/` folders with READMEs, a root `CLAUDE.md`, and three empty product documents under `docs/`. All of it is hand-written Markdown plus one `.gitignore` line; no script, no code, no change to the factory tooling ([research R1](research.md#r1-how-to-apply-the-initialization-script-vs-committed-files)).

## Technical Context

**Language/Version**: None. Markdown files and one `.gitignore` rule. The constitution must not pick a stack (FR-002).

**Primary Dependencies**: None.

**Storage**: Files in the git repository.

**Testing**: Plain bash scripts using only `grep`, `awk` and `git`. No test framework or dependency. `bash tests/run.sh` runs every `tests/contract/*.sh` and `tests/integration/*.sh`; each script exits non-zero on failure. Shared helpers are in `tests/lib.sh`. Ignore checks use `git check-ignore -v` and require the rule to come from the committed `.gitignore`, because factory VMs also ignore `/.factory/schemas/` in `.git/info/exclude`. "Tooling untouched" compares against the parent of the commit that added `specs/sf-76-init/spec.md`, not against `main`, because the factory tooling commit is on this branch only. The same checks are in [quickstart.md](quickstart.md). The first product feature picks its own framework.

**Target Platform**: The factory's Linux VMs and Claude Code sessions opened at the repo root.

**Project Type**: Repository scaffolding (documentation and config only).

**Performance Goals**: N/A. SC-004: `CLAUDE.md` readable in under 2 minutes (keep it to about one screen).

**Constraints**: No changes under `.claude/skills/`, `.specify/scripts/`, `.specify/templates/`, `.specify/extensions/` (FR-008); `README.md` untouched (FR-010); idempotent (FR-009); no invented product content (FR-007, SC-006); constitution free of `[ALL_CAPS]` tokens (SC-001).

**Scale/Scope**: 11 deliverable files: 1 replaced (constitution), 1 edited (`.gitignore`), 9 new. Plus the test files written by `write-tests`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it has no principles to check against yet; filling it is this feature's job. No gate can fail on it, and that is expected here, not an error. As a stand-in, the plan is checked against the principles the spec requires (FR-002), which become the constitution this feature writes:

| Principle (to be ratified) | Pre-research | Post-design | Notes |
|---|---|---|---|
| I. Specification Before Code | PASS | PASS | Spec approved with clarifications. Plan adds only what FR-001…FR-010 ask for. |
| II. Tests Before Code | PASS | PASS | Acceptance checks are in [quickstart.md](quickstart.md) and the [contract](contracts/baseline-files.md) before any file is written; `write-tests` turns them into failing tests next. |
| III. Keep It Simple | PASS | PASS | No init script, no extra recipe sections, one guidance file, READMEs instead of extra tooling (research R1, R3, R5). |
| Tooling untouched (FR-008) | PASS | PASS | All target paths are outside the tooling folders. |

No violations, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-76-init/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0: design choices R1–R8
├── data-model.md        # Phase 1: the baseline files as entities
├── quickstart.md        # Phase 1: runnable validation checks
├── contracts/
│   └── baseline-files.md  # Phase 1: required paths and headings
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Repository files this feature writes

```text
.gitignore                       # edit: add `.factory/schemas/` (keep `.specify/feature.json`)
CLAUDE.md                        # new: agent guidance (US3)
.specify/memory/constitution.md  # replace template: Barnacle-Pipe Constitution v1.0.0 (US1)
.factory/
└── test-env.md                  # new: Services / Schemas / Real runs, "None yet." (US2)
docs/
├── PRODUCT.md                   # new: empty sections (US3)
├── DESIGN.md                    # new: empty sections (US3)
└── DECISIONS.md                 # new: empty sections (US3)
specs/
└── README.md                    # new
tests/
├── README.md                    # new
├── run.sh                       # write-tests: runs all shell tests
├── lib.sh                       # write-tests: shared helpers
├── contract/
│   └── baseline_files.sh        # write-tests: contracts/baseline-files.md
├── integration/
│   ├── us1_constitution.sh      # write-tests
│   ├── us2_test_recipe.sh       # write-tests
│   ├── us3_orientation.sh       # write-tests
│   └── repo_invariants.sh       # write-tests: FR-008, FR-009, FR-010
└── ai/
    ├── README.md                # new
    ├── us1-real-constitution.md # write-tests: AI scenarios
    └── us3-orientation.md       # write-tests: AI scenarios
```

**Structure Decision**: No source tree yet; the first product feature adds one through its own plan and a constitution amendment. This feature's tests are shell scripts in `tests/contract/` and `tests/integration/`, with AI scenarios in `tests/ai/`. There is no unit test folder, because there is no code.

### Implementation order

1. Constitution (P1). It is independent and unblocks every later Constitution Check.
2. `.factory/test-env.md` + `.gitignore` rule (P2).
3. Folder READMEs, `docs/*.md`, `CLAUDE.md` (P3). `CLAUDE.md` comes last so its pointers name files that exist.
4. Run `bash tests/run.sh` and [quickstart.md](quickstart.md) §1–§4. Run them again after re-applying, to confirm idempotency.

For each file: if it holds real content, keep it and add only missing headings ([research R8](research.md#r8-existing-content-and-re-runs)).

## Decisions made without asking (factory run)

Nobody could answer questions in this run. These choices were made by the plan and should be confirmed in plan review:

- No init script; the files themselves are the deliverable (R1).
- Test recipe holds only the three required sections; `write-tests` adds `## Smoke checks` / `## Docker images` when needed (R3).
- Product doc section names (R7): PRODUCT = What it is, Users, Product rules, Out of scope; DESIGN = Look and feel, Wording and tone, Accessibility; DECISIONS = one dated Decisions log.
- Constitution has no Sync Impact Report comment, so SC-001 holds (R2).
- Tests are plain bash scripts with no framework, so the constitution's "no technology stack" rule holds (write-tests).

## Complexity Tracking

No violations.
