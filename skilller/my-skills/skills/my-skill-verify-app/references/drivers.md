# Drivers

Try in this order. Commands come from the driver docs and were not run when this was written.

## 1. agent-device (default)

callstack/agent-device (MIT). Needs Node >= 22.12. Version is 0.x: pin an exact version, record it in `.workflow/PROJECT.md` as `Driver: agent-device@<version>`.

- Missing: print `npm i -D agent-device@<pin>`, go to the next driver. Install only on the user's OK (project scope, exact pin; never `@latest`, never global, never under execute).
- Run as `npx --no-install agent-device …`.

```
agent-device open <app-or-id> --platform ios|android --foreground   # session + snapshot with @refs
agent-device snapshot -i
agent-device press @e2 --settle ; fill @e7 "text" --settle
agent-device wait text "Welcome"
agent-device screenshot <path>
agent-device logs clear --restart ; logs path
agent-device close                                                   # --shutdown only if this run booted the device
```

- Refs are valid only in the latest output; copy them exactly.
- Snapshot sparse or AX-unavailable: refs are invalid. Screenshot, navigate, retry; an assertion that needed the tree is NOT_VERIFIED.
- Several devices: `--udid <id>` (iOS) or `--serial <id>` (Android) plus `--session <name>`.
- Unknown command shape: `agent-device help <topic>` (`workflow`, `dogfood`, `validate`, `debugging`).

## 2. Claude desktop built-in iOS simulator tool

`mcp__Claude_Code_iOS_Simulator__control`: iOS only, no accessibility tree, no logs. Call `attach` first; `launch` needs `app_path`.

- A surface passes only when the expected result is plainly visible; otherwise NOT_VERIFIED.
- Save evidence with `xcrun simctl io booted screenshot <path>` (whether the tool's own screenshot writes a file is unverified).

## 3. Platform CLIs (launch and screenshot only)

They cannot tap or type, so only the first-screen smoke can be VERIFIED.

- iOS: `xcrun simctl launch booted <bundle-id>`, `xcrun simctl io booted screenshot <path>`, log `xcrun simctl spawn booted log stream --level error` (stop it when done).
- Android: `adb exec-out screencap -p > <path>`, log `adb logcat -d -b crash` plus `adb logcat -d *:E`.
- Flutter with `integration_test/`: `flutter test integration_test` is the check.
