import {
  normalizeUpstreamCompatibilityPolicy,
  parseUpstreamCompatibilityPolicyJson,
  type UpstreamCompatibilityPolicy,
} from '../contracts/upstreamCompatibilityPolicy.js';

export type CompatibilityPolicyStorageResult =
  | { ok: true; present: false; value?: undefined; policy?: undefined }
  | { ok: true; present: true; value: string | null; policy?: UpstreamCompatibilityPolicy }
  | { ok: false; present: true; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCompatibilityPolicyStorageInput(input: unknown): CompatibilityPolicyStorageResult {
  if (input === undefined) return { ok: true, present: false };
  if (input === null) return { ok: true, present: true, value: null };

  const policy = typeof input === 'string'
    ? parseUpstreamCompatibilityPolicyJson(input)
    : (isRecord(input) ? normalizeUpstreamCompatibilityPolicy(input) : undefined);
  if (!policy) {
    return {
      ok: false,
      present: true,
      error: 'Invalid compatibilityPolicy. Expected a non-empty upstream compatibility policy object.',
    };
  }

  return {
    ok: true,
    present: true,
    value: JSON.stringify(policy),
    policy,
  };
}

export function getCompatibilityPolicyFromExtraConfig(extraConfig: unknown): UpstreamCompatibilityPolicy | undefined {
  if (!extraConfig) return undefined;
  let parsed: unknown = extraConfig;
  if (typeof extraConfig === 'string') {
    try {
      parsed = JSON.parse(extraConfig);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed)) return undefined;
  return normalizeUpstreamCompatibilityPolicy(parsed.compatibilityPolicy);
}
