# Secret patterns

Used by the two scan agents dispatched in ship step 2. Exclusions for both: `node_modules/`, `vendor/`, lockfiles, `.workflow/` scratch (`research/`, `dispatch/`, `audit/`, `runs/`), `.worktrees/`, `.git/`, `**/secret-patterns.md`, build output, binaries, and logs (`*.log`, `*.jsonl`).

## Sensitive files (glob) — `Find sensitive files` (haiku)

`**/.env`, `**/.env.*` (except `.env.example`, `.env.sample`), `**/*.pem`, `**/*.key`, `**/*.cert`, `**/*.crt`, `**/*.p12`, `**/*.pfx`, `**/*credentials*`, `**/*secret*`, `**/id_rsa*`, `**/id_ed25519*`, `**/.htpasswd`, `**/*.keystore`, `**/*.jks`, `**/serviceAccount*.json`

Report each match as `path — sensitive file (<glob>)` plus `tracked` only when `git ls-files --error-unmatch <path>` exits 0, else `untracked`. Do not open the file.

## In-code patterns (extended regex, case-insensitive where sensible) — `Grep for hardcoded secrets` (sonnet)

| name | regex |
|---|---|
| openai-style key | `sk-[A-Za-z0-9_-]{8,}` |
| stripe key | `[sp]k_(live|test)_[A-Za-z0-9]{8,}` |
| aws access key | `AKIA[0-9A-Z]{16}` |
| aws secret | `aws_secret_access_key` |
| generic api key | `api[_-]?key\s*[:=]\s*["'][^"']{8,}` |
| generic token | `(token|auth_token|access_token)\s*[:=]\s*["'][^"']{16,}` |
| bearer | `bearer\s+[A-Za-z0-9._-]{16,}` |
| password literal | `password\s*[:=]\s*["'][^"']{4,}` |
| secret literal | `(secret|client_secret|private_key)\s*[:=]\s*["'][^"']{4,}` |
| connection string with creds | `(postgres(ql)?|mysql|mongodb(\+srv)?|redis)://[^:/\s]+:[^@\s]+@` |
| private key block | `-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----` |
| google api key | `AIza[0-9A-Za-z_-]{35}` |
| github token | `gh[pousr]_[A-Za-z0-9]{36,}` |
| slack token | `xox[baprs]-[A-Za-z0-9-]{10,}` |

Run the grep with `-l` or `-n` piped through a filter that keeps only the path and line number (for example `grep -rnE -e <regex> . | cut -d: -f1,2`; the `-e` keeps a regex that starts with `-` from being read as an option). Never print matching lines to your own output.

## Report format (both agents)

One line per finding: `path:line — <name>` using the name column above (a line matching several patterns lists the first). Never include the matched text: no quote, no prefix such as `sk-live-…`, no suffix, no last-4, no character count, no paraphrase of what the value looks like. If nothing matches, return the single word `clean`.
