/**
 * TapConnection — abstraction over the Tap event source.
 *
 * Two sources:
 *   - Web Bluetooth -> Tap Strap 2 (real device, v1 protocol, LIVE decode)
 *   - Simulate mode -> tapcodes for development without hardware
 *
 * Emits events on itself (extends EventTarget):
 *   'tap'          -> CustomEvent<TapEvent>
 *   'mouse'        -> CustomEvent<TapMouseEvent>
 *   'airgesture'   -> CustomEvent<number>
 *   'connected'    -> CustomEvent<ConnectedDetail>  ({ source, dataReady, protocol, batteryLevel })
 *   'disconnected' -> Event
 *
 * BLE flow (ported from TapWithUs/tap-web-sdk, MIT):
 *   1. requestDevice filtered on the Tap service UUID
 *   2. GATT connect, probe for V2_READ_CHAR:
 *        present -> TapXR (v2 framed protocol). NOT decoded yet: we emit
 *        dataReady=false and say so. Tap Strap 2 is the v1 target.
 *   3. v1: subscribe tap/mouse/air-gesture notifications
 *   4. write Controller mode to the NUS RX characteristic so the device
 *      streams raw tapcodes instead of typing HID text
 *   5. re-write the mode every 10s — the device reverts on its own
 *   6. AirMouse quirk honored: tapcodes 2/4 while in AIR_MOUSE mode are
 *      gesture clicks, not chords — filtered out of the tap stream
 */

