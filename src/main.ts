/**
 * TapLab entry point.
 * Wires connection -> session/remap -> DOM rendering.
 *
 * Mode semantics (P1 review fix):
 *   - Free-run: throughput only (chords, WPM, inter-tap). Accuracy and
 *     weak chords show placeholders — free-run cannot judge correctness.
 *   - Drill (coming next): prompted chords, judged taps, real accuracy.
 */

import { TapConnection } from './connection/tap-connection';
import { TelemetrySession } from './telemetry/session';
import { RemapEngine } from './engine/remap';
import { codeToFingerString } from './core/chords';
import type { TapEvent, ChordStat, ConnectedDetail } from './core/types';

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

const connection = new TapConnection();
const session = new TelemetrySession();
const remap = new RemapEngine();

const statusEl = getEl<HTMLSpanElement>('conn-status');
const streamEl = getEl<HTMLDivElement>('stream');
const weakEl = getEl<HTMLDivElement>('weak-chords');
const statAcc = getEl<HTMLSpanElement>('stat-accuracy');
const statWpm = getEl<HTMLSpanElement>('stat-wpm');
const statCount = getEl<HTMLSpanElement>('stat-count');
const statInter = getEl<HTMLSpanElement>('stat-inter');
const modeEl = getEl<HTMLSpanElement>('session-mode');
const connectBtn = getEl<HTMLButtonElement>('btn-connect');
const simulateBtn = getEl<HTMLButtonElement>('btn-simulate');
const stopBtn = getEl<HTMLButtonElement>('btn-stop');

const FREERUN_ACCURACY_HINT = 'drill mode only';
const FREERUN_WEAK_HINT =
  'Run a drill to measure accuracy — free-run cannot distinguish an unmapped chord from a missed one.';

session.start('freerun');
renderMode();
renderWeak();

connection.addEventListener('connected', (ev) => {
  const { detail } = ev as CustomEvent<ConnectedDetail>;
  if (detail.dataReady) {
    statusEl.textContent = `connected (${detail.source})`;
    statusEl.className = 'ok';
  } else {
    // BLE link is up but the decoder isn't implemented — say so plainly.
    statusEl.textContent =
      'BT linked — decoder not implemented yet, no taps will stream. Use Simulate.';
    statusEl.className = 'warn';
  }
  session.start(session.getMode());
  renderMode();
  renderStats();
  renderWeak();
});

connection.addEventListener('disconnected', () => {
  statusEl.textContent = 'disconnected';
  statusEl.className = 'bad';
  session.finish();
});

connection.addEventListener('tap', (ev) => {
  const { detail: tap } = ev as CustomEvent<TapEvent>;
  handleTap(tap);
});

function handleTap(tap: TapEvent): void {
  const result = remap.resolve(tap.code);
  session.recordTap(tap); // free-run: throughput only, no judgment
  appendStream(tap, result.char, result.corrected);
  renderStats();
  renderWeak();
}

const MAX_STREAM_LINES = 200;

function appendStream(tap: TapEvent, char: string, corrected: boolean): void {
  const line = document.createElement('div');
  const time = (performance.now() / 1000).toFixed(2);
  const fingers = codeToFingerString(tap.code);
  const correctedFlag = corrected ? ' (corrected)' : '';
  line.textContent = `[${time}s] code ${String(tap.code).padStart(2, '0')} (${fingers}) -> ${char}${correctedFlag}`;
  line.className = 'stream-line';
  streamEl.appendChild(line);
  while (streamEl.childElementCount > MAX_STREAM_LINES) {
    streamEl.removeChild(streamEl.firstChild as Node);
  }
  streamEl.scrollTop = streamEl.scrollHeight;
}

function renderMode(): void {
  modeEl.textContent = session.getMode();
}

function renderStats(): void {
  const s = session.getStats();
  statCount.textContent = String(s.totalChords);

  // Accuracy: null means "not judged" (free-run, or drill with no taps yet).
  if (s.accuracy === null) {
    statAcc.textContent = '—';
    statAcc.title = s.mode === 'freerun' ? FREERUN_ACCURACY_HINT : 'no judged taps yet';
  } else {
    statAcc.textContent = `${(s.accuracy * 100).toFixed(1)}%`;
    statAcc.title = '';
  }

  // WPM: hidden until the sample is statistically meaningful (P2 fix).
  statWpm.textContent = s.wpmReady ? s.wpm.toFixed(1) : '—';
  statWpm.title = s.wpmReady ? '' : 'needs ≥10 chords and ≥15s';

  statInter.textContent =
    s.totalChords <= 1 ? '—' : `${s.avgInterTapMs.toFixed(0)} ms`;
}

function renderWeak(): void {
  const weak: ChordStat[] = session.getWeakChords();
  weakEl.innerHTML = '';
  if (weak.length === 0) {
    const none = document.createElement('div');
    none.className = 'weak-none';
    none.textContent =
      session.getMode() === 'freerun'
        ? FREERUN_WEAK_HINT
        : 'No weak chords detected yet (needs ≥5 attempts per chord).';
    weakEl.appendChild(none);
    return;
  }
  for (const chord of weak.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'weak-row';
    const label = document.createElement('span');
    label.textContent = `code ${chord.code} (${codeToFingerString(chord.code)})`;
    const pct = document.createElement('span');
    pct.textContent =
      chord.accuracy === null ? '—' : `${(chord.accuracy * 100).toFixed(0)}%`;
    row.appendChild(label);
    row.appendChild(pct);
    weakEl.appendChild(row);
  }
}

connectBtn.addEventListener('click', () => {
  void connection.connect().catch((err: unknown) => {
    statusEl.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    statusEl.className = 'bad';
  });
});

simulateBtn.addEventListener('click', () => {
  connection.simulate();
});

stopBtn.addEventListener('click', () => {
  connection.stop();
});
