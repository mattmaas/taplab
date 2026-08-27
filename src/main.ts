/**
 * TapLab entry point.
 * Wires connection -> session/remap/drill -> DOM rendering.
 *
 * Modes:
 *   - Free-run: throughput only (chords, WPM, inter-tap). Accuracy and
 *     weak chords show placeholders — free-run cannot judge correctness.
 *   - Drill: prompted chords, judged taps, real accuracy, and the
 *     weak-chord -> next-drill loop.
 */

import { TapConnection } from './connection/tap-connection';
import { TelemetrySession } from './telemetry/session';
import { RemapEngine } from './engine/remap';
import {
  codeToFingerString,
  getFingers,
  resolveChord,
  ALL_CODES,
  UNKNOWN_CHAR,
  FINGER_NAMES,
} from './core/chords';
import { DrillRunner, generateDrill, buildWeakChordDrill } from './trainer/drill';
import type {
  TapEvent,
  ChordStat,
  ConnectedDetail,
  DrillPromptResult,
  DrillSummary,
} from './core/types';

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

const connection = new TapConnection();
const session = new TelemetrySession();
const remap = new RemapEngine();
let runner: DrillRunner | null = null;

// ---------------------------------------------------------------- elements
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

const drillCountEl = getEl<HTMLInputElement>('drill-count');
const drillAutoTapEl = getEl<HTMLInputElement>('drill-autotap');
const drillStartBtn = getEl<HTMLButtonElement>('btn-drill-start');
const drillWeakBtn = getEl<HTMLButtonElement>('btn-drill-weak');
const drillStopBtn = getEl<HTMLButtonElement>('btn-drill-stop');
const drillProgressEl = getEl<HTMLDivElement>('drill-progress');
const drillFingersEl = getEl<HTMLDivElement>('drill-fingers');
const drillLetterEl = getEl<HTMLDivElement>('drill-letter');
const drillFeedbackEl = getEl<HTMLDivElement>('drill-feedback');
const drillSummaryEl = getEl<HTMLDivElement>('drill-summary');

const FREERUN_ACCURACY_HINT = 'drill mode only';
const FREERUN_WEAK_HINT =
  'Run a drill to measure accuracy — free-run cannot distinguish an unmapped chord from a missed one.';

// ---------------------------------------------------------------- boot
buildFingerCircles();
session.start('freerun');
renderMode();
renderWeak();
updateDrillButtons();

// ---------------------------------------------------------------- connection
connection.addEventListener('connected', (ev) => {
  const { detail } = ev as CustomEvent<ConnectedDetail>;
  if (detail.dataReady) {
    statusEl.textContent = `connected (${detail.source})`;
    statusEl.className = 'ok';
  } else {
    statusEl.textContent =
      'BT linked — decoder not implemented yet, no taps will stream. Use Simulate.';
    statusEl.className = 'warn';
  }
  // A (re)connect aborts any active drill and resets to a clean free-run.
  if (runner?.isActive()) runner.abort();
  runner = null;
  session.start('freerun');
  renderMode();
  renderStats();
  renderWeak();
  updateDrillButtons();
});

connection.addEventListener('disconnected', () => {
  statusEl.textContent = 'disconnected';
  statusEl.className = 'bad';
  session.finish();
});

connection.addEventListener('tap', (ev) => {
  const { detail: tap } = ev as CustomEvent<TapEvent>;
  routeTap(tap);
});

// ---------------------------------------------------------------- tap routing
function routeTap(tap: TapEvent): void {
  if (runner?.isActive()) {
    // Drill mode: the runner judges, records into the session, and drives
    // prompt advancement via hooks. Stream shows judgment marks.
    const expected = runner.getCurrentExpected();
    runner.handleTap(tap);
    const mark = tap.code === expected ? '✓' : '✗';
    appendStream(tap, resolveChord(tap.code), false, mark);
  } else {
    const result = remap.resolve(tap.code);
    session.recordTap(tap); // free-run: throughput only, no judgment
    appendStream(tap, result.char, result.corrected);
  }
  renderStats();
  renderWeak();
}

