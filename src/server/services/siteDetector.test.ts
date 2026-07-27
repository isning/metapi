import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platforms/index.js', () => ({
  detectPlatform: vi.fn(),
}));

import { detectSite } from './siteDetector.js';
import { detectPlatform } from './platforms/index.js';

const detectPlatformMock = vi.mocked(detectPlatform);

describe('detectSite', () => {
  beforeEach(() => {
    detectPlatformMock.mockReset();
  });

  it('uses initialization presets before probing platform adapters', async () => {
    const result = await detectSite('https://api.deepseek.com/v1');

    expect(result).toEqual({
      url: 'https://api.deepseek.com',
      platform: 'openai',
      initializationPresetId: 'deepseek-openai',
    });
    expect(detectPlatformMock).not.toHaveBeenCalled();
  });

  it('falls back to adapter detection with canonicalized urls', async () => {
    detectPlatformMock.mockResolvedValueOnce({ platformName: 'newapi' } as any);

    await expect(detectSite(' https://example.com/v1/chat/completions ')).resolves.toEqual({
      url: 'https://example.com',
      platform: 'newapi',
    });
    expect(detectPlatformMock).toHaveBeenCalledWith('https://example.com/v1/chat/completions');
  });

  it('returns null when no preset or adapter matches', async () => {
    detectPlatformMock.mockResolvedValueOnce(null);

    await expect(detectSite('https://unknown.example.com')).resolves.toBeNull();
  });
});
