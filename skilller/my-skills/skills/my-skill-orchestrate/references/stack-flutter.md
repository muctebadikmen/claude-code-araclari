# Stack pack: Flutter
Load only when .workflow/PROJECT.md names this pack. Non-obvious pitfalls only; standard flutter/dart CLI usage is assumed. Items tagged (unverified) are not confirmed upstream.

## Versions and commands
- No `flutter:` key in pubspec.yaml = pure Dart package: use `dart` commands, not `flutter`.
- Keep the `environment:` SDK constraint, `.fvmrc` (unverified) and `pubspec.lock` pins unless the task is an upgrade. Never delete the whole `pubspec.lock`; on "version solving failed" delete only the blocking package's block.
- Codegen (`dart run build_runner build`) only when pubspec has build_runner; a missing `.mocks.dart` means its import name must match the test file name exactly.
- `integration_test/` is ignored by the default runner: pass the directory explicitly; it runs only at phase gates (slow, needs a device).
- Release builds (`apk|appbundle|ipa --release`), signing, and `pub publish` need user approval.
- After native, plugin or pubspec-asset changes, stop and rerun; hot reload/restart is not enough (`MissingPluginException`).

## Test seams
- Unit-test ViewModel / BLoC / notifier / repository without widgets; mirror `lib/` under `test/`, files end `_test.dart`.
- Widget tests: wrap in `MaterialApp`/`Directionality` when theme or direction is needed; after `tap`/`enterText` use `pump()`; `pumpAndSettle()` only when animations must finish and never with an infinite animation (spinner) — use `pump(Duration)`.
- Lazily built lists: `scrollUntilVisible` before finding an item. Add `ValueKey`s to critical widgets.
- Mockito: `@GenerateNiceMocks`; async stubs use `thenAnswer((_) async => v)`, never `thenReturn` for Future/Stream.

## Pitfalls (symptom -> fix)
- "RenderFlex overflowed" / "unbounded height" (ListView in Column) / "unbounded width" (TextField in Row) -> wrap in `Expanded` or `Flexible`, or give a bounded size.
- "Incorrect use of ParentData widget" -> `Expanded`/`Flexible` must be direct children of Row/Column/Flex; `Positioned` of Stack.
- "RenderBox was not laid out" -> cascading; fix the first constraint error higher in the trace.
- `LateInitializationError` / "Null check operator used on a null value" after a fix -> init order is wrong; remove the `!` or fix the order instead of adding `late`.
- `setState() called after dispose()` -> `if (!mounted) return;` after awaits; cancel timers and subscriptions in `dispose` (unverified).

## Consult upstream
- flutter/agent-plugins: skills/flutter-fix-layout-issues, flutter-add-widget-test, flutter-add-integration-test
- dart-lang/skills: skills/dart-run-static-analysis, dart-fix-runtime-errors, dart-add-unit-test, dart-generate-test-mocks, dart-resolve-package-conflicts, dart-collect-coverage

Source: flutter/agent-plugins (BSD-3-Clause)
Source: dart-lang/skills (BSD-3-Clause)
