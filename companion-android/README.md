# TapLab Companion

TapLab Companion is a native Android service with two independent features:

1. An AirMouse gesture override for clicks, media control, navigation, and scrolling.
2. Thumb-Free Tap Code, which turns raw Tap Strap 2 chords into real system-wide Android typing at the current input focus.

When Tap Code typing is off, the service restores the Tap's stock text mode so normal keyboard/HID typing remains untouched.

The override service starts automatically after reboot by default, so both the
AirMouse override and Tap Code typing resume without requiring the app to be
opened. The **Start override automatically after reboot** setting can disable
this behavior.

Tap Code typing is enabled by default on a fresh install, so a reboot brings up
a fully working configuration with no interaction. Once you toggle Tap Code
yourself, that choice is persisted and restored on subsequent service starts,
so the app never overrides a state you deliberately set. The service uses
Android's `START_STICKY` behavior so Android can recreate it after process
termination.

Some vendors may still require exempting TapLab Companion from aggressive
battery optimization to prevent the foreground service from being killed.

## Screenshots

| Main | Settings | Trainer |
| --- | --- | --- |
| ![Main screen](screenshots/main.png) | ![AirMouse and Tap Code settings](screenshots/settings.png) | ![Tap Code trainer](screenshots/trainer.png) |

## AirMouse mapping

| Tap gesture | Action |
| --- | --- |
| Index-to-thumb single tap | Left click at the current cursor position |
| Index-to-thumb double tap | Right click |
| Middle-to-thumb | Native profile cycle by default; optional media play/pause or Back override |
| Two-finger swipe up/down | Scroll wheel up/down |

The index-to-thumb and middle-to-thumb inputs above are AirMouse touch gestures
reported by the Tap API. They are distinct from simultaneous surface tap chords
and are available only while AirMouse is active.

Tap Strap 2 natively uses middle-to-thumb to cycle profiles: one buzz selects
AirMouse, two select Multimedia, and three select Smart TV. TapLab Companion
therefore leaves middle-to-thumb reserved for this native cycle by default and
does not inject media or Back for it. An opt-in setting can restore the custom
media/Back behavior, but the native firmware profile may also cycle and cause
an additional side effect.

By default, a double tap must occur within 275 ms. Single-tap actions for
gestures with double-tap support enabled are delayed by the configured window
so the app can distinguish them from double taps.

## Entering and exiting AirMouse

Tap Strap 2 firmware controls physical AirMouse entry. TapLab Companion cannot
force AirMouse mode through the official Android SDK. The SDK's XR state
command (`startXRAirMouseState`) is TapXR-only and gated by
`FEATURE_XR_STATE`; it is not a Tap Strap 2 force-AirMouse command.

Use the official activation procedure:

1. Align the thumb ring with your thumbnail.
2. Hold the hand edge-on like a handshake. Thumb and index are vertically stacked: thumb directly ABOVE the index, both parallel and pointing forward—like the two horizontal strokes of an equals sign. They are not side-by-side in the same horizontal row. Middle, ring, and pinky stay relaxed/slightly curled below the index.
3. Hold steady until the Tap gives one buzz.
4. In TapManager, confirm that the latest firmware is installed and AirMouse is
   Enabled.
5. Middle-to-thumb cycles native profiles: one buzz for AirMouse, two for
   Multimedia, and three for Smart TV. TapLab Companion preserves this cycle
   by default.

To exit, hold the palm horizontal and parallel to the floor, or place the
glider on a surface and move it slightly.

If activation is unreliable, verify ring alignment, hand orientation, firmware,
and the TapManager AirMouse setting, then repeat the gesture while holding
steady until the buzz.

Official guidance:

