/**
 * Drill engine — the weak-chord -> targeted-practice loop.
 *
 * Two parts:
 *   1. generateDrill(): builds a prompt sequence from a chord set, optionally
 *      weighted by per-chord accuracy so weak chords appear more often.
 *   2. DrillRunner: the run state machine. Shows prompts, judges taps against
 *      the expected code, measures prompt->tap latency (recall + execution,
 *      NOT inter-tap time), records judged taps into the TelemetrySession,
 *      and reports a summary on completion.
 *
 * Determinism: both parts accept injectable rng/now for testing.
 */

import type {
  TapEvent,
  ChordStat,
  DrillConfig,
  DrillPromptResult,
  DrillSummary,
} from '../core/types';
import { TelemetrySession } from '../telemetry/session';

/**
 * Weighting model:
 *   weight = BASELINE + (1 - BASELINE) * (1 - accuracy)
 * A chord you always miss (acc 0) weighs 1.0; a perfect chord still keeps
 * BASELINE weight so mastered chords stay in rotation. Chords with no
 * judged history default to UNSEEN_ACCURACY (0.5) — explored, not spammed.
 */
export const WEIGHT_BASELINE = 0.15;
export const UNSEEN_ACCURACY = 0.5;

export type Rng = () => number; // [0, 1)

function chordWeight(code: number, stats?: Map<number, ChordStat>): number {
  const stat = stats?.get(code);
  const acc =
    stat && stat.accuracy !== null && stat.attempts > 0
      ? stat.accuracy
      : UNSEEN_ACCURACY;
  return WEIGHT_BASELINE + (1 - WEIGHT_BASELINE) * (1 - acc);
}

function pickWeighted(codes: number[], weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < codes.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return codes[i];
  }
  return codes[codes.length - 1];
}

/**
 * Build a drill prompt sequence.
 *  - 'sequential': cycle targetCodes in order until totalPrompts.
 *  - 'random': uniform over targetCodes, avoiding immediate repeats.
 *  - 'weighted': accuracy-weighted sampling (weak chords more often),
 *    avoiding immediate repeats.
 */
export function generateDrill(
  config: DrillConfig,
  stats?: Map<number, ChordStat>,
  rng: Rng = Math.random,
): number[] {
  const { targetCodes, mode, totalPrompts } = config;
  const codes = targetCodes.filter((c) => c >= 1 && c <= 31);
  if (codes.length === 0) throw new Error('generateDrill: no valid target codes');
  if (totalPrompts < 1) throw new Error('generateDrill: totalPrompts must be >= 1');

  if (mode === 'sequential') {
    return Array.from({ length: totalPrompts }, (_, i) => codes[i % codes.length]);
  }

  const weights =
    mode === 'weighted' ? codes.map((c) => chordWeight(c, stats)) : codes.map(() => 1);

  const out: number[] = [];
  for (let i = 0; i < totalPrompts; i++) {
    let pick = pickWeighted(codes, weights, rng);
    // Avoid prompting the same chord twice in a row when alternatives exist.
    if (codes.length > 1) {
      let guard = 0;
      while (pick === out[out.length - 1] && guard < 10) {
        pick = pickWeighted(codes, weights, rng);
        guard++;
      }
    }
    out.push(pick);
  }
  return out;
}

export interface DrillHooks {
  /** A new prompt is on deck. */
  onPrompt?: (expected: number, index: number, total: number) => void;
  /** A tap was judged against the current prompt. */
  onResult?: (result: DrillPromptResult, index: number) => void;
  /** The run finished (all prompts answered, or aborted). */
  onComplete?: (summary: DrillSummary) => void;
}

/**
 * DrillRunner — owns one drill run.
 *
 * Lifecycle: start() -> [handleTap() x N] -> onComplete
 * start() resets the session into 'drill' mode, so every run begins with
 * clean judged stats; the session is intentionally left in drill mode after
 * completion so weak-chord queries can feed the next drill.
 */
export class DrillRunner {
  private readonly sequence: number[];
  private readonly session: TelemetrySession;
  private readonly hooks: DrillHooks;
  private readonly now: () => number;

  private index = 0;
  private active = false;
  private promptShownAt = 0;
  private results: DrillPromptResult[] = [];

  constructor(
    sequence: number[],
    session: TelemetrySession,
    hooks: DrillHooks = {},
    now: () => number = () => performance.now(),
  ) {
    if (sequence.length === 0) throw new Error('DrillRunner: empty sequence');
    this.sequence = [...sequence];
    this.session = session;
    this.hooks = hooks;
    this.now = now;
  }

  start(): void {
    this.session.start('drill');
    this.session.setExpectedSequence([...this.sequence]);
    this.index = 0;
    this.results = [];
    this.active = true;
    this.promptShownAt = this.now();
    this.hooks.onPrompt?.(this.sequence[0], 0, this.sequence.length);
  }

  isActive(): boolean {
    return this.active;
  }

  getCurrentExpected(): number | null {
    return this.active ? this.sequence[this.index] : null;
  }

  getProgress(): { answered: number; total: number } {
    return { answered: this.index, total: this.sequence.length };
  }

  /** Judge a tap against the current prompt. Ignored when not active. */
  handleTap(event: TapEvent): void {
    if (!this.active) return;
    const expected = this.sequence[this.index];
    const correct = event.code === expected;
    const promptLatencyMs = Math.max(0, event.timestamp - this.promptShownAt);

    this.session.recordTap(event, { expected });

    const result: DrillPromptResult = {
      expected,
      actual: event.code,
      correct,
      promptLatencyMs,
    };
    this.results.push(result);
    this.hooks.onResult?.(result, this.index);

    this.index += 1;
    if (this.index >= this.sequence.length) {
      this.finish(false);
      return;
    }
    this.promptShownAt = this.now();
    this.hooks.onPrompt?.(this.sequence[this.index], this.index, this.sequence.length);
  }

  /** Stop early. Answered prompts still count; summary flags aborted. */
  abort(): void {
    if (!this.active) return;
    this.finish(true);
  }

  private finish(aborted: boolean): void {
    this.active = false;
    this.session.finish();
    this.hooks.onComplete?.(this.buildSummary(aborted));
  }

  buildSummary(aborted: boolean): DrillSummary {
    const total = this.results.length;
    const correct = this.results.filter((r) => r.correct).length;
    const avgLatency =
      total === 0
        ? 0
        : this.results.reduce((a, r) => a + r.promptLatencyMs, 0) / total;
    return {
      total,
      planned: this.sequence.length,
      correct,
      accuracy: total === 0 ? null : correct / total,
      avgPromptLatencyMs: avgLatency,
      results: [...this.results],
      aborted,
    };
  }
}

/**
 * The product loop: build the next drill from what the last session proved
 * you're bad at. Falls back to fullSet exploration when there isn't enough
 * weak-chord signal yet.
 */
export function buildWeakChordDrill(
  weak: ChordStat[],
  fullSet: readonly number[],
  totalPrompts: number,
  stats?: Map<number, ChordStat>,
  rng: Rng = Math.random,
): number[] {
  const weakCodes = weak.map((w) => w.code);
  const targets =
    weakCodes.length >= 3
      ? weakCodes
      : [...new Set([...weakCodes, ...fullSet])]; // thin signal -> explore
  return generateDrill(
    { targetCodes: targets, mode: 'weighted', totalPrompts },
    stats,
    rng,
  );
}
