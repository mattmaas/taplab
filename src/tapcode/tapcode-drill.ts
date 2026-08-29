import {
  IM_CONTROL,
  LETTER_SYMBOL_CODES,
  MR_CONTROL,
  TAPCODE_GRID,
} from './tapcode';

export interface TapCodeLesson {
  id: string;
  name: string;
  description: string;
  targets: readonly string[];
}

export interface TapCodeCharStat {
  char: string;
  attempts: number;
  correct: number;
  accuracy: number;
  avgLatencyMs: number;
}

export interface TapCodeDrillPromptResult {
  prompt: string;
  actual: string;
  correct: boolean;
  latencyMs: number;
}

export interface TapCodeDrillSummary {
  promptCount: number;
  correct: number;
  accuracy: number | null;
  avgLatencyMs: number;
  perCharStats: TapCodeCharStat[];
  weakChars: string[];
}

export interface TapCodeDrillHooks {
  onPrompt?: (prompt: string, index: number, total: number) => void;
  onResult?: (result: TapCodeDrillPromptResult, index: number) => void;
  onComplete?: (summary: TapCodeDrillSummary) => void;
}

export type TapCodeDrillRng = () => number;

const GRID_LETTERS = TAPCODE_GRID.flat();
const ALL_LETTERS = [...GRID_LETTERS, 'z'];
const CONTROL_TARGETS = ['z', 'backspace', 'enter', '.', ','];
const COMMON_WORDS = [
  'the',
  'and',
  'you',
  'that',
  'was',
  'for',
  'with',
  'have',
  'this',
  'from',
];

export const TAPCODE_LESSONS: readonly TapCodeLesson[] = Object.freeze([
  {
    id: 'L1',
    name: 'Diagonal doubles',
    description: 'Learn the same-symbol mnemonic anchors.',
    targets: ['a', 'g', 'm', 's', 'y'],
  },
  {
    id: 'L2',
    name: 'Row 1 + space',
    description: 'Learn the first grid row and the space control.',
    targets: [...GRID_LETTERS.slice(0, 5), ' '],
  },
  {
    id: 'L3',
    name: 'Rows 1-2',
    description: 'Practice the first two grid rows.',
    targets: [...GRID_LETTERS.slice(0, 10), ' '],
  },
  {
    id: 'L4',
    name: 'Rows 1-3',
    description: 'Practice the first three grid rows.',
    targets: [...GRID_LETTERS.slice(0, 15), ' '],
  },
  {
    id: 'L5',
    name: 'Rows 1-4',
    description: 'Practice the first four grid rows.',
    targets: [...GRID_LETTERS.slice(0, 20), ' '],
  },
  {
    id: 'L6',
    name: 'Full grid',
    description: 'Practice every letter in the five-by-five grid.',
    targets: [...GRID_LETTERS, ' '],
  },
  {
    id: 'L7',
    name: 'Control plane',
    description: 'Learn Z and the MR-row editing controls.',
    targets: CONTROL_TARGETS,
  },
  {
    id: 'L8',
    name: 'Everything',
    description: 'Practice all letters, space, and control characters.',
    targets: [...ALL_LETTERS, ' ', 'backspace', 'enter', '.', ','],
  },
  {
    id: 'L9',
    name: 'Common words',
    description: 'Build fluency with frequently used words.',
    targets: COMMON_WORDS,
  },
  {
    id: 'L10',
    name: 'Sentences',
    description: 'Practice short phrases using the complete alphabet.',
    targets: [
      'the quick brown fox',
      'pack my box with five dozen jugs',
      'sphinx of black quartz',
      'how vexingly quick daft zebras jump',
      'the five boxing wizards jump quickly',
    ],
  },
]);

const SYMBOL_BY_INDEX = LETTER_SYMBOL_CODES;

function targetUnits(target: string): string[] {
  if (target === 'backspace' || target === 'enter') return [target];
  return Array.from(target);
}

