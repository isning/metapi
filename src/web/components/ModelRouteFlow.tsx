import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  GitBranch,
  Info,
  Route,
  Server,
  Wallet,
} from 'lucide-react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { tr } from '../i18n.js';
import { cn } from '../lib/utils.js';
import EmptyStateBlock from './EmptyStateBlock.js';
import RuntimeIdentifier, { formatRuntimeIdentifier } from './RuntimeIdentifier.js';
import ToneBadge from './ToneBadge.js';
import EstimateLevelBadge from './pricing/EstimateLevelBadge.js';
import { Card, CardContent } from './ui/card/index.js';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from './ui/empty/index.js';
import { Skeleton } from './ui/skeleton/index.js';
import * as Tabs from './ui/tabs/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table/index.js';

export type ModelRouteFlowViewMode = 'execution' | 'cost' | 'diagnostics';

type RuntimeProbabilityStatus = 'static' | 'dynamic' | 'unsupported';

type RuntimeHealthSummary = {
  successRate: number | null;
  totalCalls: number;
  avgLatencyMs: number | null;
  avgFirstTokenLatencyMs?: number | null;
  avgOutputTokensPerSecond?: number | null;
  cooldownUntil: string | null;
  consecutiveFailureCount: number | null;
};

type RuntimeRoutingSignalsProjection = {
  referencePricing?: {
    scenario: 'routing_reference';
    source: 'wallet_acquisition' | 'free_quota' | 'unavailable';
    rawCost: number | null;
    effectiveCost: number | null;
    baseCostUnit: string | null;
  } | null;
  cost?: {
    status: 'available' | 'insufficient_data' | 'pricing_unavailable';
    routingCost: number | null;
  } | null;
  probability?: number | null;
};

type RuntimeApiAttemptProjection = {
  apiAttemptId: string;
  order: number;
  apiType: string;
  upstreamEndpoint: string;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  adapterId: string;
  credentialEndpointBindingId: string;
  apiEndpointProfileId: string;
  downgradeAllowed: boolean;
  reason: string[];
};

type RuntimeApiAttemptDiagnosticProjection = {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  translationKey?: string;
  values?: Record<string, string | number | boolean | null>;
  apiType?: string;
  upstreamEndpoint?: string;
  credentialEndpointBindingId?: string;
  apiEndpointProfileId?: string;
};

type RuntimePricingComponentKind =
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'reasoning_tokens'
  | 'request'
  | 'tool_call'
  | 'image_input'
  | 'image_output'
  | 'audio_input'
  | 'audio_output'
  | 'video_input'
  | 'embedding_tokens'
  | 'storage'
  | 'custom'
  | string;

type RuntimePricingComponentRole = 'charge' | 'discount' | 'credit' | 'minimum' | 'maximum' | string;

type RuntimePricingComponentDto = {
  componentId: string;
  kind: RuntimePricingComponentKind;
  quantity: number;
  scale: number;
  currency: string | null;
  unitPrice: number | null;
  cost: number | null;
  role: RuntimePricingComponentRole;
  tierId?: string;
  quantityPricingMode?: string;
  allowanceApplied?: number;
  overlayIds?: string[];
};

type RuntimePricingResolutionDto = {
  source: string;
  sourceId: string | number | null;
  matchedScope: string | null;
  sourceType: string | null;
  planFingerprint: string | null;
  estimateLevel: string | null;
  summary: {
    currency: string | null;
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    cacheReadPerMillion: number | null;
    cacheWritePerMillion: number | null;
    reasoningPerMillion: number | null;
    requestCost: number | null;
    totalCost: number | null;
  };
  evaluation: {
    catalogEntryId: string | null;
    source: string;
    usageHash: string;
    planFingerprint: string;
    currency: string;
    totalCost: number;
    subtotalCost: number;
    adjustmentCost: number;
    estimateLevel: string;
    components: RuntimePricingComponentDto[];
    postProcessors?: Array<{ id: string; kind: string; currency?: string; amount: number }>;
    equivalentMultipliers?: Record<string, number | null | undefined>;
    diagnostics?: Array<{ severity?: string; level?: string; message: string; code?: string }>;
  } | null;
  diagnostics: Array<{ level?: string; severity?: string; message: string }>;
};

type RuntimeSelectionTermProjection = {
  termId: string;
  optionId: string;
  mode: string;
  policy: {
    source: 'default' | 'registry' | 'inline' | 'builtin';
    id: string | null;
    kind: 'cel' | 'builtin' | null;
    selectionMode: 'weighted' | 'ordered' | 'round_robin' | 'direct' | null;
  };
  enabled: boolean;
  weight: number;
  order: number;
};

type RuntimeFallbackStageProjection = {
  fallbackId: string;
  stageId: string;
  stageIndex: number;
  nodeId: string;
  selected: boolean;
};

type RuntimeAlternativeProjection = {
  alternativeId: string;
  kind: 'execution_attempt' | 'endpoint_delegation' | 'synthetic_response';
  enabled: boolean;
  endpointId: string | null;
  nodeId: string | null;
  model: string | null;
  executionAttemptIds: string[];
  selectionTerms: RuntimeSelectionTermProjection[];
  fallbackStages: RuntimeFallbackStageProjection[];
  probability: number | null;
  probabilityStatus: RuntimeProbabilityStatus;
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  } | null;
};

type RuntimeEndpointProjection = {
  endpointId: string;
  nodeId: string | null;
  alternativeIds: string[];
  executionAttemptIds: string[];
};

export type RuntimeExecutionAttemptProjection = {
  executionAttemptId: string;
  alternativeId: string;
  endpointId: string;
  nodeId: string | null;
  executionTargetId: number | null;
  model: string | null;
  modelSource: 'fixed' | 'request';
  enabled: boolean;
  siteId: number | null;
  siteName?: string | null;
  siteUrl?: string | null;
  sitePlatform?: string | null;
  accountId: number | null;
  accountLabel?: string | null;
  tokenId: number | null;
  tokenLabel?: string | null;
  tokenGroup?: string | null;
  weight: number | null;
  probability: number | null;
  probabilityStatus: RuntimeProbabilityStatus;
  health: RuntimeHealthSummary;
  routingSignals?: RuntimeRoutingSignalsProjection | null;
  apiAttempts?: RuntimeApiAttemptProjection[];
  apiAttemptDiagnostics?: RuntimeApiAttemptDiagnosticProjection[];
};

type CompiledRuntimeProjection = {
  runtimeRef: {
    artifactId: string | null;
    bundleHash: string | null;
  };
  match: {
    requestedModel: string;
    planId: string;
    entryNodeId: string;
    publicModelName: string | null;
  };
  alternatives: RuntimeAlternativeProjection[];
  endpoints: RuntimeEndpointProjection[];
  executionAttempts: RuntimeExecutionAttemptProjection[];
  selected: {
    alternativeId: string | null;
    endpointId: string | null;
    executionAttemptId: string | null;
    accountId: number | null;
    tokenId: number | null;
    siteId: number | null;
    actualModel: string | null;
    selectionSource: 'compiled_runtime' | 'forced_execution_attempt' | 'retry_scope' | 'synthetic';
  };
  filters: {
    preSelectionApplied: Array<{ nodeId: string; appliedFilters: string[] }>;
  postBuild: unknown;
  };
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  } | null;
};

export type ModelRouteFlowData = {
  requestedModel: string;
  matched: boolean;
  diagnostics: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
  compiledRuntime: CompiledRuntimeProjection | null;
  entryPricing?: {
    theoretical: {
      currency: string | null;
      inputPerMillion: number | null;
      outputPerMillion: number | null;
      cacheReadPerMillion: number | null;
      cacheWritePerMillion: number | null;
      reasoningPerMillion: number | null;
      requestCost: number | null;
      totalCost: number | null;
      inputMultiplier: number | null;
      outputMultiplier: number | null;
      totalMultiplier: number | null;
      components: RuntimePricingComponentDto[];
      usage: Record<string, unknown>;
      reference: {
        currency: string | null;
        inputPerMillion: number | null;
        outputPerMillion: number | null;
        cacheReadPerMillion: number | null;
        cacheWritePerMillion: number | null;
        reasoningPerMillion: number | null;
        requestCost: number | null;
        totalCost: number | null;
      } | null;
      referenceResolution?: RuntimePricingResolutionDto | null;
      comparison?: {
        inputMultiplier: number | null;
        outputMultiplier: number | null;
        totalMultiplier: number | null;
      };
      effectiveCost: {
        walletCostBaseCurrency: number | null;
        baseCostUnit: string | null;
        freeQuotaDaysCost: number | null;
        balanceBurn: Array<{ unit: string; amount: number }>;
        estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
        diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
      } | null;
      sourceCount: number;
      estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
      selectionMode: 'weighted' | 'ordered' | 'round_robin' | 'direct' | 'mixed' | null;
      diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
      executionAttempts: Array<{
        executionAttemptId: string;
        endpointId: string;
        nodeId: string;
        siteId: number | null;
        accountId: number | null;
        tokenId: number | null;
        modelName: string;
        probability: number | null;
        weight: number | null;
        currency: string | null;
        inputPerMillion: number | null;
        outputPerMillion: number | null;
        cacheReadPerMillion: number | null;
        cacheWritePerMillion: number | null;
        reasoningPerMillion: number | null;
        requestCost: number | null;
        totalCost: number | null;
        components: RuntimePricingComponentDto[];
        usage: Record<string, unknown>;
        resolution?: RuntimePricingResolutionDto | null;
        reference?: RuntimePricingResolutionDto | null;
        effectiveCost: {
          walletCostBaseCurrency: number | null;
          baseCostUnit: string;
          freeQuotaDaysCost: number | null;
          balanceBurn: Array<{ unit: string; amount: number }>;
          estimateLevel: 'exact' | 'estimated' | 'incomplete';
          diagnostics?: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
        } | null;
        comparison?: {
          inputMultiplier: number | null;
          outputMultiplier: number | null;
          totalMultiplier: number | null;
        };
        quoteDiagnostics?: Array<{ level?: string; severity?: string; message: string }>;
        pricingId: number | null;
        matchedScope: string | null;
        sourceRef: {
          endpointId?: string;
          nodeId?: string;
        };
      }>;
    } | null;
  };
  compatibilityPolicy?: {
    resolved: {
      reasoningHistory: {
        transport: {
          mode: 'native' | 'content_think_tag' | 'drop' | string;
          maxReasoningBytes: number;
          overflow: 'truncate' | 'drop' | string;
          thinkTag: {
            openTag: string;
            closeTag: string;
            separator: string;
          };
          toolCallMessageBehavior?: string;
          applyTo?: {
            assistantHistory?: boolean;
            assistantToolCalls?: boolean;
            responseContinuation?: boolean;
          };
        };
      };
    };
    layers: Array<{
      source: 'site' | 'account' | 'token' | 'endpoint_policy' | 'execution_attempt';
      configured: boolean;
    }>;
  };
  projectedAt: string;
};

