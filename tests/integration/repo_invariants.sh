#!/usr/bin/env bash
# Whole-feature invariants. covers FR-008, FR-009, FR-010, SC-005
source "$(dirname "$0")/../lib.sh"

# Base = the commit just before this feature's spec was first added. The factory tooling commit
# sits on the feature branch (not on main), so main...HEAD would wrongly list every skill file.
first=$(git log --format=%H --diff-filter=A -- specs/sf-76-init/spec.md | tail -n 1)
if [ -z "$first" ]; then fail "cannot find the commit that added specs/sf-76-init/spec.md"; finish; fi
base=$(git rev-parse "$first^")

# FR-008, FR-010, SC-005: tooling and README.md untouched (committed, staged, unstaged and untracked)
paths=(.claude/skills .specify/scripts .specify/templates .specify/extensions README.md)
changed=$( { git diff --name-only "$base" -- "${paths[@]}"; git ls-files --others --exclude-standard -- "${paths[@]}"; } | sort -u)
[ -z "$changed" ] || fail "factory tooling or README.md changed: $(tr '\n' ' ' <<<"$changed")"

# FR-009: applying twice leaves no duplicates (ignore rules, headings)
[ -f .gitignore ] && { d=$(grep -v '^\s*$' .gitignore | sort | uniq -d); [ -z "$d" ] || fail ".gitignore has duplicate rules: $d"; }
for f in .specify/memory/constitution.md .factory/test-env.md CLAUDE.md docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md \
         specs/README.md tests/README.md tests/ai/README.md; do
  [ -f "$f" ] || continue
  d=$(grep '^#' "$f" | sort | uniq -d)
  [ -z "$d" ] || fail "$f has duplicate headings: $d"
done
finish
