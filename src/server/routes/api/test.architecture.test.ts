import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Model Tester proxy boundaries', () => {
  it('keeps the Fastify route as an adapter over contracts, transport and job lifecycle', () => {
    const route = readSource('./test.ts');
    const surface = readSource('../../proxy-core/surfaces/modelTesterProxySurface.ts');
    const jobs = readSource('../../services/modelTesterProxyJobService.ts');
    const shared = readSource('../../../shared/modelTesterProxy.d.ts');
    const webApi = readSource('../../../web/api.ts');
    const session = readSource('../../../web/pages/helpers/modelTesterSession.ts');

    for (const forbidden of [
      "from 'undici'",
      'new Map<',
      'new FormData(',
      'new File(',
      '.getReader()',
      'readRuntimeResponseText(',
      'ALLOWED_PROXY_PATH_PATTERNS',
      'randomUUID(',
    ]) expect(route).not.toContain(forbidden);

    expect(route).toContain('parseModelTesterProxyPayload');
    expect(route).toContain('executeModelTesterProxyBuffered');
    expect(route).toContain('executeModelTesterProxyStream');
    expect(route).toContain('ModelTesterProxyJobService');
    expect(surface).toContain("from 'undici'");
    expect(surface).toContain('.getReader()');
    expect(jobs).toContain('new Map<string, StoredJob>()');
    expect(shared).toContain('export type ModelTesterProxyEnvelope');
    expect(webApi).toContain('ModelTesterProxyEnvelope');
    expect(session).toContain('TesterProxyEnvelope = ModelTesterProxyEnvelope');
    expect(session).not.toContain('type TesterProxyEnvelopeBase');
  });
});
