# Preflight checks

Read-only. Run each row that applies to the stack. Status: OK, FAIL, or UNKNOWN when the check could not run. Cite `file:line` or the command and its exit code.

| Check | Where | OK means |
|---|---|---|
| Version | Expo: `app.json`/`app.config.*` `version`; Flutter: `pubspec.yaml` `version: x.y.z+n`; Android: `versionName` in `build.gradle(.kts)`; iOS: `MARKETING_VERSION` | Valid semver-like string, differs from the last released one |
| Build number | Expo: `ios.buildNumber`, `android.versionCode`, `eas.json` `autoIncrement`/`appVersionSource`; Flutter: the `+n`; Android: `versionCode`; iOS: `CURRENT_PROJECT_VERSION` | Greater than the last uploaded build (store tool; none: UNKNOWN), or `autoIncrement` is on |
| Signing | Android: `signingConfigs` block exists in gradle; `test -e` on the keystore and `key.properties` named there. iOS: `test -e` on provisioning/ExportOptions the build names; ASC key `.p8` listed by name only. Expo: `eas.json` profile exists; credentials live on EAS (`eas credentials` is interactive: UNKNOWN) | Files and config exist. Contents never read |
| Privacy manifest | iOS: `PrivacyInfo.xcprivacy` | Present when the project ships iOS |
| Permission strings | iOS: every `NS*UsageDescription` the code needs is in Info.plist (Expo: `ios.infoPlist`). Android: every `<uses-permission>` entry is used | No empty or placeholder text |
| Target SDK | Android `targetSdk`/`targetSdkVersion` | Meets Play's current minimum. It changes yearly (unverified): look it up in Play Console help and quote the source |
| App id | Build config, `.workflow/PROJECT.md`, the store record | Same string everywhere |
| Release notes | `CHANGELOG.md`, `fastlane/metadata`, `metadata/`, or the plan | A non-empty entry for this version |
| Changelog | `CHANGELOG.md` against `git log <last tag>..HEAD --oneline` | The entry for this version covers the commits since the last tag |
| Verify-app | Latest `.workflow/verify-app/*.md` | `Outcome: VERIFIED` and newer than the last commit touching app code. Stale or absent: FAIL |
| Git | `git status --short`, `git log @{u}..` | Clean and pushed. No upstream: FAIL "not pushed". Report only |

## Report format (`.workflow/runs/release/<ts>.md`)

```
# Release preflight <ts>   Commit: <sha>   Stack: <stack>   Target: TestFlight | Play internal | both
Verdict: READY | BLOCKED | UNKNOWN
| Check | Status OK/FAIL/UNKNOWN | Evidence (file:line or command + exit code) |
## Fixes (by hand)
## Not run
## v2, needs explicit yes
```

Source idea: dry-run-before-mutation and readiness-gate pattern from rorkai/app-store-connect-cli-skills (MIT).
