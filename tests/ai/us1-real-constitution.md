# US1: Factory runs read a real constitution
Covers: FR-001, FR-002, US1 scenario 2, 3

## Scenario 1: A person reads the constitution
### Setup
Check out the built branch. Open `.specify/memory/constitution.md`. Do not open any other file first.
### Steps
1. Read the whole constitution once.
2. List each principle with its number and name.
3. For each sentence that sets a rule, note whether it is a process rule or a technology choice (a language, framework, database, platform, hosting or tool vendor).
### Expected
- [ ] At least 3 principles are listed, and they are about spec before code, tests before code and keeping it simple.
- [ ] No sentence chooses a technology. Naming git, Markdown or the factory's own files does not count as a choice.
- [ ] Each principle states at least one rule a reviewer can answer with yes or no for a given plan.

## Scenario 2: A plan's Constitution Check uses the real principles
### Setup
Check out the built branch. Have `.specify/memory/constitution.md` and `specs/sf-76-init/plan.md` available.
### Steps
1. Using only the constitution, write a Constitution Check for `specs/sf-76-init/plan.md`: one row per principle and per Factory Run Rule, each marked PASS or FAIL with one reason.
2. Note every place where you had to guess which rule applies or what a rule means.
### Expected
- [ ] Every principle got a PASS or FAIL mark.
- [ ] Zero places needed a guess about which rule applies.
