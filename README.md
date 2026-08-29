# TapLab

Telemetry, data-driven training, and an intelligent remap engine for the Tap Strap 2 wearable keyboard, via Web Bluetooth.

## Features

- Live BLE chord telemetry dashboard
- Standard chord drills with weak-chord targeting
- **Thumb-Free Tap Code**: a high-accuracy, fixed-length two-event typing system with a progressive 10-lesson curriculum, live hints, weak-character practice, and full control plane
- Lifetime progress stored locally in IndexedDB
- Fuzzy chord-correction engine
- Native Android companion in [`companion-android/`](companion-android/) providing system-wide Thumb-Free Tap Code typing and improved Tap Strap 2 AirMouse controls

## Quick start

```bash
npm install
npm run dev
```

Open [https://localhost:5173](https://localhost:5173) in Chrome or Edge. Web Bluetooth support is required.

### Phone testing

The development server binds to the LAN using self-signed HTTPS provided by `@vitejs/plugin-basic-ssl`. On your phone, browse to `https://<pc-ip>:5173` and accept the certificate warning.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/core/` | Chord tables and shared types |
| `src/connection/` | BLE/GATT connection and Tap protocol handling |
| `src/trainer/` | Standard chord drill and training engine |
| `src/tapcode/` | Thumb-Free Tap Code decoder, curriculum, drills, and tests |
| `src/telemetry/` | Session statistics and IndexedDB persistence |
| `src/engine/` | Fuzzy remap engine |
| `companion-android/` | Native system-wide Tap Code typing + AirMouse override |
| `companion-android/tap-android-sdk/` | Vendored official TapWithUs Android SDK (Apache-2.0) |

## Testing

```bash
npm test
```

The web suite currently contains 132 Vitest tests. The Android companion also includes JVM unit tests for its Kotlin Tap Code decoder:

```bash
cd companion-android
./gradlew testDebugUnitTest
```

## Hardware notes

TapLab communicates with a Tap Strap 2 over BLE. The default alphabet map is partially verified; three codes remain pending hardware verification. See [`src/core/chords.ts`](src/core/chords.ts) for details.

## License

MIT
