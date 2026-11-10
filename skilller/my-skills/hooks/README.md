# Guard hooks

Two PreToolUse hooks in bash + jq (jq missing: both block with a message). Not installed: adding them to settings is a global change that needs the owner's yes.

| Script | Matcher | Blocks | Passes |
|---|---|---|---|
| `guard-git.sh` | `Bash` | an executed force-push (`-f`, `--force`, `--force-with-lease`, `+refspec`), `reset --hard`, `clean -f`, `branch -D`, `--no-verify` / `commit -n`; also behind `/usr/bin/`, `env `, `sudo `, `$(`, `bash -c "…"` | `git push`, `push -n`, `merge -n`; the same words inside a quoted argument, a commit message (`-m`, `-F`, heredoc) or an echo/grep pattern |
| `guard-secret-read.sh` | `Read\|Grep\|Glob\|Bash` | reading the content of `.env*`, `*.p8`, `*.p12`, `*.keystore`, `*.jks`, `key.properties`, `*.mobileprovision` via Read `file_path`, Grep `path`/`glob`, Glob `pattern`/`path`, or a Bash content reader (`cat`, `<`, `grep KEY .env`, `jq`, `python`, `git show HEAD:.env`, editors …) | `.env.example`/`.sample`/`.template`; a filename used as a search pattern or text (`grep .env README.md`, `echo .env`); `ls`, `test`, `stat`, `cp`, `git ls-files`, `git check-ignore` |

The read guard covers the secret files a coding session is likely to open. Ship's scan (`skills/my-skill-ship/references/secret-patterns.md`) checks a wider list before every push.

Convention: the hook reads the tool call as JSON on stdin; exit 2 blocks it and shows stderr to Claude; exit 0 allows. Same as the archived hooks-mastery and git-guardrails examples (unverified against the installed Claude Code version).

## Install (settings.json)

Replace `/path/to` with this directory's absolute path.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "/path/to/hooks/guard-git.sh" }] },
      { "matcher": "Read|Grep|Glob|Bash", "hooks": [{ "type": "command", "command": "/path/to/hooks/guard-secret-read.sh" }] }
    ]
  }
}
```

Test: `echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | ./guard-git.sh; echo $?` prints a message and `2`.

## Limits

The hooks parse the command text (quotes, heredocs, segments, first-argument patterns): they stop accidents, not a determined bypass.

- A command built at runtime (`eval "$x"`, `sh script.sh`) is not inspected.
- `grep -f patterns .env` style option mixes may misjudge which argument is the pattern; the file argument is still checked.
- Grep over a directory passes; ripgrep skips hidden and git-ignored files by default (unverified for Claude Code's Grep).

Source: git-guardrails pattern list (mattpocock/skills, MIT) and the exit-2 convention (disler/claude-code-hooks-mastery); our own wording.
