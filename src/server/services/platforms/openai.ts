import { StandardApiProviderAdapterBase } from './standardApiProvider.js';
import type { PlatformCredentialContext } from './base.js';

export class OpenAiAdapter extends StandardApiProviderAdapterBase {
  readonly platformName = 'openai';

  async detect(url: string): Promise<boolean> {
    const normalized = (url || '').toLowerCase();
    return normalized.includes('api.openai.com');
  }

  async getModels(input: PlatformCredentialContext): Promise<string[]> {
    return this.fetchModelsFromStandardEndpoint({
      baseUrl: input.endpoint.baseUrl,
      basePathMode: input.endpoint.basePathMode,
      headers: { Authorization: `Bearer ${this.modelCredential(input)}` },
    });
  }
}
