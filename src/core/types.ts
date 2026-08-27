/**
 * TapLab core type definitions.
 * Everything else in the app speaks in these shapes.
 */

export interface TapEvent {
  code: number; // 5-bit tapcode (1-31; 0 = no fingers is invalid)
  timestamp: number; // performance.now() ms
  fingers: string[]; // which fingers tapped (e.g. ["Thumb", "Ring"])
}

export interface MouseEvent {
  vx: number;
  vy: number;
  proximity: boolean;
  timestamp: number;
}

export interface SessionStats {
  totalChords: number;
  correctChords: number;
  accuracy: number; // 0-1
  avgInterTapMs: number;
  perChordStats: Map<number, ChordStat>;
  startTime: number;
  endTime?: number;
  wpm: number; // standard WPM convention: (chords / 5) / minutes
}

export interface ChordStat {
  code: number;
  attempts: number;
  correct: number;
  accuracy: number;
  avgLatencyMs: number; // time since previous tap when this chord arrived
  recentErrors: number[]; // in training mode: tapcodes entered instead
  lastSeen: number;
}

export interface DrillConfig {
  targetCodes: number[];
  mode: 'random' | 'sequential' | 'weighted'; // weighted = bias toward weak chords
  totalPrompts: number;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'simulating';