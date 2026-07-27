export type SelectedExecutionAttemptLike = {
  target: { id: number };
  site: Record<string, unknown>;
  account: Record<string, unknown>;
  tokenName?: string;
  tokenValue?: string;
  actualModel?: string;
};

export type AttemptSuccess = {
  ok: true;
  response: Response;
  latencyMs?: number | null;
  cost?: number | null;
};

export type AttemptFailureAction =
  | 'retry_same_target'
  | 'refresh_auth'
  | 'failover'
  | 'terminal'
  | 'stop';

export type AttemptFailure = {
  ok: false;
  action: AttemptFailureAction;
  status?: number;
  rawErrorText?: string;
  error?: unknown;
};

export type AttemptResult = AttemptSuccess | AttemptFailure;

export type ExecuteAttemptContext = {
  selected: SelectedExecutionAttemptLike;
  attemptIndex: number;
  excludeTargetIds: number[];
};

export type ProxyConductorDependencies = {
  selectExecutionAttempt: (requestedModel: string, downstreamPolicy?: unknown) => Promise<SelectedExecutionAttemptLike | null>;
  previewExecutionAttempt?: (requestedModel: string, downstreamPolicy?: unknown) => Promise<SelectedExecutionAttemptLike | null>;
  selectNextExecutionAttempt: (
    requestedModel: string,
    excludeTargetIds: number[],
    downstreamPolicy?: unknown,
  ) => Promise<SelectedExecutionAttemptLike | null>;
  recordSuccess?: (targetId: number, metrics: { latencyMs: number | null; cost: number | null }) => Promise<void> | void;
  recordFailure?: (targetId: number, failure: { status?: number; rawErrorText?: string }) => Promise<void> | void;
  refreshAuth?: (
    selected: SelectedExecutionAttemptLike,
    failure: { status?: number; rawErrorText?: string },
  ) => Promise<SelectedExecutionAttemptLike | null>;
};

export type ExecuteInput = {
  requestedModel: string;
  downstreamPolicy?: unknown;
  attempt: (context: ExecuteAttemptContext) => Promise<AttemptResult>;
  onTerminalFailure?: (
    selected: SelectedExecutionAttemptLike,
    failure: { status?: number; rawErrorText?: string },
  ) => Promise<void> | void;
};

export type ExecuteResult =
  | {
    ok: true;
    selected: SelectedExecutionAttemptLike;
    response: Response;
    attempts: number;
  }
  | {
    ok: false;
    reason: 'no_target' | 'failed' | 'terminal';
    selected?: SelectedExecutionAttemptLike;
    status?: number;
    rawErrorText?: string;
    attempts: number;
  };
