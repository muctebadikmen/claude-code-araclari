# Optional store tools (read-only, unverified)

None was run when this was written. Use a tool only if it is already installed; installing is the user's call.

## asc CLI

Source: rorkai/App-Store-Connect-CLI and rorkai/app-store-connect-cli-skills (MIT). Needs an Apple Developer account and an App Store Connect API key the user owns.

- Telemetry is on by default (pseudonymous, command-level). Before the first run: `asc telemetry disable`, or set `ASC_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`. Check with `asc telemetry status`.
- Read-only commands seen in the docs (confirm flags with `asc <command> --help`; unverified):
  - `asc builds list --app "APP_ID"` and `asc builds info --build-id "BUILD_ID" --output table`
  - `asc versions view --version-id "VERSION_ID"`
  - `asc validate --app "APP_ID" --version "1.2.3" --platform IOS --output table` (readiness report; `--strict` adds warnings)
  - `asc review doctor --app "APP_ID" --version "1.2.3" --platform IOS --output table`
- v2, do not run: `release stage`, `publish`, `review submit`, `metadata push`.
- Auth comes from the keychain or env; never print it.

## magaza-mcp

Source: tunaarikaya/magaza-mcp (MIT). README states no telemetry. Start it read-only: `--salt-okunur` or `SALT_OKUNUR=1` (removes the write tools).

- Read tools: `appstore__surumler` (versions and status), `appstore__buildler` (TestFlight builds), `play__kanallar` (tracks and versions).
- Tool names come from its README, not a live session (unverified).

## play-store-mcp

Source: lusky3/play-store-mcp (MIT). Deploy-oriented (`deploy_app`, `promote_release`); telemetry not stated (unverified). Use only `get_releases`; prefer magaza-mcp read-only.

## Not used in v1

zelentsov-dev/asc-mcp (duplicates asc), ASO and screenshot tooling, IAP/subscription/pricing tools.
