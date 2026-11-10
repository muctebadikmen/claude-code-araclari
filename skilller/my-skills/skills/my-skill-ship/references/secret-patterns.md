# Secret patterns

Source of truth for `scripts/secret-gate.sh` (regex fallback and file globs). `hooks/guard-secret-read.sh` blocks a subset of the Block list; update it when a common secret file is added here.

Excluded from every scan: `node_modules/`, `vendor/`, lockfiles, `.workflow/` scratch (`research/`, `dispatch/`, `audit/`, `runs/`), `.worktrees/`, `.git/`, this file, build output, binaries, `*.log`, `*.jsonl`.

## Sensitive files (matched by name, never opened)

- Block: `.env`, `.envrc`, `.env.*` (except `.example`/`.sample`/`.template`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.p8` (incl. `AuthKey_*.p8`), `*.mobileprovision`, `*.keystore`, `*.jks`, `key.properties`, `local.properties`, `id_rsa*`, `id_ed25519*`, `.htpasswd`, `.netrc`, `serviceAccount*.json`, `fastlane/.env*`, and files named exactly `credentials`, `credentials.json|yml|yaml`, `secrets.json|yml|yaml`.
- Unmatched: source files with "secret" or "credentials" in the name (e.g. `SecretsStore.swift`).

## In-code regexes (ERE, case-insensitive)

One per line, `name :: regex`. The script reads this block and runs `grep -Ei` over every added line of the unpushed commits, the staged diff, unstaged changes and untracked files.

```patterns
openai-style key :: (^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}
stripe secret key :: [sr]k_(live|test)_[A-Za-z0-9]{8,}
aws access key :: AKIA[0-9A-Z]{16}
aws secret :: aws_secret_access_key
generic api key :: api[_-]?key[[:space:]]*[:=][[:space:]]*["'][^"']{8,}
generic token :: (token|auth_token|access_token)[[:space:]]*[:=][[:space:]]*["'][^"']{16,}
bearer :: bearer[[:space:]]+[A-Za-z0-9._-]{16,}
password literal :: password[[:space:]]*[:=][[:space:]]*["'][^"']{4,}
secret literal :: (secret|client_secret|private_key)[[:space:]]*[:=][[:space:]]*["'][^"']{4,}
connection string with creds :: (postgres(ql)?|mysql|mongodb(\+srv)?|redis)://[^:/[:space:]]+:[^@[:space:]]+@
private key block :: -----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----
google api key :: AIza[0-9A-Za-z_-]{35}
github token :: gh[pousr]_[A-Za-z0-9]{36,}
slack token :: xox[baprs]-[A-Za-z0-9-]{10,}
```

Stripe publishable keys (`pk_`) are public, so unmatched. Keep the leading guard on `sk-`; without it words like `task-notification` match.

## Gate output

One line per hit, then one `GATE:` line. Ship acts on:

- `path:line — <name>`: in-code hit in the working tree or staged diff.
- `<path> — sensitive file (<state>)`: a Block file.
- `commit <sha> path[:line] — <name>` or `commit <sha> <path> — sensitive file`: hit in unpushed history, reported even when a later commit removed it.
- `fallback: regex …`: mention only (trufflehog absent).
- `GATE: clean | scanner=<name>`, `GATE: findings <n> | scanner=<name>` or `GATE: error | <reason>`.

Commit hit 🛑 message, three lines: "Secret in unpushed commit <sha>: <path> — <name>." / "Not pushed; ship never rewrites history." / "Remove it from unpushed history (interactive rebase, or reset and recommit), then ship; rotate it if ever pushed or shared."

A hit carries its location and pattern name only: no quote, prefix, suffix, last-4, length or description of the matched text. A hit that looks like a placeholder or fixture is still reported; the user decides.

Source: trufflehog CLI flags checked against its source (AGPL-3.0; CLI called only, no code copied).
