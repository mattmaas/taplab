/**
 * TapConnection — abstraction over the Tap event source.
 *
 * Two sources:
 *   - Web Bluetooth -> Tap Strap 2 (real device) — link-layer only for now
 *   - Simulate mode -> tapcodes for development without hardware
 *
 * Emits events on itself (extends EventTarget):
 *   'tap'          -> CustomEvent<TapEvent>
 *   'mouse'        -> CustomEvent<TapMouseEvent>
 *   'connected'    -> CustomEvent<ConnectedDetail>  ({ source, dataReady })
 *   'disconnected' -> Event
 *
 * HONESTY NOTE (P3 review fix): the BLE path can reach and hold a GATT
 * connection, but the Controller-mode notification decoder is NOT
 * implemented yet — a real device will produce ZERO tap events. We surface
 * that as dataReady=false on the 'connected' event so the UI can warn
 * instead of showing a green light over a dead pipe. Simulate mode is the
 * guaranteed working path today.
 *
 * BLE UUIDs come from the official tap-web-sdk source.
 *
 * Simulate supports two shapes:
 *   simulate()                        — uniform-random codes (plumbing test)
 *   simulate({ sequence: [...] })     — scripted codes, in order, for
 *                                       deterministic drill/UI testing
 */

import { getFingers } from '../core/chords';
import type {
  TapEvent,
  TapMouseEvent,
  ConnectionState,
  ConnectedDetail,
  TapSource,
} from '../core/types';

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

export interface SimulateOptions {
  /** Scripted tapcodes emitted in order. Omit for uniform-random codes. */
  sequence?: number[];
  /** Loop the sequence when it ends (default false: auto-stop). */
  loop?: boolean;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export class TapConnection extends EventTarget {
  private source: TapSource | null = null;
  private state: ConnectionState = 'disconnected';
  private btDevice: BluetoothDeviceLike | null = null;
  private simulateTimer: number | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  getSource(): TapSource | null {
    return this.source;
  }

  /**
   * Attempt a real Web Bluetooth connection. Throws on failure.
   * NOTE: link-layer only — emits 'connected' with dataReady=false until
   * the notification decoder is implemented (no tap events will flow).
   */
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
      // notifications, decode Controller-mode frames -> emitTap/emitMouse,
      // then flip dataReady to true here.
      void server;

      this.source = 'bluetooth';
      this.state = 'connected';
      this.emitConnected({ source: 'bluetooth', dataReady: false });
    } catch (err) {
      this.state = 'disconnected';
      this.btDevice = null;
      this.dispatchEvent(new Event('disconnected'));
      throw err;
    }
  }

  /**
   * Start simulate mode.
   *   simulate()                    — random codes 1..31 forever
   *   simulate({ sequence, loop })  — scripted codes for deterministic tests
   */
  simulate(options: SimulateOptions = {}): void {
    const { sequence, loop = false, minDelayMs = 200, maxDelayMs = 800 } = options;
    this.stopSimulateTimer();
    this.source = 'simulate';
    this.state = 'simulating';
    this.emitConnected({ source: 'simulate', dataReady: true });

    let index = 0;
    const loopFn = (): void => {
      let code: number;
      if (sequence && sequence.length > 0) {
        if (index >= sequence.length) {
          if (loop) {
            index = 0;
          } else {
            this.stop();
            return;
          }
        }
        code = sequence[index] & 0x1f;
        index += 1;
      } else {
        code = 1 + Math.floor(Math.random() * 31);
      }
      if (code >= 1 && code <= 31) this.emitTap(code);
      const next = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
      this.simulateTimer = window.setTimeout(loopFn, next);
    };
    this.simulateTimer = window.setTimeout(loopFn, minDelayMs);
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

  private emitConnected(detail: ConnectedDetail): void {
    this.dispatchEvent(new CustomEvent<ConnectedDetail>('connected', { detail }));
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
  private emitMouse(event: TapMouseEvent): void {
    this.dispatchEvent(new CustomEvent<TapMouseEvent>('mouse', { detail: event }));
  }
}
