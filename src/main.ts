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
import {
  SYMBOL_NAMES,
  TapCodeDecoder,
} from './tapcode/tapcode';
import type { TapCodeEvent } from './tapcode/tapcode';
import {
  TAPCODE_LESSONS,
  TapCodeDrillRunner,
  expectedSequence,
  generateTapCodeDrill,
} from './tapcode/tapcode-drill';
import type {
  TapCodeDrillPromptResult,
  TapCodeDrillSummary,
  TapCodeLesson,
} from './tapcode/tapcode-drill';
import {
  saveSession,
  mergeResults,
  loadLifetimeStats,
  getLifetimeWeakChords,
} from './telemetry/storage';
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
let tapCodeDrillRunner: TapCodeDrillRunner | null = null;
let lastTapCodeDrillRunner: TapCodeDrillRunner | null = null;

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

const tapCodeToggleBtn = getEl<HTMLButtonElement>('tapcode-toggle');
const tapCodeOutputEl = getEl<HTMLTextAreaElement>('tapcode-output');
const tapCodePendingEl = getEl<HTMLSpanElement>('tapcode-pending');
const tapCodeLessonEl = getEl<HTMLSelectElement>('tapcode-lesson');
const tapCodeDrillCountEl = getEl<HTMLInputElement>('tapcode-drill-count');
const tapCodeDrillStartBtn = getEl<HTMLButtonElement>('tapcode-drill-start');
const tapCodeDrillWeakBtn = getEl<HTMLButtonElement>('tapcode-drill-weak');
const tapCodeDrillStopBtn = getEl<HTMLButtonElement>('tapcode-drill-stop');
const tapCodePromptEl = getEl<HTMLDivElement>('tapcode-prompt');
const tapCodeHintEl = getEl<HTMLDivElement>('tapcode-hint');
const tapCodeDrillProgressEl = getEl<HTMLDivElement>('tapcode-drill-progress');
const tapCodeDrillStatsEl = getEl<HTMLDivElement>('tapcode-drill-stats');

let tapCodeEnabled = false;
let tapCodeBuffer = '';
const tapCodeDecoder = new TapCodeDecoder(handleTapCodeEvent);

const FREERUN_ACCURACY_HINT = 'drill mode only';
const FREERUN_WEAK_HINT =
  'Run a drill to measure accuracy — free-run cannot distinguish an unmapped chord from a missed one.';

// ---------------------------------------------------------------- boot
buildFingerCircles();
populateTapCodeLessons();
session.start('freerun');
renderMode();
renderWeak();
updateDrillButtons();
updateTapCodeDrillButtons();

