#!/usr/bin/env bash
# US2: Test steps find a valid test recipe. covers FR-003, FR-004, SC-003
source "$(dirname "$0")/../lib.sh"
r=.factory/test-env.md

# US2 scenario 1 + 2: sections exist, each says none yet
if need_file "$r"; then
  for h in '## Services' '## Schemas' '## Real runs'; do
    [ "$(grep -cxF -- "$h" "$r")" = 1 ] || { fail "$r: '$h' not exactly once"; continue; }
    section "$r" "$h" | grep -qxF -- '- None yet.' || fail "$r: '$h' has no '- None yet.' entry"
  done
fi

# FR-004: recipe and feature pointer
not_ignored "$r"
repo_ignores .specify/feature.json || fail ".specify/feature.json is not ignored by .gitignore"

# US2 scenario 3, SC-003: a schema file under .factory/schemas/ is not a change to commit
made=""; [ -d .factory ] || made=".factory"; [ -d .factory/schemas ] || made=".factory/schemas $made"
mkdir -p .factory/schemas
probe=.factory/schemas/zz-probe-$$.graphql
echo 'type Query { probe: String }' > "$probe"
[ -z "$(git status --porcelain --untracked-files=all -- .factory/schemas)" ] || fail "schema file shows as a change to commit"
repo_ignores "$probe" || fail "$probe is not ignored by .gitignore (only machine-local excludes)"
rm -f "$probe"; for d in $made; do rmdir "$d" 2>/dev/null; done
finish
