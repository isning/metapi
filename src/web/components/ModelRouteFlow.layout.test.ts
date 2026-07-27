import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { create } from 'react-test-renderer';
import ModelRouteFlow, { buildRuntimeGraphViewModel, type ModelRouteFlowData } from './ModelRouteFlow.js';
import { tr } from '../i18n.js';

function buildFlow(): ModelRouteFlowData {
  return {
    requestedModel: 'gpt-test',
    matched: true,
    diagnostics: [],
    projectedAt: '2026-07-02T00:00:00.000Z',
    compiledRuntime: {
      runtimeRef: {
        artifactId: 'runtime-artifact-7',
        bundleHash: 'bundle-hash',
      },
      match: {
        requestedModel: 'gpt-test',
        planId: 'plan:gpt-test',
        entryNodeId: 'entry:gpt-test',
        publicModelName: 'gpt-test',
      },
      alternatives: [{
        alternativeId: 'alt:a',
        kind: 'execution_attempt',
        enabled: true,
        endpointId: 'endpoint:a',
        nodeId: 'node:endpoint',
        model: 'gpt-test',
        executionAttemptIds: ['ea_25'],
        selectionTerms: [{
          termId: 'term:execution-attempt',
          optionId: 'ea_25',
          mode: 'execution_attempt',
          policy: {
            source: 'builtin',
            id: 'weighted',
            kind: 'builtin',
            selectionMode: 'weighted',
          },
          enabled: true,
          weight: 10,
          order: 0,
        }],
        fallbackStages: [{
          fallbackId: 'fallback:primary',
          stageId: 'primary',
          stageIndex: 0,
          nodeId: 'dispatcher:primary',
          selected: true,
        }],
        probability: 1,
        probabilityStatus: 'static',
        syntheticResponse: null,
      }],
      endpoints: [{
        endpointId: 'endpoint:a',
        nodeId: 'node:endpoint',
        alternativeIds: ['alt:a'],
        executionAttemptIds: ['ea_25'],
      }],
      executionAttempts: [{
        executionAttemptId: 'ea_25',
        alternativeId: 'alt:a',
        endpointId: 'endpoint:a',
        nodeId: 'node:endpoint',
        executionTargetId: 25,
        model: 'gpt-test',
        modelSource: 'fixed',
        enabled: true,
        siteId: 1,
        siteName: 'site-a',
        siteUrl: 'https://site-a.example.com',
        sitePlatform: 'openai',
        accountId: 12,
        accountLabel: 'tester',
        tokenId: 34,
        tokenLabel: 'default',
        tokenGroup: null,
        weight: 10,
        probability: 1,
        probabilityStatus: 'static',
        health: {
          successRate: 0.98,
          totalCalls: 120,
          avgLatencyMs: 345,
          cooldownUntil: null,
          consecutiveFailureCount: 0,
        },
        routingSignals: {
          referencePricing: {
            scenario: 'routing_reference',
            source: 'wallet_acquisition',
            rawCost: 0.2,
            effectiveCost: 0.2,
            baseCostUnit: 'USD',
          },
        },
        apiAttempts: [{
          apiAttemptId: 'api-attempt:chat',
          order: 0,
          apiType: 'openai_chat_completions',
          upstreamEndpoint: 'chat',
          requestMethod: 'POST',
          requestUrl: 'https://site-a.example.com/v1/chat/completions',
          adapterId: 'openai_chat_completions',
          credentialEndpointBindingId: 'binding:chat',
          apiEndpointProfileId: 'profile:chat',
          downgradeAllowed: true,
          reason: ['derived_endpoint_order'],
        }, {
          apiAttemptId: 'api-attempt:responses',
          order: 1,
          apiType: 'openai_responses',
          upstreamEndpoint: 'responses',
          requestMethod: 'POST',
          requestUrl: 'https://site-a.example.com/v1/responses',
          adapterId: 'openai_responses',
          credentialEndpointBindingId: 'binding:responses',
          apiEndpointProfileId: 'profile:responses',
          downgradeAllowed: true,
          reason: ['credential_binding_supported'],
        }],
        apiAttemptDiagnostics: [],
      }],
      selected: {
        alternativeId: 'alt:a',
        endpointId: 'endpoint:a',
        executionAttemptId: 'ea_25',
        accountId: 12,
        tokenId: 34,
        siteId: 1,
        actualModel: 'gpt-test',
        selectionSource: 'compiled_runtime',
      },
      filters: {
        preSelectionApplied: [],
        postBuild: [],
      },
      syntheticResponse: null,
    },
    entryPricing: {
      theoretical: {
        currency: 'USD',
        inputPerMillion: 1.25,
        outputPerMillion: 10,
        cacheReadPerMillion: 0.25,
        cacheWritePerMillion: null,
        reasoningPerMillion: 0.5,
        requestCost: 0.0001,
        totalCost: 0.00042,
        inputMultiplier: 1,
        outputMultiplier: 1,
        totalMultiplier: 1,
        components: [
          { componentId: 'input', kind: 'input_tokens', quantity: 100, scale: 1000000, currency: 'USD', unitPrice: 1.25, cost: 0.000125, role: 'charge' },
          { componentId: 'output', kind: 'output_tokens', quantity: 20, scale: 1000000, currency: 'USD', unitPrice: 10, cost: 0.0002, role: 'charge' },
          { componentId: 'cache_read', kind: 'cache_read_tokens', quantity: 50, scale: 1000000, currency: 'USD', unitPrice: 0.25, cost: 0.0000125, role: 'charge' },
          { componentId: 'reasoning', kind: 'reasoning_tokens', quantity: 5, scale: 1000000, currency: 'USD', unitPrice: 0.5, cost: 0.0000025, role: 'charge' },
          { componentId: 'request', kind: 'request', quantity: 1, scale: 1, currency: 'USD', unitPrice: 0.0001, cost: 0.0001, role: 'charge' },
        ],
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 50,
          reasoningTokens: 5,
          requestCount: 1,
        },
        reference: {
          currency: 'USD',
          inputPerMillion: 1.25,
          outputPerMillion: 10,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: 0.00042,
        },
        effectiveCost: {
          walletCostBaseCurrency: 0.000084,
          baseCostUnit: 'USD',
          freeQuotaDaysCost: null,
          balanceBurn: [{ unit: 'USD', amount: 0.00042 }],
          estimateLevel: 'exact',
          diagnostics: [],
        },
        sourceCount: 1,
        estimateLevel: 'exact',
        selectionMode: 'weighted',
        diagnostics: [],
        executionAttempts: [{
          executionAttemptId: 'ea_25',
          endpointId: 'endpoint:a',
          nodeId: 'node:endpoint',
          siteId: 1,
          accountId: 12,
          tokenId: 34,
          modelName: 'gpt-test',
          probability: 1,
          weight: 10,
          currency: 'USD',
          inputPerMillion: 1.25,
          outputPerMillion: 10,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: null,
          reasoningPerMillion: 0.5,
          requestCost: 0.0001,
          totalCost: 0.00042,
          components: [
            { componentId: 'input', kind: 'input_tokens', quantity: 100, scale: 1000000, currency: 'USD', unitPrice: 1.25, cost: 0.000125, role: 'charge' },
            { componentId: 'output', kind: 'output_tokens', quantity: 20, scale: 1000000, currency: 'USD', unitPrice: 10, cost: 0.0002, role: 'charge' },
            { componentId: 'cache_read', kind: 'cache_read_tokens', quantity: 50, scale: 1000000, currency: 'USD', unitPrice: 0.25, cost: 0.0000125, role: 'charge' },
            { componentId: 'reasoning', kind: 'reasoning_tokens', quantity: 5, scale: 1000000, currency: 'USD', unitPrice: 0.5, cost: 0.0000025, role: 'charge' },
            { componentId: 'request', kind: 'request', quantity: 1, scale: 1, currency: 'USD', unitPrice: 0.0001, cost: 0.0001, role: 'charge' },
          ],
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 50,
            reasoningTokens: 5,
            requestCount: 1,
          },
          resolution: {
            source: 'manual_binding',
            sourceId: 1,
            matchedScope: 'model',
            sourceType: 'user',
            planFingerprint: 'plan',
            estimateLevel: 'exact',
            summary: {
              currency: 'USD',
              inputPerMillion: 1.25,
              outputPerMillion: 10,
              cacheReadPerMillion: 0.25,
              cacheWritePerMillion: null,
              reasoningPerMillion: 0.5,
              requestCost: 0.0001,
              totalCost: 0.00042,
            },
            evaluation: {
              catalogEntryId: 'catalog:gpt-test',
              source: 'user_override',
              usageHash: 'usage-hash',
              planFingerprint: 'plan',
              currency: 'USD',
              totalCost: 0.00042,
              subtotalCost: 0.00052,
              adjustmentCost: -0.0001,
              estimateLevel: 'exact',
              components: [
                { componentId: 'input', kind: 'input_tokens', quantity: 100, scale: 1000000, currency: 'USD', unitPrice: 1.25, cost: 0.000125, role: 'charge' },
                { componentId: 'output', kind: 'output_tokens', quantity: 20, scale: 1000000, currency: 'USD', unitPrice: 10, cost: 0.0002, role: 'charge' },
                { componentId: 'tool-call', kind: 'tool_call', quantity: 2, scale: 1, currency: 'USD', unitPrice: 0.03, cost: 0.06, role: 'charge', tierId: 'tier-tools', quantityPricingMode: 'graduated_tier', allowanceApplied: 1, overlayIds: ['overlay-tools'] },
                { componentId: 'promo-credit', kind: 'custom', quantity: 1, scale: 1, currency: 'USD', unitPrice: 0.5, cost: -0.5, role: 'discount', overlayIds: ['promo'] },
              ],
              postProcessors: [{ id: 'rounding', kind: 'rounding_adjustment', currency: 'USD', amount: -0.0001 }],
              equivalentMultipliers: { input: 1, output: 1 },
              diagnostics: [],
            },
            diagnostics: [],
          },
          reference: null,
          effectiveCost: {
            walletCostBaseCurrency: 0.000084,
            baseCostUnit: 'USD',
            freeQuotaDaysCost: null,
            balanceBurn: [{ unit: 'USD', amount: 0.00042 }],
            estimateLevel: 'exact',
          },
          comparison: {
            inputMultiplier: 1,
            outputMultiplier: 1,
            totalMultiplier: 1,
          },
          quoteDiagnostics: [],
          pricingId: 1,
          matchedScope: 'model',
          sourceRef: {
            endpointId: 'endpoint:a',
            nodeId: 'node:endpoint',
          },
        }],
      },
    },
  };
}

