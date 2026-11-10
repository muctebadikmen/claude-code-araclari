# Crash mode

Start from local evidence: a crash log or stack trace the user pasted or that sits in the repo beats any remote lookup.

## Steps
1. Find the crash log: pasted text, `*.ips`/`*.crash`, `adb logcat` capture, Metro/Hermes red-screen text, Dart stack. Redact secrets and user data.
2. Symbolicate when frames are raw addresses or obfuscated:
   - iOS: `xcrun atos` against the dSYM, or `symbolicatecrash` (flags `(unverified)`).
   - Android native: `ndk-stack`; R8-obfuscated Java: `retrace` with `mapping.txt` `(unverified)`.
   - React Native: map Hermes frames with the build's source map `(unverified)`.
   - Flutter: readable unless built with `--split-debug-info`; then `flutter symbolize` `(unverified)`.
3. Take the exception type and the top frame in app code. Same top frame plus same exception = one group.
4. Look up the signal below and form hypotheses from its first check. Continue at SKILL.md step 3: the repro command replays the crashing input.

## Triage table
| Signal | Check first |
|---|---|
| Force-unwrap / null deref | The value's origin; which path leaves it nil |
| Assertion / precondition | The violated invariant and its caller |
| Actor/queue/main-thread violation | Thread of the call; UI touched off-main |
| Bad access / segfault | Use-after-free, dangling ref, native lib |
| 0x8BADF00D watchdog | Main-thread work at launch or resume |
| Jetsam / OOM | Image or cache growth; leak across screens |
| Background-task expiry | Work not ended in the expiration handler |
| ANR | Main thread blocked: I/O, lock, long loop |
| Dart/JS unhandled | Missing await/catch; error from a promise or stream |

## Remote sources (optional)
Sentry, App Store Connect/TestFlight crash reports and Play Console vitals can supply a log when none is local. Tool names and access are (unverified); use them only when PROJECT.md names the service and the user has access.

Source: crash triage idea from Axiom crash-analyzer (MIT), own rows.