type ModelRouteFlowProps = {
  flow: ModelRouteFlowData | null;
  loading?: boolean;
  error?: string;
  viewMode?: ModelRouteFlowViewMode;
  onViewModeChange?: (mode: ModelRouteFlowViewMode) => void;
  compact?: boolean;
};

type RuntimeGraphNodeKind = 'request' | 'matchedPlan' | 'alternative' | 'executionTerminal' | 'apiAttempt' | 'syntheticTerminal' | 'unmatchedTerminal';
type RuntimeGraphNodeTone = 'default' | 'selected' | 'muted' | 'warning' | 'disabled';

type RuntimeGraphMetric = {
  label: string;
  value: React.ReactNode;
};

type RuntimeGraphNode = {
  [key: string]: unknown;
  id: string;
  kind: RuntimeGraphNodeKind;
  column: number;
  order: number;
  title: string;
  subtitle: string | null;
  badges: Array<{ label: string; tone: string }>;
  metrics: RuntimeGraphMetric[];
  selected: boolean;
  disabled: boolean;
  warning: boolean;
  tone: RuntimeGraphNodeTone;
  alternativeId?: string | null;
  executionAttemptId?: string | null;
  endpointId?: string | null;
  apiAttemptId?: string | null;
};

type RuntimeGraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string | null;
  selected: boolean;
  disabled: boolean;
  muted: boolean;
  warning: boolean;
};

type RuntimeGraphEdgeData = {
  label: string | null;
  selectedPath: boolean;
  mutedPath: boolean;
  warningPath: boolean;
};

type RuntimePricingEstimate = NonNullable<NonNullable<ModelRouteFlowData['entryPricing']>['theoretical']>;
type RuntimePricingExecutionAttempt = RuntimePricingEstimate['executionAttempts'][number];
type RuntimePricingComponent = RuntimePricingEstimate['components'][number];
type RuntimeEffectiveCostLike = {
  walletCostBaseCurrency: number | null;
  baseCostUnit?: string | null;
} | null;
type RuntimePricingLike = {
  inputPerMillion?: number | null;
  outputPerMillion?: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
  reasoningPerMillion: number | null;
  requestCost: number | null;
  totalCost?: number | null;
  components: RuntimePricingComponent[];
  effectiveCost?: RuntimeEffectiveCostLike;
};

type RuntimeGraphViewModel = {
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
  columns: RuntimeGraphNode[][];
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  metrics: {
    alternativeCount: number;
    endpointCount: number;
    executionAttemptCount: number;
    totalCost: number | null;
  };
};

type NodeSize = {
  width: number;
  height: number;
};

const RUNTIME_GRAPH_LEVEL_GAP = 112;
const RUNTIME_GRAPH_NODE_GAP = 18;
const RUNTIME_GRAPH_DEFAULT_WIDTH = 236;
const RUNTIME_GRAPH_ALTERNATIVE_WIDTH = 268;
const RUNTIME_GRAPH_TERMINAL_WIDTH = 320;
const RUNTIME_GRAPH_API_ATTEMPT_WIDTH = 360;

const modeItems: Array<{ value: ModelRouteFlowViewMode; label: string; description: string }> = [
  {
    value: 'execution',
    label: tr('components.modelRouteFlow.execution'),
    description: tr('components.modelRouteFlow.executionDescription'),
  },
  {
    value: 'cost',
    label: tr('components.modelRouteFlow.cost'),
    description: tr('components.modelRouteFlow.costDescription'),
  },
  {
    value: 'diagnostics',
    label: tr('components.modelRouteFlow.diagnostics'),
    description: tr('components.modelRouteFlow.diagnosticsDescription'),
  },
];

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  const ratio = value > 1 ? value / 100 : value;
  return `${(ratio * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function formatNumber(value: number | null | undefined, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${Math.round(value * 100) / 100}${suffix}`;
}

