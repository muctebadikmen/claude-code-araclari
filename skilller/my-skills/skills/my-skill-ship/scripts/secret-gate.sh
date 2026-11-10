#!/usr/bin/env bash
# Secret gate. Usage: secret-gate.sh [--staged | --range <rev>]
# Scope: added lines of every unpushed commit (HEAD --not --remotes; --range: <rev>..HEAD),
#   plus staged diff, unstaged changes and untracked files. --staged: staged diff only.
# Uses trufflehog if installed (--no-verification), else the regex fallback in references/secret-patterns.md.
# Never prints matched text. Lines: `path:line — <name>` or `commit <sha> path[:line] — <name>`.
# Exit: 0 clean, 1 findings, 2 error. BSD/macOS compatible (bash 3.2, BSD grep/awk/sed).
set -euo pipefail
trap 'echo "GATE: error | line $LINENO"; exit 2' ERR
HERE=$(cd "$(dirname "$0")" && pwd)
PAT="$HERE/../references/secret-patterns.md"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "GATE: error | not a git repo"; exit 2; }
cd "$(git rev-parse --show-toplevel)"
MODE=all; RANGE=""
case "${1:-}" in
  "") ;;
  --staged) MODE=staged ;;
  --range) RANGE=${2:-}; git rev-parse -q --verify "$RANGE^{commit}" >/dev/null || { echo "GATE: error | bad --range rev"; exit 2; } ;;
  *) echo "GATE: error | unknown argument"; exit 2 ;;
esac
export EXCL='(^|/)(node_modules|vendor|\.git|\.worktrees)/|^\.workflow/(research|dispatch|audit|runs)/|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock|Gemfile\.lock|pubspec\.lock)$|secret-patterns\.md$|\.(log|jsonl)$'
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
: > "$T/out"; : > "$T/x"; : > "$T/m"
G() { git -c core.quotePath=false "$@"; }

# Unpushed commits.
REVS=""; LOGREV=()
if [ "$MODE" = all ] && git rev-parse -q --verify HEAD >/dev/null; then
  if [ -n "$RANGE" ]; then LOGREV=("$RANGE..HEAD"); else LOGREV=(HEAD --not --remotes); fi
  REVS=$(git rev-list "${LOGREV[@]}")
fi

kind_of() {
  case "${1##*/}" in
    .env.example|.env.sample|.env.template) echo "" ;;
    .env|.env.*|.envrc|*.pem|*.key|*.p12|*.pfx|*.p8|*.mobileprovision|*.keystore|*.jks|key.properties|local.properties|id_rsa*|id_ed25519*|.htpasswd|.netrc|serviceAccount*.json|credentials|credentials.json|credentials.yml|credentials.yaml|secrets.json|secrets.yml|secrets.yaml) echo block ;;
    *) echo "" ;;
  esac
}
excluded() { printf '%s\n' "$1" | grep -Eq "$EXCL"; }