- [How do I get Tap/TapXR in and out of AirMouse/Air Mouse mode?](https://support.tapwithus.com/hc/en-us/articles/360036431254-How-do-I-get-Tap-TapXR-in-and-out-of-AirMouse-Air-Mouse-mode)
- [I Am Having Trouble Activating the AirMouse](https://support.tapwithus.com/hc/en-us/articles/360036944793-I-Am-Having-Trouble-Activating-the-AirMouse)

## AirMouse settings

The app provides persistent settings that apply live without restarting the
override service:

- **Override AirMouse thumb-middle with media/back** is off by default so
  middle-to-thumb remains reserved for the native one/two/three-buzz AirMouse,
  Multimedia, and Smart TV profile cycle. Enabling it restores custom
  media/Back actions, but native profile cycling may also occur.
- **Wait for thumb-index double tap (right click)** controls whether
  thumb-index waits for a possible right-click double tap. Disabling it makes
  every thumb-index tap an immediate left click, but sacrifices the
  thumb-index right-click action.
- **Wait for thumb-middle double tap (Back)** applies only when the
  thumb-middle override is enabled. It controls whether thumb-middle waits for
  a possible Back double tap. Disabling it makes every thumb-middle tap
  immediately send media play/pause, but sacrifices the thumb-middle Back
  action.
- **Double-tap window** adjusts both enabled AirMouse detectors from
  150-500 ms. Keyboard-mode chord clicks are unaffected; they have their own
  window under **Tap Code mode controls**. A shorter window reduces
  single-action latency but makes double taps harder to perform; a longer
  window makes double taps easier but delays single actions. The default is
  275 ms.
- **Inject two-finger AirMouse scrolling** enables or disables injected
  two-finger scrolling.

Changing a setting cancels any pending delayed single-tap action so an old
gesture cannot fire under the new configuration. These settings do not change
normal keyboard mode or Tap Code decoding.

## Tap Code mode controls outside AirMouse

Outside AirMouse, finger-to-thumb touch events are not available as distinct
inputs. While Tap Code typing is enabled, the companion instead claims chords
that contain the thumb. Thumb-Free Tap Code never uses the thumb, so a chord
containing it can never be text and is always safe to reuse as a gesture.

Matching is by **finger bitmask, not exact chord value**. Pinching thumb to
index frequently co-triggers neighbouring fingers, so the hardware commonly
reports 7 (Thumb+Index+Middle) or 11 (Thumb+Index+Ring) rather than a clean 3.
Exact-value matching silently failed on those, so the click never fired and the
chord fell through to the decoder as an invalid-chord error.

| Fingers in the chord | Example raw values | Action |
| --- | --- | --- |
| Thumb + Index (any extras) | 3, 7, 11, 19 | Left click |
| Thumb + Middle, no index | 5, 13, 21 | Media play/pause |
| Thumb alone, or thumb + ring/pinky only | 1, 9, 17, 25 | Ignored |

Index takes precedence when both index and middle are present, because a chord
such as 7 is genuinely ambiguous and clicking is the more common intent.

Thumb chords are never passed to the decoder in any mode, including the
trainer, so an incidental pinch cannot produce a spurious error, an error
haptic, or a reset training prompt.

Both mappings are enabled by default and can be disabled independently under
**Tap Code mode controls**. They apply only when Tap Code typing is ON and
AirMouse is not active. During AirMouse, the existing thumb-touch gesture
behavior remains in effect. When Tap Code typing is OFF, the companion does not
intercept these chords because they belong to the stock Tap alphabet; stock
TEXT-mode keyboard behavior remains untouched.

### Chord double tap

**Thumb+Index double tap = right click** is off by default, which keeps chord
clicks immediate. Enabling it waits for a possible second tap so right click is
available while typing, at the cost of delaying every chord click by the window.

This detector has its **own window**, separate from the AirMouse double-tap
window, so tuning cursor behavior can never change click latency while typing.
It is adjustable from 150-500 ms and defaults to 275 ms.

## Surface mouse

The Tap Strap 2 firmware does not expose the optical glider as its own state.
Engaging the glider reports **MULTIMEDIA (rawState=2)** - the same state used
when Multimedia is selected as a media remote. The companion therefore cannot
tell the two apart, and by default it stands down for MULTIMEDIA so the
firmware's native media keys keep working.

**Treat Multimedia profile as surface mouse** (off by default) reclaims that
state for cursor use. While it is on, Tap Code typing is enabled, and the
trainer is not running:

| Tap | Action |
| --- | --- |
| Index | Left click (on by default) |
| Middle | Right click (off by default) |
| Thumb chords | Same click/media mappings as keyboard mode |

Tap Code text decoding is suspended while the glider owns the device. Without
this, a bare index tap was consumed as the first symbol of a letter, producing
an 800 ms pending sequence followed by a timeout instead of a click.

The trade-off is explicit: enabling this gives up the native Multimedia HID
media keys while gliding. Leave it off if you use the Multimedia profile as an
actual remote.

Two related behaviors were corrected alongside this:

- **Stand-down is now honored.** Previously the log claimed custom injection was
  suspended for MULTIMEDIA and SMART_TV while the decoder kept consuming input
  and could still inject text. Raw input is now ignored outright in those
  states unless surface-mouse mode claims them.
- **Mode requests are centralized.** Connect and state-change handlers used to
  issue independent, racing mode requests, so identical sessions could end up in
  different SDK modes - visible in logs as hundreds of cursor packets in one
  session and almost none in the next. The requested mode is now derived in one
  place from the current state plus settings.

## Native Tap Code trainer

TapLab Companion includes a fully native Thumb-Free Tap Code curriculum and
trainer. Tap **Open native Tap Code trainer (no Chrome)** from the companion
settings. The trainer uses Android widgets and the existing Tap SDK connection;
it does not require Chrome, a WebView, Web Bluetooth, or the TapLab web app.

The ten included lessons are:

1. Diagonal doubles: `a`, `g`, `m`, `s`, and `y`
2. Row 1 plus space
3. Rows 1–2 plus space
4. Rows 1–3 plus space
5. Rows 1–4 plus space
6. The full `a`–`y` grid plus space
7. The `z`, backspace, enter, period, and comma control plane
8. Every supported character and control
9. Common words
10. Short lowercase sentences

Each prompt includes an accurate per-character chord hint. Correct characters
advance through the prompt. A mismatch records an error against the expected
character and restarts the same prompt from its beginning, emphasizing accuracy
before speed. Canceled, invalid, and timed-out sequences restart the current
attempt without recording a character result.

Character accuracy and completed lessons are stored persistently and survive
app, service, and device restarts. After a character has at least three
attempts, accuracy below 85% marks it as weak. **Drill weak characters** creates
a focused randomized drill, while character lessons otherwise weight known
weak characters approximately three times as heavily.

While training is active, the service receives raw Tap Code input but suppresses
system text and key injection. MR+MR stops the trainer instead of changing the
saved global Tap Code preference. Leaving or stopping training restores the
previous persistent Tap Code or stock text mode. AirMouse and native profile
behavior continue to take precedence while their physical modes are active.

## Thumb-Free Tap Code typing

Tap Code uses two chords per letter. The first chord selects a row and the second selects a column:

| First \ Second | Index | Middle | Ring | Pinky | Ring+Pinky |
| --- | --- | --- | --- | --- | --- |
| Index | a | b | c | d | e |
| Middle | f | g | h | i | j |
| Ring | k | l | m | n | o |
| Pinky | p | q | r | s | t |
| Ring+Pinky | u | v | w | x | y |

The chord bit values are Thumb=1, Index=2, Middle=4, Ring=8, and Pinky=16. Ring+Pinky is 24.

### Controls

| Sequence | Action |
| --- | --- |
| Index+Middle (IM) | Space, or cancel an incomplete sequence |
| Middle+Ring (MR), then Index | `z` |
| MR, then Middle | Backspace |
| MR, then Ring | Enter |
| MR, then Pinky | `.` |
| MR, then Ring+Pinky | `,` |
| MR, then MR | Disable Tap Code typing and return to the stock keyboard |

Use **Toggle Tap Code typing** in the app to enable or disable the mode. The
selected Tap Code ON/OFF state is saved and restored across service, app, and
device restarts. While enabled, the Tap runs in controller-with-mouse-HID mode:
raw taps go to the
decoder, firmware keyboard output is suppressed, and AirMouse remains
available. Selecting the native Multimedia or Smart TV profile temporarily
suspends Tap Code and custom gesture injection so the firmware's native HID
commands remain available. Returning to Keyboard or AirMouse restores Tap Code
controller mode while Tap Code remains enabled. Turning Tap Code off restores
stock text mode.

Incomplete sequences expire after 800 ms. Expiration is recovery-only and never types a character.

Decoded text is injected into the currently focused app through Android's root `input text` command. Each command may take approximately 200–300 ms, so characters can appear with a short delay.

## Requirements

- Rooted Android 10 or newer
- Magisk root access granted to TapLab Companion
- Tap Strap 2 paired at the Android OS level
- Bluetooth and notification permissions granted to the app

For a secondary Android user profile, either enable Magisk **Multiuser mode: user independent** or grant root access to TapLab Companion in that profile.

## Build

Open `companion-android/` in Android Studio and build the debug APK.

Alternatively, use the committed Gradle wrapper with JDK 17 and Android SDK 35 installed:

```bash
# Windows
.\gradlew.bat assembleDebug

# macOS/Linux
./gradlew assembleDebug
```

Run the Kotlin decoder tests with `gradlew testDebugUnitTest`. The official TapWithUs Android SDK source is vendored under `tap-android-sdk/` (Apache-2.0) because its current JitPack builds fail.

The native trainer and curriculum are packaged in the same APK; no browser or
additional web dependency is needed.

## Install in secondary profile 10

From `companion-android/`, after building:

```bash
adb push app/build/outputs/apk/debug/app-debug.apk /data/local/tmp/
adb shell pm install -r --user 10 /data/local/tmp/app-debug.apk
```

Open TapLab Companion in profile 10 and grant the requested permissions and Magisk root access. Tap **Start override service** for the AirMouse override, then use **Toggle Tap Code typing** when you want system-wide Tap Code input. Use the same button or enter MR+MR to return to the stock Tap keyboard.

## Diagnostic log tags

High-value diagnostic lines use mode and source tags:

- `[Regular]` identifies SDK-visible callbacks and status around requested
  stock mode. In TEXT mode, ordinary stock keys are emitted as HID keyboard
  output directly to Android, and the Tap SDK does not send a tap input
  callback for those keys. Consequently, `[Regular]` cannot log each stock
  keystroke.
- `[TapCode]` identifies raw input received while Tap Code decoding is active.
- `[SurfaceMouse]` identifies optical-glider activity: proximity edges plus a
  throttled `cursor active` heartbeat, at most one line per second, reporting
  accumulated packet count, proximity, Tap state, and the resolved input role.
- `[AirMouse]` identifies discrete AirMouse gesture packets.
- `[Mode]` identifies Tap state transitions and SDK mode requests.
- `[Trainer]` identifies trainer-scoped input handling.

Every raw input line reports the resolved `role=` for that event, which is the
single value that determines interpretation:

| Role | Meaning |
| --- | --- |
| `TAP_CODE` | Decode text; thumb chords act as gestures |
| `SURFACE_MOUSE` | Cursor gestures only; text decoding suspended |
| `AIR_MOUSE` | Thumb touches arrive as AirMouse packets instead |
| `STOOD_DOWN` | A native Multimedia/Smart TV profile owns the device |

Continuous cursor-motion packets are still counted rather than logged
individually, and flushed as a `Cursor-motion summary` on state change. The
heartbeat exists because whole minutes of glider use previously left no trace
at all, which made surface-mouse behavior impossible to diagnose.

## Troubleshooting

- Tap **Test root access** and confirm that the result includes a root `uid=0`.
- If a thumb-index pinch does not click, check the raw value in the log. Values
  such as 7 (Thumb+Index+Middle) and 11 (Thumb+Index+Ring) are expected and are
  matched by bitmask. A chord reported as bare 1 (Thumb) contains no index bit
  at all and cannot be distinguished from any other thumb-only contact.
- If tapping during glider use starts a letter and then times out instead of
  clicking, enable **Treat Multimedia profile as surface mouse**. Without it the
  glider state is treated as the native Multimedia profile.
- If nothing at all appears in the log while the cursor is clearly moving, the
  Tap is in TEXT mode and the SDK is not forwarding mouse packets. Check the
  most recent `[Mode] SDK mode requested` line and its `role=`.
- The firmware can cycle into MULTIMEDIA or SMART_TV on its own from a
  thumb-middle touch. The companion cannot prevent this; it reports the
  transition and resumes when the state returns.
- Check the log for the discovered `/dev/input/eventN` Tap mouse node.
- A single action is delayed by the configured 150–500 ms window when that
  gesture's double-tap support is enabled. Disable its double-tap setting for
  an immediate single action at the cost of its secondary double-tap action.
- Tap Code text injection may take 200–300 ms per decoded character because it uses Android's `input text` command.
- `[Regular]` logs do not include ordinary stock TEXT-mode keystrokes. The Tap
  SDK sends those as HID keyboard output directly to Android without a tap
  callback. Capturing them system-wide would require a kernel-level keylogger,
  which TapLab Companion intentionally does not implement.
- If a Tap Code sequence is incomplete for 800 ms, it is discarded and reported as a timeout.
- If scrolling occurs twice per gesture, turn off **Inject two-finger AirMouse
  scrolling** in the app settings.
- Confirm that the Tap is paired at the OS level and that Bluetooth permissions are granted.
- If AirMouse does not activate, confirm the latest firmware and **AirMouse
  Enabled** in TapManager, align the thumb ring with the thumbnail, use the
  vertical handshake orientation, point the index and thumb in the same
  direction, and hold steady until one buzz.
- Do not expect the companion to force Tap Strap 2 into physical AirMouse mode.
  The official Android SDK exposes the XR state command only for TapXR devices.

## Persistent log

The most recent 500 diagnostic lines, up to approximately 64 KiB, are stored in app-private internal storage. The log survives Tap disconnects, app and service restarts, device restarts, and Android reboots. **Clear log** is the only action that clears it.