function formatTokenSpeed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(value >= 10 ? 1 : 2)} tok/s`;
}

function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.priceUnavailable');
  const amount = value.toFixed(6).replace(/\.?0+$/, '');
  return currency ? `${currency} ${amount}` : amount;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  const rounded = Math.abs(value) >= 100
    ? String(Math.round(value * 100) / 100)
    : value.toFixed(6).replace(/\.?0+$/, '');
  return rounded || '0';
}

function formatEffectivePrice(cost: {
  walletCostBaseCurrency: number | null;
  baseCostUnit?: string | null;
} | null | undefined): string {
  if (!cost || cost.walletCostBaseCurrency == null || !Number.isFinite(cost.walletCostBaseCurrency)) {
    return tr('components.modelRouteFlow.walletCostUnavailable');
  }
  const amount = formatCompactNumber(cost.walletCostBaseCurrency);
  return cost.baseCostUnit ? `${cost.baseCostUnit} ${amount}` : amount;
}

function formatRawPrice(input: {
  pricing: {
    currency?: string | null;
    totalCost?: number | null;
    effectiveCost?: RuntimeEffectiveCostLike;
  } | null | undefined;
  rawPrice: number | null | undefined;
}): string {
  const rawPrice = input.rawPrice;
  if (rawPrice == null || !Number.isFinite(rawPrice)) return tr('components.modelRouteFlow.priceUnavailable');
  return formatMoney(rawPrice, input.pricing?.currency ?? null);
}

function formatRawPriceDetail(input: {
  currency?: string | null;
  rawPrice: number | null | undefined;
}): string {
  if (input.rawPrice != null && Number.isFinite(input.rawPrice)) {
    return `${tr('components.modelRouteFlow.originalPrice')}: ${formatMoney(input.rawPrice, input.currency)}`;
  }
  return `${tr('components.modelRouteFlow.originalPrice')}: ${tr('components.modelRouteFlow.priceUnavailable')}`;
}

function selectionSourceLabel(source: CompiledRuntimeProjection['selected']['selectionSource'] | null | undefined): string {
  if (source === 'compiled_runtime') return tr('components.modelRouteFlow.routePlan');
  if (source === 'forced_execution_attempt') return tr('components.modelRouteFlow.forcedExecutionAttempt');
  if (source === 'retry_scope') return tr('components.modelRouteFlow.retryScope');
  if (source === 'synthetic') return tr('components.modelRouteFlow.syntheticResponse');
  return source || 'N/A';
}

function PriceMetricValue({
  primary,
  raw,
}: {
  primary: React.ReactNode;
  raw: React.ReactNode;
}) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="truncate font-mono text-sm font-semibold">{primary}</span>
      <span className="truncate text-[10px] font-normal text-muted-foreground">{raw}</span>
    </span>
  );
}

function priceMetricValue(input: {
  pricing: {
    currency?: string | null;
    totalCost?: number | null;
    effectiveCost?: RuntimeEffectiveCostLike;
  } | null | undefined;
  rawPrice: number | null | undefined;
}): React.ReactNode {
  return (
    <PriceMetricValue
      primary={formatRawPrice(input)}
      raw={formatRawPriceDetail({ rawPrice: input.rawPrice, currency: input.pricing?.currency ?? null })}
    />
  );
}

function pricingComponentLabel(kind: RuntimePricingComponent['kind']): string {
  if (kind === 'input_tokens') return tr('components.modelRouteFlow.input');
  if (kind === 'output_tokens') return tr('components.modelRouteFlow.output');
  if (kind === 'cache_read_tokens') return tr('components.modelRouteFlow.cacheRead');
  if (kind === 'cache_write_tokens') return tr('components.modelRouteFlow.cacheWrite');
  if (kind === 'reasoning_tokens') return tr('components.modelRouteFlow.reasoning');
  if (kind === 'request') return tr('components.modelRouteFlow.requestFee');
  if (kind === 'tool_call') return tr('components.modelRouteFlow.toolCall');
  if (kind === 'image_input') return tr('components.modelRouteFlow.imageInput');
  if (kind === 'image_output') return tr('components.modelRouteFlow.imageOutput');
  if (kind === 'audio_input') return tr('components.modelRouteFlow.audioInput');
  if (kind === 'audio_output') return tr('components.modelRouteFlow.audioOutput');
  if (kind === 'video_input') return tr('components.modelRouteFlow.videoInput');
  if (kind === 'embedding_tokens') return tr('components.modelRouteFlow.embeddingTokens');
  if (kind === 'storage') return tr('components.modelRouteFlow.storage');
  if (kind === 'custom') return tr('components.modelRouteFlow.customPricingComponent');
  return kind;
}

function pricingComponentRoleLabel(role: RuntimePricingComponent['role']): string {
  if (role === 'charge') return tr('components.modelRouteFlow.pricingRoleCharge');
  if (role === 'discount') return tr('components.modelRouteFlow.pricingRoleDiscount');
  if (role === 'credit') return tr('components.modelRouteFlow.pricingRoleCredit');
  if (role === 'minimum') return tr('components.modelRouteFlow.pricingRoleMinimum');
  if (role === 'maximum') return tr('components.modelRouteFlow.pricingRoleMaximum');
  return role;
}

function formatComponentUnitPrice(component: RuntimePricingComponent): string {
  if (component.unitPrice == null || !Number.isFinite(component.unitPrice)) {
    return tr('components.modelRouteFlow.priceUnavailable');
  }
  const unit = ['request', 'tool_call', 'image_input', 'image_output', 'audio_input', 'audio_output', 'video_input', 'storage', 'custom'].includes(component.kind)
    ? tr('components.modelRouteFlow.perUnit')
    : tr('components.modelRouteFlow.perMillionTokens');
  return `${formatMoney(component.unitPrice, component.currency)} / ${unit}`;
}

function formatComponentQuantity(component: RuntimePricingComponent): string {
  if (!Number.isFinite(component.quantity)) return 'N/A';
  if (['request', 'tool_call', 'image_input', 'image_output', 'audio_input', 'audio_output', 'video_input', 'storage', 'custom'].includes(component.kind)) return formatCompactNumber(component.quantity);
  if (component.quantity === 1_000_000) {
    return tr('components.modelRouteFlow.standardPreviewTokenQuantity');
  }
  return formatModelRouteFlowTemplate('components.modelRouteFlow.tokenQuantity', {
    quantity: new Intl.NumberFormat().format(component.quantity),
  });
}

function formatComponentCost(component: RuntimePricingComponent): string {
  return formatMoney(component.cost, component.currency);
}

function PricingComponentBreakdown({
  components,
  compact = false,
  weighted = false,
  showQuantity = true,
}: {
  components: RuntimePricingComponent[];
  compact?: boolean;
  weighted?: boolean;
  showQuantity?: boolean;
}) {
  const rows = (components || []).filter((component) => (
    component.unitPrice != null || component.cost != null || component.quantity > 0
  ));
  if (rows.length === 0) return null;
  if (compact) {
    return (
      <div className="grid gap-1.5">
        {rows.map((component) => (
          <div key={component.componentId || component.kind} className="grid min-w-0 gap-1 rounded-md bg-muted/40 px-2 py-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{pricingComponentLabel(component.kind)}</span>
              <span className="shrink-0 font-mono text-xs">{formatComponentCost(component)}</span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1">
              <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">{pricingComponentRoleLabel(component.role)}</ToneBadge>
              {component.quantityPricingMode ? <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">{component.quantityPricingMode}</ToneBadge> : null}
              {component.tierId ? <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">{component.tierId}</ToneBadge> : null}
              {component.allowanceApplied != null ? <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">{formatCompactNumber(component.allowanceApplied)}</ToneBadge> : null}
              {(component.overlayIds || []).map((overlayId) => (
                <ToneBadge key={overlayId} tone="-muted" className="px-1.5 py-0 text-[10px]">{overlayId}</ToneBadge>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {weighted ? (
        <p className="text-xs text-muted-foreground">
          {tr('components.modelRouteFlow.weightedCostDescription')}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
              <TableRow>
                <TableHead>{tr('components.modelRouteFlow.costComponent')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.pricingRole')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.unitPrice')}</TableHead>
                {showQuantity ? <TableHead>{tr('components.modelRouteFlow.usageQuantity')}</TableHead> : null}
                <TableHead>{weighted
                  ? tr('components.modelRouteFlow.weightedPreviewCost')
                  : tr('components.modelRouteFlow.previewCost')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.pricingDetails')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((component) => (
            <TableRow key={component.componentId || component.kind}>
              <TableCell>
                <div>{pricingComponentLabel(component.kind)}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{component.componentId}</div>
              </TableCell>
              <TableCell>{pricingComponentRoleLabel(component.role)}</TableCell>
              <TableCell className="font-mono text-xs">{formatComponentUnitPrice(component)}</TableCell>
              {showQuantity ? <TableCell className="font-mono text-xs">{formatComponentQuantity(component)}</TableCell> : null}
              <TableCell className="font-mono text-xs">{formatComponentCost(component)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {[
                  component.tierId ? `${tr('components.modelRouteFlow.tier')}: ${component.tierId}` : '',
                  component.quantityPricingMode ? `${tr('components.modelRouteFlow.quantityPricing')}: ${component.quantityPricingMode}` : '',
                  component.allowanceApplied != null ? `${tr('components.modelRouteFlow.allowanceApplied')}: ${formatCompactNumber(component.allowanceApplied)}` : '',
                  component.overlayIds?.length ? `${tr('components.modelRouteFlow.overlays')}: ${component.overlayIds.join(', ')}` : '',
                ].filter(Boolean).join(' · ') || 'N/A'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function advancedPricingMetrics(
  pricing: RuntimePricingLike | null | undefined,
): Array<{ label: string; value: React.ReactNode }> {
  if (!pricing) return [];
  const items: Array<{
    label: string;
    rawPrice: number | null;
  }> = [
    { label: tr('components.modelRouteFlow.cacheRead'), rawPrice: pricing.cacheReadPerMillion },
    { label: tr('components.modelRouteFlow.cacheWrite'), rawPrice: pricing.cacheWritePerMillion },
    { label: tr('components.modelRouteFlow.reasoning'), rawPrice: pricing.reasoningPerMillion },
    { label: tr('components.modelRouteFlow.requestFee'), rawPrice: pricing.requestCost },
  ];
  return items
    .filter((item) => item.rawPrice != null)
    .map((item) => ({
      label: item.label,
      value: priceMetricValue({ pricing, rawPrice: item.rawPrice }),
    }));
}

function formatId(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'N/A';
  return String(value);
}

function LongRuntimeId({ value, className, kind, context }: { value: string | number | null | undefined; className?: string; kind?: React.ComponentProps<typeof RuntimeIdentifier>['kind']; context?: React.ReactNode }) {
  return <RuntimeIdentifier value={value} className={cn('text-muted-foreground', className)} kind={kind} context={context} />;
}

function formatModelRouteFlowTemplate(key: string, replacements: Record<string, string | number>) {
  let value = tr(key);
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function translateRuntimeDiagnostic(diagnostic: RuntimeApiAttemptDiagnosticProjection): string {
  const rawDiagnostic = diagnostic as RuntimeApiAttemptDiagnosticProjection & Record<string, unknown>;
  const wireTranslationKey = rawDiagnostic[`i18n${'Key'}`];
  const key = diagnostic.translationKey
    || (typeof wireTranslationKey === 'string' ? wireTranslationKey : '')
    || diagnostic.message;
  let value = key ? tr(key) : diagnostic.code;
  for (const [name, replacement] of Object.entries(diagnostic.values || {})) {
    value = value.replace(`{${name}}`, replacement == null ? '' : String(replacement));
  }
  return value || diagnostic.code;
}

function runtimeApiAttemptDiagnostics(flow: ModelRouteFlowData): RuntimeApiAttemptDiagnosticProjection[] {
  return (flow.compiledRuntime?.executionAttempts || [])
    .flatMap((attempt) => attempt.apiAttemptDiagnostics || []);
}

function attemptLabel(attempt: RuntimeExecutionAttemptProjection | null | undefined): string {
  if (!attempt) return tr('components.modelRouteFlow.noSelectedExecutionAttempt');
  const account = attempt.accountLabel || (attempt.accountId != null
    ? formatModelRouteFlowTemplate('components.modelRouteFlow.accountIdentity', { id: attempt.accountId })
    : tr('pages.proxyLogs.unknownAccount'));
  const site = attempt.siteName || attempt.siteUrl || (attempt.siteId != null
    ? formatModelRouteFlowTemplate('components.modelRouteFlow.siteIdentity', { id: attempt.siteId })
    : tr('pages.proxyLogs.unknownSite'));
  const token = attempt.tokenLabel || attempt.tokenGroup || (attempt.tokenId != null
    ? formatModelRouteFlowTemplate('components.modelRouteFlow.tokenIdentity', { id: attempt.tokenId })
    : tr('pages.tokens.default'));
  return `${account} @ ${site} / ${token}`;
}

function selectedAttempt(flow: ModelRouteFlowData): RuntimeExecutionAttemptProjection | null {
  const runtime = flow.compiledRuntime;
  if (!runtime?.selected.executionAttemptId) return null;
  return runtime.executionAttempts.find((attempt) => attempt.executionAttemptId === runtime.selected.executionAttemptId) || null;
}

function selectedAlternative(flow: ModelRouteFlowData): RuntimeAlternativeProjection | null {
  const runtime = flow.compiledRuntime;
  if (!runtime?.selected.alternativeId) return null;
  return runtime.alternatives.find((alternative) => alternative.alternativeId === runtime.selected.alternativeId) || null;
}

function selectedEndpoint(flow: ModelRouteFlowData): RuntimeEndpointProjection | null {
  const runtime = flow.compiledRuntime;
  if (!runtime?.selected.endpointId) return null;
  return runtime.endpoints.find((endpoint) => endpoint.endpointId === runtime.selected.endpointId) || null;
}

function graphNodeId(kind: RuntimeGraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function graphNodeTone(input: {
  selected: boolean;
  disabled?: boolean;
  warning?: boolean;
}): RuntimeGraphNodeTone {
  if (input.selected) return 'selected';
  if (input.disabled) return 'disabled';
  if (input.warning) return 'warning';
  return 'default';
}

function addUniqueEdge(edges: RuntimeGraphEdge[], edge: RuntimeGraphEdge) {
  if (edges.some((item) => item.id === edge.id)) return;
  edges.push(edge);
}

function probabilityLabel(status: RuntimeProbabilityStatus, value: number | null | undefined): string {
  if (status === 'dynamic') return tr('components.modelRouteFlow.dynamicProbability');
  if (status === 'unsupported') return tr('components.modelRouteFlow.unsupportedProbability');
  return formatPercent(value);
}

function ProbabilityBadge({
  status,
  value,
  className,
}: {
  status: RuntimeProbabilityStatus;
  value: number | null | undefined;
  className?: string;
}) {
  return (
    <ToneBadge tone={probabilityTone(status)} className={className}>
      {probabilityLabel(status, value)}
    </ToneBadge>
  );
}

function alternativeTitle(alternative: RuntimeAlternativeProjection): string {
  if (alternative.kind === 'synthetic_response') return tr('components.modelRouteFlow.syntheticTerminal');
  return alternative.model || tr('components.modelRouteFlow.modelMetadataMissing');
}

function selectionTermSummary(alternative: RuntimeAlternativeProjection): string {
  const modes = Array.from(new Set(alternative.selectionTerms
    .map((term) => term.policy.selectionMode || term.policy.id)
    .filter(Boolean)));
  if (modes.length > 0) return modes.join(' / ');
  if (alternative.selectionTerms.length > 0) return `${alternative.selectionTerms.length} ${tr('components.modelRouteFlow.selectionTerms')}`;
  return tr('components.modelRouteFlow.noSelectionTerms');
}

function attemptForAlternative(runtime: CompiledRuntimeProjection, alternative: RuntimeAlternativeProjection): RuntimeExecutionAttemptProjection | null {
  for (const attemptId of alternative.executionAttemptIds || []) {
    const match = runtime.executionAttempts.find((attempt) => attempt.executionAttemptId === attemptId);
    if (match) return match;
  }
  return runtime.executionAttempts.find((attempt) => attempt.alternativeId === alternative.alternativeId) || null;
}

function apiAttemptLabel(attempt: RuntimeApiAttemptProjection): string {
  return `${attempt.upstreamEndpoint} · ${attempt.apiType}`;
}

function diagnosticsForApiAttempt(
  diagnostics: RuntimeApiAttemptDiagnosticProjection[] | undefined,
  apiAttempt: RuntimeApiAttemptProjection,
): RuntimeApiAttemptDiagnosticProjection[] {
  return (diagnostics || []).filter((diagnostic) => (
    (!diagnostic.apiType || diagnostic.apiType === apiAttempt.apiType)
    && (!diagnostic.upstreamEndpoint || diagnostic.upstreamEndpoint === apiAttempt.upstreamEndpoint)
    && (!diagnostic.apiEndpointProfileId || diagnostic.apiEndpointProfileId === apiAttempt.apiEndpointProfileId)
    && (!diagnostic.credentialEndpointBindingId || diagnostic.credentialEndpointBindingId === apiAttempt.credentialEndpointBindingId)
  ));
}

function apiAttemptNodeForAttempt(input: {
  apiAttempt: RuntimeApiAttemptProjection;
  alternative: RuntimeAlternativeProjection;
  executionAttempt: RuntimeExecutionAttemptProjection;
  selected: boolean;
  order: number;
}): RuntimeGraphNode {
  const { apiAttempt, alternative, executionAttempt, selected, order } = input;
  const warning = apiAttempt.downgradeAllowed === false;
  return {
    id: graphNodeId('apiAttempt', `${alternative.alternativeId}:${apiAttempt.apiAttemptId}`),
    kind: 'apiAttempt',
    column: 4,
    order,
    title: apiAttemptLabel(apiAttempt),
    subtitle: apiAttempt.requestUrl || apiAttempt.requestMethod,
    badges: [
      { label: `#${apiAttempt.order + 1}`, tone: selected ? '-success' : '-muted' },
      { label: apiAttempt.downgradeAllowed ? tr('components.modelRouteFlow.fallbackAllowed') : tr('components.modelRouteFlow.fallbackPinned'), tone: apiAttempt.downgradeAllowed ? '-info' : 'warning' },
    ],
    metrics: [
      { label: tr('components.modelRouteFlow.requestMethod'), value: apiAttempt.requestMethod },
      { label: tr('components.modelRouteFlow.apiEndpointProfile'), value: apiAttempt.apiEndpointProfileId || 'N/A' },
    ],
    selected,
    disabled: executionAttempt.enabled === false,
    warning,
    tone: graphNodeTone({ selected, disabled: executionAttempt.enabled === false, warning }),
    alternativeId: alternative.alternativeId,
    endpointId: executionAttempt.endpointId,
    executionAttemptId: executionAttempt.executionAttemptId,
    apiAttemptId: apiAttempt.apiAttemptId,
  };
}