function collectText(node: any): string {
  return (node?.children || []).map((child: any) => (
    typeof child === 'string' ? child : collectText(child)
  )).join('');
}

function buildDynamicProbabilityFlow(): ModelRouteFlowData {
  const flow = buildFlow();
  const alternative = flow.compiledRuntime!.alternatives[0]!;
  const attempt = flow.compiledRuntime!.executionAttempts[0]!;
  alternative.probability = null;
  alternative.probabilityStatus = 'dynamic';
  attempt.probability = null;
  attempt.probabilityStatus = 'dynamic';
  flow.entryPricing!.theoretical!.executionAttempts[0]!.probability = null;
  flow.entryPricing!.theoretical!.estimateLevel = 'incomplete';
  return flow;
}

function buildUnequalProbabilityFlow(): ModelRouteFlowData {
  const flow = buildFlow();
  const runtime = flow.compiledRuntime!;
  const alternativeA = runtime.alternatives[0]!;
  const attemptA = runtime.executionAttempts[0]!;
  const pricingA = flow.entryPricing!.theoretical!.executionAttempts[0]!;
  alternativeA.probability = 0.75;
  attemptA.probability = 0.75;
  attemptA.routingSignals = {
    ...attemptA.routingSignals,
    probability: 0.75,
  };
  pricingA.probability = 0.75;

  runtime.alternatives.push({
    ...alternativeA,
    alternativeId: 'alt:b',
    endpointId: 'endpoint:b',
    nodeId: 'node:endpoint:b',
    model: 'gpt-test-b',
    executionAttemptIds: ['ea_26'],
    selectionTerms: alternativeA.selectionTerms.map((term) => ({
      ...term,
      optionId: 'ea_26',
      weight: 1,
      order: 1,
    })),
    probability: 0.25,
    probabilityStatus: 'static',
  });
  runtime.endpoints.push({
    endpointId: 'endpoint:b',
    nodeId: 'node:endpoint:b',
    alternativeIds: ['alt:b'],
    executionAttemptIds: ['ea_26'],
  });
  runtime.executionAttempts.push({
    ...attemptA,
    executionAttemptId: 'ea_26',
    alternativeId: 'alt:b',
    endpointId: 'endpoint:b',
    nodeId: 'node:endpoint:b',
    executionTargetId: 26,
    model: 'gpt-test-b',
    siteId: 2,
    siteName: 'site-b',
    accountId: 13,
    accountLabel: 'backup',
    tokenId: 35,
    tokenLabel: 'fallback',
    weight: 1,
    probability: 0.25,
    routingSignals: {
      ...attemptA.routingSignals,
      referencePricing: {
        scenario: 'routing_reference',
        source: 'wallet_acquisition',
        rawCost: 0.6,
        effectiveCost: 0.6,
        baseCostUnit: 'USD',
      },
      probability: 0.25,
    },
  });
  flow.entryPricing!.theoretical!.sourceCount = 2;
  flow.entryPricing!.theoretical!.executionAttempts.push({
    ...pricingA,
    executionAttemptId: 'ea_26',
    endpointId: 'endpoint:b',
    nodeId: 'node:endpoint:b',
    siteId: 2,
    accountId: 13,
    tokenId: 35,
    modelName: 'gpt-test-b',
    probability: 0.25,
  });
  return flow;
}

