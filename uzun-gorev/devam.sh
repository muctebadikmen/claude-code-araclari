#!/bin/bash
# SessionStart hook (matcher "compact"): after a compaction, tell Claude to
# re-read the on-disk state and keep working. Never fails, never blocks.
input=$(cat 2>/dev/null)
dir=$(printf '%s' "$input" | /usr/bin/python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd",""))
except Exception: print("")' 2>/dev/null)
[ -n "$dir" ] || dir=${CLAUDE_PROJECT_DIR:-$PWD}
state="$dir/.workflow/STATE.md"

if [ -f "$state" ]; then
  skill=$(grep -m1 -i '^Active skill:' "$state" 2>/dev/null | cut -c1-200)
  phase=$(grep -m1 -i '^Phase:' "$state" 2>/dev/null | cut -c1-300)
  cat <<MSG
The conversation was just compacted. Before doing anything else:
1. Read .workflow/STATE.md, then the plan files it names (PLAN.md, PROGRESS.md, HANDOFF.md if listed).
2. If the active skill below is a my-skill-* skill, invoke it again for the same plan and resume.
3. Continue from the first unfinished step. Do not redo tasks marked done. Background agents and worktrees listed in STATE.md may still be running: wait for and handle their results.
4. Keep working without asking the user, unless the task itself requires a decision.
${skill:+State: $skill}
${phase:+$phase}
MSG
else
  cat <<'MSG'
The conversation was just compacted. Continue the task that was in progress: re-read any plan, notes or state files you were using, check which steps are already done, and carry on from the first unfinished step without asking the user.
MSG
fi
exit 0