// ---------------------------------------------------------------- stream
const MAX_STREAM_LINES = 200;

function appendStream(tap: TapEvent, char: string, corrected: boolean, mark = ''): void {
  const line = document.createElement('div');
  const time = (performance.now() / 1000).toFixed(2);
  const fingers = codeToFingerString(tap.code);
  const correctedFlag = corrected ? ' (corrected)' : '';
  const judgeFlag = mark ? ` ${mark}` : '';
  line.textContent = `[${time}s] code ${String(tap.code).padStart(2, '0')} (${fingers}) -> ${char}${correctedFlag}${judgeFlag}`;
  line.className = mark === '✗' ? 'stream-line miss' : 'stream-line';
  streamEl.appendChild(line);
  while (streamEl.childElementCount > MAX_STREAM_LINES) {
    streamEl.removeChild(streamEl.firstChild as Node);
  }
  streamEl.scrollTop = streamEl.scrollHeight;
}

// ---------------------------------------------------------------- stats
function renderMode(): void {
  modeEl.textContent = runner?.isActive() ? 'drill' : session.getMode();
}

function renderStats(): void {
  const s = session.getStats();
  statCount.textContent = String(s.totalChords);

  if (s.accuracy === null) {
    statAcc.textContent = '—';
    statAcc.title = s.mode === 'freerun' ? FREERUN_ACCURACY_HINT : 'no judged taps yet';
  } else {
    statAcc.textContent = `${(s.accuracy * 100).toFixed(1)}%`;
    statAcc.title = '';
  }

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
    updateDrillButtons();
    return;
  }
  for (const chord of weak.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'weak-row';
    const label = document.createElement('span');
    const char = resolveChord(chord.code);
    const charLabel = char === UNKNOWN_CHAR ? '' : ` '${char}'`;
    label.textContent = `code ${chord.code}${charLabel} (${codeToFingerString(chord.code)})`;
    const pct = document.createElement('span');
    pct.textContent =
      chord.accuracy === null ? '—' : `${(chord.accuracy * 100).toFixed(0)}%`;
    row.appendChild(label);
    row.appendChild(pct);
    weakEl.appendChild(row);
  }
  updateDrillButtons();
}

// ---------------------------------------------------------------- drill UI
function buildFingerCircles(): void {
  drillFingersEl.innerHTML = '';
  for (const name of FINGER_NAMES) {
    const wrap = document.createElement('div');
    wrap.className = 'finger-wrap';
    const circle = document.createElement('div');
    circle.className = 'finger';
    circle.dataset.finger = name;
    const label = document.createElement('div');
    label.className = 'finger-label';
    label.textContent = name[0]; // T I M R P
    wrap.appendChild(circle);
    wrap.appendChild(label);
    drillFingersEl.appendChild(wrap);
  }
}

function renderPrompt(expected: number, index: number, total: number): void {
  drillProgressEl.textContent = `${index + 1} / ${total}`;
  const active = new Set(getFingers(expected));
  drillFingersEl.querySelectorAll<HTMLDivElement>('.finger').forEach((el) => {
    const name = el.dataset.finger ?? '';
    el.classList.toggle('active', active.has(name as never));
  });
  const char = resolveChord(expected);
  drillLetterEl.textContent = char === UNKNOWN_CHAR ? '·' : char;
  scheduleAutoTap(expected);
}

function flashFeedback(result: DrillPromptResult): void {
  drillFeedbackEl.textContent = result.correct
    ? `✓ ${result.promptLatencyMs.toFixed(0)} ms`
    : `✗ you tapped ${codeToFingerString(result.actual)}`;
  drillFeedbackEl.className = result.correct ? 'feedback ok' : 'feedback bad';
}