describe('ModelRouteFlow compiled runtime view', () => {
  it('renders a flattened compiled runtime map with terminal outcome nodes', () => {
    const flow = buildFlow();
    const viewModel = buildRuntimeGraphViewModel(flow);
    const rendered = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    const text = collectText(rendered.root);

    expect(viewModel?.nodes.map((node) => node.kind)).toEqual([
      'request',
      'matchedPlan',
      'alternative',
      'executionTerminal',
      'apiAttempt',
      'apiAttempt',
    ]);
    expect(viewModel?.nodes.find((node) => node.kind === 'executionTerminal')).toMatchObject({
      endpointId: 'endpoint:a',
      executionAttemptId: 'ea_25',
    });
    expect(viewModel?.nodes.filter((node) => node.kind === 'apiAttempt').map((node) => node.apiAttemptId)).toEqual([
      'api-attempt:chat',
      'api-attempt:responses',
    ]);
    expect(text).toContain('plan:gpt-test');
    expect(text).not.toContain('entry:gpt-test');
    expect(text).toContain('endpoint:a');
    expect(text).toContain('tester @ site-a / default');
    expect(text).toContain('USD 0.25');
    expect(text).toContain('USD 10');
    expect(text).toContain('USD 0.000084');
    expect(text).toContain('chat · openai_chat_completions');
    expect(text).toContain('responses · openai_responses');
    expect(rendered.root.findAllByProps({ 'data-testid': 'compiled-runtime-map' })).toHaveLength(1);
    expect(text).not.toContain('Dispatcher arg');

    rendered.unmount();
  });

  it('renders concrete compiled-runtime probabilities instead of equal placeholders', () => {
    const flow = buildUnequalProbabilityFlow();
    const viewModel = buildRuntimeGraphViewModel(flow);
    const alternativeBadges = viewModel?.nodes
      .filter((node) => node.kind === 'alternative')
      .flatMap((node) => node.badges.map((badge) => badge.label));

    expect(alternativeBadges).toEqual(expect.arrayContaining(['75%', '25%']));

    const runtimeView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    const runtimeText = collectText(runtimeView.root);
    expect(runtimeText).toContain('75%');
    expect(runtimeText).toContain('25%');
    runtimeView.unmount();

    const attemptsView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    const attemptsText = collectText(attemptsView.root);
    expect(attemptsText).toContain('75%');
    expect(attemptsText).toContain('25%');
    attemptsView.unmount();
  });

  it('shows actual cost with raw pricing detail when token pricing is unavailable', () => {
    const flow = buildFlow();
    const pricing = flow.entryPricing!.theoretical!;
    pricing.inputPerMillion = null;
    pricing.outputPerMillion = null;
    pricing.totalCost = null;
    pricing.executionAttempts[0]!.inputPerMillion = null;
    pricing.executionAttempts[0]!.outputPerMillion = null;
    pricing.executionAttempts[0]!.totalCost = null;
    pricing.executionAttempts[0]!.matchedScope = null;

    const viewModel = buildRuntimeGraphViewModel(flow);
    const terminal = viewModel?.nodes.find((node) => node.kind === 'executionTerminal');
    const actualCost = 'USD 0.000084';

    expect(terminal?.metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      tr('components.modelRouteFlow.input'),
      tr('components.modelRouteFlow.output'),
      tr('components.modelRouteFlow.total'),
    ]));

    const runtimeView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    expect(collectText(runtimeView.root)).toContain(actualCost);
    expect(collectText(runtimeView.root)).toContain(tr('components.modelRouteFlow.originalPrice'));
    expect(collectText(runtimeView.root)).not.toContain(tr('components.modelRouteFlow.costSourceConfigured'));
    expect(collectText(runtimeView.root)).not.toContain('路由成本信号');
    runtimeView.unmount();

    const pricingView = create(createElement(ModelRouteFlow, { flow, viewMode: 'cost' }));
    expect(collectText(pricingView.root)).toContain(actualCost);
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.originalPrice'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.cacheRead'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.weightedPreviewCost'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.weightedCostDescription'));
    expect(collectText(pricingView.root)).not.toContain('100 tokens');
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.reasoning'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.requestFee'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.toolCall'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.customPricingComponent'));
    expect(collectText(pricingView.root)).toContain(tr('components.modelRouteFlow.pricingRoleDiscount'));
    expect(collectText(pricingView.root)).toContain('tier-tools');
    expect(collectText(pricingView.root)).toContain('graduated_tier');
    expect(collectText(pricingView.root)).toContain('overlay-tools');
    expect(collectText(pricingView.root)).toContain('promo');
    expect(collectText(pricingView.root)).not.toContain(tr('components.modelRouteFlow.costSourceConfigured'));
    expect(collectText(pricingView.root)).not.toContain('路由成本信号');
    pricingView.unmount();
  });

  it('renders compact mode as a bounded embedded runtime summary', () => {
    const rendered = create(createElement(ModelRouteFlow, { flow: buildFlow(), compact: true }));
    const text = collectText(rendered.root);

    expect(text).toContain('tester @ site-a / default');
    expect(text).toContain('gpt-test');
    expect(rendered.root.findAll((item) => (
      typeof item.props.className === 'string'
      && item.props.className.includes('w-full min-w-0 max-w-full overflow-hidden')
    )).length).toBeGreaterThan(0);

    rendered.unmount();
  });

  it('keeps the compiled runtime visible while route flow refresh is pending', () => {
    const rendered = create(createElement(ModelRouteFlow, { flow: buildFlow(), loading: true, viewMode: 'execution' }));
    const text = collectText(rendered.root);

    expect(text).toContain('gpt-test');
    expect(text).toContain('tester @ site-a / default');
    expect(text).not.toContain(tr('common.loading'));

    rendered.unmount();
  });

  it('renders dynamic runtime probabilities instead of dropping them to N/A', () => {
    const flow = buildDynamicProbabilityFlow();
    const dynamicProbability = tr('components.modelRouteFlow.dynamicProbability');
    const viewModel = buildRuntimeGraphViewModel(flow);

    expect(viewModel?.nodes.find((node) => node.kind === 'alternative')?.badges).toContainEqual(
      expect.objectContaining({ label: dynamicProbability }),
    );
    expect(viewModel?.edges.find((edge) => edge.from.includes('matchedPlan') && edge.to.includes('alternative'))?.label)
      .toBe(dynamicProbability);

    const runtimeView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    expect(collectText(runtimeView.root)).toContain(dynamicProbability);
    runtimeView.unmount();

    const alternativesView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    expect(collectText(alternativesView.root)).toContain(dynamicProbability);
    alternativesView.unmount();

    const attemptsView = create(createElement(ModelRouteFlow, { flow, viewMode: 'execution' }));
    expect(collectText(attemptsView.root)).toContain(dynamicProbability);
    attemptsView.unmount();

    const pricingView = create(createElement(ModelRouteFlow, { flow, viewMode: 'cost' }));
    expect(collectText(pricingView.root)).toContain(dynamicProbability);
    pricingView.unmount();
  });
});
