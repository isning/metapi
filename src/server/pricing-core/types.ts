export type PricingPlanKind = 'rate_card' | 'contract_overlay' | 'composed';
export type PricingCurrency = 'USD';
export type PricingPeriod = 'request' | 'day' | 'month' | 'billing_cycle';

export type PricingComponentRole = 'charge' | 'discount' | 'credit' | 'minimum' | 'maximum';

export type PricingComponentKind =
  | 'input_tokens'
  | 'output_tokens'
  | 'reasoning_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'request'
  | 'tool_call'
  | 'image_input'
  | 'image_output'
  | 'audio_input'
  | 'audio_output'
  | 'video_input'
  | 'embedding_tokens'
  | 'storage'
  | 'custom';

export interface PricingSource {
  type: 'official' | 'provider_catalog' | 'user' | 'system_default';
  url?: string;
  checkedAt?: string;
  notes?: string;
}

export interface PricingAlias {
  alias: string;
  normalizedAlias: string;
  confidence: 'exact' | 'provider_alias' | 'normalized' | 'manual';
  source: 'built_in' | 'provider_catalog' | 'user';
}

export interface PricingCatalogEntry {
  id: string;
  version: string;
  provider: string;
  modelKey: string;
  displayName: string;
  aliases: PricingAlias[];
  status: 'active' | 'deprecated' | 'preview' | 'unknown';
  currency: PricingCurrency;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  source: PricingSource;
  plan: PricingPlan;
  planFingerprint: string;
  metadata: Record<string, unknown>;
}

export interface PricingPlan {
  schemaVersion: 1;
  planKind: PricingPlanKind;
  unitPrecision: 'per_1m' | 'per_1k' | 'per_unit' | 'mixed';
  billingMode: 'token' | 'request' | 'time' | 'asset' | 'mixed';
  aggregation: PricingAggregation;
  rounding: PricingRounding;
  components: PricingComponent[];
  tiers: PricingTier[];
  allowances?: PricingAllowance[];
  commitments?: PricingCommitment[];
  overlays?: PricingOverlay[];
  postProcessors?: PricingPostProcessor[];
  transforms?: PricingTransform[];
}