function showSummary(s: DrillSummary): void {
  const acc = s.accuracy === null ? '—' : `${(s.accuracy * 100).toFixed(1)}%`;
  const abortedNote = s.aborted ? ' (stopped early)' : '';
  drillSummaryEl.textContent =
    `Done${abortedNote}: ${s.correct}/${s.total} correct (${acc}), ` +
    `avg recall ${s.avgPromptLatencyMs.toFixed(0)} ms`;
  drillProgressEl.textContent = '';
  drillLetterEl.textContent = '';
  drillFeedbackEl.textContent = '';
  drillFingersEl
    .querySelectorAll<HTMLDivElement>('.finger')
    .forEach((el) => el.classList.remove('active'));
}

function updateDrillButtons(): void {
  const running = runner?.isActive() ?? false;
  drillStartBtn.disabled = running;
  drillStopBtn.disabled = !running;
  drillWeakBtn.disabled = running || session.getWeakChords().length === 0;
}

// ---------------------------------------------------------------- auto-tap sim
// Dev affordance: answers prompts with synthetic taps (80% correct; errors
// are Hamming-1 neighbors — a realistic finger slip). Lets the whole
// drill -> weak -> next-drill loop run without hardware.
let autoTapTimer: number | null = null;

function scheduleAutoTap(expected: number): void {
  cancelAutoTap();
  if (!drillAutoTapEl.checked) return;
  const delay = 300 + Math.random() * 600;
  autoTapTimer = window.setTimeout(() => {
    if (!runner?.isActive()) return;
    let code = expected;
    if (Math.random() < 0.2) {
      const neighbors = ALL_CODES.filter(
        (c) => c !== expected && hamming1(c, expected),
      );
      code = neighbors[Math.floor(Math.random() * neighbors.length)] ?? expected;
    }
    routeTap({
      code,
      timestamp: performance.now(),
      fingers: [...getFingers(code)],
    });
  }, delay);
}

function hamming1(a: number, b: number): boolean {
  const x = (a ^ b) & 0x1f;
  return x !== 0 && (x & (x - 1)) === 0;
}

function cancelAutoTap(): void {
  if (autoTapTimer !== null) {
    window.clearTimeout(autoTapTimer);
    autoTapTimer = null;
  }
}

// ---------------------------------------------------------------- drill control
function startDrill(sequence: number[]): void {
  drillSummaryEl.textContent = '';
  drillFeedbackEl.textContent = '';
  runner = new DrillRunner(sequence, session, {
    onPrompt: renderPrompt,
    onResult: (r) => {
      flashFeedback(r);
      renderStats();
      renderWeak();
    },
    onComplete: (s) => {
      cancelAutoTap();
      showSummary(s);
      renderMode();
      renderStats();
      renderWeak(); // session stays in drill mode: weak chords feed next drill
      updateDrillButtons();
    },
  });
  runner.start();
  renderMode();
  renderStats();
  updateDrillButtons();
}

function drillPromptCount(): number {
  const n = Number.parseInt(drillCountEl.value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 5), 100) : 20;
}

drillStartBtn.addEventListener('click', () => {
  const sequence = generateDrill({
    targetCodes: [...ALL_CODES],
    mode: 'random',
    totalPrompts: drillPromptCount(),
  });
  startDrill(sequence);
});

drillWeakBtn.addEventListener('click', () => {
  const weak = session.getWeakChords();
  if (weak.length === 0) return;
  const sequence = buildWeakChordDrill(
    weak,
    ALL_CODES,
    drillPromptCount(),
    session.getStats().perChordStats,
  );
  startDrill(sequence);
});

drillStopBtn.addEventListener('click', () => {
  cancelAutoTap();
  runner?.abort();
  renderMode();
  updateDrillButtons();
});

// ---------------------------------------------------------------- connection controls
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
  cancelAutoTap();
  if (runner?.isActive()) runner.abort();
  connection.stop();
  renderMode();
  updateDrillButtons();
});
