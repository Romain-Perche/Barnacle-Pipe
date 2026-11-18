# US3: Agents and people understand the repository at a glance
Covers: FR-006, SC-004, US3 scenario 1

## Scenario 1: A new agent session loads the guidance file
### Setup
Check out the built branch. Run from the repository root. `claude` is installed (`~/.local/bin/claude`).
### Steps
1. From the repository root, run: `claude -p --disallowedTools "Read,Bash,Grep,Glob,Edit,Write,WebFetch,WebSearch,Task" "Answer from what you already know about this repository, without opening files: 1) Which product is this repository for? 2) Where do feature specs go? 3) Where do tests go, and where do AI test scenarios go? 4) Which file holds the project rules? 5) May a factory step push to the remote?"`
2. Save the answer text.
### Expected
- [ ] Answer 1 names Barnacle-Pipe.
- [ ] Answer 2 names `specs/` (one folder per feature).
- [ ] Answer 3 names `tests/` and `tests/ai/`.
- [ ] Answer 4 names `.specify/memory/constitution.md`.
- [ ] Answer 5 says no: steps commit and the factory pushes.

## Scenario 2: A person orients in under 2 minutes
### Setup
Check out the built branch. Open only `CLAUDE.md`. Start a 2-minute timer.
### Steps
1. Read `CLAUDE.md`.
2. Answer: what is this repo for, where do specs go, where do tests go, where are the project rules.
3. Stop the timer.
### Expected
- [ ] All 4 answers are found in `CLAUDE.md` alone.
- [ ] The timer shows less than 2 minutes.
- [ ] `CLAUDE.md` describes nothing about what Barnacle-Pipe does beyond its name.
