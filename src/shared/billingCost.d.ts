export type BillingObservationGrain = 'request' | 'attempt';
export type BillingCostBucketKind = 'day' | 'hour';
export type BillingCostSubjectKind =
  | 'site'
  | 'account'
  | 'model'
  | 'entry'
  | 'endpoint'
  | 'execution_attempt'
  | 'downstream_key';

export type BillingCostAmount = {
  amount: number;
  unit: 'currency' | 'quota';
  currency: string | null;
  source: string;
  sourceId: string | null;
  estimateLevel: string | null;
  planFingerprint: string | null;
  observationCount: number;
};

export type BillingCostSummary = {
  amounts: BillingCostAmount[];
  knownObservationCount: number;
  unknownObservationCount: number;
};

export type BaseCostSummary = {
  amount: number;
  unit: string;
  knownObservationCount: number;
  unknownObservationCount: number;
  incompatibleObservationCount: number;
};
