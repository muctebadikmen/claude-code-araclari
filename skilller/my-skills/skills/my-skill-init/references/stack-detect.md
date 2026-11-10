# Stack detection → .workflow/PROJECT.md

## 1. Detect
Check the project root, then one level of subfolders (monorepo). The first matching row wins. `ios/` and `android/` inside an Expo, RN or Flutter project are part of that project, not separate stacks.

| Signal | Stack | Pack |
|---|---|---|
| `pubspec.yaml` with a `flutter:` key | flutter | `stack-flutter` |
| `package.json` dep `react-native` and (dep `expo`, or `app.json` with `"expo"`, or `app.config.{js,ts}`) | expo | `stack-expo` |
| `package.json` dep `react-native`, no expo | rn-bare | no pack |
| `settings.gradle(.kts)` + `build.gradle(.kts)` with `com.android.application` | android | `stack-android` |
| `*.xcodeproj`, `*.xcworkspace` or `Podfile`, none of the above | ios-native | no pack |
| none | none | no pack |

## 2. Read the values from the repo's files
Write only commands found in these files; any other value not found is `unknown`.
- Commands: `package.json` scripts, `Makefile`, `eas.json`, Gradle wrapper, pubspec.
- App id:
  - Expo: `expo.ios.bundleIdentifier` / `expo.android.package` in app.json or app.config.
  - Flutter: `applicationId` in `android/app/build.gradle(.kts)` and `PRODUCT_BUNDLE_IDENTIFIER` in `ios/Runner.xcodeproj/project.pbxproj`.
  - Android: `applicationId` in `app/build.gradle(.kts)`.
- Version pin: Expo SDK (`expo` dep), Flutter (`.fvmrc` or pubspec `environment:`), AGP/Kotlin (`gradle/libs.versions.toml`).

## 3. Write PROJECT.md (≤15 lines)
Init writes it once; afterwards it is hand-edited.
```
# PROJECT
Stack: <expo | flutter | android | rn-bare | ios-native | none> (<version pin>)
Pack: <stack-expo | stack-flutter | stack-android | no pack>
App id: <ios id> / <android id> | unknown
Install: <command>
Build: <command>
Test: <command>
Analyze: <lint / typecheck command>
Run: <simulator/emulator run command>
Test account: env <USER_VAR>/<PASS_VAR> | none   (variable names only, never values)
Driver: agent-device@<version>   (optional, added by verify-app)
Detected: <YYYY-MM-DD> from <manifest files>
```

Source: gamedev-skills/awesome-gamedev-agent-skills router (Apache-2.0), idea only
