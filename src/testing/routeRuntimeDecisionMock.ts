function completeExecutionAttemptForTest<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const attempt = value as Record<string, any>;
  if (typeof attempt.executionAttemptId !== 'string' || !attempt.executionAttemptId) {
    throw new Error('Test execution attempt must provide an opaque executionAttemptId');
  }
  if (!Number.isSafeInteger(attempt.executionTargetId) || attempt.executionTargetId <= 0) {
    throw new Error('Test execution attempt must provide an executionTargetId');
  }
  const routeEntrypointId = attempt.routeEntrypointId || 'test-entry';
  const runtimeEndpointId = attempt.runtimeEndpointId || 'test-endpoint';
  const runtimeArtifactId = attempt.runtimeArtifactId || 'test-runtime-artifact';
  const existingSnapshot = attempt.routeRuntimeSnapshot || {};
  return {
    ...attempt,
    routeEntrypointId,
    runtimeEndpointId,
    runtimeArtifactId,
    routeRuntimeSnapshot: {
      compiledRuntime: {
        runtimeArtifactId,
        bundleHash: null,
        program: null,
        ...(existingSnapshot.compiledRuntime || {}),
      },
      match: existingSnapshot.match || {
        requestedModel: null,
        actualModel: attempt.actualModel || null,
        planId: null,
        entryId: routeEntrypointId,
        publicModelName: null,
        terminalKind: 'endpoint',
      },
      metadata: existingSnapshot.metadata || {
        graph: null,
        plan: null,
        selection: null,
        endpoint: null,
        executionAttempt: null,
      },
      endpoint: existingSnapshot.endpoint || {
        endpointId: runtimeEndpointId,
        executionTargetId: attempt.executionTargetId,
        compatibilityPolicy: null,
      },
      executionAttempt: existingSnapshot.executionAttempt || {
        executionAttemptId: attempt.executionAttemptId,
        model: attempt.actualModel || null,
        executionTargetId: attempt.executionTargetId,
        accountId: attempt.account?.id ?? null,
        tokenId: attempt.token?.id ?? null,
        siteId: attempt.site?.id ?? null,
        credential: null,
      },
      requestUsage: existingSnapshot.requestUsage || { inputBytes: null, maxOutputTokens: null },
      state: existingSnapshot.state || {
        failureOverlay: { disabledExecutionAttemptIds: [], disabledExecutionTargetIds: [] },
        executionAttemptState: null,
      },
      filters: existingSnapshot.filters || { endpointPreference: null, postBuild: null },
      syntheticResponse: existingSnapshot.syntheticResponse || null,
    },
  } as T;
}

export async function executionDecisionFrom<T>(
  selector: (input: any) => T | Promise<T>,
  input: any,
): Promise<{ kind: 'execution_attempt'; attempt: NonNullable<Awaited<T>> } | null> {
  const attempt = await selector(input);
  return attempt == null
    ? null
    : {
      kind: 'execution_attempt',
      attempt: completeExecutionAttemptForTest(attempt) as NonNullable<Awaited<T>>,
    };
}

export function executionDecisionFromTargetMocks(
  input: any,
  selectPrimary: (...args: any[]) => any,
  selectNext?: (...args: any[]) => any,
) {
  const excluded = Array.isArray(input?.disabledExecutionTargetIds) ? input.disabledExecutionTargetIds : [];
  return executionDecisionFrom(
    () => excluded.length > 0 && selectNext
      ? selectNext(input.requestedModel, excluded, input.downstreamPolicy)
      : selectPrimary(input?.requestedModel, input?.downstreamPolicy),
    input,
  );
}
