#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Blocks destructive git that is actually executed.
# Quoted text, heredoc bodies, commit messages and echo/grep arguments do not count.
# Block = exit 2 + message on stderr (Claude Code feeds stderr back to the model).
set -o pipefail
command -v jq >/dev/null || { echo "guard-git: jq missing, blocking" >&2; exit 2; }
input=$(cat)
[ "$(jq -r '.tool_name // ""' <<<"$input")" = "Bash" ] || exit 0
raw=$(jq -r '.tool_input.command // ""' <<<"$input")
# drop heredoc bodies, then join lines
raw=$(awk 'd!=""{ if ($0==d) d=""; next } { print; if (match($0,/<<-?[ ]*["\x27]?[A-Za-z_][A-Za-z0-9_]*/)) { s=substr($0,RSTART,RLENGTH); gsub(/<<-?[ ]*["\x27]?/,"",s); d=s } }' <<<"$raw" | tr '\n' ';')
# remove quoted strings (leftmost quote wins), unless a shell is asked to run a string
if grep -qE '(^|[;&|( `])((ba|z)?sh|eval)[ ].*-c[ ]*["'"'"']' <<<"$raw"; then cmd="$raw"
else cmd=$(sed -E "s/\"[^\"]*\"|'[^']*'/ /g" <<<"$raw"); fi
# git in command position: segment start, optional env assignments / env / sudo / path prefix
P='(^|[;&|(`"'"'"'])[ ]*(((env|sudo|command|time|nohup|xargs|exec)|[A-Za-z_][A-Za-z0-9_]*=[^ ]*)[ ]+)*([^ ;&|]*/)?git'
S='[^;&|]*'            # stay inside one shell segment
block() { echo "BLOCKED by guard-git: $1. Use my-skill-ship for committing and pushing; ask the user for anything destructive." >&2; exit 2; }
has() { grep -qE -- "$1" <<<"$cmd"; }

has "$P$S push$S( -[a-zA-Z]*f[a-zA-Z]*([^a-zA-Z-]|\$)| --force| \\+[^ ])" && block "force-push"
has "$P$S reset$S --hard"                     && block "git reset --hard"
has "$P$S clean$S( -[a-zA-Z]*f| --force)"     && block "git clean -f"
has "$P$S branch$S( -[a-zA-Z]*D| --delete --force)" && block "git branch -D"
has "$P$S --no-verify|$P$S commit$S -[a-zA-Z]*n([^a-zA-Z-]|\$)" && block "--no-verify / commit -n"
exit 0
