# Stack pack: Android
Load only when .workflow/PROJECT.md names this pack. Non-obvious pitfalls only; standard Gradle/adb usage is assumed.

## Versions and commands
- Keep every pinned version; bump only when the plan says so, and bump AGP, Gradle, Kotlin and KSP together (KSP's version prefix must match Kotlin's).
- Use the existing test stack (DI, JUnit 4 vs 5, Mockk vs Mockito, Robolectric); add libraries only when the plan requires them.
- Always `./gradlew`, never a global `gradle`. `./gradlew clean` only as a last resort: fix the stale state's cause.
- `connectedDebugAndroidTest` and Espresso run only at phase gates (need a device). `bundleRelease` and anything touching signing need user approval.
- Never commit `local.properties`.

## Test seams
- JVM unit tests (`src/test`) for ViewModels, use cases, repositories, mappers. Fakes first (interface + `Default*` impl, `Fake*` in the test source set); mocks only when no fake is possible.
- Coroutines: `runTest` with `StandardTestDispatcher`; replace Main via a `MainDispatcherRule`; never `Thread.sleep`. Flow: assert collected states, not timing.
- Robolectric for code touching framework classes; Room via instrumented tests with an in-memory database.
- Screenshot tests: follow the project's existing tool; never two setups in one module.
- Skip unit tests for Activities, composable layouts, DI wiring, generated code, pure data classes.

## Pitfalls (symptom -> fix)
- UI stuck (not a crash) after a background update -> an attached View was mutated off main (sync-barrier-leak ANR); update views on main only.
- Content under the status/nav bar or keyboard after raising targetSdk to 35 -> edge-to-edge is enforced: `enableEdgeToEdge()` before `setContent`, one inset method only (Scaffold `innerPadding` or `safeDrawingPadding()`), `windowSoftInputMode=adjustResize` for text fields.
- Release-only crash, ClassNotFound, missing serialization -> R8 stripped it; add a narrow `-keep` for that class, not package-wide; decode traces with `mapping.txt`.
- Endless recomposition -> fix unstable lambdas/state reads, `key` in lazy lists, `derivedStateOf`; do not blanket-add `@Stable`/`ImmutableList`.
- Feature silently fails -> dangerous permission declared but not requested at runtime (Activity Result API).
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` -> signature differs; `adb uninstall` loses data, so ask first.

## Consult upstream (open the SKILL.md at that path)
- android/skills: testing/testing-setup, performance/anr-audit-and-fix, performance/r8-analyzer, system/edge-to-edge, jetpack-compose/jetpack-compose-performance, security/android-permissions-security, devtools/android-cli.

Source: android/skills (Apache-2.0, ideas only)
Source: android/android-cli-plugin (Apache-2.0, ideas only)
