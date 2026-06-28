export type SelectedTargetLike = {
  target: { id: number; routeId?: number };
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
  selected: SelectedTargetLike;
  attemptIndex: number;
  excludeTargetIds: number[];
};

export type ProxyConductorDependencies = {
  selectTarget: (requestedModel: string, downstreamPolicy?: unknown) => Promise<SelectedTargetLike | null>;
  previewSelectedTarget?: (requestedModel: string, downstreamPolicy?: unknown) => Promise<SelectedTargetLike | null>;
  selectNextTarget: (
    requestedModel: string,
    excludeTargetIds: number[],
    downstreamPolicy?: unknown,
  ) => Promise<SelectedTargetLike | null>;
  recordSuccess?: (targetId: number, metrics: { latencyMs: number | null; cost: number | null }) => Promise<void> | void;
  recordFailure?: (targetId: number, failure: { status?: number; rawErrorText?: string }) => Promise<void> | void;
  refreshAuth?: (
    selected: SelectedTargetLike,
    failure: { status?: number; rawErrorText?: string },
  ) => Promise<SelectedTargetLike | null>;
};

export type ExecuteInput = {
  requestedModel: string;
  downstreamPolicy?: unknown;
  attempt: (context: ExecuteAttemptContext) => Promise<AttemptResult>;
  onTerminalFailure?: (
    selected: SelectedTargetLike,
    failure: { status?: number; rawErrorText?: string },
  ) => Promise<void> | void;
};

export type ExecuteResult =
  | {
    ok: true;
    selected: SelectedTargetLike;
    response: Response;
    attempts: number;
  }
  | {
    ok: false;
    reason: 'no_target' | 'failed' | 'terminal';
    selected?: SelectedTargetLike;
    status?: number;
    rawErrorText?: string;
    attempts: number;
  };
