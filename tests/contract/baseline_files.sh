#!/usr/bin/env bash
# Contract test: paths and required headings from specs/sf-76-init/contracts/baseline-files.md
# covers FR-001, FR-003, FR-004, FR-005, FR-006, FR-007
source "$(dirname "$0")/../lib.sh"

# Constitution (FR-001)
headings_in_order .specify/memory/constitution.md \
  '# Barnacle-Pipe Constitution' '## Core Principles' \
  '### I. Specification Before Code' '### II. Tests Before Code' '### III. Keep It Simple' \
  '## Factory Run Rules' '## Development Workflow' '## Governance'
[ -f .specify/memory/constitution.md ] && { tail -n 1 .specify/memory/constitution.md | grep -Eq \
  '^\*\*Version\*\*: [0-9]+\.[0-9]+\.[0-9]+ \| \*\*Ratified\*\*: 2026-11-18 \| \*\*Last Amended\*\*: [0-9]{4}-[0-9]{2}-[0-9]{2}$' \
  || fail "constitution: last line is not the version line"; }

# Test recipe (FR-003)
headings_in_order .factory/test-env.md '# Test environment' '## Services' '## Schemas' '## Real runs'

# Ignore rules (FR-004)
if need_file .gitignore; then
  has_line .gitignore '.specify/feature.json'
  has_line .gitignore '.factory/schemas/'
fi

# Guidance file (FR-006)
headings_in_order CLAUDE.md '# Barnacle-Pipe' '## Layout' '## Factory pipeline' '## Rules for every run' '## Key files'

# Product documents (FR-007): exactly these headings, nothing more
check_doc() {
  local f=$1; shift
  headings_in_order "$f" "$@"
  [ -f "$f" ] || return
  [ "$(grep -c '^#' "$f")" = "$#" ] || fail "$f: extra headings beyond the contract"
}
check_doc docs/PRODUCT.md   '# Barnacle-Pipe — Product' '## What it is' '## Users' '## Product rules' '## Out of scope'
check_doc docs/DESIGN.md    '# Barnacle-Pipe — Design' '## Look and feel' '## Wording and tone' '## Accessibility'
check_doc docs/DECISIONS.md '# Barnacle-Pipe — Decisions' '## Decisions'

# Folder READMEs (FR-005)
for pair in 'specs/README.md|# Specs' 'tests/README.md|# Tests' 'tests/ai/README.md|# AI test scenarios'; do
  f=${pair%%|*}; t=${pair#*|}
  need_file "$f" && { [ "$(head -n 1 "$f")" = "$t" ] || fail "$f: first line must be '$t'"; }
done
finish