export interface PricingComponent {
  id: string;
  label: string;
  role: PricingComponentRole;
  kind: PricingComponentKind;
  meter: PricingMeter;
  price: PricingPrice;
  quantityPricing?: QuantityPricing;
  appliesWhen?: PricingCondition;
  tierRef?: string;
  comparisonKey?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface PricingAggregation {
  mode: 'sum_components';
  period?: PricingPeriod;
  minimumChargeUsd?: number;
  maximumChargeUsd?: number;
}

export interface PricingRounding {
  mode: 'none' | 'component' | 'total';
  precision: number;
}

export interface PricingMeter {
  unit:
    | 'token'
    | 'request'
    | 'second'
    | 'minute'
    | 'image'
    | 'megabyte'
    | 'gigabyte_month'
    | 'custom';
  quantityPath?: string;
  scale?: number;
  missingQuantity?: 'zero' | 'diagnostic' | 'error';
}

export interface PricingPrice {
  currency: PricingCurrency;
  amount: number;
  unitLabel: string;
  expression?: PricingPriceExpression;
}

export type PricingPriceExpression =
  | { kind: 'fixed' }
  | { kind: 'linear'; multiplier: number }
  | { kind: 'formula'; cel: string };

export type QuantityPricing =
  | { mode: 'flat' }
  | { mode: 'volume_tier'; tiers: QuantityPriceTier[] }
  | { mode: 'graduated_tier'; tiers: QuantityPriceTier[] }
  | { mode: 'stairstep'; steps: QuantityStepPrice[] };

export interface QuantityPriceTier {
  id: string;
  from: number;
  to?: number;
  price: PricingPrice;
}

export interface QuantityStepPrice {
  id: string;
  from: number;
  to?: number;
  flatPrice: PricingPrice;
}

export interface PricingAllowance {
  id: string;
  label: string;
  meter: PricingMeter;
  quantity: number;
  period: PricingPeriod;
  appliesWhen?: PricingCondition;
  consumeOrder?: number;
}

export interface PricingCommitment {
  id: string;
  label: string;
  period: 'month' | 'billing_cycle';
  minimumSpendUsd?: number;
  includedComponents?: string[];
  overagePolicy?: 'charge_components' | 'cap_at_minimum' | 'diagnostic_only';
}

export interface PricingOverlay {
  id: string;
  label: string;
  source: 'user_contract' | 'reseller_markup' | 'promotion' | 'internal_policy';
  operation:
    | { kind: 'replace_component_price'; componentId: string; price: PricingPrice }
    | { kind: 'multiply_component'; componentId: string; factor: number }
    | { kind: 'multiply_total'; factor: number }
    | { kind: 'add_component'; component: PricingComponent }
    | { kind: 'disable_component'; componentId: string };
  appliesWhen?: PricingCondition;
  priority?: number;
}

export interface PricingPostProcessor {
  id: string;
  label: string;
  kind: 'markup' | 'discount' | 'tax' | 'currency_conversion' | 'rounding_adjustment';
  appliesWhen?: PricingCondition;
  amount?: number;
  factor?: number;
  metadata?: Record<string, unknown>;
}

export interface PricingTier {
  id: string;
  label: string;
  dimensions: PricingTierDimension[];
}

export type PricingTierDimension =
  | { kind: 'context_tokens'; min?: number; max?: number }
  | { kind: 'input_tokens'; min?: number; max?: number }
  | { kind: 'output_tokens'; min?: number; max?: number }
  | { kind: 'service_tier'; value: string }
  | { kind: 'batch'; value: boolean }
  | { kind: 'modality'; value: string }
  | { kind: 'region'; value: string }
  | { kind: 'custom'; key: string; op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in'; value: unknown };

export interface PricingCondition {
  all?: PricingCondition[];
  any?: PricingCondition[];
  not?: PricingCondition;
  predicate?: PricingTierDimension;
  cel?: string;
}

export interface PricingTransform {
  id: string;
  kind:
    | 'copy_usage_field'
    | 'sum_usage_fields'
    | 'subtract_usage_fields'
    | 'cap_quantity'
    | 'multiply_quantity'
    | 'custom';
  inputPaths: string[];
  outputPath: string;
  value?: unknown;
  cel?: string;
}

export interface CanonicalUsage {
  schemaVersion: 1;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  requestCount: number;
  imageInputUnits: number;
  imageOutputUnits: number;
  audioInputSeconds: number;
  audioOutputSeconds: number;
  videoInputSeconds: number;
  storageMegabyteMonths: number;
  custom: Record<string, number>;
}

export interface PricingPeriodState {
  scope: 'entry_node' | 'model_endpoint' | 'target' | 'account' | 'site';
  targetId: string;
  period: 'day' | 'month' | 'billing_cycle';
  periodStart: string;
  periodEnd: string;
  usage: CanonicalUsage;
  committedSpendUsd?: number;
  consumedAllowances?: Record<string, number>;
  observedCostUsd?: number;
}

export interface PricingEvaluationDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export interface PricingEvaluation {
  catalogEntryId: string | null;
  source: 'reference' | 'user_override' | 'upstream_catalog' | 'measured' | 'default';
  usageHash: string;
  planFingerprint: string;
  composedFrom?: Array<{
    catalogEntryId?: string;
    version?: string;
    fingerprint: string;
    role: 'base_rate_card' | 'overlay' | 'post_processor';
  }>;
  totalCostUsd: number;
  subtotalCostUsd: number;
  adjustmentCostUsd: number;
  estimateLevel: 'exact' | 'request_estimate' | 'period_estimate' | 'incomplete';
  components: Array<{
    componentId: string;
    kind: PricingComponentKind;
    quantity: number;
    scale: number;
    unitPriceUsd: number;
    costUsd: number;
    role: PricingComponentRole;
    tierId?: string;
    quantityPricingMode?: QuantityPricing['mode'];
    allowanceApplied?: number;
    overlayIds?: string[];
  }>;
  postProcessors?: Array<{
    id: string;
    kind: PricingPostProcessor['kind'];
    amountUsd: number;
  }>;
  equivalentMultipliers: {
    input?: number | null;
    output?: number | null;
    cacheRead?: number | null;
    cacheWrite?: number | null;
  };
  diagnostics: PricingEvaluationDiagnostic[];
}

export interface PricingObservationDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface PricingObservation {
  id: string;
  source: 'upstream_catalog' | 'measured_billing';
  scope: 'site' | 'account' | 'entry_node' | 'model_endpoint' | 'target';
  targetId: string;
  publicModelName?: string;
  upstreamModelName?: string;
  catalogEntryId?: string | null;
  observedAt: string;
  freshnessTtlSeconds?: number;
  sampleCount?: number;
  usageShape?: CanonicalUsage;
  plan?: PricingPlan;
  planFingerprint?: string;
  evaluation?: PricingEvaluation;
  raw?: Record<string, unknown>;
  diagnostics: PricingObservationDiagnostic[];
}

