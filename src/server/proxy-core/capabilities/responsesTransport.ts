export type ResponsesUpstreamTransportMode = 'auto' | 'follow_downstream';

function normalizePlatformName(sitePlatform?: string): string {
  return typeof sitePlatform === 'string' ? sitePlatform.trim().toLowerCase() : '';
}

export function shouldForceResponsesUpstreamStream(input: {
  sitePlatform?: string;
  transportMode?: ResponsesUpstreamTransportMode;
  isCompactRequest?: boolean;
}): boolean {
  if (input.isCompactRequest) return false;
  if (input.transportMode !== 'follow_downstream') return true;

  const sitePlatform = normalizePlatformName(input.sitePlatform);
  return sitePlatform === 'codex' || sitePlatform === 'sub2api';
}