import { getFingers } from '../core/chords';
import type {
  TapEvent,
  TapMouseEvent,
  ConnectionState,
  ConnectedDetail,
  TapSource,
} from '../core/types';
import type {
  BluetoothDeviceLike,
  GattCharacteristicLike,
  GattServerLike,
  NavigatorWithBluetooth,
} from './webbluetooth';
import {
  TAP_SERVICE,
  NUS_SERVICE,
  TAP_DATA_CHAR,
  MOUSE_DATA_CHAR,
  UI_CMD_CHAR,
  AIR_GESTURE_DATA_CHAR,
  TAP_MODE_CHAR,
  V2_READ_CHAR,
  DEVICE_INFORMATION_SERVICE,
  BATTERY_SERVICE,
  BATTERY_LEVEL_CHAR,
  MODE_REFRESH_INTERVAL_MS,
  MouseModes,
  InputType,
  controllerModeCommand,
  inputTypeCommand,
  vibrationCommand,
  parseTapData,
  parseMouseData,
  parseAirGesture,
  airMouseTapToGesture,
} from './protocol';

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
  private server: GattServerLike | null = null;
  private uiCmdChar: GattCharacteristicLike | null = null;
  private tapModeChar: GattCharacteristicLike | null = null;
  private mouseMode: MouseModes = MouseModes.STDBY;
  private modeRefreshTimer: number | null = null;
  private simulateTimer: number | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  getSource(): TapSource | null {
    return this.source;
  }

  /**
   * Connect to a real Tap over Web Bluetooth. Throws on failure.
   * Resolves after 'connected' has been dispatched.
   */
  async connect(): Promise<void> {
    const nav = navigator as NavigatorWithBluetooth;
    if (!nav.bluetooth) {
      throw new Error(
        'Web Bluetooth is unavailable in this browser. Chrome/Edge/Opera on localhost or HTTPS required. Use Simulate instead.',
      );
    }
    this.state = 'connecting';
    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [TAP_SERVICE] }],
        optionalServices: [NUS_SERVICE, DEVICE_INFORMATION_SERVICE, BATTERY_SERVICE],
      });
      this.btDevice = device;
      device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      if (!device.gatt) throw new Error('Device exposes no GATT server');
      const server = await device.gatt.connect();
      this.server = server;

      const tapService = await server.getPrimaryService(TAP_SERVICE);

      // ---- protocol detection: V2_READ_CHAR present => TapXR (v2) ----
      let isV2 = false;
      try {
        await tapService.getCharacteristic(V2_READ_CHAR);
        isV2 = true;
      } catch {
        isV2 = false;
      }

      const batteryLevel = await this.readBatteryLevel(server);

      if (isV2) {
        // TapXR framed protocol — not decoded yet. Be honest about it.
        this.source = 'bluetooth';
        this.state = 'connected';
        this.emitConnected({
          source: 'bluetooth',
          dataReady: false,
          protocol: 'v2',
          batteryLevel,
        });
        return;
      }

      // ---- v1 (Tap Strap 2): subscribe + switch to Controller mode ----
      const tapDataChar = await tapService.getCharacteristic(TAP_DATA_CHAR);
      await this.subscribe(tapDataChar, (view) => this.onTapData(view));

      try {
        const mouseChar = await tapService.getCharacteristic(MOUSE_DATA_CHAR);
        await this.subscribe(mouseChar, (view) => this.onMouseData(view));
      } catch {
        console.warn('Mouse characteristic unavailable (non-fatal)');
      }
      try {
        const airChar = await tapService.getCharacteristic(AIR_GESTURE_DATA_CHAR);
        await this.subscribe(airChar, (view) => this.onAirGestureData(view));
      } catch {
        console.warn('Air-gesture characteristic unavailable (non-fatal)');
      }
      try {
        this.uiCmdChar = await tapService.getCharacteristic(UI_CMD_CHAR);
      } catch {
        this.uiCmdChar = null;
      }

      // Controller mode lives on the Nordic UART service.
      try {
        const nus = await server.getPrimaryService(NUS_SERVICE);
        this.tapModeChar = await nus.getCharacteristic(TAP_MODE_CHAR);
      } catch {
        this.tapModeChar = null;
        console.warn(
          'NUS service unavailable — cannot switch to Controller mode; the Tap will keep typing HID text.',
        );
      }

      await this.writeControllerMode();
      this.startModeRefresh();

      this.source = 'bluetooth';
      this.state = 'connected';
      this.emitConnected({
        source: 'bluetooth',
        dataReady: true,
        protocol: 'v1',
        batteryLevel,
      });
    } catch (err) {
      this.cleanupBt();
      this.state = 'disconnected';
      this.dispatchEvent(new Event('disconnected'));
      throw err;
    }
  }

  /**
   * Haptic feedback on the physical device (no-op in simulate mode).
   * durations: ms per buzz segment, 10ms resolution, max 18 segments.
   */
  async sendVibration(durationsMs: number[]): Promise<void> {
    if (!this.uiCmdChar) return;
    try {
      await this.uiCmdChar.writeValue(vibrationCommand(durationsMs));
    } catch (err) {
      console.warn('Vibration write failed:', err);
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
    this.stopModeRefresh();
    if (this.server?.connected) {
      this.server.disconnect();
    }
    const hadActivity = this.source !== null || this.state !== 'disconnected';
    this.cleanupBt();
    if (hadActivity) {
      this.state = 'disconnected';
      this.dispatchEvent(new Event('disconnected'));
    }
  }

  disconnect(): void {
    this.stop();
  }

  // ---------------------------------------------------------------- BLE internals

  private async subscribe(
    char: GattCharacteristicLike,
    handler: (view: DataView) => void,
  ): Promise<void> {
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (ev: Event) => {
      const target = ev.target as GattCharacteristicLike | null;
      const view = target?.value;
      if (view) handler(view);
    });
  }

  private onTapData(view: DataView): void {
    const code = parseTapData(view);
    // AirMouse quirk: 2/4 in AIR_MOUSE mode are clicks, not chords.
    const gesture = airMouseTapToGesture(code, this.mouseMode);
    if (gesture !== null) {
      this.dispatchEvent(new CustomEvent<number>('airgesture', { detail: gesture }));
      return;
    }
    if (code >= 1 && code <= 31) this.emitTap(code);
  }

  private onMouseData(view: DataView): void {
    const parsed = parseMouseData(view);
    if (!parsed) return;
    const detail: TapMouseEvent = { ...parsed, timestamp: performance.now() };
    this.dispatchEvent(new CustomEvent<TapMouseEvent>('mouse', { detail }));
  }

  private onAirGestureData(view: DataView): void {
    const parsed = parseAirGesture(view);
    if (parsed.kind === 'mouseModeState') {
      this.mouseMode = parsed.mouseMode;
      return;
    }
    this.dispatchEvent(
      new CustomEvent<number>('airgesture', { detail: parsed.gesture }),
    );
  }

  private async writeControllerMode(): Promise<void> {
    if (!this.tapModeChar) return;
    try {
      await this.tapModeChar.writeValue(controllerModeCommand());
      await this.tapModeChar.writeValue(inputTypeCommand(InputType.AUTO));
    } catch (err) {
      console.warn('Input-mode write failed:', err);
    }
  }

  /**
   * The device reverts to Text mode on its own; the official SDK re-writes
   * the input mode every 10s. Same here — skip it and taps stop flowing.
   */
  private startModeRefresh(): void {
    this.stopModeRefresh();
    if (!this.tapModeChar) return;
    this.modeRefreshTimer = window.setInterval(() => {
      void this.writeControllerMode();
    }, MODE_REFRESH_INTERVAL_MS);
  }

  private stopModeRefresh(): void {
    if (this.modeRefreshTimer !== null) {
      window.clearInterval(this.modeRefreshTimer);
      this.modeRefreshTimer = null;
    }
  }

  private async readBatteryLevel(server: GattServerLike): Promise<number | null> {
    try {
      const battery = await server.getPrimaryService(BATTERY_SERVICE);
      const level = await battery.getCharacteristic(BATTERY_LEVEL_CHAR);
      const view = await level.readValue();
      return view.getUint8(0);
    } catch {
      return null;
    }
  }

  private cleanupBt(): void {
    this.btDevice = null;
    this.server = null;
    this.uiCmdChar = null;
    this.tapModeChar = null;
    this.mouseMode = MouseModes.STDBY;
    this.source = null;
  }

  private stopSimulateTimer(): void {
    if (this.simulateTimer !== null) {
      window.clearTimeout(this.simulateTimer);
      this.simulateTimer = null;
    }
  }

  private handleDisconnect(): void {
    this.stopSimulateTimer();
    this.stopModeRefresh();
    this.cleanupBt();
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
}
