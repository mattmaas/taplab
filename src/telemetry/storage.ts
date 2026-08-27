/**
 * IndexedDB persistence — cumulative progress tracking across sessions.
 *
 * Stores:
 *   - Session summaries (drill results: accuracy, prompts, timing)
 *   - Lifetime per-chord stats (merged across all drill sessions)
 *   - User's chord map (if customized — future)
 *
 * The API is intentionally simple: save a completed drill's results, and
 * load lifetime stats for weak-chord generation. All IDB interaction is
 * async and failure-tolerant — if storage fails, the app still works
 * (session data just doesn't persist across reloads).
 */

import type { ChordStat, DrillSummary, DrillPromptResult } from '../core/types';

const DB_NAME = 'taplab';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const CHORD_STATS_STORE = 'chordStats';

export interface StoredSession {
  id: string; // ISO timestamp
  timestamp: number;
  summary: DrillSummary;
  results: DrillPromptResult[];
}

export interface LifetimeChordStat {
  code: number;
  totalAttempts: number;
  totalCorrect: number;
  accuracy: number; // totalCorrect / totalAttempts
  avgPromptLatencyMs: number;
  latencySamples: number;
  lastDrilled: number; // timestamp
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHORD_STATS_STORE)) {
        db.createObjectStore(CHORD_STATS_STORE, { keyPath: 'code' });
      }
    };
  });
  return dbPromise;
}

function tx(
  storeName: string,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  return openDB().then((db) => {
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  });
}

// ---------------------------------------------------------------- sessions

export async function saveSession(
  summary: DrillSummary,
  results: DrillPromptResult[],
): Promise<string> {
  const id = new Date().toISOString();
  const stored: StoredSession = {
    id,
    timestamp: Date.now(),
    summary,
    results,
  };
  const store = await tx(SESSIONS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(stored);
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSessions(limit = 50): Promise<StoredSession[]> {
  const store = await tx(SESSIONS_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as StoredSession[])
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSessions(): Promise<void> {
  const store = await tx(SESSIONS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------- lifetime chord stats

export async function loadLifetimeStats(): Promise<Map<number, LifetimeChordStat>> {
  const store = await tx(CHORD_STATS_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const map = new Map<number, LifetimeChordStat>();
      for (const stat of req.result as LifetimeChordStat[]) {
        map.set(stat.code, stat);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Merge a completed drill's per-prompt results into the lifetime stats.
 * Uses incremental-mean math so we never need to re-scan old sessions.
 */
export async function mergeResults(results: DrillPromptResult[]): Promise<void> {
  const current = await loadLifetimeStats();

  for (const r of results) {
    const existing = current.get(r.expected) ?? {
      code: r.expected,
      totalAttempts: 0,
      totalCorrect: 0,
      accuracy: 0,
      avgPromptLatencyMs: 0,
      latencySamples: 0,
      lastDrilled: 0,
    };
    existing.totalAttempts += 1;
    if (r.correct) existing.totalCorrect += 1;
    existing.accuracy =
      existing.totalAttempts > 0
        ? existing.totalCorrect / existing.totalAttempts
        : 0;
    existing.latencySamples += 1;
    existing.avgPromptLatencyMs +=
      (r.promptLatencyMs - existing.avgPromptLatencyMs) / existing.latencySamples;
    existing.lastDrilled = Date.now();
    current.set(r.expected, existing);
  }

  const store = await tx(CHORD_STATS_STORE, 'readwrite');
  for (const stat of current.values()) {
    store.put(stat);
  }
}

export async function clearLifetimeStats(): Promise<void> {
  const store = await tx(CHORD_STATS_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get lifetime weak chords — same concept as the session-level one but
 * across ALL historical drill sessions.
 */
export async function getLifetimeWeakChords(
  threshold = 0.85,
  minAttempts = 10,
): Promise<LifetimeChordStat[]> {
  const stats = await loadLifetimeStats();
  return [...stats.values()]
    .filter((s) => s.totalAttempts >= minAttempts && s.accuracy < threshold)
    .sort((a, b) => a.accuracy - b.accuracy);
}
