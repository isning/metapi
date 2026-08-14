import { describe, expect, it } from 'vitest';
import { maskToken, normalizeTokenForDisplay } from './accountTokenService.js';

describe('maskToken', () => {
  it('keeps sk- prefix for short tokens', () => {
    const masked = maskToken('sk-abcde');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.includes('***')).toBe(true);
  });

  it('keeps sk- prefix for long tokens', () => {
    const masked = maskToken('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.includes('***')).toBe(true);
  });

  it('does not invent an sk- prefix for an upstream key', () => {
    const masked = maskToken('5Uh6KjAgVOqQxNv97MAS7abkBf7Fg5GphgBXUpAOuvq2IvL4', 'new-api');
    expect(masked.startsWith('sk-')).toBe(false);
  });
});

describe('normalizeTokenForDisplay', () => {
  it('preserves opaque upstream key values across platforms', () => {
    expect(normalizeTokenForDisplay('abc123', 'new-api')).toBe('abc123');
    expect(normalizeTokenForDisplay('xyz789', 'one-api')).toBe('xyz789');
    expect(normalizeTokenForDisplay('pqr456', 'anyrouter')).toBe('pqr456');
    expect(normalizeTokenForDisplay('uvw000', 'veloera')).toBe('uvw000');
  });

  it('keeps existing sk- token unchanged', () => {
    expect(normalizeTokenForDisplay('sk-abc123', 'veloera')).toBe('sk-abc123');
  });
});
