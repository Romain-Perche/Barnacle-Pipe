#!/usr/bin/env bash
# US1: Factory runs read a real constitution. covers FR-001, FR-002, SC-001
source "$(dirname "$0")/../lib.sh"
c=.specify/memory/constitution.md
need_file "$c" || finish

# US1 scenario 1, SC-001: no placeholder tokens, no template example comments
grep -Eq '\[[A-Z][A-Z0-9_]*\]' "$c" && fail "placeholder tokens remain: $(grep -Eo '\[[A-Z][A-Z0-9_]*\]' "$c" | sort -u | tr '\n' ' ')"
grep -q '<!--' "$c" && fail "HTML/template comments remain"

# US1 scenario 2, FR-001: name, >=3 principles, workflow, governance, version line with both dates
grep -q 'Barnacle-Pipe' "$c" || fail "project name Barnacle-Pipe missing"
n=$(section "$c" '## Core Principles' | grep -c '^### ')
[ "$n" -ge 3 ] || fail "only $n principles (need >= 3)"
section "$c" '## Development Workflow' | grep -q '[a-z]' || fail "Development Workflow section empty"
section "$c" '## Governance' | grep -q '[a-z]' || fail "Governance section empty"
grep -Eq '\*\*Ratified\*\*: 2026-11-18' "$c" || fail "Ratified date missing"
grep -Eq '\*\*Last Amended\*\*: [0-9]{4}-[0-9]{2}-[0-9]{2}' "$c" || fail "Last Amended date missing"

# US1 scenario 3: each principle can be evaluated pass/fail: has a MUST rule and a rationale
for p in '### I. Specification Before Code' '### II. Tests Before Code' '### III. Keep It Simple'; do
  body=$(section "$c" "$p")
  grep -q 'MUST' <<<"$body" || fail "'$p' has no MUST rule"
  grep -qi 'rationale' <<<"$body" || fail "'$p' has no rationale"
done

# FR-002: principles cover spec-first, test-first, simplicity
section "$c" '### I. Specification Before Code' | grep -qi 'spec' || fail "principle I does not talk about the spec"
section "$c" '### II. Tests Before Code' | grep -qi 'fail' || fail "principle II does not require tests seen failing first"
section "$c" '### III. Keep It Simple' | grep -qi 'simple' || fail "principle III does not talk about simplicity"

# FR-002: process rules only, no technology stack
stack='\b(Python|JavaScript|TypeScript|Node\.js|Deno|React|Vue|Angular|Django|Flask|FastAPI|Rails|Ruby|Java|Kotlin|Rust|Golang|PHP|C#|\.NET|PostgreSQL|MySQL|SQLite|MongoDB|Redis|Kubernetes|AWS|Azure|GCP|Vercel|Heroku)\b'
grep -Eq "$stack" "$c" && fail "constitution names a technology: $(grep -Eo "$stack" "$c" | sort -u | tr '\n' ' ')"
finish
