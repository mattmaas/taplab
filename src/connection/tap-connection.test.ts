/**
 * TapConnection BLE flow tests against a fake Web Bluetooth stack.
 *
 * These exercise the exact GATT dance a real Tap Strap 2 will see on
 * hardware day: service discovery, v1/v2 detection, notification
 * subscription, Controller-mode handshake, the 10s mode refresh, the
 * AirMouse tap filter, and vibration writes.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TapConnection } from './tap-connection';
import {
  TAP_SERVICE,
  NUS_SERVICE,
  BATTERY_SERVICE,
  TAP_DATA_CHAR,
  MOUSE_DATA_CHAR,
  UI_CMD_CHAR,
  AIR_GESTURE_DATA_CHAR,
  TAP_MODE_CHAR,
  V2_READ_CHAR,
  BATTERY_LEVEL_CHAR,
  MODE_REFRESH_INTERVAL_MS,
} from './protocol';
import type { ConnectedDetail, TapEvent } from '../core/types';

// ------------------------------------------------------------ fake BLE stack

class FakeCharacteristic extends EventTarget {
  readonly uuid: string;
  value: DataView | null = null;
  written: Uint8Array[] = [];
  notifying = false;
  private readValueData: DataView | null;

  constructor(uuid: string, readValueData: DataView | null = null) {
    super();
    this.uuid = uuid;
    this.readValueData = readValueData;
  }

  async startNotifications(): Promise<this> {
    this.notifying = true;
    return this;
  }

  async writeValue(data: ArrayBuffer | ArrayBufferView): Promise<void> {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.written.push(new Uint8Array(bytes));
  }

  async readValue(): Promise<DataView> {
    if (!this.readValueData) throw new Error('read not supported');
    return this.readValueData;
  }

  /** Test helper: push a notification frame. */
  notify(bytes: number[]): void {
    this.value = new DataView(new Uint8Array(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService {
  readonly uuid: string;
  private chars = new Map<string, FakeCharacteristic>();

  constructor(uuid: string, chars: FakeCharacteristic[]) {
    this.uuid = uuid;
    for (const c of chars) this.chars.set(c.uuid.toLowerCase(), c);
  }

  async getCharacteristic(uuid: string): Promise<FakeCharacteristic> {
    const c = this.chars.get(uuid.toLowerCase());
    if (!c) throw new Error(`char not found: ${uuid}`);
    return c;
  }
}

class FakeServer {
  connected = false;
  private services = new Map<string, FakeService>();

  constructor(services: FakeService[]) {
    for (const s of services) this.services.set(s.uuid.toLowerCase(), s);
  }

  async connect(): Promise<this> {
    this.connected = true;
    return this;
  }

  disconnect(): void {
    this.connected = false;
  }

  async getPrimaryService(uuid: string): Promise<FakeService> {
    const s = this.services.get(uuid.toLowerCase());
    if (!s) throw new Error(`service not found: ${uuid}`);
    return s;
  }
}

class FakeDevice extends EventTarget {
  readonly name = 'Tap_59AB';
  readonly gatt: FakeServer;
  constructor(server: FakeServer) {
    super();
    this.gatt = server;
  }
}

interface Harness {
  connection: TapConnection;
  tapData: FakeCharacteristic;
  mouseData: FakeCharacteristic;
  airData: FakeCharacteristic;
  uiCmd: FakeCharacteristic;
  tapMode: FakeCharacteristic;
  connectedEvents: ConnectedDetail[];
  tapEvents: TapEvent[];
  gestures: number[];
}

function buildV1Harness(opts: { withNus?: boolean; battery?: number | null } = {}): Harness {
  const { withNus = true, battery = 87 } = opts;
  const tapData = new FakeCharacteristic(TAP_DATA_CHAR);
  const mouseData = new FakeCharacteristic(MOUSE_DATA_CHAR);
  const airData = new FakeCharacteristic(AIR_GESTURE_DATA_CHAR);
  const uiCmd = new FakeCharacteristic(UI_CMD_CHAR);
  const tapMode = new FakeCharacteristic(TAP_MODE_CHAR);

  const services = [
    new FakeService(TAP_SERVICE, [tapData, mouseData, airData, uiCmd]),
  ];
  if (withNus) services.push(new FakeService(NUS_SERVICE, [tapMode]));
  if (battery !== null) {
    services.push(
      new FakeService(BATTERY_SERVICE, [
        new FakeCharacteristic(
          BATTERY_LEVEL_CHAR,
          new DataView(new Uint8Array([battery]).buffer),
        ),
      ]),
    );
  }

  const device = new FakeDevice(new FakeServer(services));
  (navigator as unknown as { bluetooth: unknown }).bluetooth = {
    requestDevice: async () => device,
  };

  const connection = new TapConnection();
  const connectedEvents: ConnectedDetail[] = [];
  const tapEvents: TapEvent[] = [];
  const gestures: number[] = [];
  connection.addEventListener('connected', (ev) =>
    connectedEvents.push((ev as CustomEvent<ConnectedDetail>).detail),
  );
  connection.addEventListener('tap', (ev) =>
    tapEvents.push((ev as CustomEvent<TapEvent>).detail),
  );
  connection.addEventListener('airgesture', (ev) =>
    gestures.push((ev as CustomEvent<number>).detail),
  );

  return { connection, tapData, mouseData, airData, uiCmd, tapMode, connectedEvents, tapEvents, gestures };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as unknown as { bluetooth?: unknown }).bluetooth;
});

// ------------------------------------------------------------ tests

describe('v1 (Tap Strap 2) connect flow', () => {
  it('subscribes, switches to Controller mode, reports dataReady + battery', async () => {
    const h = buildV1Harness();
    await h.connection.connect();

    expect(h.connectedEvents).toHaveLength(1);
    expect(h.connectedEvents[0]).toMatchObject({
      source: 'bluetooth',
      dataReady: true,
      protocol: 'v1',
      batteryLevel: 87,
    });

    expect(h.tapData.notifying).toBe(true);
    expect(h.mouseData.notifying).toBe(true);
    expect(h.airData.notifying).toBe(true);

    // Controller mode + input type written on connect
    expect(h.tapMode.written.length).toBe(2);
    expect([...h.tapMode.written[0]]).toEqual([0x3, 0xc, 0x0, 0x1]); // controller
    expect([...h.tapMode.written[1]]).toEqual([0x3, 0xd, 0x0, 3]); // input type AUTO
  });

  it('decodes tap notifications into tap events', async () => {
    const h = buildV1Harness();
    await h.connection.connect();

    h.tapData.notify([5]); // thumb+middle
    h.tapData.notify([31]);

    expect(h.tapEvents.map((t) => t.code)).toEqual([5, 31]);
    expect(h.tapEvents[0].fingers).toEqual(['Thumb', 'Middle']);
  });

  it('re-writes Controller mode every 10s (device reverts otherwise)', async () => {
    const h = buildV1Harness();
    await h.connection.connect();
    const writesAfterConnect = h.tapMode.written.length;

    await vi.advanceTimersByTimeAsync(MODE_REFRESH_INTERVAL_MS * 2 + 50);
    // two refresh cycles x (mode + input type) = 4 more writes
    expect(h.tapMode.written.length).toBe(writesAfterConnect + 4);
    expect([...h.tapMode.written.at(-2)!]).toEqual([0x3, 0xc, 0x0, 0x1]);
  });

  it('filters AirMouse click-taps (2/4) out of the chord stream', async () => {
    const h = buildV1Harness();
    await h.connection.connect();

    h.airData.notify([0x14, 1]); // state change -> AIR_MOUSE
    h.tapData.notify([2]); // click, not a chord
    h.tapData.notify([4]); // click, not a chord
    h.tapData.notify([3]); // real chord, passes through
    h.airData.notify([0x14, 0]); // back to STDBY
    h.tapData.notify([2]); // now a real chord again

    expect(h.tapEvents.map((t) => t.code)).toEqual([3, 2]);
    expect(h.gestures).toEqual([12, 14]); // remapped clicks
  });

  it('sendVibration writes the UI command', async () => {
    const h = buildV1Harness();
    await h.connection.connect();
    await h.connection.sendVibration([100, 200]);
    expect([...h.uiCmd.written.at(-1)!]).toEqual([0x0, 0x2, 10, 20]);
  });

  it('survives a missing NUS service (taps still stream, mode warning only)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = buildV1Harness({ withNus: false });
    await h.connection.connect();
    expect(h.connectedEvents[0].dataReady).toBe(true);
    h.tapData.notify([9]);
    expect(h.tapEvents.map((t) => t.code)).toEqual([9]);
    expect(warn).toHaveBeenCalled();
  });

  it('missing battery service degrades to null', async () => {
    const h = buildV1Harness({ battery: null });
    await h.connection.connect();
    expect(h.connectedEvents[0].batteryLevel).toBeNull();
  });

  it('stop() clears the mode-refresh interval', async () => {
    const h = buildV1Harness();
    await h.connection.connect();
    const writes = h.tapMode.written.length;
    h.connection.stop();
    await vi.advanceTimersByTimeAsync(MODE_REFRESH_INTERVAL_MS * 3);
    expect(h.tapMode.written.length).toBe(writes); // no further writes
    expect(h.connection.getState()).toBe('disconnected');
  });
});

describe('v2 (TapXR) detection', () => {
  it('reports dataReady=false with protocol v2 and does not subscribe', async () => {
    const tapData = new FakeCharacteristic(TAP_DATA_CHAR);
    const v2Read = new FakeCharacteristic(V2_READ_CHAR);
    const device = new FakeDevice(
      new FakeServer([new FakeService(TAP_SERVICE, [tapData, v2Read])]),
    );
    (navigator as unknown as { bluetooth: unknown }).bluetooth = {
      requestDevice: async () => device,
    };

    const connection = new TapConnection();
    const events: ConnectedDetail[] = [];
    connection.addEventListener('connected', (ev) =>
      events.push((ev as CustomEvent<ConnectedDetail>).detail),
    );

    await connection.connect();
    expect(events[0]).toMatchObject({ dataReady: false, protocol: 'v2' });
    expect(tapData.notifying).toBe(false);
  });
});

describe('no Web Bluetooth', () => {
  it('throws a helpful error', async () => {
    delete (navigator as unknown as { bluetooth?: unknown }).bluetooth;
    const connection = new TapConnection();
    await expect(connection.connect()).rejects.toThrow(/Web Bluetooth is unavailable/);
  });
});
