import { describe, it, expect } from 'vitest';
import { RemapEngine } from './remap';

describe('RemapEngine.getNearbyChords', () => {
  it('returns all codes within Hamming distance 1', () => {
    const engine = new RemapEngine();
    // code 3 (Thumb+Index): H1 neighbors are 1, 2, 7, 11, 19
    expect(engine.getNearbyChords(3).sort((a, b) => a - b)).toEqual([1, 2, 7, 11, 19]);
  });
  it('excludes the code itself', () => {
    const engine = new RemapEngine();
    expect(engine.getNearbyChords(5)).not.toContain(5);
  });
});

describe('RemapEngine correction with the DEFAULT (vowel-only) map', () => {
  /**
   * Executable documentation of the review finding: with only the five
   * single-finger vowels mapped, single-candidate correction can NEVER
   * fire — every 2-finger code has exactly TWO mapped H1 neighbors (its
   * constituent fingers) and every 3+-finger code has ZERO.
   */
  it('never corrects any unmapped code (dead-path proof)', () => {
    const engine = new RemapEngine();
    for (let code = 1; code <= 31; code++) {
      const result = engine.resolve(code);
      expect(result.corrected).toBe(false);
    }
  });

  it('resolves mapped vowels directly', () => {
    const engine = new RemapEngine();
    expect(engine.resolve(1)).toEqual({ char: 'a', corrected: false });
    expect(engine.resolve(16)).toEqual({ char: 'u', corrected: false });
  });

  it('returns ? for unmapped codes without correction', () => {
    const engine = new RemapEngine();
    expect(engine.resolve(31).char).toBe('?');
  });
});

describe('RemapEngine correction with a synthetic map (proves the logic works)', () => {
  /**
   * Synthetic map where exactly one mapped chord sits at Hamming distance 1
   * from the probe code, so single-candidate correction MUST fire.
   *
   * Probe: 7 (Thumb+Index+Middle).
   * H1 neighbors of 7: 6, 5, 3, 15, 23.
   * Map ONLY 15 -> 't'. All other neighbors unmapped.
   */
  const map = { 15: 't', 24: 'z' }; // 24 is far from 7 (H distance 3)

  it('corrects to the single nearby candidate', () => {
    const engine = new RemapEngine(map);
    const result = engine.resolve(7);
    expect(result.corrected).toBe(true);
    expect(result.char).toBe('t');
    expect(result.originalChar).toBe('?');
  });

  it('does NOT correct when two candidates are equally near', () => {
    // Probe 3 (T+I). Map both H1 neighbors 1 and 2 -> ambiguous.
    const engine = new RemapEngine({ 1: 'a', 2: 'e' });
    const result = engine.resolve(3);
    expect(result.corrected).toBe(false);
    expect(result.char).toBe('?');
  });

  it('does NOT correct when nothing is near', () => {
    const engine = new RemapEngine({ 24: 'z' });
    const result = engine.resolve(7); // H distance 3 from 24
    expect(result.corrected).toBe(false);
    expect(result.char).toBe('?');
  });

  it('direct hits are never marked corrected', () => {
    const engine = new RemapEngine(map);
    expect(engine.resolve(15)).toEqual({ char: 't', corrected: false });
  });
});

describe('RemapEngine map management', () => {
  it('setMap/getMap round-trips and defends against mutation', () => {
    const engine = new RemapEngine();
    engine.setMap({ 5: 'w' });
    const out = engine.getMap();
    expect(out).toEqual({ 5: 'w' });
    out[6] = 'x'; // mutate the copy
    expect(engine.getMap()).toEqual({ 5: 'w' }); // engine unaffected
  });
});
