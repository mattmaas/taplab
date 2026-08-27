/**
 * Tap Strap 2 chord utilities.
 *
 * Tapcodes are 5-bit numbers; bit ordering (Tap convention):
 *   bit 0 = Thumb (T), bit 1 = Index (I), bit 2 = Middle (M),
 *   bit 3 = Ring (R),  bit 4 = Pinky (P)
 * So codes run 1..31 (0 = no fingers = invalid).
 */

export type { TapEvent } from './types';

export type TapCode = number; // 1-31

export const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

/** Which fingers participate in a tapcode, in finger order. */
export function getFingers(code: TapCode): FingerName[] {
  return FINGER_NAMES.filter((_, i) => ((code >> i) & 1) === 1);
}

/** Human-readable finger combo, e.g. "Thumb+Ring". */
export function codeToFingerString(code: TapCode): string {
  const fingers = getFingers(code);
  return fingers.length === 0 ? 'NONE' : fingers.join('+');
}

/** Number of fingers in a tapcode (popcount). */
export function fingerCount(code: TapCode): number {
  let n = code & 0x1f;
  let count = 0;
  while (n !== 0) {
    n &= n - 1;
    count++;
  }
  return count;
}

/** Hamming distance between two tapcodes (bits that differ). */
export function hammingDistance(a: TapCode, b: TapCode): number {
  return fingerCount(a ^ b);
}

/**
 * Default Tap alphabet.
 *
 * VERIFIED: single-finger taps map to the vowels — this is Tap's canonical
 * beginner set (TapGenius Set 1) and ships as firmware defaults:
 *   Thumb(1)='a', Index(2)='e', Middle(4)='i', Ring(8)='o', Pinky(16)='u'
 *
 * Multi-finger consonant mappings vary by firmware/custom mapping and are
 * intentionally left unmapped here. The training system operates on raw
 * codes so it works regardless; the map is used for display only.
 * Unknown codes resolve to UNKNOWN_CHAR.
 */
export const DEFAULT_TAP_ALPHABET: Record<TapCode, string> = {
  1: 'a', // Thumb
  2: 'e', // Index
  4: 'i', // Middle
  8: 'o', // Ring
  16: 'u', // Pinky
};

export const UNKNOWN_CHAR = '?';

/** Resolve a tapcode to a character through the given (or default) map. */
export function resolveChord(
  code: TapCode,
  map: Record<TapCode, string> = DEFAULT_TAP_ALPHABET,
): string {
  return map[code] ?? UNKNOWN_CHAR;
}