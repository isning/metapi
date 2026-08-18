import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  type RuntimeSettingsPayload,
  type ProxyDebugTraceDetail,
  type ProxyLogBillingDetails,
  type ProxyLogBillingSummary,
  type ProxyExecutionAttemptLog,
  type ProxyRequestLog,
  type ProxyRequestLogDetail,
  type ProxyLogsSummary,
  type ProxyLogStatusFilter,
  type ProxyLogUsageSource,
} from "../api.js";
import { useToast } from "../components/Toast.js";
import { ModelBadge } from "../components/BrandIcon.js";
import CenteredModal from "../components/CenteredModal.js";
import MobileDrawer from "../components/MobileDrawer.js";
import ResponsiveFormGrid from "../components/ResponsiveFormGrid.js";
import SiteBadgeLink from "../components/SiteBadgeLink.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.js";
import SegmentedTabBar from "../components/SegmentedTabBar.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { formatDateTimeLocal } from "./helpers/checkinLogTime.js";
import { parseProxyLogPathMeta } from "./helpers/proxyLogPathMeta.js";
import { tr } from "../i18n.js";
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import InfoNote from '../components/InfoNote.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card/index.js';
import SearchInput from '../components/SearchInput.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import RuntimeIdentifier from '../components/RuntimeIdentifier.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';
import { DataTable, DataTableEmpty, DataTableToolbar } from '../components/ui/data-table/index.js';
import { Alert, AlertDescription } from '../components/ui/alert/index.js';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  CircleSlash2,
  Copy,
  ChevronRight,
  Coins,
  FileJson,
  Filter,
  GitBranch,
  Hash,
  KeyRound,
  Layers3,
  RefreshCw,
  Target,
  Timer,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible/index.js';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../components/ui/pagination/index.js';
import {
  proxyRequestLogRevision,
  useProxyLogsWorkspaceResource,
} from './hooks/useProxyLogsWorkspaceResource.js';

type ProxyLogRenderItem = ProxyRequestLog & {
  createdAt: string;
  modelRequested: string;
  modelActual: string | null;
  firstByteLatencyMs: number | null;
  retryCount: number;
  accountId: number | null;
  siteId: number | null;
  username: string | null;
  siteName: string | null;
  siteUrl: string | null;
  tokenId: number | null;
  tokenName: string | null;
  tokenGroup: string | null;
  downstreamKeyId: number | null;
  downstreamKeyName: string | null;
  downstreamKeyGroupName: string | null;
  downstreamKeyTags: string[];
  clientFamily: string | null;
  clientAppId: string | null;
  clientAppName: string | null;
  clientConfidence?: string | null;
  upstreamPath: string | null;
  sessionId: string | null;
  usageSource?: ProxyLogUsageSource;
  executionAttemptId: string | null;
  executionTargetId: number | null;
  billingDetails?: ProxyLogBillingDetails;
  decisionSnapshot?: ProxyRequestLogDetail["decisionSnapshot"];
  runtimeUsage?: ProxyRequestLogDetail["runtimeUsage"];
};

function presentProxyRequestLog(request: ProxyRequestLog | ProxyRequestLogDetail): ProxyLogRenderItem {
  const finalAttempt = request.finalExecutionAttemptId
    ? request.attempts.find((attempt) => attempt.executionAttemptId === request.finalExecutionAttemptId)
    : undefined;
  const detail = request as ProxyRequestLogDetail;
  const finalAttemptMessageMeta = parseProxyLogPathMeta(finalAttempt?.errorMessage ?? undefined);
  const requestMessageMeta = parseProxyLogPathMeta(request.errorMessage ?? undefined);
  return {
    ...request,
    createdAt: request.startedAt,
    modelRequested: request.requestedModel || '',
    modelActual: finalAttempt?.modelActual || null,
    firstByteLatencyMs: finalAttempt?.firstByteLatencyMs ?? null,
    retryCount: request.attempts.filter((attempt) => attempt.status === 'retried').length,
    accountId: finalAttempt?.accountId ?? null,
    siteId: finalAttempt?.siteId ?? null,
    username: finalAttempt?.username ?? null,
    siteName: finalAttempt?.siteName ?? null,
    siteUrl: finalAttempt?.siteUrl ?? null,
    tokenId: finalAttempt?.tokenId ?? null,
    tokenName: finalAttempt?.tokenName ?? null,
    tokenGroup: finalAttempt?.tokenGroup ?? null,
    downstreamKeyId: finalAttempt?.downstreamKeyId ?? null,
    downstreamKeyName: finalAttempt?.downstreamKeyName ?? null,
    downstreamKeyGroupName: finalAttempt?.downstreamKeyGroupName ?? null,
    downstreamKeyTags: finalAttempt?.downstreamKeyTags || [],
    clientFamily: finalAttempt?.clientFamily ?? null,
    clientAppId: finalAttempt?.clientAppId ?? null,
    clientAppName: finalAttempt?.clientAppName ?? null,
    clientConfidence: finalAttempt?.clientConfidence ?? null,
    upstreamPath: finalAttemptMessageMeta.upstreamPath || requestMessageMeta.upstreamPath || null,
    sessionId: finalAttemptMessageMeta.sessionId || requestMessageMeta.sessionId || null,
    usageSource: finalAttempt?.usageSource,
    executionAttemptId: finalAttempt?.executionAttemptId ?? null,
    executionTargetId: finalAttempt?.executionTargetId ?? null,
    billingDetails: detail.billingDetails,
    decisionSnapshot: detail.decisionSnapshot,
    runtimeUsage: detail.runtimeUsage,
  };
}

type ProxyDebugSettingsState = {
  proxyDebugTraceEnabled: boolean;
  proxyDebugCaptureHeaders: boolean;
  proxyDebugCaptureBodies: boolean;
  proxyDebugCaptureStreamChunks: boolean;
  proxyDebugFilterSessionId: string;
  proxyDebugFilterClientKind: string;
  proxyDebugFilterModel: string;
  proxyDebugRetentionHours: number;
  proxyDebugMaxBodyBytes: number;
};

type ProxyDebugTraceDetailState = {
  loading: boolean;
  data?: ProxyDebugTraceDetail;
  error?: string;
  requestRevision?: string;
  bodiesLoaded?: boolean;
  bodiesLoading?: boolean;
  attemptBodiesLoaded?: number[];
  attemptBodiesLoading?: number[];
};

type RawPayloadViewerState = {
  title: string;
  value: unknown;
};

type ProxyDebugTraceAttempt = ProxyDebugTraceDetail["attempts"][number];
type StoredDebugPreviewPayload = {
  __metapiTruncated?: boolean;
  preview?: string;
  originalBytes?: number;
  storedBytes?: number;
};

type ProxyDebugPreflightOutcome = {
  executionAttemptId: string;
  kind: 'site_api_endpoint_pool_unavailable';
  reason: 'all_endpoints_cooling_down' | 'all_endpoints_disabled' | 'no_eligible_endpoint';
  configuredEndpointCount: number;
  enabledEndpointCount: number;
  coolingDownEndpointCount: number;
  nextAvailableAt: string | null;
  endpointFailures: Array<{
    endpointId: number;
    url: string;
    enabled: boolean;
    cooldownUntil: string | null;
    lastFailureReason: string | null;
  }>;
};

const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;
const ALL_CLIENTS_SELECT_VALUE = "__all_clients__";
const ALL_SITES_SELECT_VALUE = "__all_sites__";
const PROXY_LOG_CLIENT_FAMILY_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  gemini_cli: "Gemini CLI",
  generic: tr('pages.proxyLogs.general'),
};
const DEFAULT_PROXY_DEBUG_SETTINGS: ProxyDebugSettingsState = {
  proxyDebugTraceEnabled: false,
  proxyDebugCaptureHeaders: true,
  proxyDebugCaptureBodies: false,
  proxyDebugCaptureStreamChunks: false,
  proxyDebugFilterSessionId: "",
  proxyDebugFilterClientKind: "",
  proxyDebugFilterModel: "",
  proxyDebugRetentionHours: 24,
  proxyDebugMaxBodyBytes: 262144,
};
type DetailDisclosureCardProps = {
  title: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

function DetailDisclosureCard({
  title,
  defaultOpen = false,
  onOpenChange,
  children,
}: DetailDisclosureCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); onOpenChange?.(nextOpen); }} className="proxy-log-disclosure">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="proxy-log-disclosure-head"
          aria-label={`${open ? tr('pages.accounts.collapse') : tr('pages.proxyLogs.expand')} ${title}`}
        >
          <strong>{title}</strong>
          <span className="proxy-log-disclosure-action">
            <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
            {open ? tr('pages.accounts.collapse') : tr('pages.proxyLogs.expand')}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="proxy-log-disclosure-content">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DetailField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-sm font-medium">{children}</div>
    </div>
  );
}

function RequestPathsDetail({
  downstreamPath,
  upstreamPath,
}: {
  downstreamPath: string | null | undefined;
  upstreamPath: string | null | undefined;
}) {
  return (
    <div className="proxy-log-detail-paths p-3">
      <DetailField label={tr('pages.proxyLogs.downstreamRequestPath')}>
        {downstreamPath
          ? <code className="proxy-log-path-code">{downstreamPath}</code>
          : <span className="text-muted-foreground">{tr('pages.proxyLogs.notRecorded')}</span>}
      </DetailField>
      <DetailField label={tr('pages.proxyLogs.upstreamRequestPath')}>
        {upstreamPath
          ? <code className="proxy-log-path-code">{upstreamPath}</code>
          : <span className="text-muted-foreground">{tr('pages.proxyLogs.notRecorded')}</span>}
      </DetailField>
    </div>
  );
}

function LongRuntimeId({
  value,
  kind,
  context,
  className,
  maxLength,
}: React.ComponentProps<typeof RuntimeIdentifier>) {
  return (
    <RuntimeIdentifier
      value={value}
      kind={kind}
      context={context}
      className={className}
      maxLength={maxLength}
    />
  );
}

function formatTraceEntityLabel(
  label: string | null | undefined,
  _id: number | null | undefined,
  fallbackLabel: string,
): string {
  const normalizedLabel = (label || '').trim() || fallbackLabel;
  return normalizedLabel;
}

function formatTraceEntryRouteLabel(trace: ProxyDebugTraceDetail["trace"]): string {
  if (trace.routeEntrypointId) return trace.routeEntrypointId;
  return (trace.requestedModel || '').trim() || tr('components.modelRouteFlow.entry');
}

function formatTraceRuntimeEndpointLabel(trace: ProxyDebugTraceDetail["trace"]): string | null {
  if (trace.runtimeEndpointId) return trace.runtimeEndpointId;
  return null;
}

function formatTraceSiteLabel(trace: ProxyDebugTraceDetail["trace"]): string {
  const siteDisplay = trace.selectedSiteDisplay;
  const platform = siteDisplay?.platform || trace.selectedSitePlatform;
  const name = siteDisplay?.label || platform || null;
  const label = [
    name,
    platform && platform !== name ? platform : null,
  ].filter(Boolean).join(' · ');
  return formatTraceEntityLabel(label, trace.selectedSiteId, tr('pages.proxyLogs.selectedSite'));
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function formatLatency(ms: number | null | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '--';
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  }
  return `${ms}ms`;
}

function proxyRequestStatusTone(status: string) {
  if (status === 'success') return 'success' as const;
  if (status === 'failure') return 'error' as const;
  return '-warning' as const;
}

function proxyRequestStatusLabel(status: string) {
  if (status === 'success') return tr('pages.checkinLog.success');
  if (status === 'failure') return tr('pages.checkinLog.failed');
  return tr('pages.proxyLogs.inProgress');
}

function firstByteTone(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number") return "-muted";
  if (ms >= 3000) return "-error";
  if (ms >= 1000) return "-warning";
  return "-info";
}

function interactiveStreamLatencyTone(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number") return "-muted";
  if (ms >= 3000) return "-error";
  if (ms >= 1000) return "-warning";
  return "-success";
}

function formatStreamModeLabel(isStream: boolean | null | undefined) {
  if (isStream == null) return null;
  return isStream ? tr('pages.modelTester.streaming') : tr('pages.proxyLogs.nonStreaming');
}

function formatFirstByteLabel(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number" || ms < 0) return null;
  return `${tr('pages.proxyLogs.firstByteLatency')} ${formatLatency(ms)}`;
}

function resolveInteractiveStreamLatency(log: Pick<ProxyLogRenderItem, 'firstByteLatencyMs' | 'firstTokenLatencyMs'>) {
  if (Number.isFinite(log.firstTokenLatencyMs) && typeof log.firstTokenLatencyMs === 'number' && log.firstTokenLatencyMs > 0) {
    return {
      label: tr('pages.proxyLogs.firstTokenLatency'),
      value: formatLatency(log.firstTokenLatencyMs),
      tone: interactiveStreamLatencyTone(log.firstTokenLatencyMs),
      badge: `${tr('pages.proxyLogs.firstTokenLatency')} ${formatLatency(log.firstTokenLatencyMs)}`,
    };
  }
  if (Number.isFinite(log.firstByteLatencyMs) && typeof log.firstByteLatencyMs === 'number' && log.firstByteLatencyMs >= 0) {
    return {
      label: tr('pages.proxyLogs.firstByteLatency'),
      value: formatLatency(log.firstByteLatencyMs),
      tone: firstByteTone(log.firstByteLatencyMs),
      badge: formatFirstByteLabel(log.firstByteLatencyMs)!,
    };
  }
  return null;
}

function formatCompactNumber(value: number, digits = 6) {
  if (!Number.isFinite(value)) return "0";
  const formatted = value.toFixed(digits).replace(/\.?0+$/, "");
  return formatted || "0";
}

function formatOptionalCompactNumber(value: number | null) {
  return value == null ? "-" : formatCompactNumber(value);
}

function formatPerMillionPrice(value: number | null) {
  return value == null ? "-" : `${formatCompactNumber(value)} / 1M tokens`;
}

function formatDownstreamProtocol(path: string | null | undefined): string | null {
  const normalized = String(path || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith('/responses')) return 'Responses';
  if (normalized.endsWith('/chat/completions')) return 'Chat Completions';
  if (normalized.endsWith('/messages')) return 'Anthropic Messages';
  if (normalized.includes('generatecontent')) return 'Gemini generateContent';
  if (normalized.endsWith('/embeddings')) return 'Embeddings';
  return null;
}

const UPSTREAM_API_TYPE_LABELS: Record<string, string> = {
  'openai.responses': 'OpenAI Responses',
  'openai.responses.websocket': 'OpenAI Responses WebSocket',
  'openai.responses.compact': 'OpenAI Responses Compact',
  'openai.chat_completions': 'OpenAI Chat Completions',
  'openai.completions': 'OpenAI Completions',
  'openai.embeddings': 'OpenAI Embeddings',
  'openai.images.generations': 'OpenAI Images',
  'openai.images.edits': 'OpenAI Image Edits',
  'openai.videos': 'OpenAI Videos',
  'openai.videos.generations': 'OpenAI Video Generations',
  'anthropic.messages': 'Anthropic Messages',
  'anthropic.messages.count_tokens': 'Anthropic Count Tokens',
  'gemini.generate_content': 'Gemini generateContent',
  'gemini.count_tokens': 'Gemini countTokens',
  responses: 'OpenAI Responses',
  chat: 'OpenAI Chat Completions',
  messages: 'Anthropic Messages',
  gemini: 'Gemini generateContent',
};

function formatUpstreamApiTypeLabel(endpointType: string): string {
  return UPSTREAM_API_TYPE_LABELS[endpointType] || endpointType;
}

function formatBillingEstimateLevel(level: string | null | undefined): string | null {
  if (level === 'exact') return tr('pages.proxyLogs.estimateExact');
  if (level === 'request_estimate') return tr('pages.proxyLogs.estimateRequest');
  if (level === 'period_estimate') return tr('pages.proxyLogs.estimatePeriod');
  if (level === 'incomplete') return tr('pages.proxyLogs.estimateIncomplete');
  return null;
}

function formatCostAmount(amount: { amount: number; unit: string; currency: string | null; estimateLevel?: string | null }) {
  const unit = amount.unit === 'currency' ? (amount.currency || 'USD') : tr('pages.downstreamKeys.quota');
  const estimate = formatBillingEstimateLevel(amount.estimateLevel);
  return `${unit} ${formatCompactNumber(amount.amount, 4)}${estimate ? ` · ${estimate}` : ''}`;
}

function CostOverviewValue({ summary }: { summary: ProxyLogsSummary['cost'] }) {
  const visible = summary.amounts.slice(0, 1).map(formatCostAmount);
  const secondary = [
    summary.amounts.length > visible.length
      ? `+${summary.amounts.length - visible.length} ${tr('pages.proxyLogs.moreCostSources')}`
      : null,
    summary.unknownObservationCount > 0
      ? `${summary.unknownObservationCount.toLocaleString()} ${tr('pages.proxyLogs.unknownCostObservations')}`
      : null,
  ].filter(Boolean);
  return (
    <span className="proxy-log-cost-overview">
      <span>{visible.length > 0 ? visible.join(' / ') : '--'}</span>
      {secondary.length > 0 ? <small>{secondary.join(' · ')}</small> : null}
    </span>
  );
}

function formatRequestCost(summary: ProxyLogBillingSummary | null | undefined): string {
  return summary?.quote ? formatCostAmount(summary.quote) : '--';
}

function requestCacheMetrics(summary: ProxyLogBillingSummary | null | undefined) {
  return [
    typeof summary?.cacheReadTokens === 'number' && summary.cacheReadTokens > 0
      ? { label: tr('pages.proxyLogs.cacheRead'), value: summary.cacheReadTokens.toLocaleString() }
      : null,
    typeof summary?.cacheCreationTokens === 'number' && summary.cacheCreationTokens > 0
      ? { label: tr('pages.proxyLogs.cacheWrite'), value: summary.cacheCreationTokens.toLocaleString() }
      : null,
  ].filter((metric): metric is { label: string; value: string } => metric != null);
}

function resolveProxyLogUpstreamPath(
  log: ProxyLogRenderItem,
  debugTrace: ProxyRequestLog['debugTrace'],
): string | null {
  return debugTrace?.finalUpstreamPath || log.upstreamPath || null;
}

function formatProxyLogUsageSource(
  source: ProxyLogUsageSource | undefined,
): string | null {
  if (source === "upstream") return tr('pages.proxyLogs.upstreamResponse');
  if (source === "self-log") return tr('pages.proxyLogs.sites');
  if (source === "unknown") return tr('pages.accounts.unknown2');
  return null;
}

function formatProxyRouteStrategyLabel(strategy: string | null | undefined) {
  if (strategy === "round_robin") return tr('pages.proxyLogs.roundRobin');
  if (strategy === "stable_first") return tr('pages.proxyLogs.stableFirst');
  if (strategy === "weighted") return tr('pages.proxyLogs.weighted');
  return strategy || tr('pages.accounts.unknown2');
}

function formatProxyDecisionMatchKind(kind: string | null | undefined) {
  if (kind === "model") return tr('components.modelAnalysisPanel.model');
  if (kind === "fallback") return tr('pages.proxyLogs.fallback');
  return kind || tr('pages.accounts.unknown2');
}

function formatProxyFallbackScope(scope: string | null | undefined) {
  if (scope === "api_variant") return tr('pages.proxyLogs.apiVariantFallback');
  if (scope === "transport_replica") return tr('pages.proxyLogs.transportReplicaFallback');
  if (scope === "execution_attempt") return tr('pages.proxyLogs.executionAttemptFallback');
  if (scope === "terminal") return tr('pages.proxyLogs.terminalFallback');
  return scope || "-";
}

