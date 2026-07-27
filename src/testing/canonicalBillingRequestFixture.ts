import { db, schema } from '../server/db/index.js';

export function canonicalBillingDetails(amount: number): string {
  return JSON.stringify({
    quote: {
      amount,
      unit: 'currency',
      currency: 'USD',
      source: 'test_fixture',
      sourceId: 'canonical-billing-request-fixture',
      matchedScope: 'test',
      estimateLevel: 'exact',
      planFingerprint: 'sha256:test-fixture',
    },
  });
}

export async function insertCanonicalTerminalRequest(input: {
  id: string;
  siteId: number;
  accountId: number;
  completedAt: string;
  amount: number;
  model?: string;
  status?: 'success' | 'failure';
  latencyMs?: number;
}): Promise<void> {
  const model = input.model || 'test-model';
  await db.insert(schema.proxyRequests).values({
    id: input.id,
    downstreamPath: '/v1/chat/completions',
    requestedModel: model,
    actualModel: model,
    finalSiteId: input.siteId,
    finalAccountId: input.accountId,
    routeEntrypointId: 'test-entry',
    runtimeEndpointId: 'test-endpoint',
    finalExecutionAttemptId: 'test-attempt',
    status: input.status || 'success',
    httpStatus: input.status === 'failure' ? 502 : 200,
    latencyMs: input.latencyMs ?? 0,
    estimatedCost: input.amount,
    billingDetails: canonicalBillingDetails(input.amount),
    completedAt: input.completedAt,
  }).run();
}
