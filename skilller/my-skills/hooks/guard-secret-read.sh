#!/usr/bin/env bash
# PreToolUse hook (matcher: Read|Grep|Glob|Bash). Blocks reading the CONTENT of secret files.
# A filename used as a search pattern or text (grep .env README.md, echo .env) passes.
# List mirrors my-skill-ship/references/secret-patterns.md (keep in sync).
# Block = exit 2 + message on stderr.
set -o pipefail
command -v jq >/dev/null || { echo "guard-secret-read: jq missing, blocking" >&2; exit 2; }
input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
PROTECTED='^(\.env(rc)?(\.[A-Za-z0-9_.-]+|[*?])?|key\.properties)$|\.(p8|p12|keystore|jks|mobileprovision)$'
ALLOW='^\.env\.(example|sample|template)$'
block() { echo "BLOCKED by guard-secret-read: $1 is a secret file. Do not read it; ask the user to check it themselves." >&2; exit 2; }
secret() { # $1 = one token; split on non-path chars so python -c "open('.env')" is seen too
  local t b
  for t in $(tr -c 'A-Za-z0-9_./*?:=-' ' ' <<<"$1"); do
    t=${t##*[=:]}; b=${t##*/}
    grep -qE -- "$ALLOW" <<<"$b" && continue
    grep -qE -- "$PROTECTED" <<<"$b" && return 0
  done
  return 1
}
check() { local t; for t in "$@"; do [ -n "$t" ] && secret "$t" && block "$t"; done; return 0; }
case "$tool" in
  Read) check "$(jq -r '.tool_input.file_path // ""' <<<"$input")" ;;
  Grep) check "$(jq -r '.tool_input.path // ""' <<<"$input")" "$(jq -r '.tool_input.glob // ""' <<<"$input")" ;;
  Glob) check "$(jq -r '.tool_input.pattern // ""' <<<"$input")" "$(jq -r '.tool_input.path // ""' <<<"$input")" ;;
  Bash)
    raw=$(jq -r '.tool_input.command // ""' <<<"$input")
    raw=$(awk 'd!=""{ if ($0==d) d=""; next } { print; if (match($0,/<<-?[ ]*["\x27]?[A-Za-z_][A-Za-z0-9_]*/)) { s=substr($0,RSTART,RLENGTH); gsub(/<<-?[ ]*["\x27]?/,"",s); d=s } }' <<<"$raw")
    READ='^(cat|head|tail|less|more|bat|nl|tac|sed|awk|grep|egrep|fgrep|rg|ag|cut|sort|strings|xxd|od|base64|source|\.|scp|curl|tee|jq|yq|python3?|node|ruby|perl|vim?|nano|diff)$'
    while IFS= read -r seg; do
      seg=$(sed -E 's/[0-9]*>>?&?[ ]*[^ ]*//g; s/</ < /g' <<<"$seg")      # output redirects are not reads
      tok=(); while IFS= read -r t; do tok+=("$t"); done < <(grep -oE "\"[^\"]*\"|'[^']*'|[^ ]+" <<<"$seg" | sed -E "s/^[\"']//; s/[\"']\$//")
      i=0; while [ $i -lt ${#tok[@]} ] && grep -qE '^(env|sudo|command|time|nohup|xargs|exec|[A-Za-z_][A-Za-z0-9_]*=.*)$' <<<"${tok[$i]}"; do i=$((i+1)); done
      c=${tok[$i]:-}; c=${c##*/}; rest=("${tok[@]:$((i+1))}")
      [ "$c" = git ] && grep -qE '^(show|diff|log|blame|cat-file)$' <<<"${rest[0]:-}" && c=cat
      if [[ " ${tok[*]} " == *" < "* ]]; then c=cat; fi                  # input redirect reads the file
      grep -qE "$READ" <<<"$c" || continue
      if grep -qE '^(grep|egrep|fgrep|rg|ag|sed|awk|jq|yq)$' <<<"$c"; then   # first non-option arg is a pattern/script
        out=(); drop=1; for t in "${rest[@]}"; do
          if [[ $t == -e || $t == -f || $t == --regexp* ]]; then drop=0; skip=1; continue; fi
          [ "${skip:-0}" = 1 ] && { skip=0; continue; }
          if [ $drop = 1 ] && [[ $t != -* ]]; then drop=0; continue; fi
          out+=("$t"); done; rest=("${out[@]}"); fi
      check "${rest[@]}"
    done < <(tr ';&|\n' '\n\n\n\n' <<<"$raw") ;;
esac
exit 0
