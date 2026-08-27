/**
 * TelemetrySession - records the tap event stream and computes stats.
 *
 * Correctness model:
 *   - Training mode: pass { expected } to recordTap; correct = (code === expected).
 *   - Free-run mode: omit options; a tap is "correct" when its code resolves
 *     to a known character in the default map (vowels). This gives an
 *     immediate signal for which codes are unmapped ("weak").
 */

import { resolveChord, UNKNOWN_CHAR } from '../core/chords';
import type { TapEvent, SessionStats, ChordStat } from '../core/types';

export interface RecordOptions {
  expected?: number; // prompted code (training mode)
  correct?: boolean; // explicit override; wins over `expected`
}

export class TelemetrySession {
  private events: TapEvent[] = [];
  private startTime = 0;
  private endTime: number | undefined;
  private expectedSequence: number[] | undefined;
  private perChord = new Map<number, ChordStat>();

  /** Declare the prompt sequence (training mode). */
  setExpectedSequence(seq: number[] | undefined): void {
    this.expectedSequence = seq;
  }

  begin(): void {
    this.start();
  }

  start(): void {
    this.events = [];
    this.perChord.clear();
    this.startTime = performance.now();
    this.endTime = undefined;
  }

  finish(): void {
    this.endTime = performance.now();
  }

  recordTap(event: TapEvent, opts?: RecordOptions): void {
    if (this.startTime === 0) this.start();
    const ok =
      opts?.correct ??
      (opts?.expected === undefined
        ? resolveChord(event.code) !== UNKNOWN_CHAR
        : event.code === opts.expected);
    const key = opts?.expected ?? event.code;
    const prevTs =
      this.events.length > 0
        ? this.events[this.events.length - 1].timestamp
        : event.timestamp;
    const latency = event.timestamp - prevTs;

    const stat =
      this.perChord.get(key) ?? {
        code: key,
        attempts: 0,
        correct: 0,
        accuracy: 1,
        avgLatencyMs: 0,
        recentErrors: [],
        lastSeen: 0,
      };
    stat.attempts += 1;
    if (ok) stat.correct += 1;
    stat.accuracy = stat.correct / stat.attempts;
    stat.avgLatencyMs +=
      (latency - stat.avgLatencyMs) / stat.attempts; // running mean
    stat.lastSeen = event.timestamp;
    if (!ok && opts?.expected !== undefined) {
      stat.recentErrors.push(event.code);
      if (stat.recentErrors.length > 10) stat.recentErrors.shift();
    }
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
    const elapsedMin = Math.max((end - this.startTime) / 60000, 1 / 60000);
    const total = this.events.length;
    const correctCount = [...this.perChord.values()].reduce(
      (sum, c) => sum + c.correct,
      0,
    );
    const avgInter =
      timings.length === 0
        ? 0
        : timings.reduce((a, b) => a + b, 0) / timings.length;
    return {
      totalChords: total,
      correctChords: correctCount,
      accuracy: total === 0 ? 1 : correctCount / total,
      avgInterTapMs: avgInter,
      perChordStats: new Map(this.perChord),
      startTime: this.startTime,
      endTime: this.endTime,
      wpm: total / 5 / elapsedMin, // classic WPM convention: 5 keystrokes = 1 word
    };
  }

  /** Chords with accuracy below threshold, worst first. */
  getWeakChords(threshold = 0.95): ChordStat[] {
    return [...this.perChord.values()]
      .filter((c) => c.accuracy < threshold)
      .sort((a, b) => a.accuracy - b.accuracy);
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
        expectedSequence: this.expectedSequence ?? null,
        events: this.events,
      },
      null,
      2,
    );
  }
}