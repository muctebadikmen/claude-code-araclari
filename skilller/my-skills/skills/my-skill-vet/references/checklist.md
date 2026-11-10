# Vet checklist

Run each command from the target directory, excluding `.git`, `node_modules` and lockfiles. Collect `file:line` hits, then read each hit line and judge it. The commands were not run when this was written (BSD vs GNU flags unverified).

Source: category list modelled on snyk/agent-scan `docs/issue-codes.md` (Apache-2.0): E004 prompt injection in skill, E005 suspicious download, E006 malicious code patterns, W007 credential handling, W008 hardcoded secrets, W011 untrusted third-party content, W012 unverifiable dependency, W021 hidden unicode. Own wording. `snyk agent-scan` itself is left to the user: it needs a `SNYK_TOKEN` and uploads component text to Snyk.

## Code that runs

- Hooks and settings: `find . -name 'hooks*' -o -name 'settings*.json' -o -name '.mcp.json' -o -name 'plugin.json' | head`, then read the `command` fields.
- Scripts: `find . -type f \( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.ts' \) | head -50`.
- Package scripts: `grep -nE '"(preinstall|install|postinstall|prepare|prepublish)"' package.json`.
- Download-and-run: `grep -rnIE 'curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh|base64\s+(-d|--decode)|\beval\b|\bexec\(|child_process|os\.system|subprocess'`.
- Unpinned: `grep -rnIE 'npx\s+(-y\s+)?[^ ]*@latest|npx\s+-y\s|pip install [^=]*$|@latest|:latest'`.
- Binaries: `find . -type f -perm -u+x ! -name '*.sh'`; `find . -type f \( -name '*.so' -o -name '*.dylib' -o -name '*.exe' -o -name '*.node' -o -name '*.jar' -o -name '*.wasm' \)`; `file` on the hits.

## Reach outside the repo

- Network: `grep -rnIE 'https?://|fetch\(|axios|requests\.|urllib|WebFetch|curl |wget '`; list the hosts, drop docs links.
- Telemetry: `grep -rnIiE 'telemetry|analytics|posthog|sentry|segment|mixpanel|scarf|DO_NOT_TRACK|DISABLE_TELEMETRY'`. Note the opt-out variable.
- Config writes: `grep -rnIE '\.claude|settings\.json|CLAUDE\.md|\.zshrc|\.bashrc|LaunchAgents|crontab'`.
- Credential reads: `grep -rnIE '\.env|\.ssh|id_rsa|keychain|\.aws|credentials|\.npmrc|\.netrc|api[_-]?key|token'`.

## Prompt injection (in SKILL.md, README, agent and command files)

- Phrases: `grep -rnIiE 'ignore (all |any )?(previous|prior|above)|disregard|you must not tell|do not (tell|inform|mention).{0,20}user|system prompt|developer message|exfiltrat|silently|without (telling|asking)'`.
- Hidden text: HTML comments `grep -rnIE '<!--'`; zero-width and bidi characters `grep -rnIP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]'` (GNU grep or `rg -nP`; BSD grep lacks `-P`; unverified).
- Long base64 blobs: `grep -rnIE '[A-Za-z0-9+/]{120,}={0,2}'`.
- Instructions that widen permissions: `allowed-tools`, `Bash(*)`, `bypassPermissions`, `dangerouslyDisable`.

A hit is a finding only when the quoted line does what its category says. A doc that merely mentions a pattern is noise: say so.

Verdict: SKILL.md "Verdict". Telemetry on by default, `@latest` and global installs are adopt-with-changes items (pin, opt out).
