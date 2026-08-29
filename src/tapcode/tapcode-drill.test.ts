import { describe, expect, it, vi } from 'vitest';
import {
  TAPCODE_LESSONS,
  TapCodeDrillRunner,
  expectedSequence,
  generateTapCodeDrill,
} from './tapcode-drill';

describe('expectedSequence', () => {
  it('encodes individual letters and space', () => {
    expect(expectedSequence('a')).toEqual([2, 2]);
    expect(expectedSequence('g')).toEqual([4, 4]);
    expect(expectedSequence('y')).toEqual([24, 24]);
    expect(expectedSequence(' ')).toEqual([6]);
  });

  it('encodes z and control-plane actions', () => {
    expect(expectedSequence('z')).toEqual([12, 2]);
    expect(expectedSequence('backspace')).toEqual([12, 4]);
    expect(expectedSequence('enter')).toEqual([12, 8]);
    expect(expectedSequence('.')).toEqual([12, 16]);
    expect(expectedSequence(',')).toEqual([12, 24]);
  });

  it('concatenates symbols for words', () => {
    expect(expectedSequence('the')).toEqual([16, 24, 4, 8, 2, 24]);
  });

  it('rejects unsupported characters', () => {
    expect(() => expectedSequence('!')).toThrow(
      'Unsupported Tap Code target character',
    );
  });
});

describe('generateTapCodeDrill', () => {
  const lesson = {
    id: 'test',
    name: 'Test',
    description: 'Test lesson',
    targets: ['a', 'b'],
  };

  it('returns the requested number of lesson targets', () => {
    const sequence = generateTapCodeDrill(lesson, 8, [], () => 0.75);

    expect(sequence).toHaveLength(8);
    expect(sequence.every((target) => lesson.targets.includes(target))).toBe(true);
  });

  it('gives weak characters three times the sampling weight', () => {
    expect(generateTapCodeDrill(lesson, 1, ['a'], () => 0.7)).toEqual(['a']);
    expect(generateTapCodeDrill(lesson, 1, [], () => 0.7)).toEqual(['b']);
  });

  it('weights word prompts containing weak characters', () => {
    const words = {
      ...lesson,
      targets: ['the', 'you'],
    };

    expect(generateTapCodeDrill(words, 1, ['t'], () => 0.7)).toEqual(['the']);
  });
});

describe('TapCodeDrillRunner', () => {
  it('scores prompts and computes accuracy and latency', () => {
    let now = 100;
    const onComplete = vi.fn();
    const runner = new TapCodeDrillRunner(
      ['a', 'b'],
      { onComplete },
      () => now,
    );

    runner.start();
    now = 250;
    runner.feedCommittedOutput('a');
    now = 500;
    runner.feedCommittedOutput('x');

    const summary = runner.buildSummary();
    expect(summary.promptCount).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.avgLatencyMs).toBe(200);
    expect(onComplete).toHaveBeenCalledWith(summary);
  });

  it('tracks partial progress through word prompts', () => {
    let now = 0;
    const runner = new TapCodeDrillRunner(['the'], {}, () => now);

    runner.start();
    now = 10;
    runner.feedCommittedOutput('t');
    expect(runner.getProgress()).toEqual({
      completed: 0,
      total: 1,
      charsDone: 1,
      charsTotal: 3,
    });

    now = 20;
    runner.feedCommittedOutput('he');
    expect(runner.isActive()).toBe(false);
    expect(runner.buildSummary().correct).toBe(1);
  });

  it('identifies weak characters after enough attempts', () => {
    const runner = new TapCodeDrillRunner(['a', 'a', 'a', 'b', 'b', 'b']);
    runner.start();
    runner.feedCommittedOutput('x');
    runner.feedCommittedOutput('x');
    runner.feedCommittedOutput('a');
    runner.feedCommittedOutput('b');
    runner.feedCommittedOutput('b');
    runner.feedCommittedOutput('b');

    expect(runner.getWeakChars()).toEqual(['a']);
    expect(runner.buildSummary().perCharStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          char: 'a',
          attempts: 3,
          correct: 1,
          accuracy: 1 / 3,
        }),
      ]),
    );
  });

  it('handles action prompts as atomic decoder outputs', () => {
    const runner = new TapCodeDrillRunner(['backspace', 'enter']);
    runner.start();
    runner.feedCommittedOutput('backspace');
    runner.feedCommittedOutput('enter');

    expect(runner.buildSummary()).toEqual(
      expect.objectContaining({
        promptCount: 2,
        correct: 2,
        accuracy: 1,
      }),
    );
  });

  it('stops early and emits a summary', () => {
    const onComplete = vi.fn();
    const runner = new TapCodeDrillRunner(['a', 'b'], { onComplete });

    runner.start();
    runner.feedCommittedOutput('a');
    runner.stop();

    expect(runner.isActive()).toBe(false);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ promptCount: 1, correct: 1 }),
    );
  });
});

describe('TAPCODE_LESSONS', () => {
  it('has unique ids and non-empty target sets', () => {
    const ids = TAPCODE_LESSONS.map((lesson) => lesson.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(TAPCODE_LESSONS.every((lesson) => lesson.targets.length > 0)).toBe(true);
  });

  it('covers all 25 grid letters in L6', () => {
    const fullGrid = TAPCODE_LESSONS.find((lesson) => lesson.id === 'L6');

    expect(fullGrid).toBeDefined();
    expect(fullGrid?.targets.filter((target) => /^[a-y]$/.test(target))).toHaveLength(
      25,
    );
  });
});
