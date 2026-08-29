import { describe, expect, it } from 'vitest';
import {
  IM_CONTROL,
  LETTER_SYMBOL_CODES,
  MR_CONTROL,
  TAPCODE_GRID,
  TapCodeDecoder,
} from './tapcode';
import type {
  TapCodeEvent,
  TapCodeScheduler,
} from './tapcode';

class ManualScheduler implements TapCodeScheduler {
  private now = 0;
  private nextHandle = 1;
  private readonly tasks = new Map<
    number,
    { callback: () => void; dueAt: number }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.tasks.set(handle, {
      callback,
      dueAt: this.now + delayMs,
    });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.tasks.delete(handle);
  }

  tick(elapsedMs: number): void {
    this.now += elapsedMs;

    while (true) {
      let nextHandle: number | null = null;
      let nextDueAt = Number.POSITIVE_INFINITY;

      for (const [handle, task] of this.tasks) {
        if (task.dueAt <= this.now && task.dueAt < nextDueAt) {
          nextHandle = handle;
          nextDueAt = task.dueAt;
        }
      }

      if (nextHandle === null) return;
      const task = this.tasks.get(nextHandle);
      this.tasks.delete(nextHandle);
      task?.callback();
    }
  }
}

function createDecoder(timeoutMs = 800): {
  decoder: TapCodeDecoder;
  events: TapCodeEvent[];
  scheduler: ManualScheduler;
} {
  const events: TapCodeEvent[] = [];
  const scheduler = new ManualScheduler();
  const decoder = new TapCodeDecoder((event) => events.push(event), {
    timeoutMs,
    scheduler,
  });
  return { decoder, events, scheduler };
}

function semanticEvents(events: TapCodeEvent[]): TapCodeEvent[] {
  return events.filter((event) => event.type !== 'pending');
}

function committedText(events: TapCodeEvent[]): string {
  return events
    .filter(
      (event): event is Extract<TapCodeEvent, { type: 'commit' }> =>
        event.type === 'commit',
    )
    .map((event) => event.text)
    .join('');
}

describe('TapCodeDecoder', () => {
  it('decodes all 25 letters in the grid', () => {
    for (let row = 0; row < LETTER_SYMBOL_CODES.length; row += 1) {
      for (let column = 0; column < LETTER_SYMBOL_CODES.length; column += 1) {
        const { decoder, events } = createDecoder();
        decoder.feed(LETTER_SYMBOL_CODES[row]);
        decoder.feed(LETTER_SYMBOL_CODES[column]);

        expect(semanticEvents(events)).toEqual([
          { type: 'commit', text: TAPCODE_GRID[row]?.[column] },
        ]);
      }
    }
  });

  it('commits space immediately for IM', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(IM_CONTROL);

    expect(events).toEqual([{ type: 'commit', text: ' ' }]);
  });

  it('cancels an in-progress letter pair with IM', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(2);
    decoder.feed(IM_CONTROL);
    decoder.feed(4);
    decoder.feed(4);

    expect(semanticEvents(events)).toEqual([
      { type: 'cancel' },
      { type: 'commit', text: 'g' },
    ]);
  });

  it.each([
    [2, { type: 'commit', text: 'z' }],
    [4, { type: 'action', action: 'backspace' }],
    [8, { type: 'action', action: 'enter' }],
    [16, { type: 'commit', text: '.' }],
    [24, { type: 'commit', text: ',' }],
  ] as const)('decodes MR control row symbol %i', (symbol, expected) => {
    const { decoder, events } = createDecoder();

    decoder.feed(MR_CONTROL);
    decoder.feed(symbol);

    expect(semanticEvents(events)).toEqual([expected]);
  });

  it('emits modeToggle for MR followed by MR', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(MR_CONTROL);
    decoder.feed(MR_CONTROL);

    expect(semanticEvents(events)).toEqual([{ type: 'modeToggle' }]);
  });

  it('treats MR in the middle of a letter pair as an error and clears state', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(2);
    decoder.feed(MR_CONTROL);
    decoder.feed(4);
    decoder.feed(4);

    expect(semanticEvents(events)).toEqual([
      {
        type: 'error',
        reason: 'MR cannot follow a letter-row symbol',
      },
      { type: 'commit', text: 'g' },
    ]);
  });

  it.each([1, 3, 5, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31])(
    'rejects invalid raw code %i',
    (code) => {
      const { decoder, events } = createDecoder();

      decoder.feed(code);

      expect(semanticEvents(events)).toEqual([
        {
          type: 'error',
          reason: `Invalid Tap Code chord: ${code}`,
        },
      ]);
    },
  );

  it('clears a pending symbol after an invalid chord', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(2);
    decoder.feed(31);
    decoder.feed(4);
    decoder.feed(4);

    expect(semanticEvents(events)).toEqual([
      {
        type: 'error',
        reason: 'Invalid Tap Code chord: 31',
      },
      { type: 'commit', text: 'g' },
    ]);
  });

  it('flushes incomplete input on timeout without interpreting it', () => {
    const { decoder, events, scheduler } = createDecoder(100);

    decoder.feed(8);
    scheduler.tick(99);
    expect(semanticEvents(events)).toEqual([]);

    scheduler.tick(1);
    expect(semanticEvents(events)).toEqual([
      {
        type: 'error',
        reason: 'Incomplete Tap Code sequence timed out',
      },
    ]);

    decoder.feed(4);
    decoder.feed(4);
    expect(committedText(events)).toBe('g');
  });

  it('reports pending display changes for letters, controls, and clears', () => {
    const { decoder, events } = createDecoder();

    decoder.feed(24);
    decoder.feed(IM_CONTROL);
    decoder.feed(MR_CONTROL);
    decoder.feed(16);

    expect(
      events
        .filter(
          (event): event is Extract<TapCodeEvent, { type: 'pending' }> =>
            event.type === 'pending',
        )
        .map((event) => event.display),
    ).toEqual(['RP·', '', 'MR+', '']);
  });

  it('types "hello world" from a complete raw-code sequence', () => {
    const { decoder, events } = createDecoder();
    const sequence = [
      4, 8,       // h
      2, 24,      // e
      8, 4,       // l
      8, 4,       // l
      8, 24,      // o
      IM_CONTROL, // space
      24, 8,      // w
      8, 24,      // o
      16, 8,      // r
      8, 4,       // l
      2, 16,      // d
    ];

    sequence.forEach((code) => decoder.feed(code));

    expect(committedText(events)).toBe('hello world');
    expect(
      semanticEvents(events).filter(
        (event) => event.type === 'error' || event.type === 'cancel',
      ),
    ).toEqual([]);
  });
});
