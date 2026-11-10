# Stack pack: Expo
Load only when .workflow/PROJECT.md names this pack. Non-obvious pitfalls only; standard Expo CLI usage is assumed. Items tagged (unverified) are not confirmed upstream.

## Versions
- Read the SDK (`expo`) and `react-native` versions in package.json first; use docs for the pinned SDK (`docs.expo.dev/versions/v<SDK>.0.0/...`), not `latest`.
- No committed `ios/`/`android/` = CNG: change app config or a config plugin, never the native dirs. Committed dirs = prebuilt: never `prebuild --clean` over hand-edited native code.
- `expo.install.exclude` and `patches/` are intentional pins: leave them.
- Bump SDK/RN/deps only when asked; an upgrade is its own task.

## Commands
- Always `npx expo ...`. Native or Expo deps: `npx expo install <pkg>` (SDK-compatible version), never plain npm/yarn; then `npx expo-doctor`.
- Credit-consuming, explicit user approval only: `eas build` (cloud), `eas submit`, `eas update`, `eas deploy`, `eas credentials`, `eas channel:edit`, `npx testflight`, any `--submit`/`--auto-submit`. Read-only EAS (`whoami`, `build:list`, `build:view`) is fine.
- Check EAS flags with `npx eas-cli@latest <cmd> --help`; SDK 55+ `eas update` needs an EAS environment.

## Test seams
- Unit-test pure functions, hooks, stores, formatters, API mappers (jest-expo + RNTL, unverified). Mock only boundaries: `expo-*` modules, network, timers, storage, navigation hooks.
- Layout, animation, native modules: verify on a simulator at phase gates, not in unit tests.
- RN 0.81+: tests failing on a missing module (e.g. removed `BackHandler` mock) need a proper mock.

## Pitfalls (symptom -> fix)
- Changed app config, config plugin or native dep not picked up -> rebuild the dev client (`npx expo prebuild --clean` first on CNG).
- "Native module not found" in Expo Go -> Expo Go bundles only SDK modules; use a dev client.
- Reanimated fails on SDK 54+ -> install `react-native-worklets`.
- Hermes V1 memory regression with worklets/reanimated on SDK 55-56 and `expo@57.0.8` or lower -> upgrade to `expo@57.0.9`+; do not toggle Hermes.
- Env var undefined in app code -> client vars need the `EXPO_PUBLIC_` prefix; restart Metro.
- OTA update not visible -> needs up to two cold launches; check channel -> branch and runtime version; native changes need a new build.
- Removing a dep breaks the app -> restore its required peer (e.g. `expo-constants` with `expo-router`).
- Platform file split broken -> a default file without platform extension is required; props match across `.ios/.android/.native/.web`.
- Driving the app on a simulator: skip onboarding/dev menu with `__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1` on the dev URL (SDK 58+; earlier SDKs differ, see upstream launch-without-dev-menu.md). iOS `openurl` shows an "Open in app?" prompt for unapproved schemes.
- Performance: measure first; no memoization without a measured render problem; long lists use FlatList/FlashList, never ScrollView.

## Consult upstream
- expo/skills: plugins/expo/skills/{expo-overview, expo-dev-client, expo-upgrade, eas-app-stores, eas-update}/SKILL.md; expo-overview/references/launch-without-dev-menu.md
- callstackincubator/agent-skills: skills/react-native-best-practices/SKILL.md; skills/upgrading-react-native/references/upgrade-verification.md

Source: expo/skills (MIT)
Source: callstackincubator/agent-skills (MIT)
