import { describe, expect, it } from 'vitest';
import { hashIdCard, normalizeIdCard } from './id-card';

describe('hashIdCard', () => {
  it('returns the SHA-256 hex digest', () => {
    expect(hashIdCard('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('treats a lowercase trailing x as the canonical uppercase X', () => {
    expect(hashIdCard('12345678901234567x')).toBe(hashIdCard('12345678901234567X'));
  });

  it('trims whitespace and normalizes the trailing X', () => {
    expect(normalizeIdCard(' 12345678901234567x ')).toBe('12345678901234567X');
  });
});
