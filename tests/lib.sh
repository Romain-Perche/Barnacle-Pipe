# Shared helpers for the shell tests. Source it; call `fail "msg"`, end with `finish`.
cd "$(git rev-parse --show-toplevel)" || exit 2
FAILS=0
fail() { echo "FAIL [$(basename "$0")]: $*"; FAILS=$((FAILS + 1)); }
need_file() { [ -f "$1" ] || { fail "$1 missing"; return 1; }; }
# has_line FILE LINE : LINE appears exactly once as a whole line
has_line() { [ "$(grep -cxF -- "$2" "$1" 2>/dev/null)" = 1 ] || fail "$1: expected exactly one line '$2'"; }
# section FILE HEADING : print the body of a markdown section (until the next heading of same or higher level)
section() { awk -v h="$2" '
  $0 == h { on = 1; lvl = index(h, " "); next }
  on && /^#+ / { n = index($0, " "); if (n <= lvl) exit }
  on { print }' "$1"; }
not_ignored() { git check-ignore -q "$1" && fail "$1 is ignored by git"; return 0; }
# repo_ignores PATH : PATH is ignored by a rule in a committed .gitignore file (not only by this
# machine's .git/info/exclude or global excludes file, which a fresh clone does not have)
repo_ignores() { local src; src=$(git check-ignore -v -- "$1" | cut -d: -f1)
  case "$src" in .gitignore|*/.gitignore) return 0 ;; *) return 1 ;; esac; }
finish() { [ "$FAILS" = 0 ] && echo "ok   [$(basename "$0")]"; exit $((FAILS > 0)); }
# headings_in_order FILE H1 H2 ... : each heading appears exactly once, in this order
headings_in_order() {
  local f=$1; shift; local prev=0 n h
  need_file "$f" || return
  for h in "$@"; do
    [ "$(grep -cxF -- "$h" "$f")" = 1 ] || { fail "$f: heading '$h' not exactly once"; continue; }
    n=$(grep -nxF -- "$h" "$f" | cut -d: -f1)
    [ "$n" -gt "$prev" ] || fail "$f: heading '$h' out of order"
    prev=$n
  done
}
