#!/usr/bin/env bash
# Run every shell test. Exit 1 if any fails.
cd "$(dirname "$0")/.." || exit 2
rc=0
for t in tests/contract/*.sh tests/integration/*.sh; do bash "$t" || rc=1; done
exit $rc
