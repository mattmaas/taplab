/**
 * TapLab core type definitions.
 * Everything else in the app speaks in these shapes.
 */

export interface TapEvent {
  code: number; // 5-bit tapcode (1-31; 0 = no fingers is invalid)
  timestamp: number; // performance.now() ms
  fingers: string[]; // which fingers tapped (e.g. ["Thumb", "Ring"])
}

/**
 * Mouse movement frame from the Tap's optical sensor.
 * Named TapMouseEvent (not MouseEvent) to avoid shadowing the DOM type.
 */
export interface TapMouseEvent {
  vx: number;
  vy: number;
  proximity: boolean;
  timestamp: number;
}

/**
 * Session semantics:
 *  - 'freerun': open tapping. We CANNOT judge correctness (an unmapped code
 *    is not an error). Free-run reports throughput only — accuracy is null
 *    and weak-chord queries return [].
 *  - 'drill': every tap has a prompted `expected` code, so correctness,
 *    accuracy, and weak-chord detection are all meaningful.
 */
export type SessionMode = 'freerun' | 'drill';

export interface SessionStats {
  mode: SessionMode;
  totalChords: number;
  /** Judged-correct count. Only meaningful in drill mode (0 in free-run). */
  correctChords: number;
  /**
   * 0-1, or null when accuracy is undefined:
   * always null in free-run; null in drill until the first judged tap.
   */
  accuracy: number | null;
  avgInterTapMs: number;
  perChordStats: Map<number, ChordStat>;
  startTime: number;
  endTime?: number;
  wpm: number; // standard WPM convention: (chords / 5) / minutes
  /**
   * WPM is statistically meaningless for tiny samples/durations.
   * True once totalChords >= 10 AND elapsed >= 15s. UI should hide WPM
   * until this flips.
   */
  wpmReady: boolean;
}

export interface ChordStat {
  /** In drill mode this is the EXPECTED code; in free-run the actual code. */
  code: number;
  attempts: number;
  /** Drill mode only — stays 0 in free-run (no judgment happens). */
  correct: number;
  /**
   * correct/attempts in drill mode; null in free-run because correctness
   * is never judged there.
   */
  accuracy: number | null;
  /**
   * Running mean of inter-tap latency (ms). The session's first tap is
   * excluded — it has no predecessor, so it contributes no latency sample.
   */
  avgLatencyMs: number;
  /** How many latency samples went into avgLatencyMs. */
  latencySamples: number;
  /** Drill mode: tapcodes entered when this chord was expected (last 10). */
  recentErrors: number[];
  lastSeen: number;
}

export interface DrillConfig {
  targetCodes: number[];
  mode: 'random' | 'sequential' | 'weighted'; // weighted = bias toward weak chords
  totalPrompts: number;
}

/** Outcome of a single drill prompt. */
export interface DrillPromptResult {
  expected: number;
  actual: number;
  correct: boolean;
  /**
   * Prompt-shown -> tap-received latency. This is the drill-specific
   * metric (NOT inter-tap time): it measures recall + execution.
   */
  promptLatencyMs: number;
}

/** Final report for a completed (or aborted) drill run. */
export interface DrillSummary {
  total: number; // prompts answered
  planned: number; // prompts in the sequence
  correct: number;
  accuracy: number | null; // null if nothing was answered
  avgPromptLatencyMs: number;
  results: DrillPromptResult[];
  aborted: boolean;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'simulating';

/** Where tap events are coming from. */
export type TapSource = 'bluetooth' | 'simulate';

/**
 * Payload for the 'connected' event. dataReady=false means the transport
 * link is up but no tap data will flow (e.g. TapXR v2 framed protocol,
 * which the decoder does not speak yet — Tap Strap 2 v1 is live).
 */
export interface ConnectedDetail {
  source: TapSource;
  dataReady: boolean;
  /** BLE only: 'v1' = Tap Strap / Tap Strap 2, 'v2' = TapXR framed protocol. */
  protocol?: 'v1' | 'v2';
  /** BLE only: battery percentage read on connect, when available. */
  batteryLevel?: number | null;
}
