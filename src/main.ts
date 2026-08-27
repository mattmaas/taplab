/**
 * TapLab entry point.
 * Wires connection -> session/remap -> DOM rendering.
 */

import { TapConnection } from './connection/tap-connection';
import { TelemetrySession } from './telemetry/session';
import { RemapEngine } from './engine/remap';
import { codeToFingerString } from './core/chords';
import type { TapEvent, ChordStat } from './core/types';

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
const connectBtn = getEl<HTMLButtonElement>('btn-connect');
const simulateBtn = getEl<HTMLButtonElement>('btn-simulate');
const stopBtn = getEl<HTMLButtonElement>('btn-stop');

session.start();

connection.addEventListener('connected', () => {
  const mode = connection.getState() === 'simulating' ? 'simulate' : 'bluetooth';
  statusEl.textContent = `connected (${mode})`;
  statusEl.className = 'ok';
  session.start();
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
  session.recordTap(tap);
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

function renderStats(): void {
  const s = session.getStats();
  statCount.textContent = String(s.totalChords);
  statAcc.textContent =
    s.totalChords === 0 ? '--' : `${(s.accuracy * 100).toFixed(1)}%`;
  statWpm.textContent = s.totalChords === 0 ? '--' : s.wpm.toFixed(1);
  statInter.textContent =
    s.totalChords <= 1 ? '--' : `${s.avgInterTapMs.toFixed(0)} ms`;
}

function renderWeak(): void {
  const weak: ChordStat[] = session.getWeakChords(1.0); // everything below 100%
  if (weak.length === 0) {
    weakEl.innerHTML = '';
    const none = document.createElement('div');
    none.className = 'weak-none';
    none.textContent = 'No weak chords yet.';
    weakEl.appendChild(none);
    return;
  }
  weakEl.innerHTML = '';
  for (const chord of weak.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'weak-row';
    const label = document.createElement('span');
    label.textContent = `code ${chord.code} (${codeToFingerString(chord.code)})`;
    const pct = document.createElement('span');
    pct.textContent = `${(chord.accuracy * 100).toFixed(0)}%`;
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