function formatProxyFailureClass(kind: string | null | undefined) {
  if (kind === "protocol_mismatch") return tr('pages.proxyLogs.protocolMismatch');
  if (kind === "transport_failure") return tr('pages.proxyLogs.transportFailure');
  if (kind === "upstream_error") return tr('pages.proxyLogs.upstreamError');
  if (kind === "validation_error") return tr('pages.proxyLogs.validationError');
  return kind || "-";
}

function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "-";
}

function formatProxyLogTokenValue(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "--";
}

function renderDownstreamKeySummary(log: ProxyLogRenderItem) {
  const parts = [
    log.downstreamKeyName
      ? formatProxyLogTemplate('pages.proxyLogs.downstreamKeyValue', { value: log.downstreamKeyName })
      : null,
    log.downstreamKeyGroupName
      ? formatProxyLogTemplate('pages.proxyLogs.primaryGroupValue', { value: log.downstreamKeyGroupName })
      : null,
    Array.isArray(log.downstreamKeyTags) && log.downstreamKeyTags.length > 0
      ? formatProxyLogTemplate('pages.proxyLogs.tagsValue', { value: log.downstreamKeyTags.join(' / ') })
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(tr('pages.proxyLogs.detailSeparator')) : null;
}

function formatProxyLogTemplate(key: string, replacements: Record<string, string | number>) {
  let value = tr(key);
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function formatUpstreamCallCount(count: number): string {
  return formatProxyLogTemplate(
    count === 1 ? 'pages.proxyLogs.upstreamCallCountOne' : 'pages.proxyLogs.upstreamCallCount',
    { count },
  );
}

function ProxyLogTargetSummary({
  siteId,
  siteName,
  username,
  tokenName,
  tokenGroup,
  tokenId,
  client,
  compact = false,
  showUsername = true,
}: {
  siteId: number | null;
  siteName: string | null;
  username: string | null;
  tokenName: string | null;
  tokenGroup: string | null;
  tokenId: number | null;
  client?: React.ReactNode;
  compact?: boolean;
  showUsername?: boolean;
}) {
  const tokenLabel = tokenName || tokenGroup || (tokenId != null ? `#${tokenId}` : null);
  const hasIdentity = Boolean(siteId || siteName || username || tokenLabel);
  if (!hasIdentity) {
    return <span className="text-xs text-muted-foreground">{tr('pages.proxyLogs.noUpstreamRequest')}</span>;
  }
  return (
    <div className={`proxy-log-target-summary ${compact ? 'is-compact' : ''}`}>
      <div className="proxy-log-target-summary-primary">
        <SiteBadgeLink siteId={siteId ?? undefined} siteName={siteName} badgeStyle={{ fontSize: 11 }} />
      </div>
      <div className="proxy-log-target-summary-details">
        {showUsername && username ? <span><span className="text-muted-foreground">{tr('pages.accounts.username')}</span> {username}</span> : null}
        {tokenLabel ? <span><span className="text-muted-foreground">{tr('pages.proxyLogs.modelKey')}:</span> {tokenLabel}</span> : null}
        {tokenGroup && tokenName && tokenGroup !== tokenName ? <span className="text-muted-foreground">{tokenGroup}</span> : null}
        {client ? <span className="text-muted-foreground">{client}</span> : null}
      </div>
    </div>
  );
}

function ProxyExecutionAttemptTimeline({
  attempts,
  finalExecutionAttemptId,
  decisionSnapshotExecutionAttemptId,
  requestedModel,
  debugAttempts = [],
  preflightOutcomes = [],
  renderUpstreamExchange,
}: {
  attempts: ProxyExecutionAttemptLog[];
  finalExecutionAttemptId: string | null;
  decisionSnapshotExecutionAttemptId?: string | null;
  requestedModel?: string | null;
  debugAttempts?: ProxyDebugTraceAttempt[];
  preflightOutcomes?: ProxyDebugPreflightOutcome[];
  renderUpstreamExchange?: (attempt: ProxyDebugTraceAttempt, exchangeIndex: number) => React.ReactNode;
}) {
  function targetContext(attempt: ProxyExecutionAttemptLog) {
    return {
      identity: [
        attempt.siteName || tr('pages.proxyLogs.unknownSite'),
        attempt.username || tr('pages.proxyLogs.unknownAccount'),
      ].join(' · '),
      modelKey: attempt.tokenName
        || attempt.tokenGroup
        || (attempt.tokenId != null ? `#${attempt.tokenId}` : tr('pages.proxyLogs.notRecorded')),
    };
  }

  return (
    <section className="proxy-log-attempts-section" aria-label={tr('pages.proxyLogs.executionAttemptsAndFallback')}>
      <div className="proxy-log-section-heading">
        <strong>{tr('pages.proxyLogs.executionAttempts')}</strong>
        <ToneBadge tone="-muted">{attempts.length}</ToneBadge>
      </div>
      {attempts.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {tr('pages.proxyLogs.noAttemptRecords')}
        </div>
      ) : (
        <div className="proxy-log-attempt-list">
          {attempts.map((attempt, index) => {
            const isFinal = attempt.executionAttemptId === finalExecutionAttemptId;
            const hasFinalDecisionSnapshot = (
              attempt.executionAttemptId === decisionSnapshotExecutionAttemptId
            );
            const target = targetContext(attempt);
            const upstreamExchanges = debugAttempts.filter((debugAttempt) => (
              debugAttempt.executionAttemptId === attempt.executionAttemptId
              || (
                debugAttempt.executionAttemptId == null
                && attempts.length === 1
              )
            ));
            const statusTone = attempt.status === 'success'
              ? 'success'
              : attempt.status === 'retried'
                ? '-warning'
                : 'error';
            const preflightOutcome = preflightOutcomes.find((outcome) => (
              outcome.executionAttemptId === attempt.executionAttemptId
            ));
            return (
              <article
                key={attempt.id}
                className={`proxy-log-attempt-row ${isFinal ? 'is-final' : ''}`}
                data-testid={`proxy-log-execution-attempt-${attempt.id}`}
              >
                <div className="proxy-log-attempt-index" aria-hidden="true">{index + 1}</div>
                <div className="proxy-log-attempt-content">
                <div className="proxy-log-attempt-head">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">
                      {tr('pages.proxyLogs.runtimeScopeExecutionAttempt')} {index + 1}
                    </div>
                    <div className="proxy-log-attempt-identity">
                      <strong>{target.identity}</strong>
                      <span className="proxy-log-attempt-key">
                        <span>{tr('pages.proxyLogs.modelKey')}</span>
                        <span>{target.modelKey}</span>
                      </span>
                      <div className="proxy-log-attempt-id">
                        <span>{tr('pages.proxyLogs.attemptId')}</span>
                        <RuntimeIdentifier value={attempt.executionAttemptId} kind="execution-attempt" maxLength={160} className="runtime-identifier-wrap" />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <ToneBadge tone={statusTone}>
                      {attempt.status === 'success'
                        ? tr('pages.checkinLog.success')
                        : attempt.status === 'retried'
                          ? tr('pages.proxyLogs.attemptContinued')
                          : tr('pages.checkinLog.failed')}
                    </ToneBadge>
                    {isFinal ? (
                      <ToneBadge tone="-muted">{tr('pages.proxyLogs.finalAttempt')}</ToneBadge>
                    ) : null}
                    {hasFinalDecisionSnapshot ? (
                      <ToneBadge tone="-info">{tr('pages.proxyLogs.selectedTarget')}</ToneBadge>
                    ) : null}
                    {upstreamExchanges.length > 0 ? (
                      <ToneBadge tone="-info">
                        {formatUpstreamCallCount(upstreamExchanges.length)}
                      </ToneBadge>
                    ) : null}
                    {upstreamExchanges.length === 0 && preflightOutcome ? (
                      <ToneBadge tone="-warning">{tr('pages.proxyLogs.requestNotSentUpstream')}</ToneBadge>
                    ) : null}
                  </div>
                </div>
                <div className="proxy-log-attempt-facts">
                  <DetailField label={tr('pages.proxyLogs.runtimeScopeEndpoint')}>
                    <RuntimeIdentifier value={attempt.runtimeEndpointId} kind="route-endpoint" maxLength={160} className="runtime-identifier-wrap" />
                  </DetailField>
                  {attempt.modelActual && attempt.modelActual !== requestedModel ? (
                    <DetailField label={tr('pages.proxyLogs.actualModel')}>
                      {attempt.modelActual}
                    </DetailField>
                  ) : null}
                  <DetailField label="HTTP">{attempt.httpStatus ?? '-'}</DetailField>
                  <DetailField label={tr('pages.proxyLogs.duration')}>
                    {formatLatency(attempt.latencyMs)}
                  </DetailField>
                </div>
                {upstreamExchanges.length > 0 && renderUpstreamExchange ? (
                  <div className="proxy-log-attempt-exchanges">
                    <div className="proxy-log-attempt-exchanges-heading">
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                      <div>
                        <strong>{tr('pages.proxyLogs.upstreamExchange')}</strong>
                        <span>{tr('pages.proxyLogs.upstreamExchangeDescription')}</span>
                      </div>
                    </div>
                    <div className="proxy-log-attempt-exchange-list">
                      {upstreamExchanges.map((debugAttempt, exchangeIndex) => (
                        <React.Fragment key={debugAttempt.id}>
                          {renderUpstreamExchange(debugAttempt, exchangeIndex)}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ) : preflightOutcome ? (
                  <AttemptPreflightOutcome outcome={preflightOutcome} />
                ) : (
                  <div className="proxy-log-attempt-observability-gap">
                    <CircleSlash2 className="size-4" aria-hidden="true" />
                    <div>
                      <strong>{tr('pages.proxyLogs.noUpstreamExchangeRecorded')}</strong>
                      <span>{tr('pages.proxyLogs.noUpstreamExchangeRecordedDescription')}</span>
                    </div>
                  </div>
                )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AttemptPreflightOutcome({ outcome }: { outcome: ProxyDebugPreflightOutcome }) {
  const reason = outcome.reason === 'all_endpoints_cooling_down'
    ? formatProxyLogTemplate('pages.proxyLogs.siteEndpointAllCooling', { count: outcome.coolingDownEndpointCount })
    : outcome.reason === 'all_endpoints_disabled'
      ? tr('pages.proxyLogs.siteEndpointAllDisabled')
      : tr('pages.proxyLogs.siteEndpointNoEligible');
  const endpoints = outcome.endpointFailures.filter((entry) => entry.url);
  return (
    <div className="proxy-log-attempt-preflight" data-testid="proxy-log-attempt-preflight">
      <CircleSlash2 className="size-4" aria-hidden="true" />
      <div className="proxy-log-attempt-preflight-content">
        <div>
          <strong>{tr('pages.proxyLogs.requestNotSentUpstream')}</strong>
          <span>{tr('pages.proxyLogs.siteEndpointUnavailable')}</span>
        </div>
        <p>{reason}</p>
        {outcome.nextAvailableAt ? (
          <p className="proxy-log-attempt-preflight-time">
            {tr('pages.proxyLogs.cooldown')}: {formatDateTimeLocal(outcome.nextAvailableAt)}
          </p>
        ) : null}
        {endpoints.length > 0 ? (
          <details className="proxy-log-attempt-preflight-details">
            <summary>{tr('pages.proxyLogs.siteEndpointStatus')}</summary>
            <ul>
              {endpoints.map((entry) => (
                <li key={entry.endpointId}>
                  <code>{entry.url}</code>
                  <span>{entry.enabled ? tr('pages.proxyLogs.enabled') : tr('pages.proxyLogs.disabled')}</span>
                  {entry.cooldownUntil ? <span>{tr('pages.proxyLogs.cooldown')}: {formatDateTimeLocal(entry.cooldownUntil)}</span> : null}
                  {entry.lastFailureReason ? <span>{entry.lastFailureReason}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function getProxyDebugPreflightOutcomes(runtimeTraceJson: unknown): ProxyDebugPreflightOutcome[] {
  const runtimeTrace = asDebugRecord(parseStoredDebugJson(runtimeTraceJson));
  const rawOutcomes = runtimeTrace?.preflightOutcomes;
  if (!Array.isArray(rawOutcomes)) return [];
  return rawOutcomes.filter((outcome): outcome is ProxyDebugPreflightOutcome => (
    !!outcome
    && typeof outcome === 'object'
    && (outcome as Record<string, unknown>).kind === 'site_api_endpoint_pool_unavailable'
    && typeof (outcome as Record<string, unknown>).executionAttemptId === 'string'
  ));
}

type ProxyLogRuntimeUsageSummary = NonNullable<ProxyRequestLogDetail["runtimeUsage"]>;
type ProxyLogRuntimeUsageScope = NonNullable<ProxyLogRuntimeUsageSummary["entry"]>;

function listRuntimeUsageScopes(
  runtimeUsage: ProxyLogRuntimeUsageSummary,
): ProxyLogRuntimeUsageScope[] {
  return [
    runtimeUsage.entry,
    runtimeUsage.endpoint,
    runtimeUsage.executionAttempt,
    runtimeUsage.model,
  ].filter((scope): scope is ProxyLogRuntimeUsageScope => !!scope);
}

function formatRuntimeUsageScopeLabel(
  scope: ProxyLogRuntimeUsageScope["scope"],
): string {
  if (scope === "entry") return tr('pages.proxyLogs.runtimeScopeEntry');
  if (scope === "endpoint") return tr('pages.proxyLogs.runtimeScopeEndpoint');
  if (scope === "executionAttempt") return tr('pages.proxyLogs.runtimeScopeExecutionAttempt');
  return tr('pages.proxyLogs.runtimeScopeModel');
}

function formatRuntimeUsageScopeIdentity(scope: ProxyLogRuntimeUsageScope): string {
  if (scope.scope === "entry") {
    return `#${scope.identity}`;
  }
  return scope.identity;
}

function formatRuntimeUsageScopeDisplay(scope: ProxyLogRuntimeUsageScope): string {
  const identity = String(scope.identity || '').replace(/^#/, '');
  if (scope.scope === 'model' || identity.length <= 28) return identity || '-';
  const alternative = identity.match(/:alt:([^:]+)$/);
  if (alternative) return `${tr('pages.proxyLogs.candidate')} · ${alternative[1]}`;
  const managed = identity.match(/:managed:([^:]+)/);
  if (managed) return `managed · ${managed[1].slice(-12)}`;
  const tail = identity.split(':').filter(Boolean).at(-1) || identity;
  return tail.length > 18 ? `…${tail.slice(-16)}` : tail;
}

function formatRuntimeUsageSuccessRate(scope: ProxyLogRuntimeUsageScope): string {
  return typeof scope.successRate === "number"
    ? `${formatCompactNumber(scope.successRate, 2)}%`
    : "-";
}

function formatRuntimeUsageCost(scope: ProxyLogRuntimeUsageScope): string {
  if (scope.cost.amounts.length === 0) return "-";
  return scope.cost.amounts.map((amount) => {
    const unit = amount.unit === "currency"
      ? amount.currency
      : tr('pages.downstreamKeys.quota');
    return `${unit ? `${unit} ` : ""}${formatCompactNumber(amount.amount)}`;
  }).join(" / ");
}

function RuntimeUsageSummaryBlock({
  runtimeUsage,
}: {
  runtimeUsage?: ProxyRequestLogDetail["runtimeUsage"] | null;
}) {
  if (!runtimeUsage) return null;
  const scopes = listRuntimeUsageScopes(runtimeUsage);
  if (scopes.length === 0) return null;
  const hasCost = scopes.some((scope) => scope.cost.amounts.length > 0);

  return (
    <section className="proxy-log-detail-section proxy-log-runtime-section">
      <div className="proxy-log-subsection-heading">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <Activity className="size-3.5" />
          {tr('pages.proxyLogs.runtimeUsage')}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone="-muted">
            {formatProxyLogTemplate('pages.proxyLogs.runtimeUsageWindowDays', {
              days: runtimeUsage.windowDays,
            })}
          </ToneBadge>
          <span className="text-[11px] text-muted-foreground">
            {runtimeUsage.fromLocalDay} - {runtimeUsage.toLocalDay}
          </span>
        </div>
      </div>
      <div className={`proxy-log-runtime-usage-table ${hasCost ? 'has-cost' : ''}`}>
        <div className="proxy-log-runtime-usage-header" aria-hidden="true">
          <span>{tr('pages.proxyLogs.runtimeScope')}</span>
          <span>{tr('pages.proxyLogs.runtimeMetricSuccessRate')}</span>
          <span>{tr('pages.proxyLogs.runtimeMetricCalls')}</span>
          <span>{tr('pages.proxyLogs.runtimeMetricFailed')}</span>
          <span>{tr('pages.proxyLogs.runtimeMetricTokens')}</span>
          <span>{tr('pages.proxyLogs.runtimeMetricAverageLatency')}</span>
          {hasCost ? <span>{tr('pages.proxyLogs.runtimeMetricCost')}</span> : null}
        </div>
        {scopes.map((scope) => (
          <div
            key={`${scope.scope}:${scope.identity}`}
            className="proxy-log-runtime-usage-row"
          >
            <div className="proxy-log-runtime-usage-scope">
              <div className="proxy-log-runtime-usage-label">
                {formatRuntimeUsageScopeLabel(scope.scope)}
              </div>
              <code className="proxy-log-runtime-usage-identity" title={formatRuntimeUsageScopeIdentity(scope)}>
                {formatRuntimeUsageScopeDisplay(scope)}
              </code>
            </div>
            <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricSuccessRate')}><strong>{formatRuntimeUsageSuccessRate(scope)}</strong></div>
            <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricCalls')}><strong>{scope.totalCalls.toLocaleString()}</strong></div>
            <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricFailed')}><strong>{scope.failedCalls.toLocaleString()}</strong></div>
            <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricTokens')}><strong>{scope.totalTokens.toLocaleString()}</strong></div>
            <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricAverageLatency')}>
              <strong>{typeof scope.averageLatencyMs === "number" ? formatLatency(scope.averageLatencyMs) : "-"}</strong>
            </div>
            {hasCost ? <div className="proxy-log-runtime-usage-stat" data-label={tr('pages.proxyLogs.runtimeMetricCost')}><strong>{formatRuntimeUsageCost(scope)}</strong></div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function buildBillingFormula(detail: NonNullable<ProxyLogBillingDetails>) {
  const parts = [
    formatProxyLogTemplate('pages.proxyLogs.promptFormulaValue', {
      tokens: detail.usage.billablePromptTokens.toLocaleString(),
      price: formatOptionalCompactNumber(detail.breakdown.inputPerMillion),
    }),
  ];
  if (detail.usage.cacheReadTokens > 0) {
    parts.push(formatProxyLogTemplate('pages.proxyLogs.cacheReadFormulaValue', {
      tokens: detail.usage.cacheReadTokens.toLocaleString(),
      price: formatOptionalCompactNumber(detail.breakdown.cacheReadPerMillion),
    }));
  }
  if (detail.usage.cacheCreationTokens > 0) {
    parts.push(formatProxyLogTemplate('pages.proxyLogs.cacheWriteFormulaValue', {
      tokens: detail.usage.cacheCreationTokens.toLocaleString(),
      price: formatOptionalCompactNumber(detail.breakdown.cacheCreationPerMillion),
    }));
  }
  parts.push(formatProxyLogTemplate('pages.proxyLogs.completionFormulaValue', {
    tokens: detail.usage.completionTokens.toLocaleString(),
    price: formatOptionalCompactNumber(detail.breakdown.outputPerMillion),
    total: detail.breakdown.totalCost.toFixed(6),
  }));
  return parts.join(' + ');
}

function UsageAndBillingDetail({ log }: { log: ProxyLogRenderItem }) {
  const detail = log.billingDetails;
  const usage = detail?.usage;
  const inputTokens = usage?.promptTokens ?? log.promptTokens;
  const outputTokens = usage?.completionTokens ?? log.completionTokens;
  const cacheReadTokens = usage?.cacheReadTokens ?? log.billingSummary?.cacheReadTokens ?? null;
  const cacheCreationTokens = usage?.cacheCreationTokens ?? log.billingSummary?.cacheCreationTokens ?? null;
  const billableInputTokens = usage?.billablePromptTokens ?? null;
  const quote = detail?.quote || log.billingSummary?.quote || null;
  const hasUsage = [inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens]
    .some((value) => typeof value === 'number');
  const rateRows = detail ? [
    { label: tr('pages.proxyLogs.input'), value: formatPerMillionPrice(detail.breakdown.inputPerMillion) },
    { label: tr('pages.proxyLogs.output'), value: formatPerMillionPrice(detail.breakdown.outputPerMillion) },
    detail.usage.cacheReadTokens > 0
      ? { label: tr('pages.proxyLogs.cacheRead'), value: formatPerMillionPrice(detail.breakdown.cacheReadPerMillion) }
      : null,
    detail.usage.cacheCreationTokens > 0
      ? { label: tr('pages.proxyLogs.cacheWrite'), value: formatPerMillionPrice(detail.breakdown.cacheCreationPerMillion) }
      : null,
  ].filter((row): row is { label: string; value: string } => row != null) : [];

  return (
    <div className="proxy-log-usage-detail">
      <section className="proxy-log-detail-section">
        <div className="proxy-log-subsection-heading">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <Coins className="size-3.5" />
            {tr('pages.proxyLogs.thisRequestUsage')}
          </div>
        </div>
        {hasUsage || quote || typeof log.estimatedCost === 'number' ? (
          <div className="proxy-log-request-usage-grid">
            {typeof inputTokens === 'number' ? <LogInlineMetric label={tr('pages.proxyLogs.input')} value={inputTokens.toLocaleString()} /> : null}
            {typeof cacheReadTokens === 'number' && cacheReadTokens > 0 ? <LogInlineMetric label={tr('pages.proxyLogs.cacheRead')} value={cacheReadTokens.toLocaleString()} /> : null}
            {typeof cacheCreationTokens === 'number' && cacheCreationTokens > 0 ? <LogInlineMetric label={tr('pages.proxyLogs.cacheWrite')} value={cacheCreationTokens.toLocaleString()} /> : null}
            {typeof billableInputTokens === 'number' && billableInputTokens !== inputTokens ? <LogInlineMetric label={tr('pages.proxyLogs.billableInput')} value={billableInputTokens.toLocaleString()} /> : null}
            {typeof outputTokens === 'number' ? <LogInlineMetric label={tr('pages.proxyLogs.output')} value={outputTokens.toLocaleString()} /> : null}
            <LogInlineMetric
              label={tr('pages.proxyLogs.cost')}
              value={quote ? formatCostAmount(quote) : typeof log.estimatedCost === 'number' ? formatCompactNumber(log.estimatedCost) : '--'}
              tone="-success"
            />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.usageNotRecorded')}</div>
        )}
      </section>

      {detail ? (
        <section className="proxy-log-detail-section proxy-log-pricing-section">
          <div className="proxy-log-subsection-heading">
            <strong>{tr('pages.proxyLogs.billingProcess')}</strong>
          </div>
          <dl className="proxy-log-pricing-rates">
            {rateRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="proxy-log-billing-formula">
            <span>{tr('pages.proxyLogs.billingFormula')}</span>
            <code>{buildBillingFormula(detail)}</code>
          </div>
          <p className="proxy-log-billing-note">{tr('pages.proxyLogs.referenceOnlyActualBillingPrevails')}</p>
        </section>
      ) : null}

      <RuntimeUsageSummaryBlock runtimeUsage={log.runtimeUsage} />
    </div>
  );
}

function padDateTimeSegment(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeInputValue(value: Date) {
  return `${value.getFullYear()}-${padDateTimeSegment(value.getMonth() + 1)}-${padDateTimeSegment(value.getDate())}T${padDateTimeSegment(value.getHours())}:${padDateTimeSegment(value.getMinutes())}`;
}

function normalizeRoutePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function normalizeRoutePageSize(raw: string | null): number {
  const parsed = Number.parseInt(raw || "", 10);
  return PAGE_SIZES.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

function normalizeRouteStatus(raw: string | null): ProxyLogStatusFilter {
  if (raw === "success" || raw === "failed") return raw;
  return "all";
}

function normalizeRouteSearch(raw: string | null): string {
  return (raw || "").trim();
}

function normalizeRouteClient(raw: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  return /^((app|family):)/i.test(text) ? text : "";
}

function normalizeRouteSiteId(raw: string | null): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeRouteDateTimeInput(raw: string | null): string {
  const text = (raw || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDateTimeInputValue(parsed);
}

function readProxyLogsRouteState(search: string) {
  const params = new URLSearchParams(search);
  return {
    page: normalizeRoutePage(params.get("page")),
    pageSize: normalizeRoutePageSize(params.get("pageSize")),
    status: normalizeRouteStatus(params.get("status")),
    search: normalizeRouteSearch(params.get("q")),
    client: normalizeRouteClient(params.get("client")),
    siteId: normalizeRouteSiteId(params.get("siteId")),
    from: normalizeRouteDateTimeInput(params.get("from")),
    to: normalizeRouteDateTimeInput(params.get("to")),
  };
}

function buildProxyLogsRouteSearch(input: {
  page: number;
  pageSize: number;
  status: ProxyLogStatusFilter;
  search: string;
  client: string;
  siteId: number | null;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  if (input.page > 1) params.set("page", String(input.page));
  if (input.pageSize !== DEFAULT_PAGE_SIZE)
    params.set("pageSize", String(input.pageSize));
  if (input.status !== "all") params.set("status", input.status);
  if (input.search.trim()) params.set("q", input.search.trim());
  if (input.client.trim()) params.set("client", input.client.trim());
  if (input.siteId) params.set("siteId", String(input.siteId));
  if (input.from.trim()) params.set("from", input.from.trim());
  if (input.to.trim()) params.set("to", input.to.trim());
  const next = params.toString();
  return next ? `?${next}` : "";
}

function formatProxyLogClientFamilyLabel(
  clientFamily?: string | null,
  options?: { includeGeneric?: boolean },
) {
  const normalized =
    typeof clientFamily === "string" ? clientFamily.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (!options?.includeGeneric && normalized === "generic") return null;
  return PROXY_LOG_CLIENT_FAMILY_LABELS[normalized] || clientFamily || null;
}

function resolveProxyLogClientDisplay(
  log: Pick<
    ProxyLogRenderItem,
    "clientFamily" | "clientAppName" | "clientConfidence"
  >,
  options?: { includeGeneric?: boolean },
) {
  const familyLabel = formatProxyLogClientFamilyLabel(
    log.clientFamily,
    options,
  );
  const appName =
    typeof log.clientAppName === "string" ? log.clientAppName.trim() : "";
  if (appName) {
    return {
      app: appName,
      profile: familyLabel,
      heuristic: log.clientConfidence === "heuristic",
    };
  }
  return {
    app: null,
    profile: familyLabel,
    heuristic: false,
  };
}

function renderProxyLogClientCell(
  log: Pick<
    ProxyLogRenderItem,
    "clientFamily" | "clientAppName" | "clientConfidence"
  >,
  options?: { includeGeneric?: boolean },
) {
  const display = resolveProxyLogClientDisplay(log, options);
  if (!display.app && !display.profile) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {display.app ? <span><span className="text-muted-foreground">{tr('pages.proxyLogs.clientApplication')}:</span> {display.app}</span> : null}
        {display.app && display.heuristic ? (
          <ToneBadge tone="">
            {tr('pages.proxyLogs.inferred')}
          </ToneBadge>
        ) : null}
      </div>
      {display.profile ? (
        <span className="text-xs text-muted-foreground">
        {tr('pages.proxyLogs.clientProfile')}: {display.profile}
        </span>
      ) : null}
    </div>
  );
}

function toApiTimeBoundary(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeProxyDebugSettings(value: any): ProxyDebugSettingsState {
  return {
    proxyDebugTraceEnabled: !!value?.proxyDebugTraceEnabled,
    proxyDebugCaptureHeaders: value?.proxyDebugCaptureHeaders !== false,
    proxyDebugCaptureBodies: !!value?.proxyDebugCaptureBodies,
    proxyDebugCaptureStreamChunks: !!value?.proxyDebugCaptureStreamChunks,
    proxyDebugFilterSessionId: String(value?.proxyDebugFilterSessionId || ""),
    proxyDebugFilterClientKind: String(value?.proxyDebugFilterClientKind || ""),
    proxyDebugFilterModel: String(value?.proxyDebugFilterModel || ""),
    proxyDebugRetentionHours: Number(value?.proxyDebugRetentionHours || 24),
    proxyDebugMaxBodyBytes: Number(value?.proxyDebugMaxBodyBytes || 262144),
  };
}

function buildProxyDebugSettingsPayload(
  settings: ProxyDebugSettingsState,
): RuntimeSettingsPayload {
  return {
    proxyDebugTraceEnabled: settings.proxyDebugTraceEnabled,
    proxyDebugCaptureHeaders: settings.proxyDebugCaptureHeaders,
    proxyDebugCaptureBodies: settings.proxyDebugCaptureBodies,
    proxyDebugCaptureStreamChunks: settings.proxyDebugCaptureStreamChunks,
    proxyDebugFilterSessionId: settings.proxyDebugFilterSessionId.trim(),
    proxyDebugFilterClientKind: settings.proxyDebugFilterClientKind.trim(),
    proxyDebugFilterModel: settings.proxyDebugFilterModel.trim(),
    proxyDebugRetentionHours: Math.max(
      1,
      Math.trunc(Number(settings.proxyDebugRetentionHours || 24)),
    ),
    proxyDebugMaxBodyBytes: Math.max(
      1024,
      Math.trunc(Number(settings.proxyDebugMaxBodyBytes || 262144)),
    ),
  };
}

function formatProxyDebugCaptureSummary(settings: ProxyDebugSettingsState) {
  const parts = [tr('pages.proxyLogs.routes')];
  if (settings.proxyDebugCaptureHeaders) parts.push(tr('pages.proxyLogs.requestResponseHeaders'));
  if (settings.proxyDebugCaptureBodies) parts.push(tr('pages.proxyLogs.requestResponseBody'));
  if (settings.proxyDebugCaptureStreamChunks) parts.push(tr('pages.proxyLogs.streaming'));
  return parts.join(tr('pages.proxyLogs.listSeparator'));
}

function formatProxyDebugTargetSummary(settings: ProxyDebugSettingsState) {
  const parts = [
    settings.proxyDebugFilterSessionId
      ? `Session ${settings.proxyDebugFilterSessionId}`
      : null,
    settings.proxyDebugFilterClientKind
      ? formatProxyLogTemplate('pages.proxyLogs.clientFilterValue', { value: settings.proxyDebugFilterClientKind })
      : null,
    settings.proxyDebugFilterModel
      ? formatProxyLogTemplate('pages.proxyLogs.modelFilterValue', { value: settings.proxyDebugFilterModel })
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(tr('pages.proxyLogs.detailSeparator')) : tr('pages.proxyLogs.recordAllMatchingRequests');
}

function stringifyStoredDebugValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseStoredDebugPreview(value: unknown): {
  raw: string | null;
  displayText: string;
  truncated: boolean;
  note: string | null;
} {
  const raw = stringifyStoredDebugValue(value);
  if (!raw) {
    return {
      raw: null,
      displayText: "-",
      truncated: false,
      note: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as StoredDebugPreviewPayload | string;
    if (typeof parsed === "string") {
      return {
        raw,
        displayText: parsed || "-",
        truncated: false,
        note: null,
      };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.__metapiTruncated &&
      typeof parsed.preview === "string"
    ) {
      const originalBytes = Number(parsed.originalBytes || 0);
      const storedBytes = Number(parsed.storedBytes || 0);
      return {
        raw,
        displayText: parsed.preview || "-",
        truncated: true,
        note:
          originalBytes > 0 && storedBytes > 0
            ? formatProxyLogTemplate('pages.proxyLogs.truncatedContentDetail', {
                originalBytes,
                storedBytes,
              })
            : tr('pages.proxyLogs.contentTruncateCopyCopySaveContent'),
      };
    }

    if (parsed && typeof parsed === "object") {
      return {
        raw,
        displayText: JSON.stringify(parsed, null, 2),
        truncated: false,
        note: null,
      };
    }
  } catch {
    // Fall through to display the saved raw value directly.
  }

  return {
    raw,
    displayText: raw,
    truncated: false,
    note: null,
  };
}

function parseStoredDebugJson(value: unknown): unknown {
  const raw = stringifyStoredDebugValue(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asDebugRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asDebugArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function translateDebugDiagnostic(diagnostic: Record<string, unknown>): string {
  const wireTranslationKey = diagnostic[`i18n${'Key'}`];
  const key = typeof wireTranslationKey === 'string'
    ? wireTranslationKey
    : typeof diagnostic.message === 'string'
      ? diagnostic.message
      : typeof diagnostic.code === 'string'
        ? diagnostic.code
        : '';
  let value = key ? tr(key) : tr('pages.proxyLogs.runtimeCapabilityDiagnostic');
  const values = asDebugRecord(diagnostic.values);
  for (const [name, replacement] of Object.entries(values || {})) {
    value = value.replace(`{${name}}`, replacement == null ? '' : String(replacement));
  }
  return value;
}

function debugDiagnosticTone(diagnostic: Record<string, unknown>): string {
  const level = diagnostic.level || diagnostic.severity;
  if (level === 'error') return '-error';
  if (level === 'warn' || level === 'warning') return '-warning';
  return '-info';
}

function CompactSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-28 gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-sm font-semibold">{value}</strong>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone = "neutral",
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "error";
  wide?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "proxy-log-overview-metric-success"
      : tone === "warning"
        ? "proxy-log-overview-metric-warning"
        : tone === "error"
          ? "proxy-log-overview-metric-error"
          : "";

  return (
    <div className={`proxy-log-overview-metric ${toneClass} ${wide ? 'is-wide' : ''}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AppliedFilterPill({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <span className="proxy-log-filter-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function LogInlineMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="proxy-log-inline-metric">
      <span>{label}</span>
      {tone ? <ToneBadge tone={tone}>{value}</ToneBadge> : <strong>{value}</strong>}
    </div>
  );
}

function TraceTimelineItem({
  index,
  title,
  meta,
  tone,
  statusLabel,
  disclosureLabel,
  children,
}: {
  index: number;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tone?: string;
  statusLabel?: string;
  disclosureLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="proxy-trace-timeline-item">
      <div className="proxy-trace-timeline-marker">
        <span>{index + 1}</span>
      </div>
      <div className="proxy-trace-timeline-body">
        <div className="proxy-trace-timeline-head">
          <div className="min-w-0">
            <div className="break-words text-sm font-semibold">{title}</div>
            {meta ? <div className="mt-1 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {tone ? <ToneBadge tone={tone}>{statusLabel || (tone.includes("error") ? tr('pages.checkinLog.failed') : tr('pages.checkinLog.success'))}</ToneBadge> : null}
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={`${open ? tr('pages.accounts.collapse') : tr('pages.proxyLogs.expand')} ${disclosureLabel || `${tr('pages.proxyLogs.upstreamCall')} ${index + 1}`}`}
              >
                <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <div className="pt-1">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

type RouteRuntimeFlowNodeDetail = {
  label: string;
  value: React.ReactNode;
};

function RouteRuntimeFlowNode({
  icon,
  label,
  title,
  badges,
  meta,
  details,
  snapshotState,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  title: React.ReactNode;
  badges?: Array<{ label: React.ReactNode; tone?: string }>;
  meta?: React.ReactNode;
  details?: RouteRuntimeFlowNodeDetail[];
  snapshotState?: {
    label: string;
    description: string;
    badges: Array<{ label: React.ReactNode; tone?: string }>;
  };
  tone?: "neutral" | "request" | "route" | "target" | "token";
}) {
  const visibleDetails = (details || []).filter((detail) => detail.value != null && detail.value !== "");
  return (
    <div className={`proxy-log-decision-node proxy-log-decision-node-${tone}`}>
      <div className="proxy-log-decision-node-icon">{icon}</div>
      <div className="min-w-0">
        <div className="proxy-log-decision-node-label">{label}</div>
        <div className="proxy-log-decision-node-title">{title}</div>
        {badges && badges.length > 0 ? (
          <div className="proxy-log-decision-node-badges">
            {badges.map((badge, index) => (
              <ToneBadge key={index} tone={badge.tone || "-muted"}>
                {badge.label}
              </ToneBadge>
            ))}
          </div>
        ) : null}
        {meta ? <div className="proxy-log-decision-node-meta">{meta}</div> : null}
        {visibleDetails.length > 0 ? (
          <div className="proxy-log-decision-node-details">
            {visibleDetails.map((detail, index) => (
              <div className="proxy-log-decision-node-detail" key={`${detail.label}-${index}`}>
                <span>{detail.label}</span>
                <strong>{detail.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {snapshotState ? (
          <section
            className="proxy-log-decision-node-snapshot-state"
            aria-label={snapshotState.label}
            aria-description={snapshotState.description}
            title={snapshotState.description}
          >
            <div className="proxy-log-decision-node-snapshot-state-title">
              <Timer className="size-3.5" aria-hidden="true" />
              <strong>{snapshotState.label}</strong>
            </div>
            <div className="proxy-log-decision-node-snapshot-state-badges">
              {snapshotState.badges.map((badge, index) => (
                <ToneBadge key={index} tone={badge.tone || "-muted"}>
                  {badge.label}
                </ToneBadge>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RouteRuntimeExecutionTargetTitle({
  site,
  account,
  executionAttemptId,
}: {
  site: string | null;
  account: string | null;
  executionAttemptId: string | null;
}) {
  const identity = [site, account].filter(Boolean).join(' · ');
  return (
    <div className="proxy-log-decision-target-title">
      <strong>{identity || tr('pages.proxyLogs.runtimeIdentityUnavailable')}</strong>
      {executionAttemptId ? (
        <RuntimeIdentifier
          value={executionAttemptId}
          kind="execution-attempt"
          maxLength={56}
        />
      ) : null}
    </div>
  );
}

function RouteRuntimeFlowConnector({ label }: { label?: React.ReactNode }) {
  return (
    <div className="proxy-log-decision-connector" aria-hidden="true">
      <span />
      <ArrowRight className="size-4" />
      {label ? <em>{label}</em> : null}
    </div>
  );
}

function affinityOutcomeLabel(outcome:
  | 'pending'
  | 'bound'
  | 'primary_refreshed'
  | 'temporary_fallback'
  | 'promoted'
  | 'stale_ignored'
  | 'invalid'
  | 'disabled'): string {
  switch (outcome) {
    case 'pending': return tr('pages.proxyLogs.affinityOutcomePending');
    case 'bound': return tr('pages.proxyLogs.affinityOutcomeBound');
    case 'primary_refreshed': return tr('pages.proxyLogs.affinityOutcomePrimaryRefreshed');
    case 'temporary_fallback': return tr('pages.proxyLogs.affinityOutcomeTemporaryFallback');
    case 'promoted': return tr('pages.proxyLogs.affinityOutcomePromoted');
    case 'stale_ignored': return tr('pages.proxyLogs.affinityOutcomeStaleIgnored');
    case 'invalid': return tr('pages.proxyLogs.affinityOutcomeInvalid');
    case 'disabled': return tr('pages.proxyLogs.affinityOutcomeDisabled');
    default: return String(outcome || '-');
  }
}

function affinityModeLabel(mode: string): string {
  if (mode === 'disabled') return tr('pages.tokenRoutes.affinity.disabled');
  if (mode === 'pool') return tr('pages.tokenRoutes.affinity.pool');
  if (mode === 'target') return tr('pages.tokenRoutes.affinity.target');
  if (mode === 'inherit') return tr('pages.tokenRoutes.affinity.inherit');
  return mode || '-';
}

function unavailableAttemptReasonLabel(reason: string): string {
  const keyByReason: Record<string, string> = {
    execution_target_disabled: 'pages.proxyLogs.unavailableExecutionTargetDisabled',
    account_inactive: 'pages.proxyLogs.unavailableAccountInactive',
    site_disabled: 'pages.proxyLogs.unavailableSiteDisabled',
    cooldown: 'pages.proxyLogs.unavailableCooldown',
    downstream_policy_excluded: 'pages.proxyLogs.unavailableDownstreamPolicyExcluded',
    missing_token: 'pages.proxyLogs.unavailableMissingToken',
    identity_missing: 'pages.proxyLogs.unavailableIdentityMissing',
    route_scope_excluded: 'pages.proxyLogs.unavailableRouteScopeExcluded',
  };
  return tr(keyByReason[reason] || 'pages.proxyLogs.unavailableUnknown');
}

function unavailableDecisionReasonLabel(reason: string): string {
  switch (reason) {
    case 'no_active_runtime': return tr('pages.proxyLogs.noActiveRuntime');
    case 'no_matching_route': return tr('pages.proxyLogs.noMatchingRoute');
    case 'execution_attempts_exhausted': return tr('pages.proxyLogs.executionAttemptsExhausted');
    default: return tr('pages.proxyLogs.unavailableUnknown');
  }
}

type ProxyRuntimeSelection = NonNullable<NonNullable<ProxyRequestLogDetail['decisionSnapshot']>['decision']>;
type ProxyRuntimeSelectionCandidate = ProxyRuntimeSelection['selectors'][number]['candidates'][number];
type ProxyRuntimeSelectionTarget = NonNullable<ProxyRuntimeSelectionCandidate['targets']>[number];

function selectorModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'weighted': return tr('pages.settings.dispatchPolicyMode.weighted');
    case 'round_robin': return tr('pages.settings.dispatchPolicyMode.round_robin');
    case 'stable_first': return tr('pages.settings.dispatchPolicyBuiltin.stable_first');
    case 'priority': return tr('pages.proxyLogs.prioritySelection');
    default: return mode || tr('pages.proxyLogs.notRecorded');
  }
}

function selectorPolicySourceLabel(source: string): string {
  switch (source) {
    case 'default': return tr('pages.proxyLogs.policySourceDefault');
    case 'registry': return tr('pages.proxyLogs.policySourceRegistry');
    case 'inline': return tr('pages.proxyLogs.policySourceInline');
    case 'builtin': return tr('pages.proxyLogs.policySourceBuiltin');
    default: return source;
  }
}

function findRuntimeSelectionTarget(
  decision: ProxyRuntimeSelection | null | undefined,
  executionTargetId: number | null | undefined,
): ProxyRuntimeSelectionTarget | null {
  if (executionTargetId == null) return null;
  for (const selector of decision?.selectors || []) {
    for (const candidate of selector.candidates) {
      const target = candidate.targets?.find((item) => item.executionTargetId === executionTargetId);
      if (target) return target;
    }
  }
  return null;
}

function DecisionTargetIdentity({
  target,
  compact = false,
}: {
  target: ProxyRuntimeSelectionTarget;
  compact?: boolean;
}) {
  const credential = target.credential;
  const tokenLabel = credential?.token?.name || credential?.token?.tokenGroup || null;
  const context = [credential?.account?.username, tokenLabel].filter(Boolean).join(' · ');
  return (
    <div className={`proxy-log-candidate-target ${compact ? 'is-compact' : ''}`}>
      <SiteBadgeLink
        siteId={credential?.site?.id ?? undefined}
        siteName={credential?.site?.name || null}
        badgeStyle={{ fontSize: 11 }}
      />
      <div className="min-w-0">
        <strong>{context || tr('pages.proxyLogs.runtimeIdentityUnavailable')}</strong>
        <span>
          {target.upstreamModel || tr('pages.proxyLogs.notRecorded')}
          {credential?.site?.platform ? ` · ${credential.site.platform}` : ''}
        </span>
      </div>
    </div>
  );
}

function AffinityScopeSummary({
  poolId,
  executionTargetId,
  decision,
}: {
  poolId: string | null;
  executionTargetId: number | null;
  decision: ProxyRuntimeSelection | null | undefined;
}) {
  const target = findRuntimeSelectionTarget(decision, executionTargetId);
  return (
    <div className="proxy-log-affinity-scope-summary">
      {target ? <DecisionTargetIdentity target={target} compact /> : (
        <strong>{poolId || (executionTargetId != null ? `#${executionTargetId}` : '-')}</strong>
      )}
      {poolId && target ? <span>{poolId}</span> : null}
    </div>
  );
}

function RouteRuntimeDecisionDetails({
  snapshot,
}: {
  snapshot: NonNullable<ProxyRequestLogDetail['decisionSnapshot']>;
}) {
  const [open, setOpen] = useState(false);
  const decision = snapshot.decision;
  const affinity = snapshot.executionAttempt?.affinity || null;
  if (!decision && !affinity) return null;
  const selectorCount = decision?.selectors.length || 0;
  const fallbackCount = decision?.fallbackStages.length || 0;
  const unavailable = decision?.unavailable || null;
  const rejectedAttempts = decision?.unavailable?.rejectedAttempts || [];
  const credential = snapshot.executionAttempt?.credential;
  const selectedExecutionTargetId = snapshot.executionAttempt?.executionTargetId ?? null;
  const selectedRuntimeTarget = findRuntimeSelectionTarget(decision, selectedExecutionTargetId);
  const selectorStepByNodeId = new Map(
    (decision?.selectors || []).flatMap((selector, index) => (
      selector.nodeId ? [[selector.nodeId, index + 1] as const] : []
    )),
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="proxy-log-decision-details">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="proxy-log-decision-details-trigger"
          aria-label={tr('pages.proxyLogs.selectionSteps')}
        >
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span>{tr('pages.proxyLogs.selectionSteps')}</span>
          {selectorCount > 0 ? (
            <ToneBadge tone="-muted">
              {formatProxyLogTemplate('pages.proxyLogs.selectorCount', { count: selectorCount })}
            </ToneBadge>
          ) : null}
          {fallbackCount > 0 ? (
            <ToneBadge tone="-warning">
              {formatProxyLogTemplate('pages.proxyLogs.fallbackStageCount', { count: fallbackCount })}
            </ToneBadge>
          ) : null}
          {rejectedAttempts.length > 0 ? (
            <ToneBadge tone="-error">
              {formatProxyLogTemplate('pages.proxyLogs.rejectedAttemptCount', { count: rejectedAttempts.length })}
            </ToneBadge>
          ) : null}
          {affinity ? <ToneBadge tone={affinity.bindingOutcome === 'pending' ? '-warning' : '-info'}>{affinityOutcomeLabel(affinity.bindingOutcome)}</ToneBadge> : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="proxy-log-decision-details-content">
        {credential ? (
          <section className="proxy-log-selection-outcome" aria-label={tr('pages.proxyLogs.selectionTargetSummary')}>
            <div className="proxy-log-selection-outcome-icon"><CheckCircle2 className="size-4" /></div>
            <div className="min-w-0">
              <span>{tr('pages.proxyLogs.selectionTargetSummary')}</span>
              {selectedRuntimeTarget ? <DecisionTargetIdentity target={selectedRuntimeTarget} /> : (
                <ProxyLogTargetSummary
                  siteId={credential.site?.id ?? null}
                  siteName={credential.site?.name ?? null}
                  username={credential.account?.username ?? null}
                  tokenName={credential.token?.name ?? null}
                  tokenGroup={credential.token?.tokenGroup ?? null}
                  tokenId={credential.token?.id ?? null}
                  compact
                />
              )}
            </div>
            <div className="proxy-log-selection-outcome-meta">
              {snapshot.endpoint?.endpointId ? (
                <RuntimeIdentifier value={snapshot.endpoint.endpointId} kind="route-endpoint" maxLength={96} />
              ) : null}
              {snapshot.executionAttempt?.model ? <span>{snapshot.executionAttempt.model}</span> : null}
            </div>
          </section>
        ) : null}
        {unavailable ? (
          <section className="proxy-log-unavailable-summary" aria-label={tr('pages.proxyLogs.unavailableDecision')}>
            <div className="proxy-log-decision-section-head">
              <div className="min-w-0">
                <strong>{tr('pages.proxyLogs.unavailableDecision')}</strong>
                <span>{tr('pages.proxyLogs.unavailableDecisionDescription')}</span>
              </div>
              <ToneBadge tone="-error">{unavailableDecisionReasonLabel(unavailable.reason)}</ToneBadge>
            </div>
            {rejectedAttempts.length > 0 ? <div className="proxy-log-rejected-attempt-list">
              {rejectedAttempts.map((rejected, index) => (
                <div className="proxy-log-rejected-attempt-row" key={`${rejected.executionAttemptId || 'attempt'}-${rejected.executionTargetId || 'target'}-${index}`}>
                  <div className="min-w-0">
                    <LongRuntimeId value={rejected.executionAttemptId} kind="execution-attempt" />
                  </div>
                  <ToneBadge tone="-error">{unavailableAttemptReasonLabel(rejected.reason)}</ToneBadge>
                </div>
              ))}
            </div> : null}
          </section>
        ) : null}
        {decision?.selectors.map((selector, selectorIndex) => (
          <section className="proxy-log-selector-step" key={`${selector.selectorId}-${selectorIndex}`}>
            <div className="proxy-log-selector-step-head">
              <span className="proxy-log-selector-step-index">{selectorIndex + 1}</span>
              <div className="min-w-0">
                <span>{formatProxyLogTemplate('pages.proxyLogs.selectionStep', { index: selectorIndex + 1 })}</span>
                <strong>{selector.policyId || selector.selectorId}</strong>
                <div className="proxy-log-selector-step-meta">
                  <ToneBadge tone="-muted">{selectorModeLabel(selector.selectionMode || selector.mode)}</ToneBadge>
                  <span>{selectorPolicySourceLabel(selector.policySource)}</span>
                </div>
              </div>
              <ToneBadge tone="-muted">
                {formatProxyLogTemplate('pages.proxyLogs.candidateCount', { count: selector.candidates.length })}
              </ToneBadge>
            </div>
            <div className="proxy-log-candidate-list">
              {selector.candidates.map((candidate) => (
                <div className={`proxy-log-candidate-row ${candidate.selected ? 'is-selected' : ''}`} key={candidate.choiceId}>
                  <span className="proxy-log-candidate-rank">{candidate.order + 1}</span>
                  <div className="proxy-log-candidate-identity min-w-0">
                    {candidate.targets && candidate.targets.length > 0 ? (
                      <div className="proxy-log-candidate-target-list">
                        {candidate.targets.map((target) => (
                          <DecisionTargetIdentity key={target.executionTargetId} target={target} />
                        ))}
                      </div>
                    ) : (
                      <RuntimeIdentifier value={candidate.choiceId} kind="identifier" maxLength={96} />
                    )}
                    <div className="proxy-log-candidate-reference">
                      {candidate.endpointId ? (
                        <RuntimeIdentifier value={candidate.endpointId} kind="route-endpoint" maxLength={96} />
                      ) : null}
                      {candidate.targets?.[0]?.executionAttemptId ? (
                        <RuntimeIdentifier value={candidate.targets[0].executionAttemptId} kind="execution-attempt" maxLength={96} />
                      ) : null}
                    </div>
                  </div>
                  <div className="proxy-log-candidate-result">
                    <ToneBadge tone={!candidate.enabled || !candidate.eligible ? '-error' : candidate.selected ? '-success' : '-muted'}>
                      {!candidate.enabled
                        ? tr('pages.proxyLogs.disabledCandidate')
                        : !candidate.eligible
                          ? tr('pages.proxyLogs.ineligible')
                        : candidate.selected
                          ? tr('pages.proxyLogs.selectedCandidate')
                          : tr('pages.proxyLogs.eligible')}
                    </ToneBadge>
                    <div className="proxy-log-candidate-score">
                      <span>{tr('pages.proxyLogs.score')}</span>
                      <strong>{formatCompactNumber(candidate.score, 4)}</strong>
                    </div>
                    <span className="proxy-log-candidate-formula">
                      {formatProxyLogTemplate('pages.proxyLogs.candidateScoreFormula', {
                        weight: formatCompactNumber(candidate.weight, 4),
                        contribution: formatCompactNumber(candidate.contribution, 4),
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {affinity ? (
          <section className="proxy-log-affinity-summary" aria-label={tr('pages.proxyLogs.affinityDecision')}>
            <div className="proxy-log-decision-section-head">
              <div className="min-w-0">
                <strong>{tr('pages.proxyLogs.affinityDecision')}</strong>
                <span>{affinityModeLabel(affinity.mode)} · {affinity.fallback
                  ? (affinity.promoteOnSuccess ? tr('pages.proxyLogs.promoteOnSuccess') : tr('pages.proxyLogs.temporaryFallback'))
                  : tr('pages.proxyLogs.keepPrimary')}</span>
              </div>
              <ToneBadge tone={affinity.fallback ? '-warning' : '-success'}>
                {affinity.fallback ? tr('pages.proxyLogs.crossScopeFallback') : tr('pages.proxyLogs.primaryScope')}
              </ToneBadge>
            </div>
            <div className="proxy-log-affinity-flow">
              <div className="proxy-log-affinity-flow-node">
                <span>{tr('pages.proxyLogs.originalPrimary')}</span>
                <AffinityScopeSummary
                  poolId={affinity.primaryPoolId}
                  executionTargetId={affinity.primaryExecutionTargetId}
                  decision={decision}
                />
              </div>
              <ArrowRight className="size-4" aria-hidden="true" />
              <div className="proxy-log-affinity-flow-node is-selected">
                <span>{tr('pages.proxyLogs.selectedAffinityScope')}</span>
                <AffinityScopeSummary
                  poolId={affinity.selectedPoolId}
                  executionTargetId={affinity.selectedExecutionTargetId}
                  decision={decision}
                />
              </div>
              <ArrowRight className="size-4" aria-hidden="true" />
              <div className="proxy-log-affinity-flow-node is-outcome">
                <span>{tr('pages.proxyLogs.bindingOutcome')}</span>
                <strong>{affinityOutcomeLabel(affinity.bindingOutcome)}</strong>
                <small>{formatProxyLogTemplate('pages.proxyLogs.primaryRevisionValue', {
                  revision: affinity.resultingRevision ?? affinity.primaryRevision ?? '-',
                })}</small>
              </div>
            </div>
          </section>
        ) : null}
        {decision && decision.fallbackStages.length > 0 ? (
          <section className="proxy-log-fallback-stages">
            <div className="proxy-log-decision-section-head">
              <div className="min-w-0">
                <strong>{tr('pages.proxyLogs.fallbackStages')}</strong>
                <span>{tr('pages.proxyLogs.fallbackStagesDescription')}</span>
              </div>
            </div>
            <div className="proxy-log-fallback-stage-list">
              {decision.fallbackStages.map((stage) => (
                <div className="proxy-log-fallback-stage-row" key={`${stage.fallbackId}-${stage.stageId}`}>
                  <span className="proxy-log-fallback-stage-index">{stage.stageIndex + 1}</span>
                  <Layers3 className="size-4" aria-hidden="true" />
                  <div className="min-w-0">
                    <strong>{selectorStepByNodeId.get(stage.nodeId)
                      ? formatProxyLogTemplate('pages.proxyLogs.fallbackAfterStep', {
                          index: selectorStepByNodeId.get(stage.nodeId)!,
                        })
                      : tr('pages.proxyLogs.fallbackStage')}</strong>
                    <RuntimeIdentifier value={stage.stageId} kind="fallback-stage" maxLength={96} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RouteRuntimeSnapshotFlow({
  snapshot,
  attempts,
}: {
  snapshot: NonNullable<ProxyRequestLogDetail["decisionSnapshot"]>;
  attempts: ProxyExecutionAttemptLog[];
}) {
  const match = snapshot.match;
  const endpoint = snapshot.endpoint;
  const executionAttempt = snapshot.executionAttempt;
  const endpointState = snapshot.state.executionAttemptState || null;
  const credential = executionAttempt?.credential || null;
  const token = credential?.token || null;
  const requestedModel = match.requestedModel || "-";
  const actualModel = match.actualModel || null;
  const hasActualModel =
    !!actualModel && actualModel.trim() !== requestedModel.trim();
  const entryTitle = match.publicModelName || match.planId || requestedModel;
  const selectedEndpoint = endpoint?.endpointId || null;
  const selectedExecutionAttempt = executionAttempt?.executionAttemptId || null;
  const selectedExecutionAttemptIndex = selectedExecutionAttempt
    ? attempts.findIndex((attempt) => attempt.executionAttemptId === selectedExecutionAttempt)
    : -1;
  const selectedExecutionAttemptNumber = selectedExecutionAttemptIndex >= 0
    ? selectedExecutionAttemptIndex + 1
    : null;
  const endpointPreference = snapshot.filters.endpointPreference || null;
  const disabledAttemptCount = snapshot.state.failureOverlay.disabledExecutionAttemptIds.length;
  const disabledExecutionTargetCount = snapshot.state.failureOverlay.disabledExecutionTargetIds.length;
  const siteLabel = credential?.site?.name
    || (executionAttempt?.siteId != null
      ? formatProxyLogTemplate('components.modelRouteFlow.siteIdentity', {
          id: executionAttempt.siteId,
        })
      : null);
  const accountLabel = credential?.account?.username
    || (executionAttempt?.accountId != null
      ? formatProxyLogTemplate('components.modelRouteFlow.accountIdentity', {
          id: executionAttempt.accountId,
        })
      : null);
  const tokenLabel = token?.name || (executionAttempt?.tokenId != null ? `#${executionAttempt.tokenId}` : null);

  return (
    <div className="proxy-log-decision-flow-card">
      <div className="proxy-log-decision-flow-head">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-primary">
            {tr('pages.proxyLogs.finalDecisionSnapshot')}
          </div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.proxyLogs.finalDecisionSnapshotDescription')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {selectedExecutionAttemptNumber != null ? (
            <ToneBadge tone="-info">
              {formatProxyLogTemplate('pages.proxyLogs.decisionSnapshotForAttempt', {
                index: selectedExecutionAttemptNumber,
              })}
            </ToneBadge>
          ) : null}
          {snapshot.capturedAt ? (
            <ToneBadge tone="-muted">
              {formatDateTimeLocal(snapshot.capturedAt)}
            </ToneBadge>
          ) : null}
        </div>
      </div>

      <div className="proxy-log-decision-flow">
        <RouteRuntimeFlowNode
          tone="request"
          icon={<Hash className="size-4" />}
          label={tr('pages.proxyLogs.requestedModel')}
          title={<span className="font-mono">{requestedModel}</span>}
          badges={[
            { label: snapshot.request.stream ? tr('pages.modelTester.streaming') : tr('pages.proxyLogs.nonStreaming'), tone: snapshot.request.stream ? "-info" : "-muted" },
            ...(match.terminalKind ? [{ label: match.terminalKind === "synthetic_response" ? tr('pages.proxyLogs.syntheticResponse') : tr('pages.proxyLogs.runtimeScopeEndpoint'), tone: "-muted" }] : []),
          ]}
          meta={
            hasActualModel ? (
              <span>{tr('pages.proxyLogs.actualModel')} {actualModel}</span>
            ) : (
              tr('pages.proxyLogs.noModelRewrite')
            )
          }
          details={[
            ...(hasActualModel ? [{ label: tr('pages.proxyLogs.actualModel'), value: actualModel }] : []),
            { label: tr('pages.proxyLogs.downstreamPath'), value: snapshot.request.downstreamPath || "-" },
          ]}
        />
        <RouteRuntimeFlowConnector />
        <RouteRuntimeFlowNode
          tone="route"
          icon={<GitBranch className="size-4" />}
          label={tr('pages.proxyLogs.runtimeScopeEntry')}
          title={match.publicModelName || !match.planId
            ? (entryTitle || <span className="text-muted-foreground">-</span>)
            : <LongRuntimeId value={match.planId} kind="route-entry" />}
          details={[
            { label: tr('pages.proxyLogs.publicModel'), value: match.publicModelName || "-" },
            { label: tr('pages.proxyLogs.matchRule'), value: match.planId
              ? <LongRuntimeId value={match.planId} kind="route-entry" />
              : "-" },
          ]}
        />
        <RouteRuntimeFlowConnector />
        <RouteRuntimeFlowNode
          tone="target"
          icon={<Target className="size-4" />}
          label={tr('pages.proxyLogs.runtimeScopeEndpoint')}
          title={
            selectedEndpoint ? <RuntimeIdentifier value={selectedEndpoint} kind="identifier" maxLength={40} /> : <span className="text-muted-foreground">-</span>
          }
          badges={endpointPreference ? [{ label: endpointPreference, tone: "-muted" }] : []}
        />
        <RouteRuntimeFlowConnector />
        <RouteRuntimeFlowNode
          tone="token"
          icon={<KeyRound className="size-4" />}
          label={tr('pages.proxyLogs.selectionTargetSummary')}
          title={
            <RouteRuntimeExecutionTargetTitle
              site={siteLabel}
              account={accountLabel}
              executionAttemptId={selectedExecutionAttempt}
            />
          }
          badges={[
            ...(credential?.site?.platform ? [{ label: credential.site.platform, tone: "-muted" }] : []),
          ]}
          details={[
            { label: tr('pages.proxyLogs.modelKey'), value: tokenLabel || "-" },
            ...(executionAttempt?.model && executionAttempt.model !== requestedModel
              ? [{ label: tr('pages.proxyLogs.actualModel'), value: executionAttempt.model }]
              : []),
          ]}
          snapshotState={endpointState ? {
            label: tr('pages.proxyLogs.selectionTimeTargetState'),
            description: tr('pages.proxyLogs.selectionTimeTargetStateDescription'),
            badges: [
              {
                label: `${tr('pages.checkinLog.success')} ${formatNullableNumber(endpointState.successCount)}`,
                tone: endpointState.successCount == null || endpointState.successCount === 0
                  ? "-muted"
                  : "-success",
              },
              {
                label: `${tr('pages.checkinLog.failed')} ${formatNullableNumber(endpointState.failCount)}`,
                tone: endpointState.failCount == null || endpointState.failCount === 0
                  ? "-muted"
                  : "-error",
              },
              ...(typeof endpointState.consecutiveFailCount === "number" && endpointState.consecutiveFailCount > 0 ? [{
                label: `${tr('pages.proxyLogs.consecutiveFailures')} ${endpointState.consecutiveFailCount}`,
                tone: "-warning",
              }] : []),
              ...(endpointState.cooldownUntil ? [{
                label: `${tr('pages.proxyLogs.cooldown')} ${formatDateTimeLocal(String(endpointState.cooldownUntil))}`,
                tone: "-warning",
              }] : []),
            ],
          } : undefined}
        />
      </div>
      <div className="proxy-log-decision-stats">
        <ToneBadge tone="-muted" className="min-w-0 max-w-full overflow-hidden">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <span className="shrink-0">{tr('pages.proxyLogs.runtimeArtifactIdentity').replace(' {id}', '')}</span>
            <LongRuntimeId value={snapshot.compiledRuntime.runtimeArtifactId} kind="runtime-artifact" className="flex-1" />
          </span>
        </ToneBadge>
        {disabledAttemptCount > 0 ? (
          <ToneBadge tone="-warning">
            {formatProxyLogTemplate('pages.proxyLogs.disabledExecutionAttempts', {
              count: disabledAttemptCount,
            })}
          </ToneBadge>
        ) : null}
        {disabledExecutionTargetCount > 0 ? (
          <ToneBadge tone="-warning">
            {formatProxyLogTemplate('pages.proxyLogs.disabledExecutionTargets', {
              count: disabledExecutionTargetCount,
            })}
          </ToneBadge>
        ) : null}
      </div>
      <RouteRuntimeDecisionDetails snapshot={snapshot} />
    </div>
  );
}

function DebugTraceRouteRuntimeSnapshotFlow({
  trace,
}: {
  trace: ProxyDebugTraceDetail["trace"];
}) {
  const runtimeTrace = asDebugRecord(parseStoredDebugJson(trace.runtimeTraceJson));
  const routeRuntimeSummary = asDebugRecord(runtimeTrace?.context);
  const protocol = asDebugRecord(runtimeTrace?.protocol);
  const endpointCandidates = protocol?.endpointCandidates;
  const endpointOptionCount = Array.isArray(endpointCandidates)
    ? endpointCandidates.length
    : 0;
  const downstreamFormat = typeof routeRuntimeSummary?.downstreamFormat === "string"
    ? routeRuntimeSummary.downstreamFormat
    : null;
  const upstreamTransport = typeof routeRuntimeSummary?.upstreamTransport === "string"
    ? routeRuntimeSummary.upstreamTransport
    : null;
  const stickyHitExecutionAttemptId = trace.stickyHitExecutionAttemptId || null;
  const apiAttemptPlan = asDebugRecord(routeRuntimeSummary?.apiAttemptPlan);
  const apiAttemptCount = Array.isArray(apiAttemptPlan?.attempts)
    ? apiAttemptPlan.attempts.length
    : null;
  const runtimeCapabilityRequirement = asDebugRecord(routeRuntimeSummary?.runtimeCapabilityRequirement);
  const requiredFeatures = asDebugArray(runtimeCapabilityRequirement?.requiredFeatures)
    .map((feature) => asDebugRecord(feature))
    .filter((feature): feature is Record<string, unknown> => !!feature);
  const capabilityDiagnostics = asDebugArray(apiAttemptPlan?.diagnostics)
    .map((diagnostic) => asDebugRecord(diagnostic))
    .filter((diagnostic): diagnostic is Record<string, unknown> => !!diagnostic)
    .filter((diagnostic) => typeof diagnostic.code === 'string' && diagnostic.code.startsWith('runtime_capability.'));
  const routeLabel = formatTraceEntryRouteLabel(trace);
  const runtimeEndpointLabel = formatTraceRuntimeEndpointLabel(trace);
  const siteLabel = formatTraceSiteLabel(trace);

  return (
    <div className="proxy-trace-route-flow-card">
      <div className="proxy-trace-section-head">
        <div>
          <div className="text-sm font-semibold">{tr('pages.proxyLogs.decisionSnapshot')}</div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.proxyLogs.debugRouteRuntimeDescription')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {endpointOptionCount > 0 ? (
            <ToneBadge tone="-muted">
              {endpointOptionCount} {tr('pages.proxyLogs.endpointOptions')}
            </ToneBadge>
          ) : null}
        </div>
      </div>

      <div className="proxy-trace-route-flow">
        <RouteRuntimeFlowNode
          tone="request"
          icon={<Hash className="size-4" />}
          label={tr('pages.proxyLogs.requestedModel')}
          title={<span className="font-mono">{trace.requestedModel || "-"}</span>}
          meta={trace.downstreamPath || tr('pages.proxyLogs.downstreamPath')}
        />
        <RouteRuntimeFlowConnector label={downstreamFormat || tr('pages.proxyLogs.matchRule')} />
        <RouteRuntimeFlowNode
          tone="route"
          icon={<GitBranch className="size-4" />}
          label={tr('components.modelRouteFlow.entry')}
          title={trace.routeEntrypointId ? <LongRuntimeId value={trace.routeEntrypointId} kind="route-entry" /> : (routeLabel || <span className="text-muted-foreground">-</span>)}
          meta={
            stickyHitExecutionAttemptId
              ? `${tr('pages.proxyLogs.stickySession')} (${stickyHitExecutionAttemptId})`
              : (runtimeEndpointLabel
                  ? <LongRuntimeId value={runtimeEndpointLabel} />
                  : tr('pages.proxyLogs.requestTimeSnapshot'))
          }
        />
        <RouteRuntimeFlowConnector
          label={endpointOptionCount > 0 ? `${endpointOptionCount} ${tr('pages.proxyLogs.endpointOptions')}` : undefined}
        />
        <RouteRuntimeFlowNode
          tone="target"
          icon={<Target className="size-4" />}
          label={tr('pages.proxyLogs.selectedExecutionAttempt')}
          title={trace.selectedExecutionAttemptId
            ? <LongRuntimeId value={trace.selectedExecutionAttemptId} kind="execution-attempt" />
            : <span className="text-muted-foreground">-</span>}
          meta={
            trace.selectedSiteId
              ? siteLabel
              : tr('pages.proxyLogs.notRecorded')
          }
        />
        <RouteRuntimeFlowConnector
          label={apiAttemptCount != null ? `${apiAttemptCount} ${tr('pages.proxyLogs.apiAttempts')}` : undefined}
        />
        <RouteRuntimeFlowNode
          tone="token"
          icon={<KeyRound className="size-4" />}
          label={tr('pages.proxyLogs.executionPlan')}
          title={trace.finalUpstreamPath || "-"}
          meta={trace.finalHttpStatus ? `HTTP ${trace.finalHttpStatus}` : tr('pages.proxyLogs.notRecorded')}
        />
      </div>

      <div className="mt-3 proxy-trace-detail-grid">
        <DetailField label={tr('pages.proxyLogs.upstreamTransport')}>
          {upstreamTransport ? upstreamTransport.toUpperCase() : tr('pages.proxyLogs.notRecorded')}
        </DetailField>
      </div>

      {runtimeCapabilityRequirement || capabilityDiagnostics.length > 0 ? (
        <div className="mt-3 grid gap-2 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{tr('pages.proxyLogs.runtimeCapability')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {tr('pages.proxyLogs.runtimeCapabilityDescription')}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {typeof runtimeCapabilityRequirement?.sourceFormat === 'string' ? (
                <ToneBadge tone="-muted">{runtimeCapabilityRequirement.sourceFormat}</ToneBadge>
              ) : null}
              {typeof runtimeCapabilityRequirement?.surface === 'string' ? (
                <ToneBadge tone="-muted">{runtimeCapabilityRequirement.surface}</ToneBadge>
              ) : null}
            </div>
          </div>
          {runtimeCapabilityRequirement ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <CompactSummaryMetric
                label={tr('pages.proxyLogs.lossPolicy')}
                value={typeof runtimeCapabilityRequirement.lossPolicy === 'string' ? runtimeCapabilityRequirement.lossPolicy : '-'}
              />
              <CompactSummaryMetric
                label={tr('pages.proxyLogs.fallbackPolicy')}
                value={typeof runtimeCapabilityRequirement.fallbackPolicy === 'string' ? runtimeCapabilityRequirement.fallbackPolicy : '-'}
              />
              <CompactSummaryMetric
                label={tr('pages.proxyLogs.acceptableApiTypes')}
                value={asDebugArray(runtimeCapabilityRequirement.acceptableApiTypes).length
                  ? asDebugArray(runtimeCapabilityRequirement.acceptableApiTypes).join(' / ')
                  : '-'}
              />
              <CompactSummaryMetric
                label={tr('pages.proxyLogs.requiredFeatures')}
                value={String(requiredFeatures.length)}
              />
            </div>
          ) : null}
          {requiredFeatures.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {requiredFeatures.slice(0, 8).map((feature, index) => (
                <ToneBadge key={`${String(feature.feature || '')}-${index}`} tone="-muted">
                  {String(feature.scope || '-')} · {String(feature.feature || '-')}
                </ToneBadge>
              ))}
              {requiredFeatures.length > 8 ? (
                <ToneBadge tone="-muted">+{requiredFeatures.length - 8}</ToneBadge>
              ) : null}
            </div>
          ) : null}
          {capabilityDiagnostics.length > 0 ? (
            <div className="grid gap-1.5">
              {capabilityDiagnostics.slice(0, 6).map((diagnostic, index) => (
                <div key={`${String(diagnostic.code || '')}-${index}`} className="flex min-w-0 items-start gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
                  <ToneBadge tone={debugDiagnosticTone(diagnostic)} className="shrink-0 px-1.5 py-0 text-[10px]">
                    {String(diagnostic.severity || diagnostic.level || 'info')}
                  </ToneBadge>
                  <span className="min-w-0 break-words text-muted-foreground">
                    {translateDebugDiagnostic(diagnostic)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ProxyLogs() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialRouteState = useMemo(
    () => readProxyLogsRouteState(location.search),
    [location.search],
  );
  const [statusFilter, setStatusFilter] = useState<ProxyLogStatusFilter>(
    initialRouteState.status,
  );
  const [searchInput, setSearchInput] = useState(initialRouteState.search);
  const deferredSearchInput = useDeferredValue(searchInput.trim());
  const [clientFilter, setClientFilter] = useState(initialRouteState.client);
  const [siteFilter, setSiteFilter] = useState<number | null>(
    initialRouteState.siteId,
  );
  const [fromInput, setFromInput] = useState(initialRouteState.from);
  const [toInput, setToInput] = useState(initialRouteState.to);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(initialRouteState.page);
  const [pageSize, setPageSize] = useState(initialRouteState.pageSize);
  const [showFilters, setShowFilters] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showDebugSettingsModal, setShowDebugSettingsModal] = useState(false);
  const [debugPanelLoading, setDebugPanelLoading] = useState(false);
  const [debugPanelSaving, setDebugPanelSaving] = useState(false);
  const [debugSettings, setDebugSettings] = useState<ProxyDebugSettingsState>(
    DEFAULT_PROXY_DEBUG_SETTINGS,
  );
  const [debugDraftSettings, setDebugDraftSettings] =
    useState<ProxyDebugSettingsState>(DEFAULT_PROXY_DEBUG_SETTINGS);
  const [debugDetailById, setDebugDetailById] = useState<
    Record<number, ProxyDebugTraceDetailState>
  >({});
  const [rawPayloadViewer, setRawPayloadViewer] =
    useState<RawPayloadViewerState | null>(null);
  const isMobile = useIsMobile(768);
  const useCardLayout = useIsMobile(1359);
  const toast = useToast();
  const debugDetailByIdRef = useRef<Record<number, ProxyDebugTraceDetailState>>(
    {},
  );
  const debugDetailInFlightRef = useRef<Set<string>>(new Set());
  const fromApiBoundary = toApiTimeBoundary(fromInput);
  const toApiBoundaryValue = toApiTimeBoundary(toInput);
  const hasInvalidTimeRange = Boolean(
    fromApiBoundary &&
    toApiBoundaryValue &&
    new Date(fromApiBoundary).getTime() >=
      new Date(toApiBoundaryValue).getTime(),
  );

  useEffect(() => {
    const next = readProxyLogsRouteState(location.search);
    setStatusFilter((current) =>
      current === next.status ? current : next.status,
    );
    setSearchInput((current) =>
      current === next.search ? current : next.search,
    );
    setClientFilter((current) =>
      current === next.client ? current : next.client,
    );
    setSiteFilter((current) =>
      current === next.siteId ? current : next.siteId,
    );
    setFromInput((current) => (current === next.from ? current : next.from));
    setToInput((current) => (current === next.to ? current : next.to));
    setPage((current) => (current === next.page ? current : next.page));
    setPageSize((current) =>
      current === next.pageSize ? current : next.pageSize,
    );
  }, [location.search]);

  useEffect(() => {
    const nextSearch = buildProxyLogsRouteSearch({
      page,
      pageSize,
      status: statusFilter,
      search: searchInput,
      client: clientFilter,
      siteId: siteFilter,
      from: fromInput,
      to: toInput,
    });
    if (nextSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true },
    );
  }, [
    clientFilter,
    fromInput,
    location.pathname,
    location.search,
    navigate,
    page,
    pageSize,
    searchInput,
    siteFilter,
    statusFilter,
    toInput,
  ]);

  const workspaceQuery = useMemo(() => ({
      limit: pageSize,
      offset: Math.max(0, (page - 1) * pageSize),
      status: statusFilter,
      search: deferredSearchInput,
      ...(clientFilter ? { client: clientFilter } : {}),
      ...(siteFilter ? { siteId: siteFilter } : {}),
      ...(fromApiBoundary ? { from: fromApiBoundary } : {}),
      ...(toApiBoundaryValue ? { to: toApiBoundaryValue } : {}),
    }), [clientFilter, deferredSearchInput, fromApiBoundary, page, pageSize, siteFilter, statusFilter, toApiBoundaryValue]);
  const handleWorkspaceError = useCallback((message: string) => toast.error(message), [toast]);
  const workspaceResource = useProxyLogsWorkspaceResource({
    query: workspaceQuery,
    hasInvalidTimeRange,
    onError: handleWorkspaceError,
  });
  const { logs, summary, total, loading, sites, clientOptions, detailById, load, loadMeta, loadDetail } = workspaceResource;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const currentOffset = (safePage - 1) * pageSize;
  const displayedStart = total === 0 ? 0 : currentOffset + 1;
  const displayedEnd =
    total === 0 ? 0 : Math.min(currentOffset + logs.length, total);

  const pageNumbers = useMemo(
    () =>
      Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
        if (totalPages <= 7) return i + 1;
        if (safePage <= 4) return i + 1;
        if (safePage >= totalPages - 3) return totalPages - 6 + i;
        return safePage - 3 + i;
      }),
    [safePage, totalPages],
  );

  const siteOptions = useMemo(() => {
    const options = sites.map((site) => ({
      value: String(site.id),
      label: site.status === "disabled"
        ? formatProxyLogTemplate('pages.proxyLogs.disabledSiteValue', { value: site.name })
        : site.name,
    }));
    if (
      siteFilter &&
      !options.some((option) => option.value === String(siteFilter))
    ) {
      options.unshift({
        value: String(siteFilter),
        label: formatProxyLogTemplate('pages.proxyLogs.deletedSiteValue', { value: siteFilter }),
      });
    }
    return [{ value: "", label: tr('pages.oAuthManagement.allsites') }, ...options];
  }, [siteFilter, sites]);

  const resolvedClientOptions = useMemo(() => {
    const options = [...clientOptions];
    if (
      clientFilter &&
      !options.some((option) => option.value === clientFilter)
    ) {
      options.unshift({
        value: clientFilter,
        label: clientFilter,
      });
    }
    return [{ value: "", label: tr('pages.proxyLogs.allclient') }, ...options];
  }, [clientFilter, clientOptions]);

  const activeSiteLabel = useMemo(() => {
    if (!siteFilter) return tr('pages.oAuthManagement.allsites');
    return (
      siteOptions.find((option) => option.value === String(siteFilter))
        ?.label || formatProxyLogTemplate('pages.proxyLogs.siteIdValue', { value: siteFilter })
    );
  }, [siteFilter, siteOptions]);
  const activeClientLabel = useMemo(() => {
    if (!clientFilter) return tr('pages.proxyLogs.allclient');
    return (
      resolvedClientOptions.find((option) => option.value === clientFilter)
        ?.label || clientFilter
    );
  }, [clientFilter, resolvedClientOptions]);
  const activeStatusLabel =
    statusFilter === "success"
      ? tr('pages.checkinLog.success')
      : statusFilter === "failed"
        ? tr('pages.checkinLog.failed')
        : tr('components.notificationPanel.all');
  const activeSearchText = searchInput.trim();
  const activeFilterCount = [
    statusFilter !== "all",
    clientFilter,
    siteFilter,
    fromInput,
    toInput,
    activeSearchText,
  ].filter(Boolean).length;
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void load(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  useEffect(() => {
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setExpanded((current) =>
      current !== null && logs.some((log) => log.id === current)
        ? current
        : null,
    );
  }, [logs]);

  useEffect(() => {
    debugDetailByIdRef.current = debugDetailById;
  }, [debugDetailById]);

  const applyLoadedDebugSettings = useCallback(
    (
      nextSettings: ProxyDebugSettingsState,
      options?: { syncDraft?: boolean },
    ) => {
      setDebugSettings(nextSettings);
      if (options?.syncDraft || !showDebugSettingsModal) {
        setDebugDraftSettings(nextSettings);
      }
    },
    [showDebugSettingsModal],
  );

  const loadDebugTraceDetail = useCallback(
    async (
      id: number,
      options?: {
        force?: boolean;
        suppressToast?: boolean;
        preserveVisibleData?: boolean;
        includeBodies?: boolean;
        attemptId?: number;
        requestRevision?: string;
      },
    ) => {
      const existing = debugDetailByIdRef.current[id];
      const requestKey = `${id}:${options?.attemptId ?? 'trace'}`;
      if (debugDetailInFlightRef.current.has(requestKey)) return;
      const canReuseExistingData = options?.attemptId == null && existing?.data;
      if (!options?.force && (existing?.loading || canReuseExistingData)) return;

      debugDetailInFlightRef.current.add(requestKey);

      if (options?.attemptId != null && options?.includeBodies) {
        setDebugDetailById((current) => ({
          ...current,
          [id]: {
            ...current[id],
            loading: false,
            attemptBodiesLoading: [...(current[id]?.attemptBodiesLoading || []), options.attemptId!],
          },
        }));
      } else if (!options?.preserveVisibleData || !existing?.data) {
        setDebugDetailById((current) => ({
          ...current,
          [id]: {
            loading: true,
            requestRevision: options?.requestRevision,
          },
        }));
      } else if (options?.includeBodies) {
        setDebugDetailById((current) => ({
          ...current,
          [id]: { ...current[id], loading: false, bodiesLoading: true },
        }));
      }

      try {
        const includeBodies = options?.includeBodies === true;
        const data = includeBodies
          ? await api.getProxyDebugTraceDetail(id, {
              includeBodies: true,
              ...(options?.attemptId != null ? { attemptId: options.attemptId } : {}),
            })
          : await api.getProxyDebugTraceDetail(id);
        const current = debugDetailByIdRef.current[id];
        const mergedData = options?.attemptId != null && current?.data
          ? {
              ...current.data,
              trace: current.data.trace,
              attempts: current.data.attempts.map((attempt) => {
                const loadedAttempt = data.attempts.find((candidate) => candidate.id === attempt.id);
                return loadedAttempt?.id === options.attemptId
                  ? { ...attempt, ...loadedAttempt }
                  : attempt;
              }),
            }
          : data;
        setDebugDetailById((current) => ({
          ...current,
          [id]: {
            loading: false,
            data: mergedData,
            bodiesLoaded: includeBodies && options?.attemptId == null || current[id]?.bodiesLoaded === true,
            bodiesLoading: false,
            attemptBodiesLoaded: options?.attemptId != null
              ? [...new Set([...(current[id]?.attemptBodiesLoaded || []), options.attemptId])]
              : current[id]?.attemptBodiesLoaded,
            attemptBodiesLoading: options?.attemptId != null
              ? (current[id]?.attemptBodiesLoading || []).filter((attemptId) => attemptId !== options.attemptId)
              : current[id]?.attemptBodiesLoading,
            requestRevision: options?.requestRevision ?? current[id]?.requestRevision,
          },
        }));
      } catch (error: any) {
        const message = error?.message || tr('pages.proxyLogs.debugtraceDetailsfailed');
        setDebugDetailById((current) => ({
          ...current,
          [id]: {
            ...current[id],
            loading: false,
            error: message,
            bodiesLoading: false,
            attemptBodiesLoading: options?.attemptId != null
              ? (current[id]?.attemptBodiesLoading || []).filter((attemptId) => attemptId !== options.attemptId)
              : current[id]?.attemptBodiesLoading,
            requestRevision: options?.requestRevision ?? current[id]?.requestRevision,
          },
        }));
        if (!options?.suppressToast) {
          toast.error(message);
        }
      } finally {
        debugDetailInFlightRef.current.delete(requestKey);
      }
    },
    [toast],
  );

  const loadDebugState = useCallback(
    async (silent = false) => {
      if (!silent) setDebugPanelLoading(true);
      try {
        const runtimeSettings = await api.getRuntimeSettings();
        applyLoadedDebugSettings(normalizeProxyDebugSettings(runtimeSettings), {
          syncDraft: true,
        });
      } catch (error: any) {
        toast.error(error?.message || tr('pages.proxyLogs.proxyDebugTraceFailed'));
      } finally {
        if (!silent) setDebugPanelLoading(false);
      }
    },
    [applyLoadedDebugSettings, toast],
  );

  useEffect(() => {
    void loadDebugState();
  }, [loadDebugState]);

  const persistDebugSettings = useCallback(
    async (
      nextSettings: ProxyDebugSettingsState,
      options?: { successMessage?: string; closeAfterSave?: boolean },
    ) => {
      setDebugPanelSaving(true);
      try {
        const updated = await api.updateRuntimeSettings(
          buildProxyDebugSettingsPayload(nextSettings),
        );
        const normalized = normalizeProxyDebugSettings(updated);
        applyLoadedDebugSettings(normalized, { syncDraft: true });
        if (options?.closeAfterSave) {
          setShowDebugSettingsModal(false);
        }
        if (options?.successMessage) {
          toast.success(options.successMessage);
        }
        return normalized;
      } catch (error: any) {
        toast.error(error?.message || tr('pages.proxyLogs.saveProxyDebugSettingsFailed'));
        return null;
      } finally {
        setDebugPanelSaving(false);
      }
    },
    [applyLoadedDebugSettings, toast],
  );

  const handleSaveDebugSettings = useCallback(async () => {
    await persistDebugSettings(debugDraftSettings, {
      successMessage: tr('pages.proxyLogs.proxyDebugTracesettingsSave'),
      closeAfterSave: true,
    });
  }, [debugDraftSettings, persistDebugSettings]);

  const handleQuickToggleDebugTrace = useCallback(async () => {
    await persistDebugSettings(
      {
        ...debugSettings,
        proxyDebugTraceEnabled: !debugSettings.proxyDebugTraceEnabled,
      },
      {
        successMessage: debugSettings.proxyDebugTraceEnabled
          ? tr('pages.proxyLogs.proxyDebugTraceClose')
          : tr('pages.proxyLogs.proxyDebugTraceTurn'),
      },
    );
  }, [debugSettings, persistDebugSettings]);

  const handleToggleExpand = useCallback(
    (id: string) => {
      const shouldExpand = expanded !== id;
      setExpanded(shouldExpand ? id : null);
    },
    [expanded],
  );
  useEffect(() => {
    if (!expanded) return;
    const request = logs.find((item) => item.id === expanded);
    if (!request) return;
    const observedRevision = proxyRequestLogRevision(request);
    const detailState = detailById[expanded];
    if (!detailState?.loading && detailState?.observedRevision !== observedRevision) {
      void loadDetail(expanded, {
        force: true,
        observedRevision,
        preserveVisibleData: false,
      });
    }
    const traceId = request.debugTrace?.id;
    const debugDetailState = traceId != null ? debugDetailById[traceId] : undefined;
    if (
      traceId != null
      && !debugDetailState?.loading
      && debugDetailState?.requestRevision !== observedRevision
    ) {
      void loadDebugTraceDetail(traceId, {
        force: true,
        suppressToast: true,
        preserveVisibleData: false,
        requestRevision: observedRevision,
      });
    }
  }, [debugDetailById, detailById, expanded, loadDebugTraceDetail, loadDetail, logs]);
  const openRawPayloadViewer = useCallback((title: string, value: unknown) => {
    if (!parseStoredDebugPreview(value).raw) {
      toast.error(formatProxyLogTemplate('pages.proxyLogs.copyEmptyValue', { label: title }));
      return;
    }
    setRawPayloadViewer({ title, value });
  }, [toast]);
  const handleCopyStoredDebugValue = useCallback(
    async (label: string, value: unknown) => {
      const normalized = parseStoredDebugPreview(value);
      if (!normalized.raw) {
        toast.error(formatProxyLogTemplate('pages.proxyLogs.copyEmptyValue', { label }));
        return;
      }
      try {
        await copyTextToClipboard(normalized.raw);
        toast.success(formatProxyLogTemplate('pages.proxyLogs.copySuccessValue', { label }));
      } catch (error: any) {
        toast.error(error?.message || formatProxyLogTemplate('pages.proxyLogs.copyFailedValue', { label }));
      }
    },
    [toast],
  );

  function renderUpstreamExchange(
    attempt: ProxyDebugTraceAttempt,
    traceId: number,
    attemptBodiesLoaded: boolean,
    attemptBodiesLoading: boolean,
    exchangeIndex: number,
  ) {
    const failed =
      typeof attempt.responseStatus === "number" && attempt.responseStatus >= 400;
    const endpointType = attempt.endpointType || attempt.endpoint || 'custom.http';
    const endpointTypeLabel = formatUpstreamApiTypeLabel(endpointType);

    return (
      <TraceTimelineItem
        key={attempt.id}
        index={exchangeIndex}
        title={(
          <span className="proxy-trace-attempt-title">
            <span>{endpointTypeLabel}</span>
            {endpointTypeLabel !== endpointType ? <code>{endpointType}</code> : null}
          </span>
        )}
        meta={(
          <span className="proxy-trace-attempt-summary">
            <code>{attempt.requestPath || '-'}</code>
            <span>{tr('pages.proxyLogs.executor')} · {attempt.runtimeExecutor || '-'}</span>
          </span>
        )}
        tone={failed || attempt.rawErrorText ? "-error" : "-success"}
        disclosureLabel={`${tr('pages.proxyLogs.upstreamCall')} ${exchangeIndex + 1}`}
      >
        <div className="grid gap-3">
          <div className="proxy-trace-attempt-route">
            <DetailField label={tr('pages.proxyLogs.requestPath')}>
              <code className="proxy-log-path-code">{attempt.requestPath || '-'}</code>
            </DetailField>
            <DetailField label={tr('pages.proxyLogs.targetUrl')}>
              <code className="proxy-log-path-code">{attempt.targetUrl || '-'}</code>
            </DetailField>
          </div>
          <div className="proxy-trace-attempt-grid">
            <DetailField label={tr('pages.proxyLogs.endpoint')}>
              {attempt.endpoint || '-'}
            </DetailField>
            <DetailField label={tr('components.notificationPanel.status')}>
              {attempt.responseStatus ?? "-"}
            </DetailField>
            <DetailField label={tr('pages.proxyLogs.recoveryLogic')}>
              {attempt.recoverApplied ? tr('pages.proxyLogs.applied') : tr('pages.proxyLogs.notApplied')}
            </DetailField>
            <DetailField label={tr('pages.proxyLogs.executionFallback')}>
              {attempt.downgradeDecision ? tr('pages.proxyLogs.triggered') : tr('pages.proxyLogs.notTriggered')}
            </DetailField>
            <DetailField label={tr('pages.proxyLogs.fallbackScope')}>
              {formatProxyFallbackScope(attempt.fallbackScope)}
            </DetailField>
            <DetailField label={tr('pages.proxyLogs.failureClass')}>
              {formatProxyFailureClass(attempt.failureClass)}
            </DetailField>
          </div>
          {attempt.downgradeReason && attempt.downgradeReason !== 'api_variant_fallback' ? (
            <div className="text-xs text-muted-foreground">
              {tr('pages.proxyLogs.executionFallbackReason')}
              {attempt.downgradeReason}
            </div>
          ) : null}
          {attempt.rawErrorText ? (
            <div className="proxy-trace-error">
              <div className="text-xs font-semibold">{tr('pages.proxyLogs.mistakeinfo')}</div>
              <div className="whitespace-pre-wrap text-xs">{attempt.rawErrorText}</div>
            </div>
          ) : null}
          <section className="proxy-trace-exchange">
            <div className="proxy-trace-exchange-grid">
              <div className="proxy-trace-exchange-lane">
                <div className="proxy-trace-exchange-lane-heading">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                  <strong>{tr('pages.proxyLogs.upstreamRequest')}</strong>
                </div>
                {renderStoredDebugDetails(
                  tr('pages.proxyLogs.requestHeaders'),
                  attempt.requestHeadersJson,
                  { copyLabel: tr('pages.proxyLogs.requestHeaders') },
                )}
                {renderStoredDebugDetails(
                  tr('pages.proxyLogs.requestBody'),
                  attempt.requestBodyJson,
                  {
                    copyLabel: tr('pages.proxyLogs.requestBody'),
                    lazyLoad: !attemptBodiesLoaded ? () => void loadDebugTraceDetail(traceId, { force: true, includeBodies: true, attemptId: attempt.id, preserveVisibleData: true, suppressToast: true }) : undefined,
                    lazyLoading: attemptBodiesLoading,
                  },
                )}
              </div>
              <div className="proxy-trace-exchange-lane">
                <div className="proxy-trace-exchange-lane-heading">
                  <ArrowDownLeft className="size-4" aria-hidden="true" />
                  <strong>{tr('pages.proxyLogs.upstreamResponse')}</strong>
                </div>
                {renderStoredDebugDetails(
                  tr('pages.proxyLogs.responseHeaders'),
                  attempt.responseHeadersJson,
                  { copyLabel: tr('pages.proxyLogs.responseHeaders') },
                )}
                {renderStoredDebugDetails(
                  tr('pages.proxyLogs.responseBody'),
                  attempt.responseBodyJson,
                  {
                    copyLabel: tr('pages.proxyLogs.responseBody'),
                    lazyLoad: !attemptBodiesLoaded ? () => void loadDebugTraceDetail(traceId, { force: true, includeBodies: true, attemptId: attempt.id, preserveVisibleData: true, suppressToast: true }) : undefined,
                    lazyLoading: attemptBodiesLoading,
                  },
                )}
              </div>
            </div>
          </section>
          <div className="proxy-trace-attempt-runtime-update">
            {renderStoredDebugDetails(
              tr('pages.proxyLogs.memoryWrite'),
              attempt.memoryWriteJson,
              {
                copyLabel: tr('pages.proxyLogs.memoryWrite'),
                lazyLoad: !attemptBodiesLoaded ? () => void loadDebugTraceDetail(traceId, { force: true, includeBodies: true, attemptId: attempt.id, preserveVisibleData: true, suppressToast: true }) : undefined,
                lazyLoading: attemptBodiesLoading,
                emptyLabel: tr('pages.proxyLogs.noRuntimeStateUpdate'),
              },
            )}
          </div>
        </div>
      </TraceTimelineItem>
    );
  }

  function renderStoredDebugDetails(
    title: string,
    value: unknown,
    options?: {
      defaultOpen?: boolean;
      copyLabel?: string;
      lazyLoad?: () => void;
      lazyLoading?: boolean;
      emptyLabel?: React.ReactNode;
    },
  ) {
    const normalized = parseStoredDebugPreview(value);
    const copyLabel = options?.copyLabel || title;

    return (
      <DetailDisclosureCard title={title} defaultOpen={options?.defaultOpen} onOpenChange={(open) => {
        if (open && !normalized.raw) options?.lazyLoad?.();
      }}>
        <div className="grid gap-2.5 p-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline"
              type="button"
              disabled={!normalized.raw || options?.lazyLoading}


              aria-label={formatProxyLogTemplate('pages.proxyLogs.copyAriaValue', { label: copyLabel })}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleCopyStoredDebugValue(copyLabel, value);
              }}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              {tr('pages.proxyLogs.copySavecontent')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!normalized.raw}
              aria-label={formatProxyLogTemplate('pages.proxyLogs.viewRawPayloadAria', { label: title })}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openRawPayloadViewer(title, value);
              }}
            >
              <FileJson className="size-3.5" aria-hidden="true" />
              {tr('pages.proxyLogs.viewRawPayload')}
            </Button>
          </div>
          {normalized.note ? (
            <div className="text-xs text-muted-foreground">
              {normalized.note}
            </div>
          ) : null}
          {options?.lazyLoading && !normalized.raw ? (
            <div className="text-sm text-muted-foreground">
              {tr('pages.proxyLogs.loadingTraceDetails')}
            </div>
          ) : normalized.raw ? (
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed">{normalized.displayText}</pre>
          ) : options?.lazyLoad ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {tr('pages.proxyLogs.expandToLoadRawContent')}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {options?.emptyLabel || tr('pages.proxyLogs.notRecorded')}
            </div>
          )}
        </div>
      </DetailDisclosureCard>
    );
  }

  function renderDebugTraceDetailContent(
    traceId: number,
    options?: { showRouteFlow?: boolean },
  ) {
    const traceState = debugDetailById[traceId];
    if (traceState?.loading) {
      return (
        <div className="text-sm text-muted-foreground">
          {tr('pages.proxyLogs.loadingTraceDetails')}
        </div>
      );
    }

    if (traceState?.error) {
      return <div className="grid gap-2 text-sm text-destructive">
        <div>{traceState.error}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => void loadDebugTraceDetail(traceId, { force: true, suppressToast: true })}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {tr('pages.proxyLogs.retryTraceLoad')}
        </Button>
      </div>;
    }

    if (!traceState?.data) {
      return (
        <div className="text-sm text-muted-foreground">
          {tr('pages.proxyLogs.noTraceDetails')}
        </div>
      );
    }

    const traceDetail = traceState.data.trace;
    const rawEvidence = [
      { title: tr('pages.proxyLogs.rawDownstreamRequestHeaders'), value: traceDetail.requestHeadersJson },
      { title: tr('pages.proxyLogs.finalResponseHeaders'), value: traceDetail.finalResponseHeadersJson },
      { title: tr('pages.proxyLogs.decisionSnapshot'), value: traceDetail.runtimeTraceJson, wide: true },
    ].filter((item) => parseStoredDebugPreview(item.value).raw != null);
    const bodiesLoaded = traceState.bodiesLoaded === true;
    const bodiesLoading = traceState.bodiesLoading === true;
    return (
      <div className="proxy-log-diagnostic-evidence" data-testid={`proxy-log-debug-evidence-${traceId}`}>
        <div className="proxy-log-section-heading">
          <strong className="inline-flex items-center gap-1.5">
            <Bug className="size-3.5" aria-hidden="true" />
            {tr('pages.proxyLogs.debugDetails')}
          </strong>
          <span className="text-xs text-muted-foreground">{tr('pages.proxyLogs.debugDetailsDescription')}</span>
        </div>

        {traceDetail.stickySessionKey ? <div className="proxy-log-evidence-context">
            <DetailField label={tr('pages.proxyLogs.stickySession')}>
              {traceDetail.stickySessionKey}
            </DetailField>
          </div> : null}

        {options?.showRouteFlow !== false ? <DebugTraceRouteRuntimeSnapshotFlow trace={traceDetail} /> : null}

        <section className="proxy-log-raw-evidence">
          <div className="proxy-log-section-heading"><strong>{tr('pages.proxyLogs.downstreamExchange')}</strong></div>
          <div className="proxy-trace-artifact-grid">
            <div className="proxy-trace-artifact-wide">
              {renderStoredDebugDetails(tr('pages.proxyLogs.rawDownstreamRequestBody'), traceDetail.requestBodyJson, {
                copyLabel: tr('pages.proxyLogs.rawDownstreamRequestBody'),
                lazyLoad: !bodiesLoaded ? () => void loadDebugTraceDetail(traceId, { force: true, includeBodies: true, preserveVisibleData: true, suppressToast: true }) : undefined,
                lazyLoading: bodiesLoading,
              })}
            </div>
            <div className="proxy-trace-artifact-wide">
              {renderStoredDebugDetails(tr('pages.proxyLogs.finalResponse'), traceDetail.finalResponseBodyJson, {
                copyLabel: tr('pages.proxyLogs.finalResponse'),
                lazyLoad: !bodiesLoaded ? () => void loadDebugTraceDetail(traceId, { force: true, includeBodies: true, preserveVisibleData: true, suppressToast: true }) : undefined,
                lazyLoading: bodiesLoading,
              })}
            </div>
            {rawEvidence.map((item) => item.wide ? (
              <div className="proxy-trace-artifact-wide" key={item.title}>{renderStoredDebugDetails(item.title, item.value)}</div>
            ) : (
              <React.Fragment key={item.title}>{renderStoredDebugDetails(item.title, item.value)}</React.Fragment>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const filterControls = (
    <div className="grid gap-3">
        <div className="proxy-log-filter-grid">
          <div className="proxy-log-filter-status">
            <SegmentedTabBar<ProxyLogStatusFilter>
              value={statusFilter}
              onValueChange={(nextValue) => {
                setStatusFilter(nextValue);
                setPage(1);
              }}
              items={[
                { value: "all", label: tr('components.notificationPanel.all'), count: summary.totalCount },
                { value: "success", label: tr('pages.checkinLog.success'), count: summary.successCount },
                { value: "failed", label: tr('pages.checkinLog.failed'), count: summary.failedCount },
              ]}
            />
          </div>
          <SearchInput
            className="proxy-log-filter-search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            placeholder={tr('pages.proxyLogs.searchmodelKeyPrimaryGroupTags')}
          />
          <div className="proxy-log-filter-selects">
            <div className="min-w-0">
              <Select
                value={clientFilter || ALL_CLIENTS_SELECT_VALUE}
                onValueChange={(nextValue) => {
                  setClientFilter(nextValue === ALL_CLIENTS_SELECT_VALUE ? "" : nextValue);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tr('pages.proxyLogs.allclient')} />
                </SelectTrigger>
                <SelectContent>
                  {resolvedClientOptions.map((option) => (
                    <SelectItem key={option.value || ALL_CLIENTS_SELECT_VALUE} value={option.value || ALL_CLIENTS_SELECT_VALUE}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Select
                value={siteFilter ? String(siteFilter) : ALL_SITES_SELECT_VALUE}
                onValueChange={(nextValue) => {
                  setSiteFilter(nextValue === ALL_SITES_SELECT_VALUE ? null : Number(nextValue));
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tr('pages.oAuthManagement.allsites')} />
                </SelectTrigger>
                <SelectContent>
                  {siteOptions.map((option) => (
                    <SelectItem key={option.value || ALL_SITES_SELECT_VALUE} value={option.value || ALL_SITES_SELECT_VALUE}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="proxy-log-filter-time">
            <Label className="grid gap-1 text-xs text-muted-foreground">
              <span>{tr('pages.checkinLog.start')}</span>
              <Input
                type="datetime-local"
                value={fromInput}
                max={toInput || undefined}
                onChange={(e) => {
                  setFromInput(e.target.value);
                  setPage(1);
                }}
              />
            </Label>
            <Label className="grid gap-1 text-xs text-muted-foreground">
              <span>{tr('pages.checkinLog.end')}</span>
              <Input
                type="datetime-local"
                value={toInput}
                min={fromInput || undefined}
                onChange={(e) => {
                  setToInput(e.target.value);
                  setPage(1);
                }}
              />
            </Label>
          </div>
          <Button
            variant="outline"
            type="button"
            className="proxy-log-filter-reset-button"
            onClick={() => {
              setStatusFilter("all");
              setClientFilter("");
              setSiteFilter(null);
              setFromInput("");
              setToInput("");
              setSearchInput("");
              setPage(1);
            }}
          >
            {tr('pages.checkinLog.clearfilter')}
          </Button>
        </div>
        <div className="proxy-log-filter-pills">
          <AppliedFilterPill label={tr('components.notificationPanel.status')} value={activeStatusLabel} />
          <AppliedFilterPill label={tr('components.searchModal.sites2')} value={activeSiteLabel} />
          <AppliedFilterPill label={tr('pages.proxyLogs.client')} value={activeClientLabel} />
          {fromInput || toInput ? (
            <AppliedFilterPill
              label={tr('pages.proxyLogs.time')}
              value={`${fromInput || "-"} - ${toInput || "-"}`}
            />
          ) : null}
          {activeSearchText ? (
            <AppliedFilterPill label={tr('pages.proxyLogs.keyword')} value={activeSearchText} />
          ) : null}
        </div>
    </div>
  );

  const debugSettingsFooter = (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline"
        type="button"

        onClick={() => setDebugDraftSettings(DEFAULT_PROXY_DEBUG_SETTINGS)}
      >
        {tr('pages.proxyLogs.resetDefault')}
      </Button>
      <Button
        type="button"

        onClick={() => void handleSaveDebugSettings()}
        disabled={debugPanelSaving}
      >
        {debugPanelSaving ? tr('pages.accounts.saving') : tr('pages.proxyLogs.savedebugsettings')}
      </Button>
    </div>
  );
  const renderDebugCheckbox = (
    key: keyof Pick<
      ProxyDebugSettingsState,
      "proxyDebugTraceEnabled" | "proxyDebugCaptureHeaders" | "proxyDebugCaptureBodies" | "proxyDebugCaptureStreamChunks"
    >,
    label: string,
    description: string,
    testId: string,
  ) => (
    <div className="grid gap-1">
      <Label className="flex items-center gap-2">
        <Checkbox
          checked={debugDraftSettings[key]}
          data-debug-setting={testId}
          onCheckedChange={(checked) =>
            setDebugDraftSettings((current) => ({
              ...current,
              [key]: checked === true,
            }))
          }
        />
        {label}
      </Label>
      <div className="pl-6 text-xs text-muted-foreground">{description}</div>
    </div>
  );

  const debugSettingsForm = (
    <div className="grid gap-3">
      <InfoNote>
        {tr('pages.proxyLogs.debugTraceFilterDescription')}
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.proxyLogs.content2')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {renderDebugCheckbox("proxyDebugTraceEnabled", tr('pages.proxyLogs.enableDebugTrace'), tr('pages.proxyLogs.newRequestsWillWrittenDebugTracesOld'), "trace-enabled")}
          {renderDebugCheckbox("proxyDebugCaptureHeaders", tr('pages.proxyLogs.captureRawRequestResponseHeaders'), tr('pages.proxyLogs.keepRawDownstreamHeadersUpstreamResponseHeaders'), "capture-headers")}
          {renderDebugCheckbox("proxyDebugCaptureBodies", tr('pages.proxyLogs.captureRequestResponseBodies'), tr('pages.proxyLogs.defaultBodyTurn'), "capture-bodies")}
          {renderDebugCheckbox("proxyDebugCaptureStreamChunks", tr('pages.proxyLogs.streaming2'), tr('pages.proxyLogs.sseStreamingCompatibilityHint'), "capture-stream-chunks")}
        </CardContent>
      </Card>

      <ResponsiveFormGrid columns={2}>
        <Card>
          <CardHeader>
            <CardTitle>{tr('pages.proxyLogs.focusedFilter')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.traceSessionId')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugFilterSessionId}
              data-debug-setting="target-session-id"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugFilterSessionId: e.target.value,
                }))
              }
              placeholder={tr('pages.proxyLogs.leaveEmptyDisableFiltering')}
            />
          </Label>
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.traceClient')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugFilterClientKind}
              data-debug-setting="target-client-kind"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugFilterClientKind: e.target.value,
                }))
              }
              placeholder={tr('pages.proxyLogs.codexClaudeCode')}
            />
          </Label>
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.traceModel')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugFilterModel}
              data-debug-setting="target-model"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugFilterModel: e.target.value,
                }))
              }
              placeholder={tr('pages.proxyLogs.gpt4o')}
            />
          </Label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr('pages.proxyLogs.retentionPolicy')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.retentionDurationHours')}</span>
            <Input
              type="number"
              min={1}
              value={debugDraftSettings.proxyDebugRetentionHours}
              data-debug-setting="retention-hours"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugRetentionHours: Number(e.target.value || 1),
                }))
              }
            />
          </Label>
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.captureSizeLimitBytes')}</span>
            <Input
              type="number"
              min={1024}
              value={debugDraftSettings.proxyDebugMaxBodyBytes}
              data-debug-setting="max-body-bytes"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugMaxBodyBytes: Number(e.target.value || 1024),
                }))
              }
            />
          </Label>
          </CardContent>
        </Card>
      </ResponsiveFormGrid>

      {isMobile ? debugSettingsFooter : null}
    </div>
  );

  return (
    <div className="proxy-log-workbench animate-fade-in">
      <div className="proxy-log-summary-header">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="size-5 text-primary" />
            <h2 className="truncate text-xl font-semibold">{tr('app.usageLogs')}</h2>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {tr('pages.proxyLogs.filterProxyRequestsDescription')}
          </div>
        </div>
        <div className="proxy-log-summary-actions flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant={autoRefresh ? "secondary" : "outline"}
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? tr('pages.proxyLogs.closeautomaticrefresh') : tr('pages.proxyLogs.enableAutoRefreshEvery2Seconds')}
          >
            <RefreshCw className={autoRefresh ? "animate-spin" : undefined} />
            {autoRefresh ? tr('pages.proxyLogs.autoRefreshing') : tr('pages.oAuthManagement.automaticrefresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void load();
              void loadMeta(true);
            }}
            disabled={loading}
          >
            <RefreshCw />
            {loading ? tr('pages.oAuthManagement.loading') : tr('pages.accounts.refresh')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleQuickToggleDebugTrace()} disabled={debugPanelSaving}>
            <Bug />
            {debugSettings.proxyDebugTraceEnabled ? tr('pages.proxyLogs.closedebug') : tr('pages.proxyLogs.enableDebug')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setDebugDraftSettings(debugSettings); setShowDebugSettingsModal(true); }}>
            {tr('pages.proxyLogs.debugsettings')}
          </Button>
        </div>
      </div>

      <div className="proxy-log-overview-grid">
        <OverviewMetric
          label={tr('pages.proxyLogs.total')}
          value={summary.totalCount.toLocaleString()}
        />
        <OverviewMetric
          label={tr('pages.checkinLog.success')}
          value={summary.successCount.toLocaleString()}
          tone="success"
        />
        <OverviewMetric
          label={tr('pages.checkinLog.failed')}
          value={summary.failedCount.toLocaleString()}
          tone={summary.failedCount > 0 ? "error" : "neutral"}
        />
        <OverviewMetric
          label={tr('pages.proxyLogs.totalTokens')}
          value={summary.totalTokensAll.toLocaleString()}
          tone="warning"
        />
        <OverviewMetric
          label={tr('pages.proxyLogs.cost')}
          value={<CostOverviewValue summary={summary.cost} />}
          wide
        />
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('pages.proxyLogs.filter')}
        mobileContent={filterControls}
        mobileTrigger={
          <div className="mb-3 flex justify-end">
            <Button type="button" variant="outline" onClick={() => setShowFilters(true)}>
              <Filter />
              {tr('pages.proxyLogs.filter')}
              {activeFilterCount > 0 ? <ToneBadge tone="-muted">{activeFilterCount}</ToneBadge> : null}
            </Button>
          </div>
        }
        desktopContent={
          <div className="mb-3">
            {filterControls}
          </div>
        }
      />

      {isMobile ? (
        <MobileDrawer
          open={showDebugSettingsModal}
          onClose={() => {
            setShowDebugSettingsModal(false);
            setDebugDraftSettings(debugSettings);
          }}
          title={tr('pages.proxyLogs.debugsettings')}
          closeLabel={tr('pages.proxyLogs.closedebugsettings')}
          side="right"
        >
          <div className="grid gap-4 p-4">
            {debugSettingsForm}
          </div>
        </MobileDrawer>
      ) : (
        <CenteredModal
          open={showDebugSettingsModal}
          onClose={() => {
            setShowDebugSettingsModal(false);
            setDebugDraftSettings(debugSettings);
          }}
          title={tr('pages.proxyLogs.debugsettings')}
          footer={debugSettingsFooter}
          maxWidth={880}
          closeOnBackdrop
          closeOnEscape
        >
          {debugSettingsForm}
        </CenteredModal>
      )}

      {rawPayloadViewer ? (
        isMobile ? (
          <MobileDrawer
            open
            onClose={() => setRawPayloadViewer(null)}
            title={rawPayloadViewer.title}
            closeLabel={tr('pages.proxyLogs.closeRawPayload')}
            side="right"
          >
            <div className="grid gap-3 p-4">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopyStoredDebugValue(rawPayloadViewer.title, rawPayloadViewer.value)}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  {tr('pages.proxyLogs.copySavecontent')}
                </Button>
              </div>
              <CodeBlock>{parseStoredDebugPreview(rawPayloadViewer.value).displayText}</CodeBlock>
            </div>
          </MobileDrawer>
        ) : (
          <CenteredModal
            open
            onClose={() => setRawPayloadViewer(null)}
            title={rawPayloadViewer.title}
            maxWidth={920}
            closeOnBackdrop
            closeOnEscape
          >
            <div className="grid gap-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopyStoredDebugValue(rawPayloadViewer.title, rawPayloadViewer.value)}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  {tr('pages.proxyLogs.copySavecontent')}
                </Button>
              </div>
              <CodeBlock>{parseStoredDebugPreview(rawPayloadViewer.value).displayText}</CodeBlock>
            </div>
          </CenteredModal>
        )
      ) : null}

      {hasInvalidTimeRange && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{tr('pages.checkinLog.endtimeStarttime')}</AlertDescription>
        </Alert>
      )}

      <DataTable minWidth={useCardLayout ? undefined : 1040} density="compact" className="proxy-log-list-card">
        <DataTableToolbar className="proxy-log-list-header border-b bg-muted/30 px-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{tr('pages.proxyLogs.requestHistory')}</div>
            <div className="text-xs text-muted-foreground">
              {tr('pages.proxyLogs.showing')} {displayedStart} - {displayedEnd} {tr('pages.proxyLogs.itemsTotal')} {total} {tr('pages.programLogs.items')}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToneBadge tone={activeFilterCount > 0 ? "-primary" : "-muted"}>
              {activeFilterCount > 0
                ? `${activeFilterCount} ${tr('pages.proxyLogs.activeFilters')}`
                : tr('pages.proxyLogs.noActiveFilters')}
            </ToneBadge>
            <ToneBadge tone="-muted">
              {tr('pages.proxyLogs.rowsPerPageLabel')} {pageSize}
            </ToneBadge>
          </div>
        </DataTableToolbar>
        {loading ? (
          <div className="grid gap-3 p-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : useCardLayout ? (
          <div className="grid gap-3">
            {logs.map((requestLog) => {
              const log = presentProxyRequestLog(requestLog);
              const detailState = detailById[log.id];
              const detail = detailState?.data;
              const detailLog = detail ? presentProxyRequestLog(detail) : log;
              const pathMeta = parseProxyLogPathMeta(
                detailLog.errorMessage ?? undefined,
              );
              const isExpanded = expanded === log.id;
              const clientDisplay = resolveProxyLogClientDisplay(detailLog);
              const streamModeLabel = formatStreamModeLabel(detailLog.isStream);
              const streamLatency = resolveInteractiveStreamLatency(detailLog);
              const matchedTrace = requestLog.debugTrace || null;
              const traceDetailState = matchedTrace ? debugDetailById[matchedTrace.id] : undefined;
              const decisionSnapshot = detailLog.decisionSnapshot;
              const downstreamProtocol = formatDownstreamProtocol(log.downstreamPath);
              const upstreamPath = resolveProxyLogUpstreamPath(detailLog, matchedTrace);
              const cacheMetrics = requestCacheMetrics(requestLog.billingSummary);
              const hasUsage = log.promptTokens != null
                || log.completionTokens != null
                || cacheMetrics.length > 0
                || requestLog.billingSummary?.quote != null;

              return (
                <MobileCard
                  key={log.id}
                  title={detailLog.modelRequested || tr('common.notAvailable')}
                  subtitle={
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>{formatDateTimeLocal(log.createdAt)}</span>
                      {log.httpStatus != null ? <span>HTTP {log.httpStatus}</span> : null}
                    </span>
                  }
                  compact
                  headerActions={
                    <div className="flex items-center gap-1.5">
                      <ToneBadge tone={proxyRequestStatusTone(log.status)}>
                        {proxyRequestStatusLabel(log.status)}
                      </ToneBadge>
                      {matchedTrace ? (
                        <span className="proxy-log-debug-indicator" title={tr('pages.proxyLogs.debugCaptured')} aria-label={tr('pages.proxyLogs.debugCaptured')}>
                          <Bug className="size-3.5" aria-hidden="true" />
                        </span>
                      ) : null}
                      <Button type="button" variant="ghost" size="icon" className="-mr-2 size-11" aria-label={isExpanded ? tr('pages.proxyLogs.collapsedetails') : tr('pages.accounts.details')} onClick={() => handleToggleExpand(log.id)}>
                        <ChevronRight className={`size-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </Button>
                    </div>
                  }
                >
                  <MobileField
                    label={tr('pages.proxyLogs.downstreamProtocol')}
                    value={
                      <span className="inline-flex flex-wrap justify-end gap-x-1.5">
                        {downstreamProtocol ? <span>{downstreamProtocol}</span> : null}
                        <code className="font-mono text-xs text-muted-foreground">{log.downstreamPath || '--'}</code>
                      </span>
                    }
                  />
                  {clientDisplay.app ? <MobileField label={tr('pages.proxyLogs.clientApplication')} value={clientDisplay.app} /> : null}
                  {clientDisplay.profile ? <MobileField label={tr('pages.proxyLogs.clientProfile')} value={clientDisplay.profile} /> : null}
                  {detailLog.downstreamKeyName ? <MobileField label={tr('pages.proxyLogs.downstreamKey')} value={detailLog.downstreamKeyName} /> : null}
                  {matchedTrace?.sessionId ? <MobileField label={tr('pages.proxyLogs.session')} value={<RuntimeIdentifier value={matchedTrace.sessionId} maxLength={42} />} /> : null}
                  <div className="border-t pt-2">
                    <ProxyLogTargetSummary
                      siteId={log.siteId}
                      siteName={log.siteName}
                      username={log.username}
                      tokenName={log.tokenName}
                      tokenGroup={log.tokenGroup}
                      tokenId={log.tokenId}
                      compact
                    />
                    {upstreamPath ? (
                      <div className="mt-1 flex min-w-0 items-start gap-1 text-xs text-muted-foreground">
                        <span className="shrink-0">{tr('pages.proxyLogs.endpoint')}</span>
                        <code className="min-w-0 break-all font-mono">{upstreamPath}</code>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {streamModeLabel ? (
                      <ToneBadge tone="-muted">
                        {streamModeLabel}
                      </ToneBadge>
                    ) : null}
                    {streamLatency ? (
                      <ToneBadge tone="">
                        {streamLatency.badge}
                      </ToneBadge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-2 text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Timer className="size-3" />{tr('pages.proxyLogs.duration')} <strong className="text-foreground">{formatLatency(log.latencyMs)}</strong></span>
                    {hasUsage ? <span className="text-right text-muted-foreground">{tr('pages.proxyLogs.input')} <strong className="text-foreground">{formatProxyLogTokenValue(log.promptTokens)}</strong></span> : null}
                    {hasUsage ? <span className="text-muted-foreground">{tr('pages.proxyLogs.output')} <strong className="text-foreground">{formatProxyLogTokenValue(log.completionTokens)}</strong></span> : null}
                    {hasUsage ? <span className="text-right text-muted-foreground">{tr('pages.proxyLogs.cost')} <strong className="text-foreground">{formatRequestCost(requestLog.billingSummary)}</strong></span> : <span className="text-right text-muted-foreground">{tr('pages.proxyLogs.usageAndBilling')} --</span>}
                    {cacheMetrics.map((metric) => (
                      <span key={metric.label} className="text-muted-foreground">{metric.label} <strong className="text-foreground">{metric.value}</strong></span>
                    ))}
                  </div>
                  {isExpanded ? (
                    <div className="proxy-log-mobile-expanded mt-3">
                      {detailLog.status === 'failure' && detail && pathMeta.errorMessage.trim().length > 0 ? (
                        <section className="proxy-log-result-summary is-error">
                          <div className="proxy-log-section-heading">
                            <strong>{tr('pages.proxyLogs.resultSummary')}</strong>
                            {detailLog.attempts.length === 0 ? (
                              <ToneBadge tone="-error">{tr('pages.proxyLogs.requestNotSentUpstream')}</ToneBadge>
                            ) : null}
                          </div>
                          <div className="proxy-log-final-error">
                            <span>{tr('pages.proxyLogs.finalFailureReason')}</span>
                            <p>{pathMeta.errorMessage}</p>
                          </div>
                        </section>
                      ) : null}

                      <section className="proxy-log-narrative-section">
                        <div className="proxy-log-section-heading"><strong>{tr('pages.proxyLogs.requestContext')}</strong></div>
                        <MobileField
                          label={tr('pages.proxyLogs.requestId')}
                          value={<RuntimeIdentifier value={log.id} maxLength={48} />}
                        />
                        <MobileField
                          label={tr('pages.proxyLogs.usageSource')}
                          value={
                            formatProxyLogUsageSource(
                              detailLog.usageSource ?? pathMeta.usageSource,
                            ) || "--"
                          }
                        />
                        {detailState?.loading && (
                          <div className="text-muted-foreground">
                            {tr('pages.proxyLogs.loadingDetails')}
                          </div>
                        )}
                        {detailState?.error && (
                          <div className="text-destructive">
                            {detailState.error}
                          </div>
                        )}
                      </section>

                      {decisionSnapshot || !matchedTrace ? (
                        <section className="proxy-log-narrative-section">
                          <div className="proxy-log-section-heading"><strong>{tr('pages.proxyLogs.executionPath')}</strong></div>
                          {decisionSnapshot ? (
                            <RouteRuntimeSnapshotFlow
                              snapshot={decisionSnapshot}
                              attempts={detailLog.attempts}
                            />
                          ) : (
                            <ToneBadge tone="-muted">{tr('pages.proxyLogs.noRouteRuntimeSnapshot')}</ToneBadge>
                          )}
                        </section>
                      ) : null}

                      <ProxyExecutionAttemptTimeline
                        attempts={detailLog.attempts}
                        finalExecutionAttemptId={detailLog.finalExecutionAttemptId}
                        decisionSnapshotExecutionAttemptId={decisionSnapshot?.executionAttempt?.executionAttemptId}
                        requestedModel={detailLog.modelRequested}
                        debugAttempts={traceDetailState?.data?.attempts || []}
                        preflightOutcomes={getProxyDebugPreflightOutcomes(traceDetailState?.data?.trace.runtimeTraceJson)}
                        renderUpstreamExchange={matchedTrace ? (attempt, exchangeIndex) => renderUpstreamExchange(
                          attempt,
                          matchedTrace.id,
                          traceDetailState?.attemptBodiesLoaded?.includes(attempt.id) === true,
                          traceDetailState?.attemptBodiesLoading?.includes(attempt.id) === true,
                          exchangeIndex,
                        ) : undefined}
                      />
                      {matchedTrace ? (
                        renderDebugTraceDetailContent(matchedTrace.id, {
                          showRouteFlow: !decisionSnapshot,
                        })
                      ) : null}

                      <DetailDisclosureCard title={tr('pages.proxyLogs.usageAndBilling')}>
                        <UsageAndBillingDetail log={detailLog} />
                      </DetailDisclosureCard>
                      <DetailDisclosureCard title={tr('pages.proxyLogs.requestPaths')}>
                        <RequestPathsDetail
                          downstreamPath={detailLog.downstreamPath}
                          upstreamPath={upstreamPath}
                        />
                      </DetailDisclosureCard>
                    </div>
                  ) : null}
                </MobileCard>
              );
            })}
          </div>
        ) : (
          <Table className="proxy-log-table w-full table-fixed text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[3%]" />
                <TableHead className="w-[14%]">{tr('pages.checkinLog.time')}</TableHead>
                <TableHead className="w-[27%]">{tr('pages.proxyLogs.requestOverview')}</TableHead>
                <TableHead className="w-[22%]">{tr('pages.proxyLogs.upstreamExecution')}</TableHead>
                <TableHead className="w-[14%]">{tr('pages.proxyLogs.resultAndLatency')}</TableHead>
                <TableHead className="w-[20%] text-right">{tr('pages.proxyLogs.usageAndBilling')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((requestLog) => {
                const log = presentProxyRequestLog(requestLog);
                const matchedTrace = requestLog.debugTrace || null;
                const traceDetailState = matchedTrace ? debugDetailById[matchedTrace.id] : undefined;
                const detailState = detailById[log.id];
                const detail = detailState?.data;
                const detailLog = detail ? presentProxyRequestLog(detail) : log;
                const clientDisplay = resolveProxyLogClientDisplay(detailLog);
                const pathMeta = parseProxyLogPathMeta(
                  detailLog.errorMessage ?? undefined,
                );
                const downstreamKeySummary =
                  renderDownstreamKeySummary(detailLog);
                const streamModeLabel = formatStreamModeLabel(
                  detailLog.isStream,
                );
                const streamLatency = resolveInteractiveStreamLatency(detailLog);
                const decisionSnapshot = detailLog.decisionSnapshot;
                const downstreamProtocol = formatDownstreamProtocol(log.downstreamPath);
                const upstreamPath = resolveProxyLogUpstreamPath(detailLog, matchedTrace);
                const cacheMetrics = requestCacheMetrics(requestLog.billingSummary);
                const hasUsage = log.promptTokens != null
                  || log.completionTokens != null
                  || cacheMetrics.length > 0
                  || requestLog.billingSummary?.quote != null;

                return (
                  <React.Fragment key={log.id}>
                    <TableRow
                      data-testid={`proxy-log-row-${log.id}`}
                      onClick={() => handleToggleExpand(log.id)}
                      className={`proxy-log-table-row row-selectable cursor-pointer ${expanded === log.id ? "row-selected" : ""}`.trim()}
                      data-state={expanded === log.id ? "selected" : undefined}
                    >
                      <TableCell className="text-muted-foreground">
                        <ChevronRight className={`size-4 transition-transform ${expanded === log.id ? "rotate-90" : ""}`} />
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1">
                          <span className="whitespace-nowrap font-mono text-xs font-medium">{formatDateTimeLocal(log.createdAt)}</span>
                          <span className="inline-flex min-w-0 items-center gap-0.5 text-[11px] text-muted-foreground">#<RuntimeIdentifier value={log.id} maxLength={30} /></span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="proxy-log-model-cell">
                          <div className="flex flex-wrap items-center gap-2">
                            <ModelBadge model={log.modelRequested} />
                            {streamModeLabel ? <ToneBadge tone="-muted">{streamModeLabel}</ToneBadge> : null}
                          </div>
                          <div className="proxy-log-request-line">
                            <span className="proxy-log-line-label">{tr('pages.proxyLogs.downstreamProtocol')}</span>
                            {downstreamProtocol ? <span className="text-foreground">{downstreamProtocol}</span> : null}
                            <code>{log.downstreamPath || '--'}</code>
                          </div>
                          {(clientDisplay.app || clientDisplay.profile) ? (
                            <div className="proxy-log-request-line">
                              {clientDisplay.app ? <span><span className="proxy-log-line-label">{tr('pages.proxyLogs.clientApplication')}</span> <span className="text-foreground">{clientDisplay.app}</span>{clientDisplay.heuristic ? <span> · {tr('pages.proxyLogs.inferred')}</span> : null}</span> : null}
                              {clientDisplay.profile ? <span><span className="proxy-log-line-label">{tr('pages.proxyLogs.clientProfile')}</span> <span className="text-foreground">{clientDisplay.profile}</span></span> : null}
                            </div>
                          ) : null}
                          {(detailLog.downstreamKeyName || matchedTrace?.sessionId) ? (
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground" title={downstreamKeySummary ? String(detailLog.downstreamKeyGroupName || '') : undefined}>
                              {detailLog.downstreamKeyName ? <span>{tr('pages.proxyLogs.downstreamKey')}: <span className="text-foreground">{detailLog.downstreamKeyName}</span></span> : null}
                              {matchedTrace?.sessionId ? <span className="inline-flex min-w-0 items-center gap-1"><span className="proxy-log-line-label">{tr('pages.proxyLogs.session')}</span> <RuntimeIdentifier value={matchedTrace.sessionId} maxLength={30} /></span> : null}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="proxy-log-target-cell">
                          <ProxyLogTargetSummary
                            siteId={log.siteId}
                            siteName={log.siteName}
                            username={log.username}
                            tokenName={log.tokenName}
                            tokenGroup={log.tokenGroup}
                            tokenId={log.tokenId}
                          />
                          {upstreamPath ? (
                            <div className="proxy-log-request-line">
                              <span className="proxy-log-line-label">{tr('pages.proxyLogs.endpoint')}</span>
                              <code>{upstreamPath}</code>
                            </div>
                          ) : null}
                          {log.modelActual && log.modelActual !== log.modelRequested ? (
                            <div className="proxy-log-request-line"><span className="proxy-log-line-label">{tr('pages.proxyLogs.actualModel')}</span><span className="text-foreground">{log.modelActual}</span></div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ToneBadge tone={proxyRequestStatusTone(log.status)}>
                              {proxyRequestStatusLabel(log.status)}
                            </ToneBadge>
                            {log.httpStatus != null ? <span className="font-mono text-xs font-semibold text-foreground">HTTP {log.httpStatus}</span> : null}
                            {matchedTrace ? (
                              <span
                                className="proxy-log-debug-indicator"
                                title={tr('pages.proxyLogs.debugCaptured')}
                                aria-label={tr('pages.proxyLogs.debugCaptured')}
                              >
                                <Bug className="size-3.5" aria-hidden="true" />
                              </span>
                            ) : null}
                          </div>
                          <div className="grid gap-0.5 text-xs text-muted-foreground">
                            <span>{tr('pages.proxyLogs.duration')} <strong className="text-foreground">{formatLatency(log.latencyMs)}</strong></span>
                            {streamLatency ? <span>{streamLatency.label} <strong className="text-foreground">{streamLatency.value}</strong></span> : null}
                            {log.retryCount > 0 ? <span>{tr('pages.dashboard.retry')} <strong className="text-foreground">{log.retryCount}</strong></span> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {hasUsage ? (
                          <div className="proxy-log-table-metric-stack">
                            <LogInlineMetric label={tr('pages.proxyLogs.input')} value={formatProxyLogTokenValue(log.promptTokens)} />
                            <LogInlineMetric label={tr('pages.proxyLogs.output')} value={formatProxyLogTokenValue(log.completionTokens)} />
                            {cacheMetrics.map((metric) => (
                              <LogInlineMetric key={metric.label} label={metric.label} value={metric.value} />
                            ))}
                            <LogInlineMetric label={tr('pages.proxyLogs.cost')} value={formatRequestCost(requestLog.billingSummary)} />
                          </div>
                        ) : <span className="proxy-log-empty-metric">--</span>}
                      </TableCell>
                    </TableRow>
                    {expanded === log.id && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <div className="anim-collapse is-open">
                            <div className="anim-collapse-inner">
                              <div className="proxy-log-detail-panel animate-fade-in">
                                {detailState?.loading && (
                                  <div className="text-xs text-muted-foreground">
                                    {tr('pages.proxyLogs.loadingDetails')}
                                  </div>
                                )}
                                {detailState?.error && (
                                  <div className="text-xs text-destructive">
                                    {detailState.error}
                                  </div>
                                )}

                                {detailLog.status === 'failure' && detail && pathMeta.errorMessage.trim().length > 0 ? (
                                  <section className="proxy-log-result-summary is-error">
                                    <div className="proxy-log-section-heading">
                                      <strong>{tr('pages.proxyLogs.resultSummary')}</strong>
                                      {detailLog.attempts.length === 0 ? (
                                        <ToneBadge tone="-error">{tr('pages.proxyLogs.requestNotSentUpstream')}</ToneBadge>
                                      ) : null}
                                    </div>
                                    <div className="proxy-log-final-error">
                                      <span>{tr('pages.proxyLogs.finalFailureReason')}</span>
                                      <p>{pathMeta.errorMessage}</p>
                                    </div>
                                  </section>
                                ) : null}

                                <section className="proxy-log-narrative-section">
                                  <div className="proxy-log-section-heading"><strong>{tr('pages.proxyLogs.requestContext')}</strong></div>
                                  <div className="proxy-log-detail-grid">
                                    <DetailField label={tr('pages.proxyLogs.requestId')}><RuntimeIdentifier value={detailLog.id} maxLength={48} /></DetailField>
                                    <DetailField label={tr('pages.proxyLogs.usageSource')}>{formatProxyLogUsageSource(detailLog.usageSource ?? pathMeta.usageSource) || tr('pages.accounts.unknown2')}</DetailField>
                                  </div>
                                </section>

                                {decisionSnapshot || !matchedTrace ? (
                                  <section className="proxy-log-narrative-section">
                                    <div className="proxy-log-section-heading"><strong>{tr('pages.proxyLogs.executionPath')}</strong></div>
                                    {decisionSnapshot ? (
                                      <RouteRuntimeSnapshotFlow
                                        snapshot={decisionSnapshot}
                                        attempts={detailLog.attempts}
                                      />
                                    ) : (
                                      <ToneBadge tone="-muted">{tr('pages.proxyLogs.noRouteRuntimeSnapshot')}</ToneBadge>
                                    )}
                                  </section>
                                ) : null}

                                <ProxyExecutionAttemptTimeline
                                  attempts={detailLog.attempts}
                                  finalExecutionAttemptId={detailLog.finalExecutionAttemptId}
                                  decisionSnapshotExecutionAttemptId={decisionSnapshot?.executionAttempt?.executionAttemptId}
                                  requestedModel={detailLog.modelRequested}
                                  debugAttempts={traceDetailState?.data?.attempts || []}
                                  preflightOutcomes={getProxyDebugPreflightOutcomes(traceDetailState?.data?.trace.runtimeTraceJson)}
                                  renderUpstreamExchange={matchedTrace ? (attempt, exchangeIndex) => renderUpstreamExchange(
                                    attempt,
                                    matchedTrace.id,
                                    traceDetailState?.attemptBodiesLoaded?.includes(attempt.id) === true,
                                    traceDetailState?.attemptBodiesLoading?.includes(attempt.id) === true,
                                    exchangeIndex,
                                  ) : undefined}
                                />

                                {matchedTrace ? renderDebugTraceDetailContent(matchedTrace.id, { showRouteFlow: !decisionSnapshot }) : null}

                                <DetailDisclosureCard title={tr('pages.proxyLogs.usageAndBilling')}>
                                  <UsageAndBillingDetail log={detailLog} />
                                </DetailDisclosureCard>

                                <DetailDisclosureCard title={tr('pages.proxyLogs.requestPaths')}>
                                  <RequestPathsDetail
                                    downstreamPath={detailLog.downstreamPath}
                                    upstreamPath={upstreamPath}
                                  />
                                </DetailDisclosureCard>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && logs.length === 0 && (
          <DataTableEmpty
            title={tr('pages.proxyLogs.noUsageLogs')}
            description={tr('pages.proxyLogs.proxyRequestEmptyDescription')}
          />
        )}
      </DataTable>

      {total > 0 && (
        <div className="proxy-log-pagination-bar">
          <div className="mr-auto text-xs text-muted-foreground">
            {tr('pages.proxyLogs.showing')} {displayedStart} - {displayedEnd} {tr('pages.proxyLogs.itemsTotal')} {total} {tr('pages.programLogs.items')}
          </div>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  aria-label={tr('pages.models.previousPage')}
                />
              </PaginationItem>
          {pageNumbers.map((num) => (
            <PaginationItem key={num}>
              <PaginationLink type="button" isActive={num === safePage} onClick={() => setPage(num)}>
                {num}
              </PaginationLink>
            </PaginationItem>
          ))}
              <PaginationItem>
                <PaginationNext
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  aria-label={tr('pages.models.nextPage')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{tr('pages.proxyLogs.rowsPerPageLabel')}</span>
              <Select
                value={String(pageSize)}
                onValueChange={(nextValue) => {
                  setPageSize(Number(nextValue));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-24">
                  <SelectValue placeholder={String(pageSize)} />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
        </div>
      )}
    </div>
  );
}
