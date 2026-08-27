/**
 * Tap BLE protocol — constants, command builders, and frame parsers.
 *
 * Ported from the official TapWithUs/tap-web-sdk (MIT license):
 *   https://github.com/TapWithUs/tap-web-sdk
 * Verified against the SDK source (src/TapSDKWeb.ts, src/detect.ts,
 * src/parsers.ts, src/inputmodes.ts, src/enumerations.ts) — not docs.
 *
 * Protocol facts that matter:
 *  - Tap Strap 2 speaks "v1": tapcodes arrive as plain uint8 notifications
 *    on TAP_DATA_CHAR. TapXR speaks "v2" (framed messages on V2_READ_CHAR);
 *    v2 presence is how you detect an XR.
 *  - Input mode (Text vs Controller) is written to the NUS RX characteristic
 *    and REVERTS on its own: the SDK re-writes the mode every 10 seconds.
 *    Miss that detail and the device silently falls back to Text mode.
 *  - In AirMouse mode, tapcodes 2 and 4 are actually gesture clicks, not
 *    chords — the SDK converts them to air gestures (+10).
 */

// ---------------------------------------------------------------- UUIDs
export const TAP_SERVICE = 'c3ff0001-1d8b-40fd-a56f-c7bd5d0f3370';
export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

export const TAP_DATA_CHAR = 'c3ff0005-1d8b-40fd-a56f-c7bd5d0f3370';
export const MOUSE_DATA_CHAR = 'c3ff0006-1d8b-40fd-a56f-c7bd5d0f3370';
export const UI_CMD_CHAR = 'c3ff0009-1d8b-40fd-a56f-c7bd5d0f3370';
export const AIR_GESTURE_DATA_CHAR = 'c3ff000a-1d8b-40fd-a56f-c7bd5d0f3370';

/** NUS RX — write input-mode / input-type commands here. */
export const TAP_MODE_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
/** NUS TX — raw sensor notifications (future: adaptive thresholds). */
export const RAW_SENSORS_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/** Present only on v2 (TapXR) devices — used for protocol detection. */
export const V2_READ_CHAR = 'c3ff000e-1d8b-40fd-a56f-c7bd5d0f3370';
export const V2_WRITE_CHAR = 'c3ff000f-1d8b-40fd-a56f-c7bd5d0f3370';

export const DEVICE_INFORMATION_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
export const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL_CHAR = '00002a19-0000-1000-8000-00805f9b34fb';

export type TapProtocol = 'v1' | 'v2';

/**
 * The device reverts input mode on its own; the official SDK re-writes the
 * current mode every 10 seconds. We do the same.
 */
export const MODE_REFRESH_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------- enums
export enum MouseModes {
  STDBY = 0,
  AIR_MOUSE = 1,
  OPTICAL1 = 2,
  OPTICAL2 = 3,
}

export enum InputType {
  MOUSE = 1,
  KEYBOARD = 2,
  AUTO = 3,
}

/** Air-gesture frame code that signals a mouse-mode state change. */
export const AIR_GESTURE_STATE_CODE = 0x14;

// ---------------------------------------------------------------- commands
const INPUT_MODE_PREFIX = [0x3, 0xc, 0x0];

export function textModeCommand(): Uint8Array {
  return new Uint8Array([...INPUT_MODE_PREFIX, 0x0]);
}

export function controllerModeCommand(): Uint8Array {
  return new Uint8Array([...INPUT_MODE_PREFIX, 0x1]);
}

export function controllerTextModeCommand(): Uint8Array {
  return new Uint8Array([...INPUT_MODE_PREFIX, 0x5]);
}

export function inputTypeCommand(inputType: InputType): Uint8Array {
  return new Uint8Array([0x3, 0xd, 0x0, inputType]);
}

/**
 * Vibration command: durations in ms, resolution 10ms, each clamped to
 * 0-2550ms, max 18 segments. Prefix [0x00, 0x02].
 */
export function vibrationCommand(durationsMs: number[]): Uint8Array {
  const seq = durationsMs
    .slice(0, 18)
    .map((d) => Math.max(0, Math.min(255, Math.floor(d / 10))));
  return new Uint8Array([0x0, 0x2, ...seq]);
}

// ---------------------------------------------------------------- parsers
/** Tap data frame: byte 0 is the 5-bit tapcode (1-31). */
export function parseTapData(data: DataView): number {
  return data.getUint8(0);
}

export interface ParsedMouse {
  vx: number;
  vy: number;
  proximity: boolean;
}

/**
 * Mouse data frame: vx=int16 LE @1, vy=int16 LE @3, proximity=uint8 @9.
 * Returns null for frames too short to contain the fields.
 */
export function parseMouseData(data: DataView): ParsedMouse | null {
  if (data.byteLength < 10) return null;
  return {
    vx: data.getInt16(1, true),
    vy: data.getInt16(3, true),
    proximity: data.getUint8(9) === 1,
  };
}

export type ParsedAirGesture =
  | { kind: 'gesture'; gesture: number }
  | { kind: 'mouseModeState'; mouseMode: MouseModes };

/**
 * Air-gesture frame: byte 0 is the gesture code, EXCEPT 0x14 which is a
 * mouse-mode state change with the new mode in byte 1.
 */
export function parseAirGesture(data: DataView): ParsedAirGesture {
  const code = data.getUint8(0);
  if (code === AIR_GESTURE_STATE_CODE && data.byteLength >= 2) {
    return { kind: 'mouseModeState', mouseMode: data.getUint8(1) as MouseModes };
  }
  return { kind: 'gesture', gesture: code };
}

/**
 * AirMouse quirk: while in AIR_MOUSE mode, tapcodes 2 and 4 are gesture
 * clicks, not chords. The SDK remaps them to air gestures (+10).
 * Returns the remapped gesture code, or null when the tapcode is a real tap.
 */
export function airMouseTapToGesture(
  tapcode: number,
  mouseMode: MouseModes,
): number | null {
  if (mouseMode === MouseModes.AIR_MOUSE && (tapcode === 2 || tapcode === 4)) {
    return tapcode + 10;
  }
  return null;
}

/** v2 (TapXR) detection from a known characteristic list. */
export function detectProtocolFromCharacteristics(uuids: string[]): TapProtocol {
  const target = V2_READ_CHAR.toLowerCase();
  return uuids.some((u) => u.toLowerCase() === target) ? 'v2' : 'v1';
}