function terminalNodeForAlternative(input: {
  runtime: CompiledRuntimeProjection;
  alternative: RuntimeAlternativeProjection;
  selected: boolean;
  order: number;
  pricingByAttemptId: Map<string, RuntimePricingExecutionAttempt>;
}): RuntimeGraphNode {
  const { runtime, alternative, selected, order, pricingByAttemptId } = input;
  if (alternative.kind === 'synthetic_response') {
    const response = alternative.syntheticResponse || runtime.syntheticResponse || null;
    const warning = true;
    return {
      id: graphNodeId('syntheticTerminal', alternative.alternativeId),
      kind: 'syntheticTerminal',
      column: 3,
      order,
      title: tr('components.modelRouteFlow.syntheticTerminal'),
      subtitle: response?.message || tr('components.modelRouteFlow.noCompiledRuntimeDescription'),
      badges: [
        { label: String(response?.statusCode || 'N/A'), tone: 'warning' },
        { label: tr('components.modelRouteFlow.terminalOutcome'), tone: '-muted' },
      ],
      metrics: [],
      selected,
      disabled: !alternative.enabled,
      warning,
      tone: graphNodeTone({ selected, disabled: !alternative.enabled, warning }),
      alternativeId: alternative.alternativeId,
      endpointId: null,
      executionAttemptId: null,
      apiAttemptId: null,
    };
  }

  const attempt = attemptForAlternative(runtime, alternative);
  const pricing = attempt ? pricingByAttemptId.get(attempt.executionAttemptId) : undefined;
  const warning = !!attempt?.health.cooldownUntil
    || Number(attempt?.health.consecutiveFailureCount || 0) > 0
    || alternative.kind === 'endpoint_delegation'
    || !attempt;
  return {
    id: graphNodeId('executionTerminal', alternative.alternativeId),
    kind: 'executionTerminal',
    column: 3,
    order,
    title: attempt ? attemptLabel(attempt) : tr('components.modelRouteFlow.noTerminalOutcome'),
    subtitle: [
      alternative.endpointId ? `${tr('components.modelRouteFlow.endpointIdentity')}: ${formatRuntimeIdentifier(alternative.endpointId, { kind: 'route-endpoint' })}` : '',
      attempt ? `${tr('components.modelRouteFlow.executionAttemptIdentity')}: ${formatRuntimeIdentifier(attempt.executionAttemptId, { kind: 'execution-attempt' })}` : '',
    ].filter(Boolean).join(' · ') || null,
    badges: [
      { label: tr('components.modelRouteFlow.executionTerminal'), tone: selected ? '-success' : '-muted' },
      ...(runtime.selected.selectionSource === 'forced_execution_attempt' && selected
        ? [{ label: tr('components.modelRouteFlow.forcedExecutionAttempt'), tone: '-info' }]
        : []),
      ...(attempt?.executionTargetId != null
        ? [{ label: `${tr('components.modelRouteFlow.executionTarget')} ${attempt.executionTargetId}`, tone: '-muted' }]
        : []),
    ],
    metrics: [
      { label: tr('components.modelRouteFlow.input'), value: priceMetricValue({ pricing, rawPrice: pricing?.inputPerMillion }) },
      { label: tr('components.modelRouteFlow.output'), value: priceMetricValue({ pricing, rawPrice: pricing?.outputPerMillion }) },
      ...advancedPricingMetrics(pricing),
      { label: tr('components.modelRouteFlow.total'), value: priceMetricValue({ pricing, rawPrice: pricing?.totalCost }) },
      { label: tr('components.modelRouteFlow.cashCost'), value: formatEffectivePrice(pricing?.effectiveCost) },
      { label: tr('components.modelRouteFlow.scope'), value: pricing?.matchedScope || 'N/A' },
      { label: tr('components.modelAnalysisPanel.successRate'), value: formatPercent(attempt?.health.successRate) },
      { label: tr('pages.models.firstTokenLatency'), value: formatNumber(attempt?.health.avgFirstTokenLatencyMs, 'ms') },
      { label: tr('pages.models.outputSpeed'), value: formatTokenSpeed(attempt?.health.avgOutputTokensPerSecond) },
    ],
    selected,
    disabled: !alternative.enabled || attempt?.enabled === false || !attempt,
    warning,
    tone: graphNodeTone({ selected, disabled: !alternative.enabled || attempt?.enabled === false || !attempt, warning }),
    alternativeId: alternative.alternativeId,
    endpointId: alternative.endpointId,
    executionAttemptId: attempt?.executionAttemptId || null,
    apiAttemptId: null,
  };
}

export function buildRuntimeGraphViewModel(flow: ModelRouteFlowData): RuntimeGraphViewModel | null {
  const runtime = flow.compiledRuntime;
  const pricingByAttemptId = new Map((flow.entryPricing?.theoretical?.executionAttempts || [])
    .map((attempt) => [attempt.executionAttemptId, attempt]));

  const nodes: RuntimeGraphNode[] = [];
  const edges: RuntimeGraphEdge[] = [];
  const selectedNodeIds = new Set<string>();
  const selectedEdgeIds = new Set<string>();

  const rememberNode = (node: RuntimeGraphNode) => {
    if (nodes.some((item) => item.id === node.id)) return;
    if (node.selected) selectedNodeIds.add(node.id);
    nodes.push(node);
  };

  const rememberEdge = (edge: RuntimeGraphEdge) => {
    if (edge.selected) selectedEdgeIds.add(edge.id);
    addUniqueEdge(edges, edge);
  };

  const requestNodeId = graphNodeId('request', flow.requestedModel);
  rememberNode({
    id: requestNodeId,
    kind: 'request',
    column: 0,
    order: 0,
    title: flow.requestedModel,
    subtitle: tr('components.modelRouteFlow.requestedModel'),
    badges: [{ label: tr('components.modelRouteFlow.runtimeMap'), tone: '-muted' }],
    metrics: [{
      label: tr('components.modelRouteFlow.actualModel'),
      value: runtime?.selected.actualModel || tr('components.modelRouteFlow.modelMetadataMissing'),
    }],
    selected: true,
    disabled: false,
    warning: !flow.matched,
    tone: graphNodeTone({ selected: true, warning: !flow.matched }),
  });

  if (!runtime) {
    const unmatchedNodeId = graphNodeId('unmatchedTerminal', flow.requestedModel);
    rememberNode({
      id: unmatchedNodeId,
      kind: 'unmatchedTerminal',
      column: 3,
      order: 0,
      title: tr('components.modelRouteFlow.unmatchedRuntime'),
      subtitle: tr('components.modelRouteFlow.noCompiledRuntimeDescription'),
      badges: [{ label: tr('components.modelRouteFlow.unmatched'), tone: 'warning' }],
      metrics: [],
      selected: true,
      disabled: true,
      warning: true,
      tone: graphNodeTone({ selected: true, disabled: true, warning: true }),
    });
    rememberEdge({
      id: `${requestNodeId}->${unmatchedNodeId}`,
      from: requestNodeId,
      to: unmatchedNodeId,
      label: tr('components.modelRouteFlow.unmatched'),
      selected: true,
      disabled: true,
      muted: false,
      warning: true,
    });
    return {
      nodes,
      edges,
      columns: Array.from({ length: 5 }, (_, column) => nodes.filter((node) => node.column === column)),
      selectedNodeIds,
      selectedEdgeIds,
      metrics: {
        alternativeCount: 0,
        endpointCount: 0,
        executionAttemptCount: 0,
        totalCost: flow.entryPricing?.theoretical?.totalCost ?? null,
      },
    };
  }

  const selectedAlternativeId = runtime.selected.alternativeId || '';
  const selectedPlanNodeId = graphNodeId('matchedPlan', runtime.match.planId);
  rememberNode({
    id: selectedPlanNodeId,
    kind: 'matchedPlan',
    column: 1,
    order: 0,
    title: runtime.match.publicModelName || runtime.match.planId,
    subtitle: runtime.match.publicModelName || tr('components.modelRouteFlow.matchedPlan'),
    badges: [
      { label: tr('components.modelRouteFlow.matchedPlan'), tone: flow.matched ? '-success' : 'warning' },
      { label: runtime.match.planId, tone: '-muted' },
    ],
    metrics: [
      { label: tr('components.modelRouteFlow.projectedAt'), value: flow.projectedAt },
      { label: tr('components.modelRouteFlow.bundleHash'), value: runtime.runtimeRef.bundleHash || 'N/A' },
    ],
    selected: flow.matched,
    disabled: !flow.matched,
    warning: !flow.matched,
    tone: graphNodeTone({ selected: flow.matched, disabled: !flow.matched, warning: !flow.matched }),
  });
  rememberEdge({
    id: `${requestNodeId}->${selectedPlanNodeId}`,
    from: requestNodeId,
    to: selectedPlanNodeId,
    label: flow.matched ? tr('components.modelRouteFlow.matched') : tr('components.modelRouteFlow.unmatched'),
    selected: flow.matched,
    disabled: !flow.matched,
    muted: !flow.matched,
    warning: !flow.matched,
  });

  const alternatives = [...runtime.alternatives].sort((left, right) => {
    if (left.alternativeId === selectedAlternativeId) return -1;
    if (right.alternativeId === selectedAlternativeId) return 1;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    const probabilityDelta = (right.probability ?? -1) - (left.probability ?? -1);
    if (probabilityDelta !== 0) return probabilityDelta;
    return left.alternativeId.localeCompare(right.alternativeId);
  });

  alternatives.forEach((alternative, index) => {
    const selected = alternative.alternativeId === selectedAlternativeId;
    const warning = alternative.kind === 'synthetic_response';
    const alternativeNodeId = graphNodeId('alternative', alternative.alternativeId);
    rememberNode({
      id: alternativeNodeId,
      kind: 'alternative',
      column: 2,
      order: index,
      title: alternativeTitle(alternative),
      subtitle: alternative.alternativeId,
      badges: [
        { label: selected ? tr('components.modelRouteFlow.selectedBranch') : tr('components.modelRouteFlow.nonSelectedAlternative'), tone: selected ? '-success' : '-muted' },
        { label: probabilityLabel(alternative.probabilityStatus, alternative.probability), tone: probabilityTone(alternative.probabilityStatus) },
      ],
      metrics: [
        { label: tr('components.modelRouteFlow.policy'), value: selectionTermSummary(alternative) },
        { label: tr('components.modelRouteFlow.selectionTerms'), value: alternative.selectionTerms.length },
      ],
      selected,
      disabled: !alternative.enabled,
      warning,
      tone: graphNodeTone({ selected, disabled: !alternative.enabled, warning }),
      alternativeId: alternative.alternativeId,
      endpointId: alternative.endpointId,
      executionAttemptId: attemptForAlternative(runtime, alternative)?.executionAttemptId || null,
    });
    rememberEdge({
      id: `${selectedPlanNodeId}->${alternativeNodeId}`,
      from: selectedPlanNodeId,
      to: alternativeNodeId,
      label: probabilityLabel(alternative.probabilityStatus, alternative.probability),
      selected,
      disabled: !alternative.enabled,
      muted: !selected,
      warning,
    });

    const terminalNode = terminalNodeForAlternative({
      runtime,
      alternative,
      selected,
      order: index,
      pricingByAttemptId,
    });
    rememberNode(terminalNode);
    rememberEdge({
      id: `${alternativeNodeId}->${terminalNode.id}`,
      from: alternativeNodeId,
      to: terminalNode.id,
      label: alternative.kind === 'synthetic_response'
        ? String(alternative.syntheticResponse?.statusCode || runtime.syntheticResponse?.statusCode || '')
        : (selected && runtime.selected.selectionSource === 'forced_execution_attempt'
            ? tr('components.modelRouteFlow.forcedExecutionAttempt')
            : tr('components.modelRouteFlow.executionAttempt')),
      selected,
      disabled: !alternative.enabled || terminalNode.disabled,
      muted: !selected,
      warning: terminalNode.warning,
    });

    const terminalAttempt = attemptForAlternative(runtime, alternative);
    if (terminalAttempt) {
      const apiAttempts = terminalAttempt.apiAttempts || [];
      apiAttempts.forEach((apiAttempt, apiAttemptIndex) => {
        const apiNode = apiAttemptNodeForAttempt({
          apiAttempt,
          alternative,
          executionAttempt: terminalAttempt,
          selected,
          order: index * 100 + apiAttemptIndex,
        });
        rememberNode(apiNode);
        rememberEdge({
          id: `${terminalNode.id}->${apiNode.id}`,
          from: terminalNode.id,
          to: apiNode.id,
          label: `#${apiAttempt.order + 1}`,
          selected,
          disabled: terminalNode.disabled || terminalAttempt.enabled === false,
          muted: !selected,
          warning: apiNode.warning,
        });
      });
    }
  });

  const columns = Array.from({ length: 5 }, (_, column) => nodes
    .filter((node) => node.column === column)
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title)));

  return {
    nodes,
    edges,
    columns,
    selectedNodeIds,
    selectedEdgeIds,
    metrics: {
      alternativeCount: runtime.alternatives.length,
      endpointCount: runtime.endpoints.length,
      executionAttemptCount: runtime.executionAttempts.length,
      totalCost: flow.entryPricing?.theoretical?.totalCost ?? null,
    },
  };
}

