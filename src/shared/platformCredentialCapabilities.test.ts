import { describe, expect, it } from 'vitest';
import {
  getPlatformCredentialCapabilities,
  supportsInteractiveCredentialMode,
} from './platformCredentialCapabilities.js';

describe('platform credential capabilities', () => {
  it('marks standard OpenAI-compatible providers as API-key-only', () => {
    for (const platform of ['openai', 'claude', 'gemini', 'gemini-cli', 'cliproxyapi']) {
      expect(getPlatformCredentialCapabilities(platform)).toEqual({
        session: false,
        apiKey: true,
        sessionCredentialKind: 'either',
      });
      expect(supportsInteractiveCredentialMode(platform, 'session')).toBe(false);
      expect(supportsInteractiveCredentialMode(platform, 'apikey')).toBe(true);
    }
  });

  it('keeps panel platforms available to both connection flows', () => {
    expect(getPlatformCredentialCapabilities('new-api')).toEqual({
      session: true,
      apiKey: true,
      sessionCredentialKind: 'session_cookie_or_api_token',
    });
  });

  it('declares the concrete Session credential form when an adapter requires one', () => {
    expect(getPlatformCredentialCapabilities('new-api').sessionCredentialKind).toBe('session_cookie_or_api_token');
    expect(getPlatformCredentialCapabilities('anyrouter').sessionCredentialKind).toBe('session_cookie_or_api_token');
    expect(getPlatformCredentialCapabilities('sub2api').sessionCredentialKind).toBe('access_token');
  });
});
