# Releasing TapLab Companion

Cut a GitHub Release with an installable APK so people can try Thumb-Free Tap Code without
an Android toolchain. Releases are tagged `companion-vX.Y.Z` and versioned from
`companion-android/app/build.gradle` (`versionName` / `versionCode`).

## Checklist

1. Bump `versionCode` and `versionName` in `companion-android/app/build.gradle`.
2. Build and test:
   ```bash
   cd companion-android
   ./gradlew testDebugUnitTest assembleDebug     # Windows: .\gradlew.bat ...
   cd .. && npm test
   ```
3. Smoke-test the APK on a real Tap Strap 2 + rooted device (see `companion-android/README.md`
   → hardware checklist): connect, type a word in another app, click via AirMouse, run one
   trainer lesson.
4. Rename the artifact so the release asset is self-describing:
   ```bash
   cp companion-android/app/build/outputs/apk/debug/app-debug.apk taplab-companion-vX.Y.Z-debug.apk
   ```
5. Commit, tag, push, release:
   ```bash
   git commit -am "release: companion vX.Y.Z"
   git tag companion-vX.Y.Z
   git push && git push --tags
   gh release create companion-vX.Y.Z taplab-companion-vX.Y.Z-debug.apk \
     --title "TapLab Companion vX.Y.Z" --notes-file docs/release-notes/vX.Y.Z.md
   ```

Debug-signed builds are fine for sideloading; a release keystore is not required unless the
app is ever distributed through a store. Never commit keystores or `local.properties`.

## Release notes template

```markdown
## What's new
- …

## Requirements
Rooted Android 10+, Tap Strap 2 paired at the OS level, Bluetooth + notification permissions.

## Install
adb install -r taplab-companion-vX.Y.Z-debug.apk — then open once to grant Bluetooth,
notification, and root. See README → Thumb-Free Tap Code for the chord table.

## Known limitations
See README → Known limitations.
```
