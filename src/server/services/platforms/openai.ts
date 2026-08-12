import { StandardApiProviderAdapterBase } from './standardApiProvider.js';
import type { ModelDiscoveryOptions } from './base.js';

export class OpenAiAdapter extends StandardApiProviderAdapterBase {
  readonly platformName = 'openai';

  async detect(url: string): Promise<boolean> {
    const normalized = (url || '').toLowerCase();
    return normalized.includes('api.openai.com');
  }

  async getModels(baseUrl: string, apiToken: string, _platformUserId?: number, options?: ModelDiscoveryOptions): Promise<string[]> {
    return this.fetchModelsFromStandardEndpoint({
      baseUrl,
      basePathMode: options?.basePathMode,
      headers: { Authorization: `Bearer ${apiToken}` },
    });
  }
}
