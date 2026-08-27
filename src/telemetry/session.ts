/**
 * TelemetrySession — records the tap event stream and computes stats.
 *
 * Correctness model (P1 review fix):
 *   - 'drill' mode: every recordTap MUST carry { expected } (or an explicit
 *     { correct } override). correct = (code === expected). Accuracy and
 *     weak-chord detection are only meaningful here.
 *   - 'freerun' mode: correctness is NEVER judged. An unmapped code is not
 *     an error — we cannot distinguish "unmapped" from "missed". Free-run
 *     reports throughput only (count, WPM, inter-tap timing). accuracy is
 *     null and getWeakChords() returns [].
 *
 * Mode is fixed for the lifetime of a run: start(mode) clears all state,
 * so drill and free-run distributions can never mix in one Map (P2 fix #4).
 *
 * Stat keying:
 *   - drill: keyed by EXPECTED code — "when prompted X, what happened?"
 *   - freerun: keyed by ACTUAL code — pure per-chord throughput.
 */

import type { TapEvent, SessionStats, ChordStat, SessionMode } from '../core/types';

export interface RecordOptions {
  expected?: number; // prompted code (drill mode)
  correct?: boolean; // explicit override; wins over `expected`
}

/** WPM is hidden until both thresholds are met (P2 fix #2). */
export const WPM_MIN_CHORDS = 10;
export const WPM_MIN_ELAPSED_MS = 15_000;

/** Chords need this many attempts before we judge them weak (P1 fix). */
export const WEAK_CHORD_MIN_ATTEMPTS = 5;

export class TelemetrySession {
  private events: TapEvent[] = [];
  private started = false;
  private startTime = 0;
  private endTime: number | undefined;
  private mode: SessionMode = 'freerun';
  private expectedSequence: number[] | undefined;
  private perChord = new Map<number, ChordStat>();
  /** Count of taps that were actually judged (drill mode only). */
  private judgedCount = 0;
  private judgedCorrect = 0;

  /** Declare the prompt sequence (drill mode bookkeeping/export). */
  setExpectedSequence(seq: number[] | undefined): void {
    this.expectedSequence = seq;
  }

  getMode(): SessionMode {
    return this.mode;
  }

  /**
   * Start (or restart) a run. Clears ALL prior state — drill and free-run
   * stats never share a Map.
   */
  start(mode: SessionMode = 'freerun'): void {
    this.events = [];
    this.perChord.clear();
    this.judgedCount = 0;
    this.judgedCorrect = 0;
    this.mode = mode;
    this.started = true;
    this.startTime = performance.now();
    this.endTime = undefined;
    if (mode === 'freerun') this.expectedSequence = undefined;
  }

  finish(): void {
    this.endTime = performance.now();
  }

  recordTap(event: TapEvent, opts?: RecordOptions): void {
    // Sentinel is an explicit flag — NOT startTime === 0, because
    // performance.now() can legitimately be 0 (found by test suite).
    if (!this.started) this.start(this.mode);

    // --- Mode guard (P2 fix #4): free-run never judges correctness. ---
    let judged = false;
    let ok = false;
    if (this.mode === 'drill') {
      if (opts?.correct !== undefined) {
        judged = true;
        ok = opts.correct;
      } else if (opts?.expected !== undefined) {
        judged = true;
        ok = event.code === opts.expected;
      }
      // Drill taps without expected/correct are recorded but not judged.
    } else if (opts?.expected !== undefined || opts?.correct !== undefined) {
      // Free-run must not smuggle in judgments — ignore and warn once.
      console.warn(
        'TelemetrySession: correctness options ignored in freerun mode. ' +
          'Call start("drill") for judged sessions.',
      );
    }

    // Drill keys stats by the EXPECTED code; free-run by the ACTUAL code.
    const key =
      this.mode === 'drill' && opts?.expected !== undefined
        ? opts.expected
        : event.code;

    // --- Latency (P2 fix #1): the session's first event has no
    // predecessor, so it contributes NO latency sample. ---
    const hasPredecessor = this.events.length > 0;
    const latency = hasPredecessor
      ? event.timestamp - this.events[this.events.length - 1].timestamp
      : 0;

    const stat: ChordStat =
      this.perChord.get(key) ?? {
        code: key,
        attempts: 0,
        correct: 0,
        accuracy: null,
        avgLatencyMs: 0,
        latencySamples: 0,
        recentErrors: [],
        lastSeen: 0,
      };

    stat.attempts += 1;
    if (judged) {
      this.judgedCount += 1;
      if (ok) {
        stat.correct += 1;
        this.judgedCorrect += 1;
      } else {
        stat.recentErrors.push(event.code);
        if (stat.recentErrors.length > 10) stat.recentErrors.shift();
      }
      stat.accuracy = stat.correct / stat.attempts;
    }
    if (hasPredecessor) {
      stat.latencySamples += 1;
      stat.avgLatencyMs += (latency - stat.avgLatencyMs) / stat.latencySamples;
    }
    stat.lastSeen = event.timestamp;

    this.perChord.set(key, stat);
    this.events.push(event);
  }

  getEvents(): TapEvent[] {
    return [...this.events];
  }

  /** Inter-tap deltas between consecutive events. */
  getInterTapTimings(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.events.length; i++) {
      out.push(this.events[i].timestamp - this.events[i - 1].timestamp);
    }
    return out;
  }

  getStats(): SessionStats {
    const timings = this.getInterTapTimings();
    const end = this.endTime ?? performance.now();
    const elapsedMs = Math.max(end - this.startTime, 1);
    const elapsedMin = elapsedMs / 60000;
    const total = this.events.length;
    const avgInter =
      timings.length === 0
        ? 0
        : timings.reduce((a, b) => a + b, 0) / timings.length;

    // Accuracy is null unless we actually judged something (P1 + nit fix:
    // an empty session is "no data", not 100%).
    const accuracy =
      this.mode === 'drill' && this.judgedCount > 0
        ? this.judgedCorrect / this.judgedCount
        : null;

    return {
      mode: this.mode,
      totalChords: total,
      correctChords: this.judgedCorrect,
      accuracy,
      avgInterTapMs: avgInter,
      perChordStats: new Map(this.perChord),
      startTime: this.startTime,
      endTime: this.endTime,
      wpm: total / 5 / elapsedMin, // classic convention: 5 keystrokes = 1 word
      wpmReady: total >= WPM_MIN_CHORDS && elapsedMs >= WPM_MIN_ELAPSED_MS,
    };
  }

  /**
   * Chords with accuracy below threshold, worst first.
   * Drill mode only — free-run cannot judge, so it returns [].
   * Chords with fewer than minAttempts attempts are excluded: one bad
   * sample is not a statistical verdict (P1 fix).
   */
  getWeakChords(
    threshold = 0.95,
    minAttempts = WEAK_CHORD_MIN_ATTEMPTS,
  ): ChordStat[] {
    if (this.mode !== 'drill') return [];
    return [...this.perChord.values()]
      .filter(
        (c) =>
          c.attempts >= minAttempts &&
          c.accuracy !== null &&
          c.accuracy < threshold,
      )
      .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
  }

  /** JSON snapshot of stats + raw events. */
  export(): string {
    const stats = this.getStats();
    const perChord: Record<string, ChordStat> = {};
    for (const [code, stat] of stats.perChordStats) {
      perChord[String(code)] = stat;
    }
    return JSON.stringify(
      {
        stats: { ...stats, perChordStats: perChord },
        mode: this.mode,
        expectedSequence: this.expectedSequence ?? null,
        events: this.events,
      },
      null,
      2,
    );
  }
}
