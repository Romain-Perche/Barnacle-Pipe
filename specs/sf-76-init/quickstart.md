# Quickstart: Validate the Initialization (SF-76)

Run from the repository root after implementation. Needs only `bash`, `grep` and `git`. The same checks are automated in `tests/` (run all: `bash tests/run.sh`; see [plan.md](plan.md) Testing). Every check prints nothing on success and `FAIL: …` otherwise. Required paths and headings: [contracts/baseline-files.md](contracts/baseline-files.md).

## 1. Constitution (US1, FR-001, FR-002, SC-001)

```bash
c=.specify/memory/constitution.md
grep -Eq '\[[A-Z][A-Z0-9_]*\]' $c && echo "FAIL: placeholder tokens"
grep -q '<!--' $c && echo "FAIL: template comments"
for h in '# Barnacle-Pipe Constitution' '## Core Principles' '### I. Specification Before Code' \
         '### II. Tests Before Code' '### III. Keep It Simple' '## Development Workflow' '## Governance'; do
  grep -qxF "$h" $c || echo "FAIL: missing $h"; done
grep -Eq '^\*\*Version\*\*: 1\.0\.0 \| \*\*Ratified\*\*: 2026-11-18 \| \*\*Last Amended\*\*: 2026-11-18' $c || echo "FAIL: version line"
```

Expected: no output. Manually confirm no language, framework or platform is named.

## 2. Test recipe and ignore rules (US2, FR-003, FR-004, SC-003)

```bash
r=.factory/test-env.md
for h in '## Services' '## Schemas' '## Real runs'; do
  [ "$(grep -cxF "$h" $r)" = 1 ] || echo "FAIL: $h not exactly once"; done
[ "$(grep -cxF -- '- None yet.' $r)" -ge 3 ] || echo "FAIL: none-yet entries"
git check-ignore -q $r && echo "FAIL: recipe ignored"
# The rule must come from the committed .gitignore: factory VMs also ignore /.factory/schemas/
# in .git/info/exclude, which a fresh clone does not have.
git check-ignore -v .factory/schemas/probe.graphql | grep -q '^\.gitignore:' || echo "FAIL: schemas not ignored by .gitignore"
git check-ignore -v .specify/feature.json | grep -q '^\.gitignore:' || echo "FAIL: feature.json not ignored by .gitignore"
```

Automated: `bash tests/integration/us2_test_recipe.sh` (also places a real probe file under `.factory/schemas/` and checks `git status`).

## 3. Guidance, folders, product docs (US3, FR-005..FR-007, SC-006)

```bash
for f in specs/README.md tests/README.md tests/ai/README.md docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md CLAUDE.md; do
  git ls-files --error-unmatch $f >/dev/null 2>&1 || echo "FAIL: $f not tracked"; done
for w in Barnacle-Pipe specs/ tests/ai/ docs/ .factory/ .specify/ .specify/memory/constitution.md \
         .factory/test-env.md docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md; do
  grep -qF "$w" CLAUDE.md || echo "FAIL: CLAUDE.md lacks $w"; done
grep -qi 'not push\|never push' CLAUDE.md || echo "FAIL: push rule"
for f in docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md; do
  head -1 $f | grep -q 'Barnacle-Pipe' || echo "FAIL: $f title"
  # every line after the purpose line is a heading, '- None yet.' or blank
  tail -n +4 $f | grep -vE '^(## .+|- None yet\.|)$' && echo "FAIL: $f has content"; done
```

Expected: no output (the docs check assumes title, blank line, purpose line, then sections).

## 4. Tooling untouched and idempotency (FR-008, FR-009, FR-010, SC-005)

```bash
# Base = parent of the commit that first added this spec. Not `main`: the factory tooling commit
# is on this branch only, so `main...HEAD` would list every skill file.
base=$(git log --format=%H --diff-filter=A -- specs/sf-76-init/spec.md | tail -n 1)^
p=".claude/skills .specify/scripts .specify/templates .specify/extensions README.md"
git diff --name-only $base -- $p; git ls-files --others --exclude-standard -- $p
[ "$(grep -cxF '.factory/schemas/' .gitignore)" = 1 ] || echo "FAIL: duplicate/missing ignore rule"
[ "$(grep -cxF '.specify/feature.json' .gitignore)" = 1 ] || echo "FAIL: duplicate/missing ignore rule"
```

Expected: no output. Re-applying the implementation tasks then `git status --porcelain` shows no changes.

## 5. Orientation read (SC-004, manual)

Read only `CLAUDE.md` and answer within 2 minutes: what is this repo, where do specs go, where do tests go, where are the project rules. 4/4 expected.
