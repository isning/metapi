import { describe, expect, it } from 'vitest';
import {
  parseSiteBatchPayload,
  parseSiteCreatePayload,
  parseSiteDetectPayload,
  parseSiteDisabledModelsPayload,
  parseSiteUpdatePayload,
} from './siteRoutePayloads.js';

describe('site route payload contracts', () => {
  it('accepts site create, update, batch, disabled-model, and detect payloads', () => {
    expect(parseSiteCreatePayload({
      name: ' OpenAI ',
      url: ' https://api.openai.com ',
      platform: ' openai ',
      initializationPresetId: null,
      customHeaders: { 'x-test': '1' },
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        name: 'OpenAI',
        url: 'https://api.openai.com',
        platform: 'openai',
        initializationPresetId: null,
        customHeaders: { 'x-test': '1' },
        extra: 'kept',
      },
    });
    expect(parseSiteUpdatePayload({ name: ' Renamed ', platform: ' new-api ' })).toEqual({
      success: true,
      data: { name: 'Renamed', platform: 'new-api' },
    });
    expect(parseSiteBatchPayload({ ids: [1], action: 'delete' })).toEqual({
      success: true,
      data: { ids: [1], action: 'delete' },
    });
    expect(parseSiteDisabledModelsPayload({ models: ['gpt-4.1'] })).toEqual({
      success: true,
      data: { models: ['gpt-4.1'] },
    });
    expect(parseSiteDetectPayload({ url: ' https://api.deepseek.com/v1 ' })).toEqual({
      success: true,
      data: { url: 'https://api.deepseek.com/v1' },
    });
  });

  it('returns field-specific validation messages', () => {
    expect(parseSiteCreatePayload('bad')).toEqual({
      success: false,
      error: 'Invalid site payload.',
    });
    expect(parseSiteCreatePayload({ name: '', url: 'https://example.com' })).toEqual({
      success: false,
      error: 'Invalid name. Expected non-empty string.',
    });
    expect(parseSiteUpdatePayload({ platform: '' })).toEqual({
      success: false,
      error: 'Invalid platform. Expected string.',
    });
    expect(parseSiteBatchPayload({ ids: [0] })).toEqual({
      success: false,
      error: 'Invalid ids. Expected number[].',
    });
    expect(parseSiteBatchPayload({ action: 1 })).toEqual({
      success: false,
      error: 'Invalid action. Expected string.',
    });
    expect(parseSiteDisabledModelsPayload({ models: [1] })).toEqual({
      success: false,
      error: 'Invalid models. Expected string[].',
    });
  });
});