# 1a. Sensitive file names in unpushed history (also files committed and later deleted).
if [ -n "$REVS" ]; then
  sha=?
  while IFS= read -r l; do
    case "$l" in "@@C "*) sha=${l#@@C }; continue ;; "") continue ;; esac
    if excluded "$l"; then continue; fi
    k=$(kind_of "$l")
    if [ "$k" = block ]; then echo "commit $sha $l — sensitive file"; fi
  done < <(G log --format='@@C %h' --name-only --diff-filter=ACMR "${LOGREV[@]}") >> "$T/out"
fi

# 1b. Sensitive file names now: staged (+ modified, untracked unless --staged).
{
  G diff --cached --name-only --diff-filter=d
  if [ "$MODE" = all ]; then G ls-files -m; G ls-files -o --exclude-standard; fi
} | sort -u > "$T/now"
while IFS= read -r f; do
  if [ -z "$f" ] || excluded "$f"; then continue; fi
  k=$(kind_of "$f")
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then st=tracked; else st=untracked; fi
  if [ "$k" = block ]; then echo "$f — sensitive file ($st)"; fi
done < "$T/now" >> "$T/out"

# 2. Content.
if command -v trufflehog >/dev/null 2>&1; then
  SCANNER=trufflehog
  # Whitelist of fields only. Raw/RawV2/Redacted are never selected.
  JQ='fromjson? | select(.SourceMetadata?) | (.SourceMetadata.Data.Git // .SourceMetadata.Data.Filesystem // {}) as $m | (if $m.commit then "commit \($m.commit[0:7]) " else "" end) + "\($m.file // "?"):\($m.line // 0) — \(.DetectorName // "?")"'
  if [ -n "$REVS" ]; then
    A=(git "file://$PWD" --branch HEAD --no-verification --json --no-update)
    if [ -n "$RANGE" ]; then A+=(--since-commit "$RANGE")
    else B=$(git rev-parse -q --verify "$(printf '%s\n' "$REVS" | tail -1)^" 2>/dev/null || true); if [ -n "$B" ]; then A+=(--since-commit "$B"); fi; fi
    trufflehog "${A[@]}" 2>/dev/null | jq -R -r "$JQ" 2>/dev/null >> "$T/out" || true
  fi
  FILES=(); while IFS= read -r f; do if [ -n "$f" ] && [ -f "$f" ] && ! excluded "$f"; then FILES+=("$f"); fi; done < "$T/now"
  if [ ${#FILES[@]} -gt 0 ]; then
    trufflehog filesystem "${FILES[@]}" --no-verification --json --no-update 2>/dev/null | jq -R -r "$JQ" 2>/dev/null >> "$T/out" || true
  fi
else
  SCANNER=regex
  echo "fallback: regex (trufflehog not installed; entropy-only secrets not detected)"
  # Collect added lines: x = content (never printed), m = "<sha|-> TAB path TAB line".
  {
    if [ -n "$REVS" ]; then G log -p -U0 --no-color --no-ext-diff --format='@@C %h' "${LOGREV[@]}"; fi
    echo '@@C -'
    G diff --cached -U0 --no-color --no-ext-diff
    if [ "$MODE" = all ]; then
      G diff -U0 --no-color --no-ext-diff
      G ls-files -o --exclude-standard | while IFS= read -r f; do
        [ -f "$f" ] || continue
        G diff --no-index -U0 --no-color --no-ext-diff -- /dev/null "$f" || true
      done
    fi
  } | awk -v X="$T/x" -v M="$T/m" '
    /^@@C / { sha = $2; file = ""; hdr = 0; next }
    /^diff / { hdr = 1; file = ""; next }
    hdr && /^\+\+\+ / { f = substr($0, 5); if (f == "/dev/null") file = ""; else { sub(/^b\//, "", f); file = f }
                        if (file ~ ENVIRON["EXCL"]) file = ""; next }
    hdr && !/^@@ / { next }
    /^@@ / { hdr = 0; s = $0; sub(/^@@ -[^ ]* \+/, "", s); sub(/[ ,].*/, "", s); ln = s + 0; next }
    /^\+/ { if (file != "") { print substr($0, 2) > X; print sha "\t" file "\t" ln > M }; ln++; next }'
  while IFS= read -r line; do
    name=${line%% :: *}; re=${line#* :: }
    grep -anEi -e "$re" "$T/x" 2>/dev/null | cut -d: -f1 > "$T/i" || true
    [ -s "$T/i" ] || continue
    awk -F'\t' -v n="$name" 'NR == FNR { w[$1] = 1; next }
      (FNR in w) { if ($1 == "-") print $2 ":" $3 " — " n; else print "commit " $1 " " $2 ":" $3 " — " n }' "$T/i" "$T/m" >> "$T/out"
  done < <(sed -n '/^```patterns$/,/^```$/p' "$PAT" | grep ' :: ')
fi

sort -u "$T/out" | grep -v '^$' > "$T/f" || true
cat "$T/f"
n=$(grep -vc "^fallback:" "$T/f" || true)
if [ "$n" -gt 0 ]; then echo "GATE: findings $n | scanner=$SCANNER"; exit 1; fi
echo "GATE: clean | scanner=$SCANNER"
