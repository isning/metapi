import { BasePlatformAdapter, CheckinResult, BalanceInfo, type PlatformCredentialContext } from './base.js';
import {
  normalizeCommonPricingPayload,
  type UpstreamPricingCatalog,
} from '../upstreamPricingCatalog.js';
import { resolvePlatformUserId } from '../accountExtraConfig.js';

export class VeloeraAdapter extends BasePlatformAdapter {
  readonly platformName = 'veloera';

  private platformUserId(input: PlatformCredentialContext): number | undefined {
    return resolvePlatformUserId(input.account.extraConfig, input.account.username);
  }

  async detect(url: string): Promise<boolean> {
    try {
      const res = await this.fetchJson<any>(`${url}/api/status`);
      return res?.success === true && (
        res?.data?.system_name?.toLowerCase().includes('veloera') ||
        res?.data?.version?.includes('veloera')
      );
    } catch {
      return false;
    }
  }

  private veloeraHeaders(accessToken: string, userId?: number): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (userId) {
      const value = String(userId);
      headers['Veloera-User'] = value;
      headers['New-API-User'] = value;
      headers['User-id'] = value;
    }
    return headers;
  }

  async checkin(input: PlatformCredentialContext): Promise<CheckinResult> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const platformUserId = this.platformUserId(input);
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/user/checkin`, {
        method: 'POST',
        headers: this.veloeraHeaders(accessToken, platformUserId),
      });
      if (res?.success) {
        return { success: true, message: res.message || 'Check-in successful', reward: res.data?.reward?.toString() };
      }
      return { success: false, message: res?.message || 'Check-in failed' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getBalance(input: PlatformCredentialContext): Promise<BalanceInfo> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const platformUserId = this.platformUserId(input);
    const res = await this.fetchJson<any>(`${baseUrl}/api/user/self`, {
      headers: this.veloeraHeaders(accessToken, platformUserId),
    });
    const data = res?.data;
    const quota = (data?.quota || 0) / 1000000;
    const used = (data?.used_quota || 0) / 1000000;
    const todayIncome = Number.isFinite(data?.today_income) ? (data.today_income / 1000000) : undefined;
    const todayQuotaConsumption = Number.isFinite(data?.today_quota_consumption) ? (data.today_quota_consumption / 1000000) : undefined;
    return { balance: quota - used, used, quota, todayIncome, todayQuotaConsumption };
  }

  async getModels(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const apiToken = this.modelCredential(input);
    const res = await this.fetchJson<any>(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    return (res?.data || []).map((m: any) => m.id).filter(Boolean);
  }

  async getPricingCatalog(input: PlatformCredentialContext): Promise<UpstreamPricingCatalog | null> {
    const baseUrl = input.endpoint.baseUrl;
    const token = this.pricingCredential(input).trim();
    const headers = token
      ? this.veloeraHeaders(token, this.platformUserId(input))
      : {};
    const payload = await this.fetchJson<any>(`${baseUrl}/api/pricing`, { headers });
    return normalizeCommonPricingPayload(payload);
  }
}
