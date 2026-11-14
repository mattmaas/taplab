# TapLab Roadmap

Planned work across **TapLab Companion (Android)** and **TapLab Web**, roughly in priority order.

## 1. Non-root Android input method (`InputMethodService`) (~8–10 hrs)
Right now system-wide Thumb-Free Tap Code typing goes through `RootInjector` (`su` + `input text`), which limits TapLab Companion to Magisk-rooted devices and adds ~200–300 ms per character.
- Add an Android `InputMethodService` (`TapCodeImeService`) backed by the existing `TapCodeDecoder` so unrooted Android phones, tablets, and XR headsets can type via `InputConnection.commitText()` with near-zero latency.
- Keep `RootInjector` as an optional backend for AirMouse clicks/scrolls and hardware-keyboard coexistence when another soft keyboard is active.
- Expose backend selection (`IME` vs `Root shell`) in `CompanionSettings` and `MainActivity`.

## 2. Shift, digits, and punctuation layer in Thumb-Free Tap Code (~6–8 hrs)
`TapCodeDecoder` (both Kotlin in `companion-android` and TypeScript in `src/tapcode/tapcode.ts`) currently covers `a`–`z`, space, backspace, enter, `.`, and `,`.
- Design a conflict-free prefix chord (using unused two-chord control slots under `IM` / `MR` or `I+P`) for one-shot Shift, Caps Lock, digits `0`–`9`, and common punctuation (`?`, `!`, `'`, `-`, `/`, `:`, `@`).
- Mirror the extended table identically in Kotlin (`TapCodeDecoder.kt`, `TapCodeCurriculum.kt`) and TypeScript (`src/tapcode/tapcode.ts`) with parity unit tests.
- Add lessons 11–13 to the native trainer and printable `docs/tap-code-poster.html`.

## 3. Low-latency `uinput` / persistent injection path for rooted mode (~4–6 hrs)
Even with a persistent `su` shell in `RootInjector.kt`, invoking Android's `input text` spawns a JVM process per character (~200–300 ms).
- Replace per-character `input text` calls with a lightweight native/JNI or `/dev/uinput` virtual keyboard writer (matching how `discoverTapEventDevice()` already handles `/dev/input/eventN` for mouse events) to bring rooted character injection under 15 ms.
- Add fallback detection and diagnostic logging under `[TapCode]` when `/dev/uinput` permissions are restricted by SELinux policy.

## 4. `TapOverrideService` state-machine & BLE replay test suite (~5–6 hrs)
`TapCodeDecoderTest.kt` covers chord decoding, while `TapOverrideService.kt` (~1,000 lines covering `TAP_CODE`, `SURFACE_MOUSE`, `AIR_MOUSE`, `STOOD_DOWN`, chord bitmask clicks, double-tap windows, and SDK mode-rearming guards) has no automated tests yet.
- Extract pure mode-resolution and gesture-arbitration state machines out of `TapOverrideService.kt` behind a testable Kotlin interface.
- Build a deterministic packet-replay test harness covering connect/disconnect races, `MULTIMEDIA` surface-mouse stand-down, and stock-HID re-arming regressions.
- Wire `./gradlew testDebugUnitTest` and `npm test` into a GitHub Actions CI workflow.

## 5. Training progress export/import & custom chord profiles (~4–5 hrs)
`TrainingProgressStore.kt` on Android and `src/telemetry/storage.ts` (IndexedDB) on Web store per-character accuracy independently, with no backup across APK reinstalls or device switches.
- Add JSON export/import of lesson history and per-character error stats in `TapCodeTrainerActivity` and the web dashboard.
- Finish hardware verification of four-finger stock chords (`15`, `28`, `29`, `30`) in `src/core/chords.ts` and allow saving custom user chord remaps.

## 6. TapXR compatibility pass (~3–4 hrs)
The vendored SDK (`tap-android-sdk`) includes `TapXRState` and `FEATURE_XR_STATE`, which behave differently from Tap Strap 2 firmware for AirMouse entry.
- Detect TapXR vs Tap Strap 2 capabilities at connection time via `FeatureVersionSupport` and adapt UI guidance and AirMouse state handling accordingly.