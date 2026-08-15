import { OneApiAdapter } from './oneApi.js';
import type { PlatformCredentialContext } from './base.js';
import {
  normalizeOneHubPricingPayload,
  type UpstreamPricingCatalog,
} from '../upstreamPricingCatalog.js';

export class OneHubAdapter extends OneApiAdapter {
  readonly platformName: string = 'one-hub';

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('onehub') || normalized.includes('one-hub');
  }

  /**
   * OneHub model discovery: try /v1/models first, fall back to /api/available_model.
   * The /api/available_model model-list API returns { data: { model_name: { price: ... }, ... } }
   * where the keys are model names.
   */
  override async getModels(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const apiToken = this.modelCredential(input);
    let openAiModels: string[] = [];
    try {
      openAiModels = await super.getModels(input);
    } catch {}
    if (openAiModels.length > 0) return openAiModels;

    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/available_model`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const payload = res?.data && typeof res.data === 'object' ? res.data : res;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const models = Object.keys(payload).filter(Boolean);
        if (models.length > 0) return models;
      }
    } catch {}

    return [];
  }

  /**
   * OneHub user groups: /api/user_group_map returns { data: { group_name: ratio, ... } }
   */
  override async getUserGroups(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/user_group_map`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const source = res?.data || res;
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        const groups = Object.keys(source).map((k) => k.trim()).filter(Boolean);
        if (groups.length > 0) return Array.from(new Set(groups));
      }
    } catch {}

    return super.getUserGroups(input);
  }

  override async getPricingCatalog(input: PlatformCredentialContext): Promise<UpstreamPricingCatalog | null> {
    const baseUrl = input.endpoint.baseUrl;
    const token = this.pricingCredential(input);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const [availablePayload, groupPayload] = await Promise.all([
      this.fetchJson<any>(`${baseUrl}/api/available_model`, { headers }),
      this.fetchJson<any>(`${baseUrl}/api/user_group_map`, { headers }),
    ]);

    return normalizeOneHubPricingPayload(availablePayload, groupPayload);
  }
}
