/**
 * TapConnection - abstraction over the Tap event source.
 *
 * Two sources:
 *   - Web Bluetooth -> Tap Strap 2 (real device)
 *   - Simulate mode -> random tapcodes for development without hardware
 *
 * Emits events on itself (extends EventTarget):
 *   'tap'          -> CustomEvent<TapEvent>
 *   'mouse'        -> CustomEvent<MouseEvent>
 *   'connected'    -> Event
 *   'disconnected' -> Event
 *
 * BLE: the service/characteristic UUIDs below come from the official
 * tap-web-sdk. Protocol framing (v1 vs v2) is NOT decoded yet - the decode
 * step is marked TODO. Until then, simulate mode is the guaranteed working
 * path for end-to-end UI development.
 *
 * Note: Web Bluetooth interfaces are declared structurally below so we can
 * compile against the standard DOM lib without @types/web-bluetooth.
 */

import { getFingers } from '../core/chords';
import type { TapEvent, MouseEvent, ConnectionState } from '../core/types';

export const TAP_SERVICE_UUID = 'c3ff0001-1d8b-40fd-a56f-c7bd5d0f3370';
export const TAP_DATA_CHARACTERISTIC_UUID = 'c3ff0003-1d8b-40fd-a56f-c7bd5d0f3370';

/** Minimal structural surface of Web Bluetooth we actually use. */
interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
}
interface BluetoothDeviceLike {
  readonly name?: string;
  readonly gatt?: GattServerLike;
  addEventListener(type: string, listener: (ev: Event) => void): void;
}
interface BluetoothRequestOptions {
  filters?: { namePrefix?: string }[];
  optionalServices?: string[];
}
interface BluetoothLike {
  requestDevice(options: BluetoothRequestOptions): Promise<BluetoothDeviceLike>;
}

type Source = 'bluetooth' | 'simulate';

export class TapConnection extends EventTarget {
  private source: Source | null = null;
  private state: ConnectionState = 'disconnected';
  private btDevice: BluetoothDeviceLike | null = null;
  private simulateTimer: number | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  /** Attempt a real Web Bluetooth connection. Throws on failure. */
  async connect(): Promise<void> {
    const nav = navigator as Navigator & { bluetooth?: BluetoothLike };
    if (!nav.bluetooth) {
      throw new Error('Web Bluetooth is unavailable in this browser. Use Simulate.');
    }
    this.state = 'connecting';
    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Tap' }, { namePrefix: 'TAP' }],
        optionalServices: [TAP_SERVICE_UUID],
      });
      this.btDevice = device;
      device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      if (!device.gatt) throw new Error('Device exposes no GATT server');
      const server = await device.gatt.connect();

      // TODO(protocol): resolve TAP_DATA_CHARACTERISTIC_UUID, subscribe to
      // notifications, and decode Controller-mode frames into emitTap/emitMouse.
      void server;

      this.source = 'bluetooth';
      this.state = 'connected';
      this.dispatchEvent(new Event('connected'));
    } catch (err) {
      this.state = 'disconnected';
      this.btDevice = null;
      this.dispatchEvent(new Event('disconnected'));
      throw err;
    }
  }

  /** Start simulate mode: random tapcodes 1..31 at random intervals. */
  simulate(minDelayMs = 200, maxDelayMs = 800): void {
    this.stopSimulateTimer();
    this.source = 'simulate';
    this.state = 'simulating';
    this.dispatchEvent(new Event('connected'));

    const loop = (): void => {
      const code = 1 + Math.floor(Math.random() * 31);
      this.emitTap(code);
      const next = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
      this.simulateTimer = window.setTimeout(loop, next);
    };
    this.simulateTimer = window.setTimeout(loop, minDelayMs);
  }

  /** Stop any active source and emit 'disconnected'. */
  stop(): void {
    this.stopSimulateTimer();
    if (this.btDevice?.gatt?.connected) {
      this.btDevice.gatt.disconnect();
    }
    const hadActivity = this.source !== null || this.state !== 'disconnected';
    this.source = null;
    this.btDevice = null;
    if (hadActivity) {
      this.state = 'disconnected';
      this.dispatchEvent(new Event('disconnected'));
    }
  }

  disconnect(): void {
    this.stop();
  }

  private stopSimulateTimer(): void {
    if (this.simulateTimer !== null) {
      window.clearTimeout(this.simulateTimer);
      this.simulateTimer = null;
    }
  }

  private handleDisconnect(): void {
    this.stopSimulateTimer();
    this.source = null;
    this.btDevice = null;
    this.state = 'disconnected';
    this.dispatchEvent(new Event('disconnected'));
  }

  private emitTap(code: number): void {
    const detail: TapEvent = {
      code,
      timestamp: performance.now(),
      fingers: [...getFingers(code)],
    };
    this.dispatchEvent(new CustomEvent<TapEvent>('tap', { detail }));
  }

  // Reserved for when the BLE decoder ships actual mouse frames.
  private emitMouse(event: MouseEvent): void {
    this.dispatchEvent(new CustomEvent<MouseEvent>('mouse', { detail: event }));
  }
}