import { describe, it, expect, vi } from 'vitest';
import {
  generateDrill,
  DrillRunner,
  buildWeakChordDrill,
  WEIGHT_BASELINE,
} from './drill';
import { TelemetrySession } from '../telemetry/session';
import type { TapEvent, ChordStat, DrillSummary, DrillPromptResult } from '../core/types';

function tap(code: number, timestamp: number): TapEvent {
  return { code, timestamp, fingers: [] };
}

function stat(code: number, attempts: number, correct: number): ChordStat {
  return {
    code,
    attempts,
    correct,
    accuracy: attempts > 0 ? correct / attempts : null,
    avgLatencyMs: 0,
    latencySamples: 0,
    recentErrors: [],
    lastSeen: 0,
  };
}

/** Deterministic rng cycling through provided values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('generateDrill', () => {
  it('sequential cycles targets in order to the requested length', () => {
    const seq = generateDrill({
      targetCodes: [1, 2, 4],
      mode: 'sequential',
      totalPrompts: 7,
    });
    expect(seq).toEqual([1, 2, 4, 1, 2, 4, 1]);
  });

  it('random uses only target codes and hits the requested length', () => {
    const seq = generateDrill(
      { targetCodes: [1, 2], mode: 'random', totalPrompts: 50 },
      undefined,
      seqRng([0.1, 0.6, 0.3, 0.9]),
    );
    expect(seq).toHaveLength(50);
    expect(new Set(seq).size).toBeLessThanOrEqual(2);
    for (const code of seq) expect([1, 2]).toContain(code);
  });

  it('avoids immediate repeats when alternatives exist', () => {
    const seq = generateDrill(
      { targetCodes: [1, 2, 4, 8], mode: 'random', totalPrompts: 100 },
      undefined,
      Math.random,
    );
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('single-code target allows repeats (no alternatives)', () => {
    const seq = generateDrill({ targetCodes: [5], mode: 'random', totalPrompts: 5 });
    expect(seq).toEqual([5, 5, 5, 5, 5]);
  });

  it('weighted biases toward low-accuracy chords', () => {
    // code 3: 0% accuracy (weight 1.0), code 5: 100% (weight = baseline)
    const stats = new Map<number, ChordStat>([
      [3, stat(3, 10, 0)],
      [5, stat(5, 10, 10)],
    ]);
    const seq = generateDrill(
      { targetCodes: [3, 5], mode: 'weighted', totalPrompts: 400 },
      stats,
      Math.random,
    );
    const weakCount = seq.filter((c) => c === 3).length;
    // Expected ratio 1.0 / (1.0 + 0.15) ≈ 87%. With repeat-avoidance it
    // drifts toward alternation, so just assert a strong majority.
    expect(weakCount).toBeGreaterThan(200);
  });

  it('weighted keeps mastered chords in rotation via baseline weight', () => {
    expect(WEIGHT_BASELINE).toBeGreaterThan(0);
    const stats = new Map<number, ChordStat>([
      [3, stat(3, 10, 0)],
      [5, stat(5, 10, 10)],
    ]);
    // Force rolls that land in the tail of the cumulative distribution.
    const seq = generateDrill(
      { targetCodes: [3, 5], mode: 'weighted', totalPrompts: 10 },
      stats,
      seqRng([0.99]),
    );
    expect(seq).toContain(5);
  });

  it('throws on empty targets or bad count', () => {
    expect(() =>
      generateDrill({ targetCodes: [], mode: 'random', totalPrompts: 5 }),
    ).toThrow();
    expect(() =>
      generateDrill({ targetCodes: [1], mode: 'random', totalPrompts: 0 }),
    ).toThrow();
  });

  it('filters out-of-range codes', () => {
    const seq = generateDrill({
      targetCodes: [0, 1, 32, 99],
      mode: 'sequential',
      totalPrompts: 3,
    });
    expect(seq).toEqual([1, 1, 1]);
  });
});

describe('DrillRunner', () => {
  function makeRunner(sequence: number[], nowValues: number[]) {
    const session = new TelemetrySession();
    let i = 0;
    const now = () => nowValues[Math.min(i++, nowValues.length - 1)];
    const prompts: Array<{ code: number; index: number }> = [];
    const results: DrillPromptResult[] = [];
    let summary: DrillSummary | null = null;
    const runner = new DrillRunner(
      sequence,
      session,
      {
        onPrompt: (code, index) => prompts.push({ code, index }),
        onResult: (r) => results.push(r),
        onComplete: (s) => (summary = s),
      },
      now,
    );
    return { runner, session, prompts, results, getSummary: () => summary };
  }

  it('runs the full lifecycle: prompt -> judge -> advance -> complete', () => {
    const { runner, prompts, results, getSummary } = makeRunner([1, 2], [1000, 2000]);
    runner.start();
    expect(runner.isActive()).toBe(true);
    expect(prompts).toEqual([{ code: 1, index: 0 }]);
    expect(runner.getCurrentExpected()).toBe(1);

    runner.handleTap(tap(1, 1400)); // correct, 400ms after prompt@1000
    expect(results[0]).toEqual({
      expected: 1,
      actual: 1,
      correct: true,
      promptLatencyMs: 400,
    });
    expect(prompts[1]).toEqual({ code: 2, index: 1 });

    runner.handleTap(tap(4, 2500)); // wrong (tapped 4, wanted 2), 500ms after prompt@2000
    const summary = getSummary()!;
    expect(runner.isActive()).toBe(false);
    expect(summary.total).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.avgPromptLatencyMs).toBe(450);
    expect(summary.aborted).toBe(false);
  });

  it('records judged taps into the session keyed by expected code', () => {
    const { runner, session } = makeRunner([5, 5, 5], [0, 0, 0]);
    runner.start();
    runner.handleTap(tap(5, 10)); // hit
    runner.handleTap(tap(9, 20)); // miss
    runner.handleTap(tap(5, 30)); // hit
    const stats = session.getStats();
    expect(stats.mode).toBe('drill');
    expect(stats.accuracy).toBeCloseTo(2 / 3);
    const chord = stats.perChordStats.get(5)!;
    expect(chord.attempts).toBe(3);
    expect(chord.correct).toBe(2);
    expect(chord.recentErrors).toEqual([9]);
  });

  it('ignores taps when inactive and after completion', () => {
    const { runner, results } = makeRunner([1], [0]);
    runner.handleTap(tap(1, 5)); // before start
    expect(results).toHaveLength(0);
    runner.start();
    runner.handleTap(tap(1, 10));
    runner.handleTap(tap(1, 20)); // after complete
    expect(results).toHaveLength(1);
  });

  it('abort produces a summary flagged aborted with partial results', () => {
    const { runner, getSummary } = makeRunner([1, 2, 4], [0, 0, 0]);
    runner.start();
    runner.handleTap(tap(1, 10));
    runner.abort();
    const s = getSummary()!;
    expect(s.aborted).toBe(true);
    expect(s.total).toBe(1);
    expect(s.planned).toBe(3);
    expect(runner.isActive()).toBe(false);
  });

  it('clamps negative latency to 0 (clock skew safety)', () => {
    const { runner, results } = makeRunner([1], [1000]);
    runner.start();
    runner.handleTap(tap(1, 900)); // timestamp before promptShownAt
    expect(results[0].promptLatencyMs).toBe(0);
  });

  it('throws on empty sequence', () => {
    expect(() => new DrillRunner([], new TelemetrySession())).toThrow();
  });
});

describe('buildWeakChordDrill (the product loop)', () => {
  it('drills weak codes when there is enough signal', () => {
    const weak = [stat(3, 6, 1), stat(7, 5, 0), stat(12, 8, 2)];
    const seq = buildWeakChordDrill(weak, [1, 2, 4, 8, 16], 30);
    for (const code of seq) expect([3, 7, 12]).toContain(code);
  });

  it('falls back to exploration when weak signal is thin', () => {
    const weak = [stat(3, 6, 1)]; // only one weak chord
    const seq = buildWeakChordDrill(weak, [1, 2], 50);
    const used = new Set(seq);
    expect(used.size).toBeGreaterThan(1); // explored beyond the single weak code
    for (const code of seq) expect([3, 1, 2]).toContain(code);
  });

  it('end-to-end: drill -> misses -> weak chords -> next drill targets them', () => {
    const session = new TelemetrySession();
    // Drill: 6 prompts of code 5; user always taps 9 (0% accuracy).
    const runner = new DrillRunner([5, 5, 5, 5, 5, 5], session, {}, () => 0);
    runner.start();
    for (let i = 0; i < 6; i++) runner.handleTap(tap(9, i * 100));

    const weak = session.getWeakChords();
    expect(weak.map((w) => w.code)).toEqual([5]);

    const next = buildWeakChordDrill(
      weak,
      [1, 2, 4],
      20,
      session.getStats().perChordStats,
    );
    // Thin signal (1 weak chord) -> weighted exploration, but the weak
    // chord must dominate: weight 1.0 vs unseen 0.575.
    const weakShare = next.filter((c) => c === 5).length / next.length;
    expect(weakShare).toBeGreaterThan(0.2);
    expect(next).toContain(5);
  });
});