function targetContainsWeakChar(
  target: string,
  weakChars: ReadonlySet<string>,
): boolean {
  return targetUnits(target).some((char) => weakChars.has(char));
}

/**
 * Build a randomized lesson sequence. Targets containing a weak character
 * receive three times the sampling weight.
 */
export function generateTapCodeDrill(
  lesson: TapCodeLesson,
  promptCount: number,
  weakChars: readonly string[] = [],
  rng: TapCodeDrillRng = Math.random,
): string[] {
  if (lesson.targets.length === 0) {
    throw new Error('generateTapCodeDrill: lesson has no targets');
  }
  if (!Number.isInteger(promptCount) || promptCount < 1) {
    throw new Error('generateTapCodeDrill: promptCount must be >= 1');
  }

  const weak = new Set(weakChars);
  const weights = lesson.targets.map((target) =>
    targetContainsWeakChar(target, weak) ? 3 : 1,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const sequence: string[] = [];

  for (let i = 0; i < promptCount; i++) {
    let roll = rng() * totalWeight;
    let selected = lesson.targets[lesson.targets.length - 1];

    for (let targetIndex = 0; targetIndex < lesson.targets.length; targetIndex++) {
      roll -= weights[targetIndex];
      if (roll <= 0) {
        selected = lesson.targets[targetIndex];
        break;
      }
    }

    sequence.push(selected);
  }

  return sequence;
}

function letterSequence(char: string): number[] | null {
  for (let row = 0; row < TAPCODE_GRID.length; row++) {
    const column = TAPCODE_GRID[row].indexOf(char);
    if (column >= 0) {
      return [SYMBOL_BY_INDEX[row], SYMBOL_BY_INDEX[column]];
    }
  }
  return null;
}

/** Return the exact Tap Code chord sequence needed to enter a target. */
export function expectedSequence(target: string): number[] {
  if (target === 'backspace') return [MR_CONTROL, 4];
  if (target === 'enter') return [MR_CONTROL, 8];

  const sequence: number[] = [];
  for (const char of Array.from(target.toLowerCase())) {
    if (char === ' ') {
      sequence.push(IM_CONTROL);
      continue;
    }
    if (char === 'z') {
      sequence.push(MR_CONTROL, 2);
      continue;
    }
    if (char === '.') {
      sequence.push(MR_CONTROL, 16);
      continue;
    }
    if (char === ',') {
      sequence.push(MR_CONTROL, 24);
      continue;
    }

    const symbols = letterSequence(char);
    if (symbols === null) {
      throw new Error(`Unsupported Tap Code target character: ${char}`);
    }
    sequence.push(...symbols);
  }
  return sequence;
}

interface MutableCharStat {
  attempts: number;
  correct: number;
  totalLatencyMs: number;
}

/**
 * Runs a Tap Code lesson using semantic decoder output rather than raw chords.
 * A mismatched character ends the current prompt as incorrect.
 */
export class TapCodeDrillRunner {
  private readonly prompts: string[];
  private readonly hooks: TapCodeDrillHooks;
  private readonly now: () => number;

  private index = 0;
  private progress = 0;
  private active = false;
  private promptShownAt = 0;
  private actual = '';
  private results: TapCodeDrillPromptResult[] = [];
  private charStats = new Map<string, MutableCharStat>();

  constructor(
    prompts: readonly string[],
    hooks: TapCodeDrillHooks = {},
    now: () => number = () => performance.now(),
  ) {
    if (prompts.length === 0) {
      throw new Error('TapCodeDrillRunner: empty prompt sequence');
    }
    this.prompts = [...prompts];
    this.hooks = hooks;
    this.now = now;
  }

  start(): void {
    this.index = 0;
    this.progress = 0;
    this.actual = '';
    this.results = [];
    this.charStats.clear();
    this.active = true;
    this.showCurrentPrompt();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.hooks.onComplete?.(this.buildSummary());
  }

  isActive(): boolean {
    return this.active;
  }

  getCurrentPrompt(): string | null {
    return this.active ? this.prompts[this.index] : null;
  }

  getProgress(): { completed: number; total: number; charsDone: number; charsTotal: number } {
    const prompt = this.getCurrentPrompt();
    return {
      completed: this.index,
      total: this.prompts.length,
      charsDone: this.progress,
      charsTotal: prompt === null ? 0 : targetUnits(prompt).length,
    };
  }

  /**
   * Feed committed semantic decoder output. Actions use the values
   * "backspace" and "enter"; ordinary commits use their emitted text.
   */
  feedCommittedOutput(output: string): void {
    if (!this.active || output.length === 0) return;

    const outputs =
      output === 'backspace' || output === 'enter'
        ? [output]
        : Array.from(output);

    for (const unit of outputs) {
      if (!this.active) return;
      const expectedUnits = targetUnits(this.prompts[this.index]);
      const expected = expectedUnits[this.progress];
      const latencyMs = Math.max(0, this.now() - this.promptShownAt);
      const correct = unit === expected;

      this.recordChar(expected, correct, latencyMs);
      this.actual += unit;

      if (!correct) {
        this.finishPrompt(false, latencyMs);
        return;
      }

      this.progress += 1;
      if (this.progress >= expectedUnits.length) {
        this.finishPrompt(true, latencyMs);
      }
    }
  }

  getWeakChars(threshold = 0.85, minAttempts = 3): string[] {
    if (threshold < 0 || threshold > 1) {
      throw new Error('TapCodeDrillRunner: threshold must be between 0 and 1');
    }
    if (!Number.isInteger(minAttempts) || minAttempts < 1) {
      throw new Error('TapCodeDrillRunner: minAttempts must be >= 1');
    }

    return this.getPerCharStats()
      .filter((stat) => stat.attempts >= minAttempts && stat.accuracy < threshold)
      .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
      .map((stat) => stat.char);
  }

  buildSummary(): TapCodeDrillSummary {
    const promptCount = this.results.length;
    const correct = this.results.filter((result) => result.correct).length;
    const avgLatencyMs =
      promptCount === 0
        ? 0
        : this.results.reduce((sum, result) => sum + result.latencyMs, 0) /
          promptCount;

    return {
      promptCount,
      correct,
      accuracy: promptCount === 0 ? null : correct / promptCount,
      avgLatencyMs,
      perCharStats: this.getPerCharStats(),
      weakChars: this.getWeakChars(),
    };
  }

  private showCurrentPrompt(): void {
    this.progress = 0;
    this.actual = '';
    this.promptShownAt = this.now();
    this.hooks.onPrompt?.(
      this.prompts[this.index],
      this.index,
      this.prompts.length,
    );
  }

  private finishPrompt(correct: boolean, latencyMs: number): void {
    const result: TapCodeDrillPromptResult = {
      prompt: this.prompts[this.index],
      actual: this.actual,
      correct,
      latencyMs,
    };
    this.results.push(result);
    this.hooks.onResult?.(result, this.index);

    this.index += 1;
    if (this.index >= this.prompts.length) {
      this.active = false;
      this.hooks.onComplete?.(this.buildSummary());
      return;
    }

    this.showCurrentPrompt();
  }

  private recordChar(char: string, correct: boolean, latencyMs: number): void {
    const stat = this.charStats.get(char) ?? {
      attempts: 0,
      correct: 0,
      totalLatencyMs: 0,
    };
    stat.attempts += 1;
    if (correct) stat.correct += 1;
    stat.totalLatencyMs += latencyMs;
    this.charStats.set(char, stat);
  }

  private getPerCharStats(): TapCodeCharStat[] {
    return [...this.charStats.entries()]
      .map(([char, stat]) => ({
        char,
        attempts: stat.attempts,
        correct: stat.correct,
        accuracy: stat.correct / stat.attempts,
        avgLatencyMs: stat.totalLatencyMs / stat.attempts,
      }))
      .sort((a, b) => a.char.localeCompare(b.char));
  }
}
