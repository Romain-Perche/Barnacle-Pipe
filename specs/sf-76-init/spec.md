# Feature Specification: Initialize Project for the Factory

**Feature Branch**: `factory/sf-76-init`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "init — initiate project with the files the factory needs to create"

## Context

The repository holds the factory tooling: Spec Kit settings under `.specify/` and the factory skills under `.claude/skills/`. It does not hold the project files those tools read. Today:

- The project constitution (`.specify/memory/constitution.md`) still has only the template placeholders (`[PROJECT_NAME]`, `[PRINCIPLE_1_NAME]`, …).
- There is no test recipe (`.factory/test-env.md`). The `write-tests` and `plan-review` steps read it.
- Nothing stops downloaded schemas (`.factory/schemas/`) from being committed, but `write-tests` says git must never track them.
- There is no place for AI test scenarios (`tests/ai/`) and no agent guidance file at the repository root.
- The README holds only the repository name.

This feature adds the baseline files so that every later factory run (specify → plan → tasks → write-tests → plan review → build) starts from a known, valid project state. It does not add product features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Factory runs read a real constitution (Priority: P1)

A factory step (plan, analyze, plan review) opens the project constitution to check a plan against the project's principles. It finds real principles, governance rules and a version, not template placeholders.

**Why this priority**: Every planning and review gate checks against the constitution. If the constitution has only placeholders, those checks mean nothing and each run must guess the rules.

**Independent Test**: Open the constitution and confirm that no placeholder tokens remain and that it states principles, governance and a version with dates.

**Acceptance Scenarios**:

1. **Given** the initialized repository, **When** a factory step reads the constitution, **Then** it contains no `[ALL_CAPS]` placeholder tokens and no template example comments.
2. **Given** the initialized repository, **When** a person reads the constitution, **Then** they find at least three named principles, a governance section, and a version line with ratified and last-amended dates.
3. **Given** a later feature plan, **When** the plan's constitution check runs, **Then** it can evaluate each principle as pass or fail without asking which rules apply.

---

### User Story 2 - Test steps find a valid test recipe (Priority: P2)

The `write-tests` step starts in a fresh VM. It reads the test recipe to learn which outside services have approved fakes and which real runs are allowed. The recipe exists, has the sections the step expects, and starts with no outside services listed.

**Why this priority**: Without a recipe, `write-tests` must create one during an unrelated feature. That mixes project setup into feature work and gives reviewers a surprise change.

**Independent Test**: Open the test recipe and confirm that it has the `Services`, `Schemas` and `Real runs` sections and that each section has an explicit "none yet" entry.

**Acceptance Scenarios**:

1. **Given** the initialized repository, **When** `write-tests` reads the test recipe, **Then** the file exists with the sections `## Services`, `## Schemas` and `## Real runs`.
2. **Given** the initialized repository, **When** a person reads the recipe, **Then** each section states that no outside service, schema or real run is configured yet.
3. **Given** a schema file placed under the schemas folder, **When** a person checks the working tree status, **Then** the schema file is not shown as a change to commit.

---

### User Story 3 - Agents and people understand the repository at a glance (Priority: P3)

A new agent session or a person opens the repository root. A guidance file and the README explain what the repository is, how the factory pipeline uses it, where specs, tests and factory files live, and which rules apply (for example: do not push from a step; the factory pushes).

**Why this priority**: This makes runs faster and more consistent, but runs can still work without it because each skill has its own rules.

**Independent Test**: Read only the README and the guidance file and answer: what is this repo, where do specs go, where do tests go, and which file holds the project rules.

**Acceptance Scenarios**:

1. **Given** the initialized repository, **When** an agent session starts at the repository root, **Then** a guidance file is loaded that names the folder layout (`specs/`, `tests/`, `tests/ai/`, `.factory/`, `.specify/`) and points to the constitution.
2. **Given** the initialized repository, **When** a person opens the README, **Then** it describes the repository's purpose and the factory pipeline order in a few lines.
3. **Given** the initialized repository, **When** `write-tests` writes its first AI scenario, **Then** the `tests/ai/` folder already exists.

### Edge Cases

- If a file this feature creates already exists with real content (not a template), keep its content and add only the missing sections.
- Files that each run creates (`.specify/feature.json`, `.factory/schemas/`) must stay out of version control, and the ignore rules must not hide other files the factory commits (`.factory/test-env.md`).
- Running the initialization again must not duplicate sections, ignore rules or folders.
- Empty folders are not tracked by version control, so folders the feature adds must hold a placeholder or README file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST contain a completed project constitution with no template placeholder tokens. It MUST have a project name, at least three principles, a development workflow section, a governance section and a version line with dates.
- **FR-002**: The constitution's principles MUST cover at least: specification before code, tests written before the implementation, and keeping solutions simple.
- **FR-003**: The repository MUST contain a test recipe at `.factory/test-env.md` with the sections `## Services`, `## Schemas` and `## Real runs`, each with an explicit "none yet" entry.
- **FR-004**: Version control MUST ignore `.factory/schemas/` and `.specify/feature.json`, and MUST still track `.factory/test-env.md`.
- **FR-005**: The repository MUST contain a `specs/` folder, a `tests/` folder and a `tests/ai/` folder, each tracked with a short README that says what goes in it.
- **FR-006**: The repository MUST contain an agent guidance file at the root that describes the folder layout, points to the constitution and the test recipe, and states the factory rules that apply to every run (fresh VM, no reliance on earlier session memory, commit but do not push).
- **FR-007**: The README MUST describe the repository purpose and list the factory pipeline steps in order.
- **FR-008**: The feature MUST NOT change the factory tooling (`.claude/skills/`, `.specify/scripts/`, `.specify/templates/`, `.specify/extensions/`).
- **FR-009**: Applying the initialization twice MUST leave the repository in the same state as applying it once.

### Key Entities

- **Constitution**: The project's governing principles and rules. Read by planning, analysis and review gates. Has a version and amendment dates.
- **Test recipe**: The record of how each outside service is tested (fake plus schema), which schemas are used, and which real runs are allowed. Starts empty.
- **Agent guidance file**: Short orientation for any agent session: layout, rules and pointers to the constitution and test recipe.
- **Folder READMEs**: One-line purpose notes that keep `specs/`, `tests/` and `tests/ai/` tracked.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A search of the constitution for placeholder tokens (`[` followed by capital letters and `]`) finds 0 matches.
- **SC-002**: The next factory feature runs specify, plan, tasks and write-tests with 0 steps that stop to create or ask for a missing baseline file.
- **SC-003**: After a schema file is placed under `.factory/schemas/`, the working tree shows 0 changes to commit.
- **SC-004**: A reviewer who reads only the README and the guidance file answers 4 of 4 orientation questions (repo purpose, where specs go, where tests go, where project rules are) in under 2 minutes.
- **SC-005**: The feature's change set touches 0 files under the factory tooling folders listed in FR-008.

## Assumptions

- The repository has no product code yet. The constitution states process principles, not a technology stack. A later amendment adds stack rules when the first product feature chooses one.
- The constitution starts at version 1.0.0, ratified on 2026-11-18.
- The project name in the constitution comes from the repository name ("Alexis-testing").
- The agent guidance file is `CLAUDE.md`, because the factory's only installed integration is Claude.
- No outside services exist yet, so the test recipe lists none. `write-tests` adds entries when a feature needs them.
- The constitution is written to the template's structure, so the constitution step can amend it later.
