/**
 * Minimal structural Web Bluetooth typings.
 *
 * We type only the surface we use, structurally, so the project compiles
 * against the standard DOM lib without @types/web-bluetooth and without
 * depending on browser-specific ambient types.
 */

export interface GattCharacteristicLike {
  readonly uuid: string;
  readonly value?: DataView | null;
  startNotifications(): Promise<GattCharacteristicLike>;
  addEventListener(type: string, listener: (ev: Event) => void): void;
  writeValue(value: ArrayBuffer | ArrayBufferView): Promise<void>;
  readValue(): Promise<DataView>;
}

export interface GattServiceLike {
  readonly uuid: string;
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
}

export interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
}

export interface BluetoothDeviceLike {
  readonly name?: string;
  readonly gatt?: GattServerLike;
  addEventListener(type: string, listener: (ev: Event) => void): void;
}

export interface BluetoothRequestOptions {
  filters?: Array<{ namePrefix?: string; services?: string[] }>;
  optionalServices?: string[];
}

export interface BluetoothLike {
  requestDevice(options: BluetoothRequestOptions): Promise<BluetoothDeviceLike>;
}

export type NavigatorWithBluetooth = Navigator & { bluetooth?: BluetoothLike };
