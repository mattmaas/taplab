import { describe, it, expect } from 'vitest';
import {
  getFingers,
  codeToFingerString,
  fingerCount,
  hammingDistance,
  resolveChord,
  DEFAULT_TAP_ALPHABET,
  UNKNOWN_CHAR,
} from './chords';

describe('fingerCount (popcount)', () => {
  it('counts bits for all 31 valid codes', () => {
    expect(fingerCount(1)).toBe(1); // thumb
    expect(fingerCount(3)).toBe(2); // thumb+index
    expect(fingerCount(7)).toBe(3);
    expect(fingerCount(15)).toBe(4);
    expect(fingerCount(31)).toBe(5); // all fingers
    expect(fingerCount(0)).toBe(0);
  });

  it('masks to 5 bits', () => {
    expect(fingerCount(32)).toBe(0); // bit 5 is not a finger
    expect(fingerCount(63)).toBe(5); // 0b111111 -> 0b11111
  });
});

describe('hammingDistance', () => {
  it('is 0 for identical codes', () => {
    expect(hammingDistance(21, 21)).toBe(0);
  });
  it('counts differing bits', () => {
    expect(hammingDistance(1, 2)).toBe(2); // thumb vs index
    expect(hammingDistance(3, 1)).toBe(1); // drop index
    expect(hammingDistance(31, 0)).toBe(5);
  });
  it('is symmetric', () => {
    for (let a = 1; a <= 31; a += 7) {
      for (let b = 1; b <= 31; b += 5) {
        expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
      }
    }
  });
});

describe('getFingers / codeToFingerString', () => {
  it('maps bits to finger names in order', () => {
    expect(getFingers(1)).toEqual(['Thumb']);
    expect(getFingers(9)).toEqual(['Thumb', 'Ring']);
    expect(getFingers(31)).toEqual(['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']);
  });
  it('renders human-readable combos', () => {
    expect(codeToFingerString(9)).toBe('Thumb+Ring');
    expect(codeToFingerString(0)).toBe('NONE');
  });
});

describe('resolveChord', () => {
  it('resolves the verified vowel set', () => {
    expect(resolveChord(1)).toBe('a');
    expect(resolveChord(2)).toBe('e');
    expect(resolveChord(4)).toBe('i');
    expect(resolveChord(8)).toBe('o');
    expect(resolveChord(16)).toBe('u');
  });
  it('returns UNKNOWN_CHAR for unmapped codes', () => {
    expect(resolveChord(3)).toBe(UNKNOWN_CHAR);
    expect(resolveChord(31)).toBe(UNKNOWN_CHAR);
  });
  it('default map contains exactly the 5 single-finger vowels (documents map coverage)', () => {
    expect(Object.keys(DEFAULT_TAP_ALPHABET)).toHaveLength(5);
  });
});
