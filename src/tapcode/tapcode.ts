export const LETTER_SYMBOL_CODES = [2, 4, 8, 16, 24] as const;
export type TapCodeSymbol = (typeof LETTER_SYMBOL_CODES)[number];

export const IM_CONTROL = 6;
export const MR_CONTROL = 12;

export const SYMBOL_NAMES: Readonly<Record<TapCodeSymbol, string>> = Object.freeze({
  2: 'I',
  4: 'M',
  8: 'R',
  16: 'P',
  24: 'RP',
});

export const TAPCODE_GRID: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['a', 'b', 'c', 'd', 'e']),
  Object.freeze(['f', 'g', 'h', 'i', 'j']),
  Object.freeze(['k', 'l', 'm', 'n', 'o']),
  Object.freeze(['p', 'q', 'r', 's', 't']),
  Object.freeze(['u', 'v', 'w', 'x', 'y']),
]);

export type TapCodeEvent =
  | { type: 'commit'; text: string }
  | { type: 'action'; action: 'backspace' | 'enter' }
  | { type: 'cancel' }
  | { type: 'error'; reason: string }
  | { type: 'modeToggle' }
  | { type: 'pending'; display: string };

export interface TapCodeScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface TapCodeDecoderOptions {
  timeoutMs?: number;
  scheduler?: TapCodeScheduler;
}

const SYMBOL_INDEX: Readonly<Record<TapCodeSymbol, number>> = Object.freeze({
  2: 0,
  4: 1,
  8: 2,
  16: 3,
  24: 4,
});

const DEFAULT_TIMEOUT_MS = 800;

const DEFAULT_SCHEDULER: TapCodeScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

function isLetterSymbol(code: number): code is TapCodeSymbol {
  return Object.prototype.hasOwnProperty.call(SYMBOL_NAMES, code);
}

/**
 * Stateful decoder for the Thumb-Free Tap Code input system.
 *
 * Timeouts are recovery-only: an incomplete sequence is discarded rather
 * than interpreted as input.
 */
export class TapCodeDecoder {
  private pendingSymbol: TapCodeSymbol | null = null;
  private controlRow = false;
  private recoveryTimer: number | null = null;
  private readonly timeoutMs: number;
  private readonly scheduler: TapCodeScheduler;
  private readonly onEvent: (event: TapCodeEvent) => void;

  constructor(
    onEvent: (event: TapCodeEvent) => void,
    options: TapCodeDecoderOptions = {},
  ) {
    this.onEvent = onEvent;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Tap Code timeout must be a positive finite number');
    }
  }

  feed(code: number): void {
    if (code === IM_CONTROL) {
      this.handleImControl();
      return;
    }

    if (code === MR_CONTROL) {
      this.handleMrControl();
      return;
    }

    if (isLetterSymbol(code)) {
      this.handleLetterSymbol(code);
      return;
    }

    this.clearPending();
    this.emit({
      type: 'error',
      reason: `Invalid Tap Code chord: ${code}`,
    });
  }

  /** Clear incomplete input without producing a semantic input event. */
  reset(): void {
    this.clearPending();
  }

  private handleImControl(): void {
    if (this.pendingSymbol === null && !this.controlRow) {
      this.emit({ type: 'commit', text: ' ' });
      return;
    }

    this.clearPending();
    this.emit({ type: 'cancel' });
  }

  private handleMrControl(): void {
    if (this.pendingSymbol !== null) {
      this.clearPending();
      this.emit({
        type: 'error',
        reason: 'MR cannot follow a letter-row symbol',
      });
      return;
    }

    if (this.controlRow) {
      this.clearPending();
      this.emit({ type: 'modeToggle' });
      return;
    }

    this.controlRow = true;
    this.armRecoveryTimer();
    this.emit({ type: 'pending', display: 'MR+' });
  }

  private handleLetterSymbol(symbol: TapCodeSymbol): void {
    if (this.controlRow) {
      this.clearPending();
      this.commitControlSymbol(symbol);
      return;
    }

    if (this.pendingSymbol === null) {
      this.pendingSymbol = symbol;
      this.armRecoveryTimer();
      this.emit({
        type: 'pending',
        display: `${SYMBOL_NAMES[symbol]}·`,
      });
      return;
    }

    const row = SYMBOL_INDEX[this.pendingSymbol];
    const column = SYMBOL_INDEX[symbol];
    const text = TAPCODE_GRID[row]?.[column];

    this.clearPending();

    if (text === undefined) {
      this.emit({
        type: 'error',
        reason: 'Tap Code grid lookup failed',
      });
      return;
    }

    this.emit({ type: 'commit', text });
  }

  private commitControlSymbol(symbol: TapCodeSymbol): void {
    switch (symbol) {
      case 2:
        this.emit({ type: 'commit', text: 'z' });
        break;
      case 4:
        this.emit({ type: 'action', action: 'backspace' });
        break;
      case 8:
        this.emit({ type: 'action', action: 'enter' });
        break;
      case 16:
        this.emit({ type: 'commit', text: '.' });
        break;
      case 24:
        this.emit({ type: 'commit', text: ',' });
        break;
    }
  }

  private armRecoveryTimer(): void {
    this.disarmRecoveryTimer();
    this.recoveryTimer = this.scheduler.setTimeout(() => {
      this.recoveryTimer = null;
      this.pendingSymbol = null;
      this.controlRow = false;
      this.emit({ type: 'pending', display: '' });
      this.emit({
        type: 'error',
        reason: 'Incomplete Tap Code sequence timed out',
      });
    }, this.timeoutMs);
  }

  private clearPending(): void {
    this.disarmRecoveryTimer();
    this.pendingSymbol = null;
    this.controlRow = false;
    this.emit({ type: 'pending', display: '' });
  }

  private disarmRecoveryTimer(): void {
    if (this.recoveryTimer === null) return;
    this.scheduler.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private emit(event: TapCodeEvent): void {
    this.onEvent(event);
  }
}
