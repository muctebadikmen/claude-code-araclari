# Secret patterns

Used by the two scan agents in ship step 2. Exclude in both: `node_modules/`, `vendor/`, lockfiles, `.workflow/` scratch (`research/`, `dispatch/`, `audit/`, `runs/`), `.worktrees/`, `.git/`, `**/secret-patterns.md`, build output, binaries, logs (`*.log`, `*.jsonl`).

## Sensitive files (glob): `Find sensitive files` (haiku)

`**/.env`, `**/.env.*` (not `.env.example`/`.env.sample`), `**/*.pem`, `**/*.key`, `**/*.cert`, `**/*.crt`, `**/*.p12`, `**/*.pfx`, `**/*.keystore`, `**/*.jks`, `**/*credentials*`, `**/*secret*`, `**/id_rsa*`, `**/id_ed25519*`, `**/.htpasswd`, `**/serviceAccount*.json`

Report `path — sensitive file (<glob>)` plus `tracked` if `git ls-files --error-unmatch <path>` exits 0, else `untracked`. Don't open the file.

## In-code patterns (extended regex): `Grep for hardcoded secrets` (sonnet)

| name | regex |
|---|---|
| openai-style key | `(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}` |
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

Run with output cut to path and line, e.g. `grep -rnE -e <regex> . | cut -d: -f1,2` (`-e` keeps a regex starting with `-` from being read as an option); never print matching lines. The `sk-` pattern needs the leading non-word guard: without it ordinary words such as `task-notification` match.

A hit that is plainly not a secret (an identifier, prose, an obvious placeholder such as `sk-xxxx`, a test fixture) is reported as `path:line — <name> (false positive: <reason>)`, reason in a few words, no value. Doubt means a finding.

## Report format

One line per finding: `path:line — <name>` (first matching name if several). Never the matched text: no quote, prefix, suffix, last-4, length or description of the value. Nothing found: `clean`.
