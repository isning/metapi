export type RouteExecutionFailureOverlay = {
  disabledExecutionAttemptIds?: string[];
  disabledExecutionTargetIds?: number[];
};

export type RouteExecutionScope = {
  runtimeArtifactId: string;
  requestedModel: string;
  matchedEntryNodeId: string | null;
  failureOverlay: RouteExecutionFailureOverlay;
};
