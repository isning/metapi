import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type EndpointModelObservationStatus = 'confirmed' | 'rejected' | 'transient_failure';
export type EndpointModelObservationSource = 'runtime' | 'manual_test' | 'catalog_refresh';

export async function recordEndpointModelObservation(input: {
  siteId: number;
  credentialKey: string;
  apiEndpointProfileId: string | number | null | undefined;
  modelName: string;
  status: EndpointModelObservationStatus;
  failureClass?: string | null;
  source?: EndpointModelObservationSource;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const profileId = Number(input.apiEndpointProfileId);
  const modelName = String(input.modelName || '').trim();
  const credentialKey = String(input.credentialKey || '').trim();
  if (!Number.isInteger(profileId) || profileId <= 0 || !modelName || !credentialKey) {
    return;
  }

  const now = new Date().toISOString();
  await db.transaction(async (tx: any) => {
    await tx.delete(schema.endpointModelObservations)
      .where(and(
        eq(schema.endpointModelObservations.siteId, input.siteId),
        eq(schema.endpointModelObservations.credentialKey, credentialKey),
        eq(schema.endpointModelObservations.apiEndpointProfileId, profileId),
        eq(schema.endpointModelObservations.modelName, modelName),
      ))
      .run();
    await tx.insert(schema.endpointModelObservations).values({
      siteId: input.siteId,
      credentialKey,
      apiEndpointProfileId: profileId,
      modelName,
      status: input.status,
      failureClass: input.failureClass ?? null,
      source: input.source || 'runtime',
      observedAt: now,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    }).run();
  });
}

export function classifyEndpointObservationFailure(input: {
  status: number;
  errorText?: string | null;
}): {
  status: EndpointModelObservationStatus;
  failureClass: string;
} {
  const status = Number(input.status || 0);
  const lowered = String(input.errorText || '').toLowerCase();
  if (
    status === 400
    || status === 404
    || lowered.includes('not support')
    || lowered.includes('unsupported')
    || lowered.includes('unknown url')
    || lowered.includes('invalid endpoint')
  ) {
    return {
      status: 'rejected',
      failureClass: 'protocol_or_model_rejected',
    };
  }
  return {
    status: 'transient_failure',
    failureClass: status >= 500 ? 'upstream_transient' : 'request_failed',
  };
}