function probabilityTone(status: RuntimeProbabilityStatus): string {
  if (status === 'static') return '-success';
  if (status === 'unsupported') return 'warning';
  return '-info';
}

function diagnosticTone(level: string): string {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warning';
  return '-info';
}

function StatusBadge({ flow }: { flow: ModelRouteFlowData }) {
  if (!flow.matched) {
    return <ToneBadge tone="warning">{tr('components.modelRouteFlow.unmatched')}</ToneBadge>;
  }
  if (flow.compiledRuntime?.syntheticResponse) {
    return <ToneBadge tone="warning">{tr('components.modelRouteFlow.syntheticResponse')}</ToneBadge>;
  }
  return <ToneBadge tone="-success">{tr('components.modelRouteFlow.matched')}</ToneBadge>;
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 min-w-0 break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function runtimeGraphNodeIcon(kind: RuntimeGraphNodeKind): React.ReactNode {
  if (kind === 'request') return <Route className="size-3.5" />;
  if (kind === 'matchedPlan') return <GitBranch className="size-3.5" />;
  if (kind === 'alternative') return <Cpu className="size-3.5" />;
  if (kind === 'apiAttempt') return <ArrowRight className="size-3.5" />;
  if (kind === 'syntheticTerminal' || kind === 'unmatchedTerminal') return <AlertTriangle className="size-3.5" />;
  return <Server className="size-3.5" />;
}

function runtimeGraphNodeLabel(kind: RuntimeGraphNodeKind): string {
  if (kind === 'request') return tr('components.modelRouteFlow.requestedModel');
  if (kind === 'matchedPlan') return tr('components.modelRouteFlow.matchedPlan');
  if (kind === 'alternative') return tr('components.modelRouteFlow.alternative');
  if (kind === 'apiAttempt') return tr('components.modelRouteFlow.apiFallbackAttempt');
  if (kind === 'syntheticTerminal') return tr('components.modelRouteFlow.syntheticTerminal');
  if (kind === 'unmatchedTerminal') return tr('components.modelRouteFlow.unmatchedRuntime');
  return tr('components.modelRouteFlow.terminalOutcome');
}

function runtimeGraphToneClasses(tone: RuntimeGraphNodeTone): string {
  if (tone === 'selected') return 'border-success/45 bg-success/5 ring-2 ring-success/15';
  if (tone === 'warning') return 'border-warning/45 bg-warning/5';
  if (tone === 'disabled') return 'border-muted border-dashed bg-muted/20 opacity-70';
  if (tone === 'muted') return 'bg-muted/25';
  return 'bg-card';
}

function RuntimeMapNodeCard({ data }: NodeProps<Node<RuntimeGraphNode>>) {
  const node = data;
  const color = node.tone === 'selected'
    ? 'var(--success)'
    : node.tone === 'warning'
      ? 'var(--warning)'
      : node.tone === 'disabled'
        ? 'var(--muted-foreground)'
        : 'var(--primary)';
  if (node.kind === 'apiAttempt') {
    const [endpointLabel, apiTypeLabel] = node.title.split(' · ');
    const fallbackBadge = node.badges[1];
    const methodMetric = node.metrics[0];
    return (
      <div className={cn(
        'relative w-full overflow-hidden rounded-md border bg-background/85 px-3 py-2.5 text-card-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)]',
        node.selected && 'border-success/40 bg-success/5',
        node.warning && !node.selected && 'border-warning/40 bg-warning/5',
        node.disabled && 'border-muted border-dashed bg-muted/20 opacity-70',
      )}>
        <Handle type="target" position={Position.Left} style={{ background: color, borderColor: 'var(--background)' }} />
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 28%, var(--border))`,
              background: `color-mix(in srgb, ${color} 8%, transparent)`,
            }}
          >
            {runtimeGraphNodeIcon(node.kind)}
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[10px] font-medium uppercase text-muted-foreground">
                {runtimeGraphNodeLabel(node.kind)}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {methodMetric ? (
                  <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">
                    {methodMetric.value}
                  </ToneBadge>
                ) : null}
                {fallbackBadge ? (
                  <ToneBadge tone={fallbackBadge.tone} className="max-w-24 truncate px-1.5 py-0 text-[10px]">
                    {fallbackBadge.label}
                  </ToneBadge>
                ) : null}
              </div>
            </div>
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold leading-tight">
                {endpointLabel || node.title}
              </span>
              {apiTypeLabel ? (
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {apiTypeLabel}
                </span>
              ) : null}
            </div>
            {node.subtitle ? (
              <div className="line-clamp-2 break-all font-mono text-[11px] leading-snug text-muted-foreground">
                {node.subtitle}
              </div>
            ) : null}
          </div>
        </div>
        <Handle type="source" position={Position.Right} style={{ background: color, borderColor: 'var(--background)' }} />
      </div>
    );
  }
  return (
    <div className={cn(
      'w-full overflow-hidden rounded-md border text-card-foreground shadow-sm',
      runtimeGraphToneClasses(node.tone),
    )}>
      <Handle type="target" position={Position.Left} style={{ background: color, borderColor: 'var(--background)' }} />
      <div className="grid gap-2 p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 28%, var(--border))`,
              background: `color-mix(in srgb, ${color} 9%, transparent)`,
            }}
          >
            {runtimeGraphNodeIcon(node.kind)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-medium uppercase text-muted-foreground">
              {runtimeGraphNodeLabel(node.kind)}
            </div>
            <div className="mt-0.5 line-clamp-2 break-words text-sm font-semibold leading-tight">
              {node.title}
            </div>
          </div>
        </div>
        {node.subtitle ? (
          <div className="line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
            {node.subtitle}
          </div>
        ) : null}
        {node.badges.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1">
            {node.badges.slice(0, 4).map((badge, index) => (
              <ToneBadge key={`${badge.label}-${index}`} tone={badge.tone} className="max-w-full truncate px-1.5 py-0 text-[10px]">
                {badge.label}
              </ToneBadge>
            ))}
          </div>
        ) : null}
        {node.metrics.length > 0 ? (
          <div className="grid min-w-0 grid-cols-2 gap-1.5">
            {node.metrics.slice(0, 6).map((metric) => (
              <div key={metric.label} className="min-w-0 rounded bg-muted/40 px-1.5 py-1">
                <div className="truncate text-[9px] uppercase text-muted-foreground">{metric.label}</div>
                <div className="min-w-0 font-mono text-[11px] font-semibold">{metric.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color, borderColor: 'var(--background)' }} />
    </div>
  );
}

function estimateWrappedLines(value: string | null | undefined, charsPerLine: number): number {
  const text = (value || '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function estimateRuntimeNodeSize(node: RuntimeGraphNode): NodeSize {
  const width = node.kind === 'executionTerminal' || node.kind === 'syntheticTerminal'
    ? RUNTIME_GRAPH_TERMINAL_WIDTH
    : node.kind === 'apiAttempt'
      ? RUNTIME_GRAPH_API_ATTEMPT_WIDTH
    : node.kind === 'alternative'
      ? RUNTIME_GRAPH_ALTERNATIVE_WIDTH
      : RUNTIME_GRAPH_DEFAULT_WIDTH;
  if (node.kind === 'apiAttempt') {
    return {
      width,
      height: 92,
    };
  }
  const charsPerLine = Math.max(24, Math.floor(width / 8));
  const titleLines = estimateWrappedLines(node.title, charsPerLine);
  const subtitleLines = estimateWrappedLines(node.subtitle, charsPerLine);
  const badgeRows = node.badges.length > 0 ? Math.ceil(Math.min(node.badges.length, 4) / 2) : 0;
  const metricRows = node.metrics.length > 0 ? Math.ceil(Math.min(node.metrics.length, 6) / 2) : 0;
  return {
    width,
    height: Math.max(116, 74 + titleLines * 17 + subtitleLines * 16 + badgeRows * 22 + metricRows * 44),
  };
}

export function layoutRuntimeMapNodes(viewModel: RuntimeGraphViewModel): Node<RuntimeGraphNode>[] {
  const columnWidths = viewModel.columns.map((column) => Math.max(
    RUNTIME_GRAPH_DEFAULT_WIDTH,
    ...column.map((node) => estimateRuntimeNodeSize(node).width),
  ));
  const columnX = new Map<number, number>();
  let nextX = 0;
  columnWidths.forEach((width, column) => {
    columnX.set(column, nextX);
    nextX += width + RUNTIME_GRAPH_LEVEL_GAP;
  });

  const positions = new Map<string, { x: number; y: number }>();
  viewModel.columns.forEach((columnNodes, column) => {
    const sizes = columnNodes.map(estimateRuntimeNodeSize);
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0)
      + Math.max(0, columnNodes.length - 1) * RUNTIME_GRAPH_NODE_GAP;
    let y = -(totalHeight / 2);
    columnNodes.forEach((node, index) => {
      positions.set(node.id, { x: columnX.get(column) || 0, y });
      y += sizes[index]!.height + RUNTIME_GRAPH_NODE_GAP;
    });
  });

  return viewModel.nodes.map((node) => {
    const size = estimateRuntimeNodeSize(node);
    return {
      id: node.id,
      type: 'runtimeMapNode',
      position: positions.get(node.id) || { x: 0, y: 0 },
      data: node,
      width: size.width,
      height: size.height,
      draggable: false,
    };
  });
}

function RuntimeMapEdge(props: EdgeProps<Edge<RuntimeGraphEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const selectedPath = props.data?.selectedPath === true;
  const mutedPath = props.data?.mutedPath === true;
  const warningPath = props.data?.warningPath === true;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={12}
        className={cn(
          'model-route-flow-edge',
          mutedPath && 'model-route-flow-edge-candidate',
          selectedPath && 'model-route-flow-edge-selected',
          warningPath && !selectedPath && 'model-route-flow-edge-candidate',
        )}
      />
      {selectedPath ? (
        <BaseEdge
          id={`${props.id}-flow`}
          path={path}
          interactionWidth={0}
          className="model-route-flow-edge-flow"
        />
      ) : null}
      {props.data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'model-route-flow-edge-label nodrag nopan',
              selectedPath && 'is-selected',
              mutedPath && 'is-candidate',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {props.data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function CompiledRuntimeMap({ viewModel, compact = false }: { viewModel: RuntimeGraphViewModel; compact?: boolean }) {
  const nodeTypes = useMemo(() => ({ runtimeMapNode: RuntimeMapNodeCard }), []);
  const edgeTypes = useMemo(() => ({ runtimeMapEdge: RuntimeMapEdge }), []);
  const nodes = useMemo(() => layoutRuntimeMapNodes(viewModel), [viewModel]);
  const edges: Edge<RuntimeGraphEdgeData>[] = useMemo(() => viewModel.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'runtimeMapEdge',
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      label: edge.label,
      selectedPath: edge.selected,
      mutedPath: edge.muted,
      warningPath: edge.warning,
    },
  })), [viewModel]);

  return (
    <div
      className={cn('overflow-hidden rounded-md border bg-card', compact ? 'h-[360px]' : 'h-[560px]')}
      data-testid="compiled-runtime-map"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.24}
        maxZoom={1.35}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function SelectedTerminalInspector({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const attempt = selectedAttempt(flow);
  const alternative = selectedAlternative(flow);
  if (!runtime) return null;
  if (runtime.syntheticResponse || alternative?.kind === 'synthetic_response') {
    const response = alternative?.syntheticResponse || runtime.syntheticResponse;
    return (
      <Card>
        <CardContent className="p-3">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{tr('components.modelRouteFlow.syntheticTerminal')}</div>
              <div className="mt-1 break-words text-sm text-muted-foreground">{response?.message || tr('components.modelRouteFlow.noCompiledRuntimeDescription')}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ToneBadge tone="warning">{String(response?.statusCode || 'N/A')}</ToneBadge>
                <ToneBadge tone="-muted">{selectionSourceLabel(runtime.selected.selectionSource)}</ToneBadge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!attempt) return null;
  const pricing = flow.entryPricing?.theoretical?.executionAttempts.find((item) => item.executionAttemptId === attempt.executionAttemptId);
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{tr('components.modelRouteFlow.terminalOutcome')}</div>
            <div className="mt-1 truncate text-sm text-muted-foreground">{attemptLabel(attempt)}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ProbabilityBadge status={attempt.probabilityStatus} value={attempt.probability} />
            <ToneBadge tone="-muted">{attempt.model || 'N/A'}</ToneBadge>
            {attempt.endpointId ? <ToneBadge tone="-muted" className="max-w-56"><LongRuntimeId value={attempt.endpointId} kind="route-endpoint" /></ToneBadge> : null}
            {attempt.executionTargetId != null ? <ToneBadge tone="-muted">{tr('components.modelRouteFlow.executionTarget')} {attempt.executionTargetId}</ToneBadge> : null}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <MiniMetric label={tr('components.modelRouteFlow.input')} value={priceMetricValue({ pricing, rawPrice: pricing?.inputPerMillion })} />
          <MiniMetric label={tr('components.modelRouteFlow.output')} value={priceMetricValue({ pricing, rawPrice: pricing?.outputPerMillion })} />
          {advancedPricingMetrics(pricing).map((metric) => (
            <MiniMetric key={metric.label} label={metric.label} value={metric.value} />
          ))}
          <MiniMetric label={tr('components.modelRouteFlow.total')} value={priceMetricValue({ pricing, rawPrice: pricing?.totalCost })} />
          <MiniMetric label={tr('components.modelRouteFlow.cashCost')} value={formatEffectivePrice(pricing?.effectiveCost)} />
          <MiniMetric label={tr('components.modelRouteFlow.scope')} value={pricing?.matchedScope || 'N/A'} />
          <MiniMetric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(attempt.health.successRate)} />
          <MiniMetric label={tr('pages.models.firstTokenLatency')} value={formatNumber(attempt.health.avgFirstTokenLatencyMs, 'ms')} />
          <MiniMetric label={tr('pages.models.outputSpeed')} value={formatTokenSpeed(attempt.health.avgOutputTokensPerSecond)} />
        </div>
        {pricing?.components?.length ? (
          <div className="mt-3 border-t pt-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {tr('components.modelRouteFlow.costDetails')}
            </div>
            <PricingComponentBreakdown components={pricing.components} compact />
          </div>
        ) : null}
        {(attempt.apiAttempts || []).length > 0 ? (
          <div className="mt-3 border-t pt-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {tr('components.modelRouteFlow.apiFallbackPlan')}
            </div>
            <div className="grid gap-1.5">
              {(attempt.apiAttempts || []).slice(0, 6).map((apiAttempt) => {
                const diagnostics = diagnosticsForApiAttempt(attempt.apiAttemptDiagnostics, apiAttempt);
                return (
                  <div key={apiAttempt.apiAttemptId} className="grid min-w-0 gap-1 rounded-md border bg-background px-2 py-1.5 text-xs">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ToneBadge tone={apiAttempt.downgradeAllowed ? '-info' : '-muted'} className="px-1.5 py-0 text-[10px]">
                        #{apiAttempt.order + 1}
                      </ToneBadge>
                      <span className="min-w-0 truncate font-medium">{apiAttemptLabel(apiAttempt)}</span>
                      <span className="min-w-0 truncate font-mono text-muted-foreground">{apiAttempt.requestUrl || apiAttempt.requestMethod}</span>
                      {diagnostics.length > 0 ? (
                        <ToneBadge tone={diagnosticTone(diagnostics[0]!.level)} className="px-1.5 py-0 text-[10px]">
                          {diagnostics.length} {tr('components.modelRouteFlow.diagnostics')}
                        </ToneBadge>
                      ) : null}
                    </div>
                    {diagnostics.slice(0, 2).map((diagnostic, diagnosticIndex) => (
                      <div key={`${diagnostic.code}-${diagnosticIndex}`} className="line-clamp-2 text-[11px] text-muted-foreground">
                        {translateRuntimeDiagnostic(diagnostic)}
                      </div>
                    ))}
                  </div>
                );
              })}
              {(attempt.apiAttempts || []).length > 6 ? (
                <div className="text-xs text-muted-foreground">
                  +{(attempt.apiAttempts || []).length - 6} {tr('components.modelRouteFlow.apiFallbackAttempts')}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RuntimePath({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const alternative = selectedAlternative(flow);
  const attempt = selectedAttempt(flow);
  const viewModel = useMemo(() => buildRuntimeGraphViewModel(flow), [flow]);
  if (!viewModel) return null;
  const selectedProbability = alternative
    ? probabilityLabel(alternative.probabilityStatus, alternative.probability)
    : attempt
      ? probabilityLabel(attempt.probabilityStatus, attempt.probability)
      : 'N/A';

  return (
    <div className="grid gap-3">
      <CompiledRuntimeMap viewModel={viewModel} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <MiniMetric label={tr('components.modelRouteFlow.planId')} value={runtime?.match.planId || 'N/A'} />
        <MiniMetric label={tr('components.modelRouteFlow.selectionSource')} value={selectionSourceLabel(runtime?.selected.selectionSource)} />
        <MiniMetric label={tr('components.modelRouteFlow.selectedProbability')} value={selectedProbability} />
        <MiniMetric label={tr('components.modelRouteFlow.alternatives')} value={viewModel.metrics.alternativeCount} />
        <MiniMetric label={tr('components.modelRouteFlow.executionAttempts')} value={viewModel.metrics.executionAttemptCount} />
        <MiniMetric label={tr('components.modelRouteFlow.entryCost')} value={formatMoney(viewModel.metrics.totalCost, flow.entryPricing?.theoretical?.currency)} />
      </div>

      <SelectedTerminalInspector flow={flow} />
    </div>
  );
}

function AlternativesView({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const alternatives = runtime?.alternatives || [];
  const pricingByAttemptId = new Map((flow.entryPricing?.theoretical?.executionAttempts || [])
    .map((attempt) => [attempt.executionAttemptId, attempt]));
  if (alternatives.length === 0) {
    return (
      <EmptyStateBlock
        icon={<Cpu className="size-5" />}
        title={tr('components.modelRouteFlow.noAlternatives')}
        description={tr('components.modelRouteFlow.noAlternativesDescription')}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {alternatives.map((alternative) => {
        const selected = runtime?.selected.alternativeId === alternative.alternativeId;
        const attempts = (alternative.executionAttemptIds || [])
          .map((attemptId) => runtime?.executionAttempts.find((attempt) => attempt.executionAttemptId === attemptId) || null)
          .filter((attempt): attempt is RuntimeExecutionAttemptProjection => !!attempt);
        return (
        <Card key={alternative.alternativeId}>
          <CardContent className="p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold">{alternativeTitle(alternative)}</div>
                  {selected ? <ToneBadge tone="-success">{tr('components.modelRouteFlow.selectedBranch')}</ToneBadge> : null}
                </div>
                <div className="mt-1">
                  <LongRuntimeId value={alternative.endpointId || alternative.alternativeId} kind="route-endpoint" />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ProbabilityBadge status={alternative.probabilityStatus} value={alternative.probability} />
                <ToneBadge tone="-muted">{alternative.selectionTerms.length} {tr('components.modelRouteFlow.selectionTerms')}</ToneBadge>
                <ToneBadge tone="-muted">{alternative.executionAttemptIds.length} {tr('components.modelRouteFlow.executionAttempts')}</ToneBadge>
              </div>
            </div>
            {alternative.kind === 'synthetic_response' ? (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                <div className="font-medium">{tr('components.modelRouteFlow.syntheticTerminal')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{alternative.syntheticResponse?.message || runtime?.syntheticResponse?.message || 'N/A'}</div>
              </div>
            ) : (
              <div className="grid gap-2">
                {attempts.length > 0 ? attempts.map((attempt) => {
                  const pricing = pricingByAttemptId.get(attempt.executionAttemptId);
                  return (
                    <div key={attempt.executionAttemptId} className={cn('grid gap-2 rounded-md border bg-background p-3', runtime?.selected.executionAttemptId === attempt.executionAttemptId && 'border-success/45 bg-success/5')}>
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{attemptLabel(attempt)}</div>
                          <div className="mt-1"><LongRuntimeId value={attempt.executionAttemptId} kind="execution-attempt" context={[attempt.accountLabel, attempt.siteName, attempt.tokenLabel || attempt.tokenGroup].filter(Boolean).join(' · ') || undefined} /></div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <ProbabilityBadge status={attempt.probabilityStatus} value={attempt.probability} />
                          <ToneBadge tone={attempt.enabled ? '-success' : 'warning'}>{attempt.enabled ? tr('components.modelRouteFlow.available') : tr('components.modelRouteFlow.blocked')}</ToneBadge>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                        <MiniMetric label={tr('components.modelRouteFlow.endpoint')} value={<LongRuntimeId value={attempt.endpointId} kind="route-endpoint" className="text-foreground" />} />
                        <MiniMetric label={tr('components.modelRouteFlow.model')} value={attempt.model || 'N/A'} />
                        <MiniMetric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(attempt.health.successRate)} />
                        <MiniMetric label={tr('pages.models.firstTokenLatency')} value={formatNumber(attempt.health.avgFirstTokenLatencyMs, 'ms')} />
                        <MiniMetric label={tr('pages.models.outputSpeed')} value={formatTokenSpeed(attempt.health.avgOutputTokensPerSecond)} />
                        <MiniMetric label={tr('components.modelRouteFlow.cashCost')} value={formatEffectivePrice(pricing?.effectiveCost)} />
                      </div>
                      {pricing ? (
                        <PricingComponentBreakdown components={pricing.resolution?.evaluation?.components || pricing.components} compact />
                      ) : null}
                      {(attempt.apiAttempts || []).length > 0 ? (
                        <div className="grid gap-1.5 border-t pt-2">
                          <div className="text-xs font-medium text-muted-foreground">{tr('components.modelRouteFlow.apiFallbackPlan')}</div>
                          <div className="grid gap-1.5 md:grid-cols-2">
                            {(attempt.apiAttempts || []).map((apiAttempt) => (
                              <div key={apiAttempt.apiAttemptId} className="rounded-md border bg-muted/25 p-2">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                  <div className="min-w-0 truncate text-xs font-semibold">{apiAttemptLabel(apiAttempt)}</div>
                                  <ToneBadge tone="-muted" className="px-1.5 py-0 text-[10px]">#{apiAttempt.order + 1}</ToneBadge>
                                </div>
                                <div className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-muted-foreground">{apiAttempt.requestUrl}</div>
                                {diagnosticsForApiAttempt(attempt.apiAttemptDiagnostics, apiAttempt).slice(0, 2).map((diagnostic, diagnosticIndex) => (
                                  <div key={`${diagnostic.code}-${diagnosticIndex}`} className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                    {translateRuntimeDiagnostic(diagnostic)}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <EmptyStateBlock
                    className="rounded-md border border-dashed bg-background"
                    title={tr('components.modelRouteFlow.noExecutionAttempts')}
                    description={tr('components.modelRouteFlow.noExecutionAttemptsDescription')}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}

function ExecutionAttemptsView({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const attempts = runtime?.executionAttempts || [];
  if (attempts.length === 0) {
    return (
      <EmptyStateBlock
        icon={<Server className="size-5" />}
        title={tr('components.modelRouteFlow.noExecutionAttempts')}
        description={tr('components.modelRouteFlow.noExecutionAttemptsDescription')}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr('components.modelRouteFlow.executionAttempt')}</TableHead>
              <TableHead>{tr('components.modelRouteFlow.endpoint')}</TableHead>
              <TableHead>{tr('components.modelRouteFlow.model')}</TableHead>
              <TableHead>{tr('components.searchModal.accounts2')}</TableHead>
              <TableHead>{tr('components.modelRouteFlow.probability')}</TableHead>
              <TableHead>{tr('components.modelAnalysisPanel.successRate')}</TableHead>
              <TableHead>{tr('pages.models.interactivePerformance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((attempt) => (
              <TableRow key={attempt.executionAttemptId} data-state={runtime?.selected.executionAttemptId === attempt.executionAttemptId ? 'selected' : undefined}>
                <TableCell>
                  <LongRuntimeId value={attempt.executionAttemptId} kind="execution-attempt" className="text-foreground" context={[attempt.accountLabel, attempt.siteName, attempt.tokenLabel || attempt.tokenGroup].filter(Boolean).join(' · ') || undefined} />
                  <div className="mt-1 text-xs text-muted-foreground">{attemptLabel(attempt)}</div>
                </TableCell>
                <TableCell><LongRuntimeId value={attempt.endpointId} kind="route-endpoint" className="text-foreground" /></TableCell>
                <TableCell className="font-mono text-xs">{attempt.model || 'N/A'}</TableCell>
                <TableCell>
                  <div className="text-sm">{attempt.accountLabel || formatId(attempt.accountId)}</div>
                  <div className="text-xs text-muted-foreground">{attempt.tokenLabel || attempt.tokenGroup || formatId(attempt.tokenId)}</div>
                </TableCell>
                <TableCell><ProbabilityBadge status={attempt.probabilityStatus} value={attempt.probability} /></TableCell>
                <TableCell>{formatPercent(attempt.health.successRate)}</TableCell>
                <TableCell>
                  <div>{formatNumber(attempt.health.avgFirstTokenLatencyMs, 'ms')}</div>
                  <div className="text-xs text-muted-foreground">{formatTokenSpeed(attempt.health.avgOutputTokensPerSecond)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CostView({ flow }: { flow: ModelRouteFlowData }) {
  const pricing = flow.entryPricing?.theoretical || null;
  const runtimeAttemptById = useMemo(() => new Map(
    (flow.compiledRuntime?.executionAttempts || []).map((attempt) => [attempt.executionAttemptId, attempt]),
  ), [flow.compiledRuntime?.executionAttempts]);
  if (!pricing) {
    return (
      <EmptyStateBlock
        icon={<Wallet className="size-5" />}
        title={tr('components.modelRouteFlow.noPricingEstimate')}
        description={tr('components.modelRouteFlow.noPricingEstimateDescription')}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <Card>
        <CardContent className="p-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{tr('components.modelRouteFlow.weightedEntryPricing')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{tr('components.modelRouteFlow.weightedEntryPricingDescription')}</div>
            </div>
            <EstimateLevelBadge
              level={pricing.estimateLevel}
              diagnostics={pricing.diagnostics}
              executionAttempts={pricing.executionAttempts}
              sourceCount={pricing.sourceCount}
              selectionMode={pricing.selectionMode}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <MiniMetric
              label={tr('components.modelRouteFlow.input')}
              value={priceMetricValue({ pricing, rawPrice: pricing.inputPerMillion })}
            />
            <MiniMetric
              label={tr('components.modelRouteFlow.output')}
              value={priceMetricValue({ pricing, rawPrice: pricing.outputPerMillion })}
            />
            {advancedPricingMetrics(pricing).map((metric) => (
              <MiniMetric key={metric.label} label={metric.label} value={metric.value} />
            ))}
            <MiniMetric
              label={tr('components.modelRouteFlow.total')}
              value={priceMetricValue({ pricing, rawPrice: pricing.totalCost })}
            />
          </div>
          {pricing.effectiveCost ? (
            <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3">
              <MiniMetric label={tr('components.modelRouteFlow.cashCost')} value={formatEffectivePrice(pricing.effectiveCost)} />
              <MiniMetric label={tr('components.modelRouteFlow.freeQuotaCost')} value={formatNumber(pricing.effectiveCost.freeQuotaDaysCost)} />
              <MiniMetric label={tr('components.modelRouteFlow.upstreamBalanceCost')} value={pricing.effectiveCost.balanceBurn.length} />
            </div>
          ) : null}
          {pricing.components.length > 0 ? (
            <div className="mt-3 border-t pt-3">
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {tr('components.modelRouteFlow.costDetails')}
              </div>
              <PricingComponentBreakdown components={pricing.components} weighted showQuantity={false} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('components.modelRouteFlow.executionAttempt')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.probability')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.input')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.output')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.total')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.costDetails')}</TableHead>
                <TableHead>{tr('components.modelRouteFlow.scope')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.executionAttempts.map((attempt) => {
                const runtimeAttempt = runtimeAttemptById.get(attempt.executionAttemptId);
                return (
                  <TableRow key={attempt.executionAttemptId}>
                    <TableCell>
                      <LongRuntimeId value={attempt.executionAttemptId} kind="execution-attempt" className="text-foreground" />
                      <div className="mt-1 text-xs text-muted-foreground">{attempt.modelName}</div>
                    </TableCell>
                    <TableCell>
                      {runtimeAttempt ? (
                        <ProbabilityBadge
                          status={runtimeAttempt.probabilityStatus}
                          value={runtimeAttempt.probability}
                        />
                      ) : formatPercent(attempt.probability)}
                    </TableCell>
                    <TableCell>{priceMetricValue({ pricing: attempt, rawPrice: attempt.resolution?.summary.inputPerMillion ?? attempt.inputPerMillion })}</TableCell>
                    <TableCell>{priceMetricValue({ pricing: attempt, rawPrice: attempt.resolution?.summary.outputPerMillion ?? attempt.outputPerMillion })}</TableCell>
                    <TableCell>{priceMetricValue({ pricing: attempt, rawPrice: attempt.resolution?.summary.totalCost ?? attempt.totalCost })}</TableCell>
                    <TableCell>
                      <PricingComponentBreakdown components={attempt.resolution?.evaluation?.components || attempt.components} compact />
                    </TableCell>
                    <TableCell>{attempt.matchedScope || 'N/A'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ExecutionView({ flow }: { flow: ModelRouteFlowData }) {
  return (
    <div className="grid gap-3">
      <RuntimePath flow={flow} />
      <AlternativesView flow={flow} />
    </div>
  );
}

function DiagnosticsView({ flow }: { flow: ModelRouteFlowData }) {
  const diagnostics = [
    ...(flow.diagnostics || []),
    ...(flow.entryPricing?.theoretical?.diagnostics || []),
    ...runtimeApiAttemptDiagnostics(flow).map((diagnostic) => ({
      level: diagnostic.level,
      message: translateRuntimeDiagnostic(diagnostic),
    })),
  ];
  if (diagnostics.length === 0) {
    return (
      <EmptyStateBlock
        icon={<Info className="size-5" />}
        title={tr('components.modelRouteFlow.noDiagnostics')}
        description={tr('components.modelRouteFlow.noDiagnosticsDescription')}
      />
    );
  }

  return (
    <div className="grid gap-2">
      {diagnostics.map((item, index) => (
        <div key={`${item.message}-${index}`} className="flex min-w-0 items-start gap-2 rounded-md border p-3">
          <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', item.level === 'error' ? 'text-destructive' : item.level === 'warn' ? 'text-warning' : 'text-muted-foreground')} />
          <div className="min-w-0">
            <ToneBadge tone={diagnosticTone(item.level)} className="mb-1">{item.level}</ToneBadge>
            <div className="break-words text-sm text-muted-foreground">{item.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowHeader({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const attempt = selectedAttempt(flow);
  const selectedLabel = runtime?.syntheticResponse
    ? tr('components.modelRouteFlow.syntheticTerminal')
    : attemptLabel(attempt);
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <div className="truncate text-sm font-semibold">{tr('components.modelRouteFlow.compiledRuntime')}</div>
              <StatusBadge flow={flow} />
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
              <div>{tr('components.modelRouteFlow.requestedModel')}: <span className="font-mono text-foreground">{flow.requestedModel}</span></div>
              <div>{tr('components.modelRouteFlow.actualModel')}: <span className="font-mono text-foreground">{runtime?.selected.actualModel || tr('components.modelRouteFlow.modelMetadataMissing')}</span></div>
              <div>{tr('components.modelRouteFlow.terminalOutcome')}: <span className="text-foreground">{selectedLabel}</span></div>
            </div>
          </div>
          <div className="grid min-w-52 gap-1 text-xs text-muted-foreground">
            <div>{tr('components.modelRouteFlow.projectedAt')}: <span className="font-mono text-foreground">{flow.projectedAt}</span></div>
            <div>{tr('components.modelRouteFlow.bundleHash')}: <LongRuntimeId value={runtime?.runtimeRef.bundleHash} kind="runtime-artifact" className="text-foreground" /></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompactRuntimeNode({ node }: { node: RuntimeGraphNode }) {
  return (
    <div className={cn(
      'min-w-0 rounded-md border p-2 text-xs',
      runtimeGraphToneClasses(node.tone),
    )}>
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        <span className="shrink-0">{runtimeGraphNodeIcon(node.kind)}</span>
        <span className="truncate">{runtimeGraphNodeLabel(node.kind)}</span>
      </div>
      <div className="mt-1 line-clamp-2 break-words font-semibold leading-snug">{node.title}</div>
      {node.subtitle ? <div className="mt-0.5 truncate text-muted-foreground">{node.subtitle}</div> : null}
      {node.badges.length > 0 ? (
        <div className="mt-1 flex min-w-0 flex-wrap gap-1">
          {node.badges.slice(0, 2).map((badge, index) => (
            <ToneBadge key={`${badge.label}-${index}`} tone={badge.tone} className="max-w-full truncate px-1.5 py-0 text-[10px]">
              {badge.label}
            </ToneBadge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompactRouteFlow({ flow }: { flow: ModelRouteFlowData }) {
  const runtime = flow.compiledRuntime;
  const viewModel = useMemo(() => buildRuntimeGraphViewModel(flow), [flow]);
  const selectedPath = (viewModel?.columns || [])
    .flatMap((column) => column.filter((node) => node.selected))
    .slice(0, 4);
  const alternativeOverflow = (viewModel?.nodes || [])
    .filter((node) => node.kind === 'alternative' && !node.selected);
  const visibleAlternatives = alternativeOverflow.slice(0, 2);
  const hiddenAlternativeCount = Math.max(0, alternativeOverflow.length - visibleAlternatives.length);

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-card text-card-foreground">
      <div className="grid min-w-0 gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">
            {tr('components.modelRouteFlow.compactRouteSummary')}
          </div>
          <StatusBadge flow={flow} />
        </div>

        <div className="grid min-w-0 gap-1.5">
          {selectedPath.map((node, index) => (
            <React.Fragment key={node.id}>
              <CompactRuntimeNode node={node} />
              {index < selectedPath.length - 1 ? (
                <div className="flex h-3 items-center justify-center text-muted-foreground">
                  <ArrowRight className="size-3 rotate-90" />
                </div>
              ) : null}
            </React.Fragment>
          ))}
        </div>

        <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
          <MiniMetric label={tr('components.modelRouteFlow.alternatives')} value={runtime?.alternatives.length || 0} />
          <MiniMetric label={tr('components.modelRouteFlow.executionAttempts')} value={runtime?.executionAttempts.length || 0} />
          <MiniMetric label={tr('components.modelRouteFlow.entryCost')} value={formatMoney(flow.entryPricing?.theoretical?.totalCost, flow.entryPricing?.theoretical?.currency)} />
          <MiniMetric label={tr('components.modelRouteFlow.diagnostics')} value={String(flow.diagnostics.length)} />
        </div>

        {visibleAlternatives.length > 0 ? (
          <div className="grid min-w-0 gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate font-medium">{tr('components.modelRouteFlow.nonSelectedAlternative')}</span>
              {hiddenAlternativeCount > 0 ? <span className="shrink-0">+{hiddenAlternativeCount}</span> : null}
            </div>
            <div className="grid min-w-0 gap-1.5">
              {visibleAlternatives.map((node) => <CompactRuntimeNode key={node.id} node={node} />)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  const label = tr('components.modelRouteFlow.routes');
  if (compact) {
    return (
      <div role="status" aria-busy="true" aria-label={label} className="grid gap-2 rounded-md border bg-card p-3">
        <span className="sr-only">{label}</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
    );
  }

  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid min-w-0 gap-3">
      <span className="sr-only">{label}</span>
      <div className="rounded-md border bg-card p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }, (_item, index) => (
            <div key={index} className="rounded-md border p-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="grid min-h-[260px] gap-4 md:grid-cols-[1fr_1fr_1fr]">
          {Array.from({ length: 3 }, (_item, index) => (
            <div key={index} className="flex items-center justify-center">
              <div className="w-full max-w-[320px] rounded-md border p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-4/5" />
                <div className="mt-4 flex gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, compact = false }: { error: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive', compact && 'text-xs')}>
      {error || tr('components.modelRouteFlow.loadFailed')}
    </div>
  );
}

function EmptyFlowState({ compact = false }: { compact?: boolean }) {
  return (
    <Empty className={compact ? 'rounded-md border p-3' : 'rounded-md border p-6'}>
      <EmptyHeader>
        <EmptyIcon><GitBranch className="size-5" /></EmptyIcon>
        <EmptyTitle>{tr('components.modelRouteFlow.selectmodelRoutes')}</EmptyTitle>
        <EmptyDescription>{tr('components.modelRouteFlow.selectmodelRoutesDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export default function ModelRouteFlow({
  flow,
  loading = false,
  error = '',
  viewMode,
  onViewModeChange,
  compact = false,
}: ModelRouteFlowProps) {
  const [internalViewMode, setInternalViewMode] = useState<ModelRouteFlowViewMode>('execution');
  const validModeValues = useMemo(() => new Set(modeItems.map((item) => item.value)), []);

  if (loading && !flow) {
    return <LoadingState compact={compact} />;
  }
  if (error) return <ErrorState error={error} compact={compact} />;
  if (!flow) return <EmptyFlowState compact={compact} />;
  if (compact) return <CompactRouteFlow flow={flow} />;

  const requestedMode = viewMode && validModeValues.has(viewMode) ? viewMode : undefined;
  const currentMode = requestedMode || internalViewMode;
  const activeMode = modeItems.find((item) => item.value === currentMode) || modeItems[0]!;
  const handleViewModeChange = (value: string) => {
    if (!validModeValues.has(value as ModelRouteFlowViewMode)) return;
    const next = value as ModelRouteFlowViewMode;
    if (viewMode == null) setInternalViewMode(next);
    onViewModeChange?.(next);
  };

  return (
    <div className={cn('grid min-w-0 gap-3 transition-opacity duration-150', loading && 'opacity-75')} aria-busy={loading}>
      <FlowHeader flow={flow} />
      <Tabs.Tabs value={currentMode} onValueChange={handleViewModeChange}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Tabs.TabsList className="h-auto flex-wrap justify-start">
            {modeItems.map((item) => (
              <Tabs.TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </Tabs.TabsTrigger>
            ))}
          </Tabs.TabsList>
          <div className="max-w-xl text-xs text-muted-foreground">{activeMode.description}</div>
        </div>
        <Tabs.TabsContent value="execution" className="mt-3">
          <ExecutionView flow={flow} />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="cost" className="mt-3">
          <CostView flow={flow} />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="diagnostics" className="mt-3">
          <DiagnosticsView flow={flow} />
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </div>
  );
}
