import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function listSources(relativePath: string): Array<{ path: string; source: string }> {
  const root = new URL(relativePath, import.meta.url);
  const files: Array<{ path: string; source: string }> = [];
  const visit = (url: URL, relativePrefix: string) => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const childUrl = new URL(entry.name, url);
      const childPath = `${relativePrefix}${entry.name}`;
      if (entry.isDirectory()) {
        visit(new URL(`${entry.name}/`, url), `${childPath}/`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      if (!statSync(childUrl).isFile()) continue;
      files.push({
        path: childPath,
        source: readFileSync(childUrl, 'utf8'),
      });
    }
  };
  visit(root, '');
  return files;
}

describe('proxy route architecture boundaries', () => {
  it('keeps production route files from importing protocol transformers', () => {
    const routeSources = listSources('../');
    for (const { path, source } of routeSources) {
      expect(source, path).not.toMatch(/from ['"][^'"]*transformers\//);
    }
  });

  it('keeps protocol transformer imports confined to transformer and format-adapter modules', () => {
    const serverSources = listSources('../../../');
    for (const { path, source } of serverSources) {
      const normalizedPath = path.replace(/\\/g, '/');
      const serverRelativePath = normalizedPath.startsWith('server/')
        ? normalizedPath.slice('server/'.length)
        : normalizedPath;
      if (serverRelativePath.startsWith('transformers/')) continue;
      if (serverRelativePath.startsWith('proxy-core/formats/')) continue;
      expect(source, path).not.toMatch(/from ['"][^'"]*transformers\//);
    }
  });

  it('keeps shared protocol helpers out of openai/chat protocol adapter', () => {
    const surfaceSource = readSource('../../proxy-core/formats/openaiChat.ts');
    expect(surfaceSource).toContain("from '../../transformers/openai/chat/index.js'");
    expect(surfaceSource).not.toContain("from './chatFormats.js'");
  });

  it('keeps anthropic-specific stream orchestration out of openai/chat protocol adapter', () => {
    const surfaceSource = readSource('../../proxy-core/formats/openaiChat.ts');
    expect(surfaceSource).not.toContain('serializeAnthropicRawSseEvent');
    expect(surfaceSource).not.toContain('syncAnthropicRawStreamStateFromEvent');
    expect(surfaceSource).not.toContain('isAnthropicRawSseEventName');
    expect(surfaceSource).not.toContain('serializeAnthropicFinalAsStream');
    expect(surfaceSource).toContain('openAiChatTransformer.proxyStream.createSession(');
  });

  it('keeps chat endpoint retry and downgrade strategy in the generic orchestrator', () => {
    const orchestratorSource = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');
    expect(orchestratorSource).toContain('executeEndpointFlow(');
  });

  it('keeps responses protocol assembly out of responses route', () => {
    const source = readSource('./responses.ts');
    const surfaceSource = readSource('../../proxy-core/formats/responses.ts');
    expect(source).toContain("from '../../proxy-core/orchestration/genericProxyOrchestrator.js'");
    expect(source).not.toContain('function toResponsesPayload(');
    expect(source).not.toContain('function createResponsesStreamState(');
    expect(source).not.toContain("from '../../transformers/openai/responses/conversion.js'");
    expect(source).not.toContain("from '../../transformers/openai/responses/outbound.js'");
    expect(source).not.toContain("from '../../transformers/openai/responses/aggregator.js'");
    expect(source).not.toContain('function buildResponsesCompatibilityBodies(');
    expect(source).not.toContain('function buildResponsesCompatibilityHeaderCandidates(');
    expect(source).not.toContain('function shouldRetryResponsesCompatibility(');
    expect(source).not.toContain("from './protocolCompat.js'");
    expect(source).not.toContain('function shouldDowngradeFromChatToMessagesForResponses(');
    expect(source).not.toContain('function normalizeText(');
    expect(surfaceSource).toContain('openAiResponsesTransformer.inbound.toOpenAiBody(');
    expect(surfaceSource).toContain('openAiResponsesTransformer.proxyStream.createSession(');
    expect(surfaceSource).toContain('openAiResponsesTransformer.outbound.serializeFinal(');
  });

  it('keeps responses endpoint retry and downgrade strategy out of the route', () => {
    const source = readSource('./responses.ts');
    const orchestratorSource = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');
    expect(orchestratorSource).toContain('executeEndpointFlow(');
    expect(source).not.toContain('openAiResponsesTransformer.compatibility.shouldRetry(');
    expect(source).not.toContain('openAiResponsesTransformer.compatibility.buildRetryBodies(');
    expect(source).not.toContain('openAiResponsesTransformer.compatibility.buildRetryHeaders(');
    expect(source).not.toContain('openAiResponsesTransformer.compatibility.shouldDowngradeChatToMessages(');
    expect(source).not.toContain('buildMinimalJsonHeadersForCompatibility(');
    expect(source).not.toContain('isEndpointDowngradeError(');
    expect(source).not.toContain('isUnsupportedMediaTypeError(');
  });

  it('removes normalizeContentText from upstream endpoint routing', () => {
    const source = readSource('./upstreamEndpoint.ts');
    expect(source).not.toContain('function normalizeContentText(');
    expect(source).not.toContain('normalizeContentText(');
  });

  it('keeps codex runtime header and prompt-cache derivation inside platform profiles', () => {
    const source = readSource('./upstreamEndpoint.ts');
    expect(source).not.toContain('buildCodexRuntimeHeaders(');
    expect(source).not.toContain('shouldInjectDerivedPromptCacheKey');
  });

  it('keeps codex responses normalization behind transformer helpers', () => {
    const source = readSource('./upstreamEndpoint.ts');
    expect(source).toContain("from '../../services/upstreamRequestBuilder.js'");
    expect(source).not.toContain('function ensureCodexResponsesInstructions(');
    expect(source).not.toContain('function ensureCodexResponsesStoreFalse(');
    expect(source).not.toContain('function stripCodexUnsupportedResponsesFields(');
    expect(source).not.toContain('function applyCodexResponsesCompatibility(');
  });

  it('keeps endpoint runtime snapshot helper out of the route layer', () => {
    const source = readSource('./upstreamEndpoint.ts');
    expect(source).not.toContain('function getUpstreamEndpointRuntimeStateSnapshot(');
    expect(source).not.toContain('export function getUpstreamEndpointRuntimeStateSnapshot(');
  });

  it('keeps endpoint flow orchestration owned by proxy-core instead of the route layer', () => {
    const source = readSource('./endpointFlow.ts');
    expect(source).toContain("from '../../proxy-core/orchestration/endpointFlow.js'");
    expect(source).not.toContain('async function runEndpointFlowHook<');
    expect(source).not.toContain('export async function executeEndpointFlow(');
  });

  it('keeps Fastify endpoint registration out of the protocol adapter contract', () => {
    const adapterTypesSource = readSource('../../proxy-core/formats/types.ts');
    const routerSource = readSource('./router.ts');
    const surfaceRegistrarSource = readSource('../../proxy-core/surfaces/downstreamProtocolSurface.ts');

    expect(adapterTypesSource).not.toContain("from 'fastify'");
    expect(adapterTypesSource).not.toMatch(/\bregister\s*\(/);
    expect(routerSource).toContain("from '../../proxy-core/surfaces/downstreamProtocolSurface.js'");
    expect(surfaceRegistrarSource).toContain('registerDownstreamProtocolSurface(');
    expect(surfaceRegistrarSource).toContain('handleGenericSurfaceRequest(');
  });

  it('keeps protocol adapters free of HTTP registration, routing, runtime dispatch, and proxy logging', () => {
    const formatSources = listSources('../../proxy-core/formats/');
    for (const { path, source } of formatSources) {
      expect(source, path).not.toContain("from 'fastify'");
      expect(source, path).not.toContain('services/tokenRouter.js');
      expect(source, path).not.toContain('services/runtimeDispatch.js');
      expect(source, path).not.toContain('services/proxyLogStore.js');
      expect(source, path).not.toContain('services/proxyLogMessage.js');
      expect(source, path).not.toMatch(/\bapp\.(?:get|post|put|delete|patch)\s*\(/);
    }
  });

  it('keeps proxy-core surfaces as HTTP registration and request parsing adapters', () => {
    const surfaceSources = listSources('../../proxy-core/surfaces/');
    for (const { path, source } of surfaceSources) {
      expect(source, path).not.toContain('services/tokenRouter.js');
      expect(source, path).not.toContain('services/runtimeDispatch.js');
      expect(source, path).not.toContain('services/proxyLogStore.js');
      expect(source, path).not.toContain('services/proxyLogMessage.js');
      expect(source, path).not.toContain('orchestration/endpointFlow.js');
      expect(source, path).not.toMatch(/from ['"][^'"]*transformers\//);
    }
  });

  it('keeps protocol-specific orchestration out of proxy-core orchestration modules', () => {
    const allowedOwners = new Set([
      'genericProxyOrchestrator.ts',
      'sharedProxyOrchestration.ts',
      'endpointFlow.ts',
      'modelListOrchestrator.ts',
      'responsesWebsocketFlow.ts',
    ]);
    const orchestrationSources = listSources('../../proxy-core/orchestration/');
    for (const { path, source } of orchestrationSources) {
      if (allowedOwners.has(path)) continue;
      expect(source, path).not.toContain('services/tokenRouter.js');
      expect(source, path).not.toContain('services/runtimeDispatch.js');
      expect(source, path).not.toContain('services/proxyLogStore.js');
      expect(source, path).not.toContain('services/proxyLogMessage.js');
      expect(source, path).not.toContain('executeEndpointFlow(');
      expect(source, path).not.toContain('runWithSiteApiEndpointPool(');
    }
  });

  it('keeps protocol payload field inspection out of generic proxy orchestration', () => {
    const source = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');
    expect(source).not.toContain('encrypted_content');
    expect(source).not.toContain('reasoning_signature');
    expect(source).not.toContain('hasResponsesReasoningRequest');
    expect(source).not.toContain('carriesResponsesReasoningContinuity');
    expect(source).not.toContain('summarizeConversationFileInputsInResponsesBody');
    expect(source).not.toContain('summarizeConversationFileInputsInOpenAiBody');
    expect(source).not.toContain('carriesResponsesFileUrlInput');
  });

  it('keeps responses websocket payload merge semantics behind the protocol adapter facade', () => {
    const source = readSource('../../proxy-core/orchestration/responsesWebsocketFlow.ts');
    expect(source).toContain('protocolAdapters.responses.websocket.normalizeRequest(');
    expect(source).toContain('protocolAdapters.responses.websocket.collectOutput(');
    expect(source).not.toContain('next.input =');
    expect(source).not.toContain('parsed.input');
    expect(source).not.toContain('lastRequest.input');
    expect(source).not.toContain('payload.response.output');
    expect(source).not.toContain('payload.output_text');
  });

  it('keeps gemini runtime closure behind the gemini protocol adapter', () => {
    const adapterSource = readSource('../../proxy-core/formats/gemini.ts');
    expect(adapterSource).toContain('geminiGenerateContentTransformer.stream.consumeUpstreamSseBuffer(');
    expect(adapterSource).toContain('geminiGenerateContentTransformer.outbound.serializeAggregateResponse(');
  });

  it('keeps proxy file persistence out of files route', () => {
    const source = readSource('./files.ts');
    expect(source).toContain("from '../../proxy-core/surfaces/filesSurface.js'");
    expect(source).not.toContain('saveProxyFile(');
    expect(source).not.toContain('listProxyFilesByOwner(');
    expect(source).not.toContain('getProxyFileByPublicIdForOwner(');
    expect(source).not.toContain('getProxyFileContentByPublicIdForOwner(');
    expect(source).not.toContain('softDeleteProxyFileByPublicIdForOwner(');
  });

  it('keeps chat stream lifecycle behind transformer-owned facade', () => {
    const surfaceSource = readSource('../../proxy-core/formats/openaiChat.ts');
    expect(surfaceSource).not.toContain("from '../../transformers/shared/protocolLifecycle.js'");
    expect(surfaceSource).not.toContain('createProxyStreamLifecycle');
    expect(surfaceSource).toContain('openAiChatTransformer.proxyStream.createSession(');
  });

  it('keeps responses stream lifecycle behind transformer-owned facade', () => {
    const source = readSource('./responses.ts');
    const surfaceSource = readSource('../../proxy-core/formats/responses.ts');
    expect(source).not.toContain("from '../../transformers/shared/protocolLifecycle.js'");
    expect(source).not.toContain('createProxyStreamLifecycle');
    expect(source).not.toContain('const consumeSseBuffer = (incoming: string): string => {');
    expect(source).not.toContain('reply.raw.end();');
    expect(surfaceSource).toContain('openAiResponsesTransformer.proxyStream.createSession(');
  });

  it('keeps oauth refresh recovery and success bookkeeping behind shared surface helpers', () => {
    const surfaceSource = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');

    expect(surfaceSource).toContain('trySurfaceOauthRefreshRecovery(');
    expect(surfaceSource).toContain('recordSurfaceSuccess(');
    expect(surfaceSource).not.toContain('refreshOauthAccessTokenSingleflight(');
    expect(surfaceSource).not.toContain('resolveProxyUsageWithSelfLogFallback(');
    expect(surfaceSource).not.toContain('resolveProxyLogBilling(');
    expect((surfaceSource.match(/bestEffortMetrics:/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps canonical transformer contracts out of route adapters', () => {
    const responsesSource = readSource('./responses.ts');
    expect(responsesSource).not.toContain("from '../proxy-core/");
    expect(responsesSource).not.toContain("from '../../transformers/contracts.js'");
    expect(responsesSource).not.toContain("from '../../transformers/canonical/");
  });
});
