#!/usr/bin/env bash
# US3: Agents and people understand the repository at a glance. covers FR-005, FR-006, FR-007, SC-006
source "$(dirname "$0")/../lib.sh"

# US3 scenario 1, FR-006: CLAUDE.md names product, layout, pipeline order, pointers, run rules
g=CLAUDE.md
if need_file "$g"; then
  for w in Barnacle-Pipe specs/ tests/ tests/ai/ docs/ .factory/ .specify/ \
           .specify/memory/constitution.md .factory/test-env.md docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md; do
    grep -qF -- "$w" "$g" || fail "$g does not mention $w"
  done
  section "$g" '## Factory pipeline' | tr '\n' ' ' | grep -Eqi 'specify.*plan.*tasks.*write-tests.*plan review.*(build|implement)' \
    || fail "$g: pipeline order specify → plan → tasks → write-tests → plan review → build not found"
  rules=$(section "$g" '## Rules for every run')
  grep -qi 'fresh VM' <<<"$rules" || fail "$g: rule 'fresh VM' missing"
  grep -qi 'memory' <<<"$rules" || fail "$g: rule about earlier session memory missing"
  grep -qi 'commit' <<<"$rules" || fail "$g: commit rule missing"
  grep -Eqi "(do not|don't|never) push" <<<"$rules" || fail "$g: 'do not push' rule missing"
fi

# US3 scenario 2, FR-007, SC-006: three docs, title names Barnacle-Pipe, sections only 'None yet.'
for f in docs/PRODUCT.md docs/DESIGN.md docs/DECISIONS.md; do
  need_file "$f" || continue
  not_ignored "$f"
  head -n 1 "$f" | grep -Eq '^# .*Barnacle-Pipe' || fail "$f: title does not name Barnacle-Pipe"
  [ -z "$(sed -n 2p "$f")" ] || fail "$f: line 2 must be blank"
  sed -n 3p "$f" | grep -Eq '^[^#-].+' || fail "$f: line 3 must be the one-line purpose"
  extra=$(tail -n +4 "$f" | grep -vE '^(## .+|- None yet\.|)$')
  [ -z "$extra" ] || fail "$f: content beyond headings and '- None yet.': $(head -n 1 <<<"$extra")"
  # every section holds exactly one '- None yet.'
  awk '/^## /{ if (h != "" && c != 1) bad = bad " " h; h = $0; c = 0; next }
       /^- None yet\.$/{ c++ }
       END { if (h != "" && c != 1) bad = bad " " h; if (bad != "") { print bad; exit 1 } }' "$f" >/dev/null \
    || fail "$f: a section does not hold exactly one '- None yet.'"
done

# US3 scenario 3, FR-005: folders exist with a README and are not ignored
for f in specs/README.md tests/README.md tests/ai/README.md; do
  need_file "$f" && not_ignored "$f"
  [ -f "$f" ] && { [ "$(grep -c '[a-z]' "$f")" -ge 1 ] && [ "$(wc -l < "$f")" -ge 2 ] || fail "$f: needs a title and a purpose line"; }
done
finish
