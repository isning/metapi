import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDownstreamSkKey } from './generateDownstreamSkKey.js';

describe('generateDownstreamSkKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the requested prefix followed by 32 random bytes encoded as hex', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index;
      }
      return array;
    });

    expect(generateDownstreamSkKey('sk-metapi-')).toBe(
      'sk-metapi-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    );
  });
});
