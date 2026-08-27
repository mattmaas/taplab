import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TelemetrySession,
  WEAK_CHORD_MIN_ATTEMPTS,
  WPM_MIN_CHORDS,
  WPM_MIN_ELAPSED_MS,
} from './session';
import type { TapEvent } from '../core/types';

function tap(code: number, timestamp: number): TapEvent {
  return { code, timestamp, fingers: [] };
}

let nowValue = 0;
beforeEach(() => {
  nowValue = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('free-run mode (P1: throughput only, no judgment)', () => {
  it('reports accuracy as null regardless of map coverage', () => {
    const s = new TelemetrySession();
    s.start('freerun');
    s.recordTap(tap(1, 100)); // mapped vowel
    s.recordTap(tap(31, 400)); // unmapped code
    const stats = s.getStats();
    expect(stats.mode).toBe('freerun');
    expect(stats.accuracy).toBeNull();
    expect(stats.correctChords).toBe(0);
    expect(stats.totalChords).toBe(2);
  });

  it('returns no weak chords — free-run cannot judge', () => {
    const s = new TelemetrySession();
    s.start('freerun');
    for (let i = 0; i < 20; i++) s.recordTap(tap(31, i * 100));
    expect(s.getWeakChords()).toEqual([]);
  });

  it('ignores smuggled correctness options and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new TelemetrySession();
    s.start('freerun');
    s.recordTap(tap(3, 100), { expected: 3 });
    expect(warn).toHaveBeenCalled();
    expect(s.getStats().accuracy).toBeNull();
  });

  it('empty session reports null accuracy, not 100%', () => {
    const s = new TelemetrySession();
    s.start('freerun');
    expect(s.getStats().accuracy).toBeNull();
  });
});

describe('drill mode (judged taps)', () => {
  it('computes accuracy from expected codes', () => {
    const s = new TelemetrySession();
    s.start('drill');
    s.recordTap(tap(1, 100), { expected: 1 }); // hit
    s.recordTap(tap(2, 300), { expected: 1 }); // miss
    s.recordTap(tap(1, 500), { expected: 1 }); // hit
    const stats = s.getStats();
    expect(stats.accuracy).toBeCloseTo(2 / 3);
    expect(stats.correctChords).toBe(2);
  });

  it('keys stats by EXPECTED code, not actual', () => {
    const s = new TelemetrySession();
    s.start('drill');
    s.recordTap(tap(2, 100), { expected: 1 }); // typed e when prompted a
    const stats = s.getStats();
    expect(stats.perChordStats.has(1)).toBe(true);
    expect(stats.perChordStats.has(2)).toBe(false);
    expect(stats.perChordStats.get(1)?.recentErrors).toEqual([2]);
  });

  it('drill accuracy is null before any judged tap', () => {
    const s = new TelemetrySession();
    s.start('drill');
    expect(s.getStats().accuracy).toBeNull();
  });

  it('respects explicit correct override', () => {
    const s = new TelemetrySession();
    s.start('drill');
    s.recordTap(tap(2, 100), { expected: 1, correct: true }); // override wins
    expect(s.getStats().accuracy).toBe(1);
  });
});

describe('weak-chord detection (P1: minimum sample size)', () => {
  it(`excludes chords with fewer than ${WEAK_CHORD_MIN_ATTEMPTS} attempts`, () => {
    const s = new TelemetrySession();
    s.start('drill');
    // 4 misses on code 5 — bad but below the sample-size bar
    for (let i = 0; i < WEAK_CHORD_MIN_ATTEMPTS - 1; i++) {
      s.recordTap(tap(6, i * 100), { expected: 5 });
    }
    expect(s.getWeakChords()).toEqual([]);
    // 5th attempt crosses the bar
    s.recordTap(tap(6, 900), { expected: 5 });
    const weak = s.getWeakChords();
    expect(weak).toHaveLength(1);
    expect(weak[0].code).toBe(5);
    expect(weak[0].accuracy).toBe(0);
  });

  it('sorts worst first and respects threshold', () => {
    const s = new TelemetrySession();
    s.start('drill');
    // code 1: 5 hits (100%) — not weak
    for (let i = 0; i < 5; i++) s.recordTap(tap(1, i * 10), { expected: 1 });
    // code 2: 1 hit / 4 miss (20%)
    s.recordTap(tap(2, 100), { expected: 2 });
    for (let i = 0; i < 4; i++) s.recordTap(tap(9, 200 + i * 10), { expected: 2 });
    // code 4: 3 hit / 2 miss (60%)
    for (let i = 0; i < 3; i++) s.recordTap(tap(4, 300 + i * 10), { expected: 4 });
    for (let i = 0; i < 2; i++) s.recordTap(tap(9, 400 + i * 10), { expected: 4 });

    const weak = s.getWeakChords(0.95);
    expect(weak.map((w) => w.code)).toEqual([2, 4]);
  });
});

describe('latency (P2: first tap contributes no sample)', () => {
  it('excludes the first event from latency means', () => {
    const s = new TelemetrySession();
    s.start('freerun');
    s.recordTap(tap(1, 1000)); // first event — no predecessor
    const first = s.getStats().perChordStats.get(1)!;
    expect(first.latencySamples).toBe(0);
    expect(first.avgLatencyMs).toBe(0);

    s.recordTap(tap(1, 1250)); // 250ms after
    const after = s.getStats().perChordStats.get(1)!;
    expect(after.latencySamples).toBe(1);
    expect(after.avgLatencyMs).toBe(250);
  });

  it('avgInterTapMs matches the running mean of deltas', () => {
    const s = new TelemetrySession();
    s.start('freerun');
    s.recordTap(tap(1, 0));
    s.recordTap(tap(2, 200));
    s.recordTap(tap(4, 600)); // deltas: 200, 400
    expect(s.getStats().avgInterTapMs).toBe(300);
  });
});

describe('WPM gating (P2)', () => {
  it('wpmReady is false for tiny samples even over long time', () => {
    const s = new TelemetrySession();
    nowValue = 0;
    s.start('freerun');
    nowValue = WPM_MIN_ELAPSED_MS + 1000;
    s.recordTap(tap(1, nowValue));
    expect(s.getStats().wpmReady).toBe(false); // 1 chord < min
  });

  it('wpmReady is false for big samples over short time', () => {
    const s = new TelemetrySession();
    nowValue = 0;
    s.start('freerun');
    for (let i = 0; i < WPM_MIN_CHORDS + 5; i++) s.recordTap(tap(1, i * 10));
    nowValue = 1000; // only 1s elapsed
    expect(s.getStats().wpmReady).toBe(false);
  });

  it('wpmReady flips true once both thresholds are met', () => {
    const s = new TelemetrySession();
    nowValue = 0;
    s.start('freerun');
    for (let i = 0; i < WPM_MIN_CHORDS; i++) s.recordTap(tap(1, i * 100));
    nowValue = WPM_MIN_ELAPSED_MS;
    const stats = s.getStats();
    expect(stats.wpmReady).toBe(true);
    expect(stats.wpm).toBeGreaterThan(0);
  });
});

describe('mode isolation (P2: distributions never mix)', () => {
  it('switching modes clears all per-chord state', () => {
    const s = new TelemetrySession();
    s.start('drill');
    for (let i = 0; i < 6; i++) s.recordTap(tap(9, i * 100), { expected: 5 });
    expect(s.getWeakChords()).toHaveLength(1);

    s.start('freerun'); // mode switch = full reset
    expect(s.getStats().totalChords).toBe(0);
    expect(s.getStats().perChordStats.size).toBe(0);
    expect(s.getWeakChords()).toEqual([]);
  });
});

describe('export', () => {
  it('serializes mode, stats, and events as valid JSON', () => {
    const s = new TelemetrySession();
    s.start('drill');
    s.recordTap(tap(1, 100), { expected: 1 });
    const parsed = JSON.parse(s.export());
    expect(parsed.mode).toBe('drill');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.stats.totalChords).toBe(1);
  });
});