// ---------------------------------------------------------------- connection
connection.addEventListener('connected', (ev) => {
  const { detail } = ev as CustomEvent<ConnectedDetail>;
  if (detail.dataReady) {
    const proto = detail.protocol ? ` ${detail.protocol}` : '';
    const battery =
      detail.batteryLevel != null ? `, battery ${detail.batteryLevel}%` : '';
    statusEl.textContent = `connected (${detail.source}${proto}${battery})`;
    statusEl.className = 'ok';
  } else if (detail.protocol === 'v2') {
    statusEl.textContent =
      'TapXR (v2) detected — decoder targets Tap Strap 2 (v1); no taps will stream yet.';
    statusEl.className = 'warn';
  } else {
    statusEl.textContent = 'BT linked — no data (decoder unavailable). Use Simulate.';
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
  if (tapCodeEnabled) {
    tapCodeDecoder.feed(tap.code);
    return;
  }

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
  modeEl.textContent = tapCodeDrillRunner?.isActive()
    ? 'tapcode-drill'
    : tapCodeEnabled
      ? 'tapcode'
      : runner?.isActive()
        ? 'drill'
        : session.getMode();
}

function handleTapCodeEvent(event: TapCodeEvent): void {
  switch (event.type) {
    case 'commit':
      if (tapCodeDrillRunner?.isActive()) {
        tapCodeDrillRunner.feedCommittedOutput(event.text);
        renderTapCodeDrillProgress();
      } else {
        tapCodeBuffer += event.text;
        renderTapCodeOutput();
      }
      break;
    case 'action':
      if (tapCodeDrillRunner?.isActive()) {
        tapCodeDrillRunner.feedCommittedOutput(event.action);
        renderTapCodeDrillProgress();
      } else {
        if (event.action === 'backspace') {
          tapCodeBuffer = Array.from(tapCodeBuffer).slice(0, -1).join('');
        } else {
          tapCodeBuffer += '\n';
        }
        renderTapCodeOutput();
      }
      break;
    case 'pending':
      tapCodePendingEl.textContent = event.display;
      break;
    case 'cancel':
    case 'error':
      void connection.sendVibration([200]);
      break;
    case 'modeToggle':
      setTapCodeEnabled(!tapCodeEnabled);
      break;
  }
}

function renderTapCodeOutput(): void {
  tapCodeOutputEl.value = tapCodeBuffer;
  tapCodeOutputEl.scrollTop = tapCodeOutputEl.scrollHeight;
}

function setTapCodeEnabled(enabled: boolean): void {
  if (tapCodeEnabled === enabled) return;

  cancelAutoTap();
  if (runner?.isActive()) runner.abort();
  runner = null;
  if (!enabled && tapCodeDrillRunner?.isActive()) {
    tapCodeDrillRunner.stop();
  }
  session.start('freerun');

  tapCodeEnabled = enabled;
  tapCodeDecoder.reset();
  tapCodeToggleBtn.textContent = enabled
    ? 'Disable Tap Code'
    : 'Enable Tap Code';
  tapCodeToggleBtn.classList.toggle('active', enabled);
  tapCodeToggleBtn.setAttribute('aria-pressed', String(enabled));

  renderMode();
  renderStats();
  renderWeak();
  updateDrillButtons();
  updateTapCodeDrillButtons();
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
  const tapCodeDrillRunning = tapCodeDrillRunner?.isActive() ?? false;
  drillStartBtn.disabled = running || tapCodeEnabled || tapCodeDrillRunning;
  drillStopBtn.disabled = !running;
  drillWeakBtn.disabled =
    running ||
    tapCodeEnabled ||
    tapCodeDrillRunning ||
    session.getWeakChords().length === 0;
}

// ---------------------------------------------------------------- tap code training
function populateTapCodeLessons(): void {
  tapCodeLessonEl.innerHTML = '';
  for (const lesson of TAPCODE_LESSONS) {
    const option = document.createElement('option');
    option.value = lesson.id;
    option.textContent = `${lesson.id} — ${lesson.name}`;
    option.title = lesson.description;
    tapCodeLessonEl.appendChild(option);
  }
}

function selectedTapCodeLesson(): TapCodeLesson {
  return (
    TAPCODE_LESSONS.find((lesson) => lesson.id === tapCodeLessonEl.value) ??
    TAPCODE_LESSONS[0]
  );
}

function tapCodePromptCount(): number {
  const count = Number.parseInt(tapCodeDrillCountEl.value, 10);
  return Number.isFinite(count) ? Math.min(Math.max(count, 1), 100) : 20;
}

function tapCodeTargetLabel(target: string): string {
  if (target === ' ') return 'SPACE';
  if (target === 'backspace') return 'BACKSPACE';
  if (target === 'enter') return 'ENTER';
  return target;
}

function tapCodeSymbolLabel(code: number): string {
  if (code === 6) return 'Index + Middle';
  if (code === 12) return 'Middle + Ring';
  return SYMBOL_NAMES[code as keyof typeof SYMBOL_NAMES] ?? String(code);
}

function renderTapCodePrompt(prompt: string, index: number, total: number): void {
  tapCodePromptEl.textContent = tapCodeTargetLabel(prompt);
  tapCodeHintEl.textContent = expectedSequence(prompt)
    .map(tapCodeSymbolLabel)
    .join(' · ');
  tapCodeDrillProgressEl.textContent = `${index + 1} / ${total} · 0 chars`;
}

function renderTapCodeDrillProgress(): void {
  if (!tapCodeDrillRunner?.isActive()) return;
  const progress = tapCodeDrillRunner.getProgress();
  tapCodeDrillProgressEl.textContent =
    `${progress.completed + 1} / ${progress.total} · ` +
    `${progress.charsDone} / ${progress.charsTotal} chars`;
}

function renderTapCodeResult(result: TapCodeDrillPromptResult): void {
  const mark = result.correct ? '✓' : '✗';
  tapCodeDrillStatsEl.textContent =
    `${mark} ${tapCodeTargetLabel(result.prompt)} · ${result.latencyMs.toFixed(0)} ms`;
}

function renderTapCodeSummary(summary: TapCodeDrillSummary): void {
  const accuracy =
    summary.accuracy === null ? '—' : `${(summary.accuracy * 100).toFixed(1)}%`;
  const stats = [...summary.perCharStats]
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .map(
      (stat) =>
        `${tapCodeTargetLabel(stat.char)}: ${(stat.accuracy * 100).toFixed(0)}% ` +
        `(${stat.correct}/${stat.attempts})`,
    );

  tapCodeDrillStatsEl.textContent = [
    `${summary.correct}/${summary.promptCount} correct (${accuracy}) · ` +
      `${summary.avgLatencyMs.toFixed(0)} ms average`,
    ...stats,
  ].join('\n');
  tapCodePromptEl.textContent = '';
  tapCodeHintEl.textContent = '';
  tapCodeDrillProgressEl.textContent = '';
}

function updateTapCodeDrillButtons(): void {
  const running = tapCodeDrillRunner?.isActive() ?? false;
  tapCodeDrillStartBtn.disabled = running;
  tapCodeDrillStopBtn.disabled = !running;
  tapCodeLessonEl.disabled = running;
  tapCodeDrillCountEl.disabled = running;
  tapCodeDrillWeakBtn.disabled =
    running || (lastTapCodeDrillRunner?.getWeakChars().length ?? 0) === 0;
}

function startTapCodeDrill(sequence: string[]): void {
  cancelAutoTap();
  if (runner?.isActive()) runner.abort();
  runner = null;
  setTapCodeEnabled(true);

  tapCodeDrillStatsEl.textContent = '';
  const drill = new TapCodeDrillRunner(sequence, {
    onPrompt: (prompt, index, total) => {
      renderTapCodePrompt(prompt, index, total);
      renderTapCodeDrillProgress();
    },
    onResult: renderTapCodeResult,
    onComplete: (summary) => {
      lastTapCodeDrillRunner = drill;
      renderTapCodeSummary(summary);
      renderMode();
      updateDrillButtons();
      updateTapCodeDrillButtons();
    },
  });
  tapCodeDrillRunner = drill;
  lastTapCodeDrillRunner = drill;
  drill.start();

  renderMode();
  updateDrillButtons();
  updateTapCodeDrillButtons();
}

tapCodeDrillStartBtn.addEventListener('click', () => {
  const sequence = generateTapCodeDrill(
    selectedTapCodeLesson(),
    tapCodePromptCount(),
  );
  startTapCodeDrill(sequence);
});

tapCodeDrillWeakBtn.addEventListener('click', () => {
  const weakChars = lastTapCodeDrillRunner?.getWeakChars() ?? [];
  if (weakChars.length === 0) {
    tapCodeDrillStatsEl.textContent =
      'No weak characters yet. Complete at least three attempts per character.';
    updateTapCodeDrillButtons();
    return;
  }

  const lesson = selectedTapCodeLesson();
  const relevantTargets = lesson.targets.filter((target) =>
    weakChars.some((char) =>
      target === 'backspace' || target === 'enter'
        ? target === char
        : Array.from(target).includes(char),
    ),
  );
  const weakLesson: TapCodeLesson = {
    ...lesson,
    targets: relevantTargets.length > 0 ? relevantTargets : lesson.targets,
  };
  startTapCodeDrill(
    generateTapCodeDrill(weakLesson, tapCodePromptCount(), weakChars),
  );
});

tapCodeDrillStopBtn.addEventListener('click', () => {
  tapCodeDrillRunner?.stop();
  renderMode();
  updateDrillButtons();
  updateTapCodeDrillButtons();
});

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
  if (tapCodeDrillRunner?.isActive()) tapCodeDrillRunner.stop();
  if (tapCodeEnabled) setTapCodeEnabled(false);

  drillSummaryEl.textContent = '';
  drillFeedbackEl.textContent = '';
  runner = new DrillRunner(sequence, session, {
    onPrompt: renderPrompt,
    onResult: (r) => {
      flashFeedback(r);
      // Haptic feedback on the physical device: short buzz on a miss.
      // No-op in simulate mode or when the UI-cmd characteristic is absent.
      if (!r.correct) void connection.sendVibration([200]);
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
      // Persist to IndexedDB (fire-and-forget; failure is non-fatal)
      void saveSession(s, s.results).catch((err) =>
        console.warn('Session save failed:', err),
      );
      void mergeResults(s.results).catch((err) =>
        console.warn('Lifetime merge failed:', err),
      );
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
  // Merge current-session weak chords with lifetime weak chords for better
  // drill generation — a chord you've historically struggled with stays
  // in the drill even if this particular session didn't exercise it.
  void (async () => {
    let weak = session.getWeakChords();
    try {
      const lifetimeWeak = await getLifetimeWeakChords();
      // Combine: session-level weak + lifetime-weak (deduplicated by code)
      const codes = new Set(weak.map((w) => w.code));
      for (const lw of lifetimeWeak) {
        if (!codes.has(lw.code)) {
          weak.push({
            code: lw.code,
            attempts: lw.totalAttempts,
            correct: lw.totalCorrect,
            accuracy: lw.accuracy,
            avgLatencyMs: lw.avgPromptLatencyMs,
            latencySamples: lw.latencySamples,
            recentErrors: [],
            lastSeen: lw.lastDrilled,
          });
        }
      }
    } catch {
      // Lifetime stats unavailable — fall back to session-only
    }
    if (weak.length === 0) return;
    let stats: Map<number, import('./core/types').ChordStat> | undefined;
    try {
      const lifetime = await loadLifetimeStats();
      // Convert lifetime stats to ChordStat shape for weighting
      stats = new Map();
      for (const [code, ls] of lifetime) {
        stats.set(code, {
          code,
          attempts: ls.totalAttempts,
          correct: ls.totalCorrect,
          accuracy: ls.accuracy,
          avgLatencyMs: ls.avgPromptLatencyMs,
          latencySamples: ls.latencySamples,
          recentErrors: [],
          lastSeen: ls.lastDrilled,
        });
      }
    } catch {
      stats = session.getStats().perChordStats;
    }
    const sequence = buildWeakChordDrill(weak, ALL_CODES, drillPromptCount(), stats);
    startDrill(sequence);
  })();
});

drillStopBtn.addEventListener('click', () => {
  cancelAutoTap();
  runner?.abort();
  renderMode();
  updateDrillButtons();
});

tapCodeToggleBtn.addEventListener('click', () => {
  setTapCodeEnabled(!tapCodeEnabled);
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
  if (tapCodeDrillRunner?.isActive()) tapCodeDrillRunner.stop();
  connection.stop();
  renderMode();
  updateDrillButtons();
  updateTapCodeDrillButtons();
});
