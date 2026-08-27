import { describe, it, expect } from 'vitest';
import {
  parseTapData,
  parseMouseData,
  parseAirGesture,
  airMouseTapToGesture,
  detectProtocolFromCharacteristics,
  controllerModeCommand,
  textModeCommand,
  controllerTextModeCommand,
  inputTypeCommand,
  vibrationCommand,
  InputType,
  MouseModes,
  V2_READ_CHAR,
} from './protocol';

function view(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

describe('parseTapData (vectors mirror tap-web-sdk parsers.test.ts)', () => {
  it('reads the tapcode from byte 0', () => {
    expect(parseTapData(view([5]))).toBe(5); // thumb + middle
    expect(parseTapData(view([1]))).toBe(1); // thumb only
    expect(parseTapData(view([31]))).toBe(31); // all fingers
  });
});

describe('parseMouseData', () => {
  it('parses vx/vy little-endian signed and proximity', () => {
    const buffer = new ArrayBuffer(10);
    const v = new DataView(buffer);
    v.setInt16(1, 100, true);
    v.setInt16(3, -50, true);
    v.setUint8(9, 1);
    expect(parseMouseData(v)).toEqual({ vx: 100, vy: -50, proximity: true });
  });

  it('handles proximity=false and negative velocities', () => {
    const buffer = new ArrayBuffer(10);
    const v = new DataView(buffer);
    v.setInt16(1, -200, true);
    v.setInt16(3, -300, true);
    v.setUint8(9, 0);
    expect(parseMouseData(v)).toEqual({ vx: -200, vy: -300, proximity: false });
  });

  it('returns null for undersized frames', () => {
    expect(parseMouseData(view([0, 1, 2]))).toBeNull();
  });
});

describe('parseAirGesture', () => {
  it('returns plain gestures', () => {
    expect(parseAirGesture(view([2]))).toEqual({ kind: 'gesture', gesture: 2 });
  });
  it('decodes 0x14 as a mouse-mode state change', () => {
    expect(parseAirGesture(view([0x14, 1]))).toEqual({
      kind: 'mouseModeState',
      mouseMode: MouseModes.AIR_MOUSE,
    });
  });
  it('treats a bare 0x14 with no payload as a gesture (defensive)', () => {
    expect(parseAirGesture(view([0x14]))).toEqual({ kind: 'gesture', gesture: 0x14 });
  });
});

describe('airMouseTapToGesture (the AirMouse 2/4 quirk)', () => {
  it('remaps tapcodes 2 and 4 to gestures while in AIR_MOUSE', () => {
    expect(airMouseTapToGesture(2, MouseModes.AIR_MOUSE)).toBe(12);
    expect(airMouseTapToGesture(4, MouseModes.AIR_MOUSE)).toBe(14);
  });
  it('passes taps through in every other mode', () => {
    expect(airMouseTapToGesture(2, MouseModes.STDBY)).toBeNull();
    expect(airMouseTapToGesture(4, MouseModes.OPTICAL1)).toBeNull();
    expect(airMouseTapToGesture(3, MouseModes.AIR_MOUSE)).toBeNull();
  });
});

describe('command builders (byte-exact against SDK source)', () => {
  it('input modes carry the 0x3,0xc,0x0 prefix', () => {
    expect([...textModeCommand()]).toEqual([0x3, 0xc, 0x0, 0x0]);
    expect([...controllerModeCommand()]).toEqual([0x3, 0xc, 0x0, 0x1]);
    expect([...controllerTextModeCommand()]).toEqual([0x3, 0xc, 0x0, 0x5]);
  });
  it('input type command is 0x3,0xd,0x0,<type>', () => {
    expect([...inputTypeCommand(InputType.AUTO)]).toEqual([0x3, 0xd, 0x0, 3]);
    expect([...inputTypeCommand(InputType.KEYBOARD)]).toEqual([0x3, 0xd, 0x0, 2]);
  });
  it('vibration: [0,2] prefix, ms/10, clamped 0-255, max 18 segments', () => {
    expect([...vibrationCommand([100, 200, 100])]).toEqual([0x0, 0x2, 10, 20, 10]);
    expect([...vibrationCommand([99999])]).toEqual([0x0, 0x2, 255]);
    expect([...vibrationCommand([-50])]).toEqual([0x0, 0x2, 0]);
    expect(vibrationCommand(new Array(30).fill(100))).toHaveLength(2 + 18);
  });
});

describe('protocol detection', () => {
  it('v2 when the V2 read characteristic is present (case-insensitive)', () => {
    expect(detectProtocolFromCharacteristics([V2_READ_CHAR.toUpperCase()])).toBe('v2');
  });
  it('v1 otherwise', () => {
    expect(detectProtocolFromCharacteristics(['c3ff0005-1d8b-40fd-a56f-c7bd5d0f3370'])).toBe('v1');
    expect(detectProtocolFromCharacteristics([])).toBe('v1');
  });
});
