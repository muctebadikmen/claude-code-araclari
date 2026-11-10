# Mobile lenses

Use only when `.workflow/PROJECT.md` names a mobile stack. Append the lines that fit that stack (Expo/RN, Flutter, Android, iOS) to the analyzer's lens list.

- Process killed or backgrounded mid-operation; state restored incompletely.
- Main-thread blocking (ANR); UI mutated off the main thread/actor.
- Leaks: retain cycles, listeners never removed, unbounded caches or image memory.
- Offline, timeout, partial response: no handling or no user feedback.
- Permission denied or revoked after grant: dead end or crash.
- Persistence migration from an old app version missing or lossy.
- Deep link or navigation stack lands in an invalid state.
- Notification and background-task callbacks that assume a live UI or session.
- Secrets or tokens in plist/manifest/AsyncStorage; ATS or cleartext exceptions.
- API used without OS-version gating.
- Silent failure: empty catch, or a fallback that hides the error.

Source: ideas from Axiom agents (MIT), the Android ANR audit guide (Apache-2.0), ECC silent-failure-hunter (MIT); own wording.
