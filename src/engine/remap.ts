/**
 * RemapEngine - chord -> character resolution with fuzzy correction.
 *
 * MVP behavior: unknown codes are corrected ONLY when exactly one mapped
 * chord sits within Hamming distance 1 (e.g. you dropped/added a finger and
 * landed next to a vowel). This is deliberately conservative; the full
 * bigram-aware correction model plugs into suggestCorrection later.
 */

import { DEFAULT_TAP_ALPHABET, hammingDistance } from '../core/chords';

export interface ResolveResult {
  char: string;
  corrected: boolean;
  originalChar?: string;
}

export class RemapEngine {
  private chordMap: Record<number, string>;
  private recentCodes: number[] = []; // sliding window for future n-gram context
  private static readonly WINDOW = 10;

  constructor(map?: Record<number, string>) {
    this.chordMap = map ?? { ...DEFAULT_TAP_ALPHABET };
  }

  setMap(map: Record<number, string>): void {
    this.chordMap = { ...map };
  }

  getMap(): Record<number, string> {
    return { ...this.chordMap };
  }

  /** Resolve a tapcode to a character; corrects if a single nearby known chord exists. */
  resolve(code: number): ResolveResult {
    this.pushRecent(code);
    const direct = this.chordMap[code];
    if (direct) return { char: direct, corrected: false };
    const suggestion = this.suggestCorrection(code, '');
    if (suggestion) {
      return { char: suggestion, corrected: true, originalChar: '?' };
    }
    return { char: '?', corrected: false };
  }

  /** All valid codes within `maxDistance` Hamming bits of `code`. */
  getNearbyChords(code: number, maxDistance = 1): number[] {
    const out: number[] = [];
    for (let c = 1; c <= 31; c++) {
      if (c !== code && hammingDistance(code, c) <= maxDistance) {
        out.push(c);
      }
    }
    return out;
  }

  /**
   * Given the expected context (previous chars), suggest a better chord.
   * Skeleton: conservative single-candidate correction.
   */
  suggestCorrection(code: number, prevChars: string): string | null {
    void prevChars; // bigram model to come; kept in signature for compatibility
    const candidates = this.getNearbyChords(code).filter(
      (c) => this.chordMap[c] !== undefined,
    );
    if (candidates.length === 1) {
      return this.chordMap[candidates[0]];
    }
    return null;
  }

  private pushRecent(code: number): void {
    this.recentCodes.push(code);
    if (this.recentCodes.length > RemapEngine.WINDOW) {
      this.recentCodes.shift();
    }
  }
}