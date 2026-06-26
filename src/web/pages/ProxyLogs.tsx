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
  type ProxyDebugTraceListItem,
  type ProxyLogBillingDetails,
  type ProxyLogClientOption,
  type ProxyLogDetail,
  type ProxyLogListItem,
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
  ArrowRight,
  Bug,
  ChevronRight,
  Coins,
  Filter,
  GitBranch,
  Hash,
  KeyRound,
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

type ProxyLogRenderItem = ProxyLogListItem & {
  billingDetails?: ProxyLogBillingDetails;
  routeDecision?: ProxyLogDetail["routeDecision"];
  username?: string | null;
  siteName?: string | null;
  siteUrl?: string | null;
  errorMessage?: string | null;
};

type ProxyLogDetailState = {
  loading: boolean;
  data?: ProxyLogDetail;
  error?: string;
};

type ProxyLogSiteFilterOption = {
  id: number;
  name: string;
  status: string | null;
};

type ProxyDebugSettingsState = {
  proxyDebugTraceEnabled: boolean;
  proxyDebugCaptureHeaders: boolean;
  proxyDebugCaptureBodies: boolean;
  proxyDebugCaptureStreamChunks: boolean;
  proxyDebugTargetSessionId: string;
  proxyDebugTargetClientKind: string;
  proxyDebugTargetModel: string;
  proxyDebugRetentionHours: number;
  proxyDebugMaxBodyBytes: number;
};

type ProxyDebugTraceDetailState = {
  loading: boolean;
  data?: ProxyDebugTraceDetail;
  error?: string;
};

type ProxyDebugTraceAttempt = ProxyDebugTraceDetail["attempts"][number];
type StoredDebugPreviewPayload = {
  __metapiTruncated?: boolean;
  preview?: string;
  originalBytes?: number;
  storedBytes?: number;
};

const PAGE_SIZES = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;
const TRACE_TABLE_LIMIT = 20;
const DEBUG_TRACE_PAGE_SIZE = 5;
const ALL_CLIENTS_SELECT_VALUE = "__all_clients__";
const ALL_SITES_SELECT_VALUE = "__all_sites__";
const PROXY_LOGS_DEBUG_TRACE_PANEL_STORAGE_KEY =
  "metapi.proxyLogs.debugTracePanelExpanded";
const PROXY_LOG_CLIENT_FAMILY_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  gemini_cli: "Gemini CLI",
  generic: tr('pages.proxyLogs.general'),
};
const EMPTY_SUMMARY: ProxyLogsSummary = {
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  totalCost: 0,
  totalTokensAll: 0,
};
const DEFAULT_PROXY_DEBUG_SETTINGS: ProxyDebugSettingsState = {
  proxyDebugTraceEnabled: false,
  proxyDebugCaptureHeaders: true,
  proxyDebugCaptureBodies: false,
  proxyDebugCaptureStreamChunks: false,
  proxyDebugTargetSessionId: "",
  proxyDebugTargetClientKind: "",
  proxyDebugTargetModel: "",
  proxyDebugRetentionHours: 24,
  proxyDebugMaxBodyBytes: 262144,
};
const DEBUG_REFRESH_INTERVAL_MS = 2000;
type DetailDisclosureCardProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function DetailDisclosureCard({
  title,
  defaultOpen = false,
  children,
}: DetailDisclosureCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-3">
        <CardTitle>{title}</CardTitle>
        <CollapsibleTrigger asChild>
        <Button
        type="button"
          variant="ghost"
          size="sm"
        aria-label={`${open ? tr('pages.accounts.collapse') : tr('pages.proxyLogs.expand')}${title}`}
      >
          {open ? tr('pages.accounts.collapse') : tr('pages.proxyLogs.expand')}
        </Button>
        </CollapsibleTrigger>
      </CardHeader>
      <CollapsibleContent asChild>
        <CardContent className="pt-0">{children}</CardContent>
      </CollapsibleContent>
    </Card>
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

function formatTraceEntityLabel(
  label: string | null | undefined,
  id: number | null | undefined,
  fallbackLabel: string,
): string {
  const normalizedLabel = (label || '').trim() || fallbackLabel;
  return id ? `${normalizedLabel} (#${id})` : normalizedLabel;
}

function formatTraceRouteLabel(trace: ProxyDebugTraceDetail["trace"]): string {
  return formatTraceEntityLabel(
    trace.selectedRouteDisplay?.label || trace.requestedModel,
    trace.selectedRouteId,
    tr('pages.proxyLogs.selectedRoute'),
  );
}

function formatTraceTargetLabel(trace: ProxyDebugTraceDetail["trace"]): string {
  return formatTraceEntityLabel(
    trace.selectedTargetDisplay?.label
      || trace.selectedTargetDisplay?.sourceModel
      || trace.selectedTargetDisplay?.routeEndpointId,
    trace.selectedTargetId,
    tr('pages.proxyLogs.selectedTarget'),
  );
}

function formatTraceSiteLabel(trace: ProxyDebugTraceDetail["trace"]): string {
  const siteDisplay = trace.selectedSiteDisplay;
  const platform = siteDisplay?.platform || trace.selectedSitePlatform || trace.selectedTargetDisplay?.sitePlatform;
  const name = siteDisplay?.label || trace.selectedTargetDisplay?.siteName || platform || null;
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

function formatLatency(ms: number) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  }
  return `${ms}ms`;
}

function latencyTone(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number") return "-muted";
  if (ms >= 3000) return "-error";
  if (ms >= 1000) return "-warning";
  return "-success";
}

function firstByteTone(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number") return "-muted";
  if (ms >= 3000) return "-error";
  if (ms >= 1000) return "-warning";
  return "-info";
}

function formatStreamModeLabel(isStream: boolean | null | undefined) {
  if (isStream == null) return null;
  return isStream ? tr('pages.modelTester.streaming') : tr('pages.proxyLogs.nonStreaming');
}

function formatFirstByteLabel(ms: number | null | undefined) {
  if (!Number.isFinite(ms) || typeof ms !== "number" || ms < 0) return null;
  return `首字 ${formatLatency(ms)}`;
}

function formatCompactNumber(value: number, digits = 6) {
  if (!Number.isFinite(value)) return "0";
  const formatted = value.toFixed(digits).replace(/\.?0+$/, "");
  return formatted || "0";
}

function formatPerMillionPrice(value: number) {
  return `$${formatCompactNumber(value)} / 1M tokens`;
}

function formatBillingDetailSummary(log: ProxyLogRenderItem) {
  const detail = log.billingDetails;
  if (!detail) return null;
  return `模型倍率 ${formatCompactNumber(detail.pricing.modelRatio)}，输出倍率 ${formatCompactNumber(detail.pricing.completionRatio)}，缓存倍率 ${formatCompactNumber(detail.pricing.cacheRatio)}，缓存创建倍率 ${formatCompactNumber(detail.pricing.cacheCreationRatio)}，分组倍率 ${formatCompactNumber(detail.pricing.groupRatio)}`;
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

function formatProxyDecisionBackendKind(kind: string | null | undefined) {
  if (kind === "routes") return tr('pages.proxyLogs.routeGroup');
  if (kind === "supply") return tr('pages.proxyLogs.supplyRoute');
  return kind || tr('pages.accounts.unknown2');
}

function formatProxyDecisionMatchKind(kind: string | null | undefined) {
  if (kind === "model") return tr('components.modelAnalysisPanel.model');
  if (kind === "fallback") return tr('pages.proxyLogs.fallback');
  return kind || tr('pages.accounts.unknown2');
}

function formatProxyFallbackScope(scope: string | null | undefined) {
  if (scope === "api_variant") return tr('pages.proxyLogs.apiVariantFallback');
  if (scope === "transport_replica") return tr('pages.proxyLogs.transportReplicaFallback');
  if (scope === "route_candidate") return tr('pages.proxyLogs.routeCandidateFallback');
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
    log.downstreamKeyName ? `下游 Key: ${log.downstreamKeyName}` : null,
    log.downstreamKeyGroupName ? `主分组: ${log.downstreamKeyGroupName}` : null,
    Array.isArray(log.downstreamKeyTags) && log.downstreamKeyTags.length > 0
      ? `标签: ${log.downstreamKeyTags.join(" / ")}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : null;
}

function buildBillingProcessLines(log: ProxyLogRenderItem) {
  const detail = log.billingDetails;
  if (!detail) return [];

  const lines = [
    `提示价格：${formatPerMillionPrice(detail.breakdown.inputPerMillion)}`,
    `补全价格：${formatPerMillionPrice(detail.breakdown.outputPerMillion)}`,
  ];

  if (detail.usage.cacheReadTokens > 0) {
    lines.push(
      `缓存价格：${formatPerMillionPrice(detail.breakdown.cacheReadPerMillion)} (缓存倍率: ${formatCompactNumber(detail.pricing.cacheRatio)})`,
    );
  }

  if (detail.usage.cacheCreationTokens > 0) {
    lines.push(
      `缓存创建价格：${formatPerMillionPrice(detail.breakdown.cacheCreationPerMillion)} (缓存创建倍率: ${formatCompactNumber(detail.pricing.cacheCreationRatio)})`,
    );
  }

  const parts = [
    `提示 ${detail.usage.billablePromptTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.inputPerMillion)}`,
  ];

  if (detail.usage.cacheReadTokens > 0) {
    parts.push(
      `缓存 ${detail.usage.cacheReadTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.cacheReadPerMillion)}`,
    );
  }

  if (detail.usage.cacheCreationTokens > 0) {
    parts.push(
      `缓存创建 ${detail.usage.cacheCreationTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.cacheCreationPerMillion)}`,
    );
  }

  parts.push(
    `补全 ${detail.usage.completionTokens.toLocaleString()} tokens / 1M tokens * $${formatCompactNumber(detail.breakdown.outputPerMillion)} = $${detail.breakdown.totalCost.toFixed(6)}`,
  );
  lines.push(parts.join(" + "));

  return lines;
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
      primary: appName,
      secondary: familyLabel,
      heuristic: log.clientConfidence === "heuristic",
    };
  }
  return {
    primary: familyLabel,
    secondary: null,
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
  if (!display.primary) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>{display.primary}</span>
        {display.heuristic ? (
          <ToneBadge tone="">
            {tr('pages.proxyLogs.inferred')}
          </ToneBadge>
        ) : null}
      </div>
      {display.secondary ? (
        <span className="text-xs text-muted-foreground">
          {display.secondary}
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
    proxyDebugTargetSessionId: String(value?.proxyDebugTargetSessionId || ""),
    proxyDebugTargetClientKind: String(value?.proxyDebugTargetClientKind || ""),
    proxyDebugTargetModel: String(value?.proxyDebugTargetModel || ""),
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
    proxyDebugTargetSessionId: settings.proxyDebugTargetSessionId.trim(),
    proxyDebugTargetClientKind: settings.proxyDebugTargetClientKind.trim(),
    proxyDebugTargetModel: settings.proxyDebugTargetModel.trim(),
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
  return parts.join("、");
}

function formatProxyDebugTargetSummary(settings: ProxyDebugSettingsState) {
  const parts = [
    settings.proxyDebugTargetSessionId
      ? `Session ${settings.proxyDebugTargetSessionId}`
      : null,
    settings.proxyDebugTargetClientKind
      ? `客户端 ${settings.proxyDebugTargetClientKind}`
      : null,
    settings.proxyDebugTargetModel
      ? `模型 ${settings.proxyDebugTargetModel}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : tr('pages.proxyLogs.recordAllMatchingRequests');
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
            ? `内容已截断展示，原始 ${originalBytes} bytes，当前保留 ${storedBytes} bytes。复制按钮会复制当前数据库里保存的内容。`
            : tr('pages.proxyLogs.contentTruncateCopyCopySaveContent'),
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
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "error";
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
    <div className={`proxy-log-overview-metric ${toneClass}`.trim()}>
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

function TraceDetailMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="proxy-trace-detail-metric">
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
  children,
}: {
  index: number;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="proxy-trace-timeline-item">
      <div className="proxy-trace-timeline-marker">
        <span>{index + 1}</span>
      </div>
      <div className="proxy-trace-timeline-body">
        <div className="proxy-trace-timeline-head">
          <div className="min-w-0">
            <div className="break-words text-sm font-semibold">{title}</div>
            {meta ? <div className="mt-1 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          {tone ? <ToneBadge tone={tone}>{tone.includes("error") ? tr('pages.checkinLog.failed') : tr('pages.checkinLog.success')}</ToneBadge> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function RouteDecisionFlowNode({
  icon,
  label,
  title,
  meta,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tone?: "neutral" | "request" | "route" | "target" | "token";
}) {
  return (
    <div className={`proxy-log-decision-node proxy-log-decision-node-${tone}`}>
      <div className="proxy-log-decision-node-icon">{icon}</div>
      <div className="min-w-0">
        <div className="proxy-log-decision-node-label">{label}</div>
        <div className="proxy-log-decision-node-title">{title}</div>
        {meta ? <div className="proxy-log-decision-node-meta">{meta}</div> : null}
      </div>
    </div>
  );
}

function RouteDecisionFlowConnector({ label }: { label?: React.ReactNode }) {
  return (
    <div className="proxy-log-decision-connector" aria-hidden="true">
      <span />
      <ArrowRight className="size-4" />
      {label ? <em>{label}</em> : null}
    </div>
  );
}

function RouteDecisionFlow({
  decision,
  fallbackRequestedModel,
}: {
  decision: NonNullable<ProxyLogDetail["routeDecision"]>;
  fallbackRequestedModel: string;
}) {
  const route = decision.route || null;
  const target = decision.target || null;
  const token = decision.token || null;
  const snapshot = route?.snapshotSummary || null;
  const requestedModel = decision.requestedModel || fallbackRequestedModel || "-";
  const actualModel = decision.actualModel || null;
  const hasActualModel =
    !!actualModel && actualModel.trim() !== requestedModel.trim();
  const sourceLabel =
    decision.source === "snapshot"
      ? tr('pages.proxyLogs.requestTimeSnapshot')
      : tr('pages.proxyLogs.currentRouteState');

  return (
    <div className="proxy-log-decision-flow-card">
      <div className="proxy-log-decision-flow-head">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-primary">
            {tr('pages.proxyLogs.routeDecision')}
          </div>
          <div className="text-xs text-muted-foreground">
            {decision.source === "snapshot"
              ? tr('pages.proxyLogs.routeDecisionSnapshotDescription')
              : tr('pages.proxyLogs.routeDecisionCurrentDescription')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <ToneBadge tone={decision.source === "snapshot" ? "-success" : "-warning"}>
            {sourceLabel}
          </ToneBadge>
          {decision.capturedAt ? (
            <ToneBadge tone="-muted">
              {formatDateTimeLocal(decision.capturedAt)}
            </ToneBadge>
          ) : null}
        </div>
      </div>

      <div className="proxy-log-decision-flow">
        <RouteDecisionFlowNode
          tone="request"
          icon={<Hash className="size-4" />}
          label={tr('pages.proxyLogs.requestedModel')}
          title={<span className="font-mono">{requestedModel}</span>}
          meta={
            hasActualModel ? (
              <span>{tr('pages.proxyLogs.actualModel')} {actualModel}</span>
            ) : (
              tr('pages.proxyLogs.noModelRewrite')
            )
          }
        />
        <RouteDecisionFlowConnector
          label={
            snapshot
              ? formatProxyDecisionMatchKind(snapshot.matchKind)
              : tr('pages.proxyLogs.matchRule')
          }
        />
        <RouteDecisionFlowNode
          tone="route"
          icon={<GitBranch className="size-4" />}
          label={tr('pages.proxyLogs.matchedRoute')}
          title={
            route ? (
              route.displayName || `${tr('pages.proxyLogs.route')} #${route.id ?? "-"}`
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          }
          meta={
            route ? (
              <span>
                #{route.id ?? "-"} · {formatProxyRouteStrategyLabel(route.routingStrategy)}
              </span>
            ) : (
              tr('pages.proxyLogs.notRecorded')
            )
          }
        />
        <RouteDecisionFlowConnector
          label={target ? `P${formatNullableNumber(target.priority)}` : undefined}
        />
        <RouteDecisionFlowNode
          tone="target"
          icon={<Target className="size-4" />}
          label={tr('pages.proxyLogs.selectedTarget')}
          title={
            target ? (
              <span>#{target.id ?? "-"}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          }
          meta={
            target ? (
              <span>{target.routeEndpointId || tr('pages.proxyLogs.legacyTarget')}</span>
            ) : (
              tr('pages.proxyLogs.notRecorded')
            )
          }
        />
        <RouteDecisionFlowConnector
          label={target ? `${tr('pages.proxyLogs.weight')} ${formatNullableNumber(target.weight)}` : undefined}
        />
        <RouteDecisionFlowNode
          tone="token"
          icon={<KeyRound className="size-4" />}
          label={tr('pages.proxyLogs.targetToken')}
          title={
            token ? (
              token.name || `#${token.id ?? "-"}`
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          }
          meta={
            token ? (
              <span>
                {token.tokenGroup || tr('pages.proxyLogs.noTokenGroup')} · {token.valueStatus || "-"}
              </span>
            ) : (
              tr('pages.proxyLogs.notRecorded')
            )
          }
        />
      </div>
    </div>
  );
}

function DebugTraceRouteDecisionFlow({
  trace,
}: {
  trace: ProxyDebugTraceDetail["trace"];
}) {
  const decisionSummary = asDebugRecord(parseStoredDebugJson(trace.decisionSummaryJson));
  const endpointCandidates = parseStoredDebugJson(trace.endpointCandidatesJson);
  const candidateCount = Array.isArray(endpointCandidates)
    ? endpointCandidates.length
    : 0;
  const downstreamFormat = typeof decisionSummary?.downstreamFormat === "string"
    ? decisionSummary.downstreamFormat
    : null;
  const stickyPreferredTargetId = Number(decisionSummary?.stickyPreferredTargetId || 0);
  const apiAttemptPlan = asDebugRecord(decisionSummary?.apiAttemptPlan);
  const apiAttemptCount = Array.isArray(apiAttemptPlan?.attempts)
    ? apiAttemptPlan.attempts.length
    : null;
  const routeLabel = formatTraceRouteLabel(trace);
  const targetLabel = formatTraceTargetLabel(trace);
  const siteLabel = formatTraceSiteLabel(trace);

  return (
    <div className="proxy-trace-route-flow-card">
      <div className="proxy-trace-section-head">
        <div>
          <div className="text-sm font-semibold">{tr('pages.proxyLogs.routeDecision')}</div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.proxyLogs.debugRouteDecisionDescription')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {candidateCount > 0 ? (
            <ToneBadge tone="-muted">
              {candidateCount} {tr('pages.proxyLogs.candidates')}
            </ToneBadge>
          ) : null}
        </div>
      </div>

      <div className="proxy-trace-route-flow">
        <RouteDecisionFlowNode
          tone="request"
          icon={<Hash className="size-4" />}
          label={tr('pages.proxyLogs.requestedModel')}
          title={<span className="font-mono">{trace.requestedModel || "-"}</span>}
          meta={trace.downstreamPath || tr('pages.proxyLogs.downstreamPath')}
        />
        <RouteDecisionFlowConnector label={downstreamFormat || tr('pages.proxyLogs.matchRule')} />
        <RouteDecisionFlowNode
          tone="route"
          icon={<GitBranch className="size-4" />}
          label={tr('pages.proxyLogs.selectedRoute')}
          title={trace.selectedRouteId ? routeLabel : <span className="text-muted-foreground">-</span>}
          meta={
            stickyPreferredTargetId > 0
              ? `${tr('pages.proxyLogs.stickySession')} (#${stickyPreferredTargetId})`
              : tr('pages.proxyLogs.requestTimeSnapshot')
          }
        />
        <RouteDecisionFlowConnector
          label={candidateCount > 0 ? `${candidateCount} ${tr('pages.proxyLogs.candidates')}` : undefined}
        />
        <RouteDecisionFlowNode
          tone="target"
          icon={<Target className="size-4" />}
          label={tr('pages.proxyLogs.selectedTarget')}
          title={trace.selectedTargetId ? targetLabel : <span className="text-muted-foreground">-</span>}
          meta={
            trace.selectedSiteId
              ? siteLabel
              : tr('pages.proxyLogs.notRecorded')
          }
        />
        <RouteDecisionFlowConnector
          label={apiAttemptCount != null ? `${apiAttemptCount} ${tr('pages.proxyLogs.apiAttempts')}` : undefined}
        />
        <RouteDecisionFlowNode
          tone="token"
          icon={<KeyRound className="size-4" />}
          label={tr('pages.proxyLogs.executionPlan')}
          title={trace.finalUpstreamPath || "-"}
          meta={trace.finalHttpStatus ? `HTTP ${trace.finalHttpStatus}` : tr('pages.proxyLogs.notRecorded')}
        />
      </div>
    </div>
  );
}

function readStoredDebugTracePanelExpanded(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(
      PROXY_LOGS_DEBUG_TRACE_PANEL_STORAGE_KEY,
    );
    if (stored == null) return true;
    return stored !== "false";
  } catch {
    return true;
  }
}

function persistDebugTracePanelExpanded(expanded: boolean) {
  try {
    globalThis.localStorage?.setItem(
      PROXY_LOGS_DEBUG_TRACE_PANEL_STORAGE_KEY,
      expanded ? "true" : "false",
    );
  } catch {
    // Ignore storage write failures and keep UI responsive.
  }
}

export default function ProxyLogs() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialRouteState = useMemo(
    () => readProxyLogsRouteState(location.search),
    [location.search],
  );
  const [logs, setLogs] = useState<ProxyLogListItem[]>([]);
  const [summary, setSummary] = useState<ProxyLogsSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
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
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(initialRouteState.page);
  const [pageSize, setPageSize] = useState(initialRouteState.pageSize);
  const [detailById, setDetailById] = useState<
    Record<number, ProxyLogDetailState>
  >({});
  const [showFilters, setShowFilters] = useState(false);
  const [sites, setSites] = useState<
    Array<{ id: number; name: string; status?: string | null }>
  >([]);
  const [clientOptions, setClientOptions] = useState<ProxyLogClientOption[]>(
    [],
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showDebugSettingsModal, setShowDebugSettingsModal] = useState(false);
  const [debugPanelLoading, setDebugPanelLoading] = useState(false);
  const [debugPanelSaving, setDebugPanelSaving] = useState(false);
  const [debugTracePanelExpanded, setDebugTracePanelExpanded] = useState(() =>
    readStoredDebugTracePanelExpanded(),
  );
  const [debugSettings, setDebugSettings] = useState<ProxyDebugSettingsState>(
    DEFAULT_PROXY_DEBUG_SETTINGS,
  );
  const [debugDraftSettings, setDebugDraftSettings] =
    useState<ProxyDebugSettingsState>(DEFAULT_PROXY_DEBUG_SETTINGS);
  const [debugTraces, setDebugTraces] = useState<ProxyDebugTraceListItem[]>([]);
  const [debugTracePage, setDebugTracePage] = useState(1);
  const [selectedDebugTraceId, setSelectedDebugTraceId] = useState<
    number | null
  >(null);
  const [showDebugTraceDetailModal, setShowDebugTraceDetailModal] =
    useState(false);
  const [debugDetailById, setDebugDetailById] = useState<
    Record<number, ProxyDebugTraceDetailState>
  >({});
  const isMobile = useIsMobile(768);
  const toast = useToast();
  const loadSeq = useRef(0);
  const metaLoadSeq = useRef(0);
  const selectedDebugTraceIdRef = useRef<number | null>(null);
  const debugDetailByIdRef = useRef<Record<number, ProxyDebugTraceDetailState>>(
    {},
  );
  const debugDetailInFlightRef = useRef<Set<number>>(new Set());
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const currentOffset = (safePage - 1) * pageSize;
  const displayedStart = total === 0 ? 0 : currentOffset + 1;
  const displayedEnd =
    total === 0 ? 0 : Math.min(currentOffset + logs.length, total);
  const debugTraceTotalPages = Math.max(
    1,
    Math.ceil(debugTraces.length / DEBUG_TRACE_PAGE_SIZE),
  );
  const safeDebugTracePage = Math.min(debugTracePage, debugTraceTotalPages);
  const debugTraceOffset = (safeDebugTracePage - 1) * DEBUG_TRACE_PAGE_SIZE;
  const visibleDebugTraces = debugTraces.slice(
    debugTraceOffset,
    debugTraceOffset + DEBUG_TRACE_PAGE_SIZE,
  );
  const debugTraceDisplayedStart =
    debugTraces.length === 0 ? 0 : debugTraceOffset + 1;
  const debugTraceDisplayedEnd =
    debugTraces.length === 0
      ? 0
      : Math.min(
          debugTraceOffset + visibleDebugTraces.length,
          debugTraces.length,
        );

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
      label: site.status === "disabled" ? `${site.name}（已禁用）` : site.name,
    }));
    if (
      siteFilter &&
      !options.some((option) => option.value === String(siteFilter))
    ) {
      options.unshift({
        value: String(siteFilter),
        label: `站点 #${siteFilter}（已删除）`,
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
        ?.label || `站点 #${siteFilter}`
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
  const siteIdByName = useMemo(() => {
    const index = new Map<string, number>();
    for (const site of sites) {
      const siteName = String(site?.name || "").trim();
      const siteId = Number(site?.id);
      if (
        !siteName ||
        !Number.isFinite(siteId) ||
        siteId <= 0 ||
        index.has(siteName)
      )
        continue;
      index.set(siteName, Math.trunc(siteId));
    }
    return index;
  }, [sites]);

  const load = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (hasInvalidTimeRange) {
        setLogs([]);
        setTotal(0);
        setSummary(EMPTY_SUMMARY);
        if (seq === loadSeq.current) setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const params = {
          limit: pageSize,
          offset: currentOffset,
          status: statusFilter,
          search: deferredSearchInput,
          ...(clientFilter ? { client: clientFilter } : {}),
          ...(siteFilter ? { siteId: siteFilter } : {}),
          ...(fromApiBoundary ? { from: fromApiBoundary } : {}),
          ...(toApiBoundaryValue ? { to: toApiBoundaryValue } : {}),
        };
        const data = await api.getProxyLogsQuery(params);
        if (seq !== loadSeq.current) return;
        setLogs(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
      } catch (e: any) {
        if (seq !== loadSeq.current) return;
        if (!silent) toast.error(e.message || tr('pages.proxyLogs.failedLoadLog'));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [
      clientFilter,
      currentOffset,
      deferredSearchInput,
      fromApiBoundary,
      hasInvalidTimeRange,
      pageSize,
      siteFilter,
      statusFilter,
      toApiBoundaryValue,
      toast,
    ],
  );

  const loadMeta = useCallback(
    async (forceRefresh = false) => {
      const seq = ++metaLoadSeq.current;
      if (hasInvalidTimeRange) {
        setSummary(EMPTY_SUMMARY);
        setClientOptions([]);
        return;
      }

      try {
        const data = await api.getProxyLogsMeta({
          status: statusFilter,
          search: deferredSearchInput,
          ...(clientFilter ? { client: clientFilter } : {}),
          ...(siteFilter ? { siteId: siteFilter } : {}),
          ...(fromApiBoundary ? { from: fromApiBoundary } : {}),
          ...(toApiBoundaryValue ? { to: toApiBoundaryValue } : {}),
          ...(forceRefresh ? { refresh: 1 } : {}),
        });
        if (seq !== metaLoadSeq.current) return;
        setSummary(data.summary || EMPTY_SUMMARY);
        setClientOptions(
          Array.isArray(data.clientOptions) ? data.clientOptions : [],
        );
        const normalized: ProxyLogSiteFilterOption[] = (
          Array.isArray(data.sites) ? data.sites : []
        )
          .map((site: any) => ({
            id: Number(site?.id || 0),
            name: String(site?.name || "").trim() || `站点 #${site?.id ?? ""}`,
            status: typeof site?.status === "string" ? site.status : null,
          }))
          .filter((site: ProxyLogSiteFilterOption) => site.id > 0)
          .sort(
            (left: ProxyLogSiteFilterOption, right: ProxyLogSiteFilterOption) =>
              left.name.localeCompare(right.name, "zh-CN"),
          );
        setSites(normalized);
      } catch (error) {
        if (seq !== metaLoadSeq.current) return;
        console.error("Failed to load proxy log meta:", error);
      }
    },
    [
      clientFilter,
      deferredSearchInput,
      fromApiBoundary,
      hasInvalidTimeRange,
      siteFilter,
      statusFilter,
      toApiBoundaryValue,
    ],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

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
    if (debugTracePage <= debugTraceTotalPages) return;
    setDebugTracePage(debugTraceTotalPages);
  }, [debugTracePage, debugTraceTotalPages]);

  useEffect(() => {
    setExpanded((current) =>
      current !== null && logs.some((log) => log.id === current)
        ? current
        : null,
    );
  }, [logs]);

  useEffect(() => {
    selectedDebugTraceIdRef.current = selectedDebugTraceId;
  }, [selectedDebugTraceId]);

  useEffect(() => {
    debugDetailByIdRef.current = debugDetailById;
  }, [debugDetailById]);

  const loadDetail = useCallback(
    async (id: number) => {
      const existing = detailById[id];
      if (existing?.loading || existing?.data) return;

      setDetailById((current) => ({
        ...current,
        [id]: { loading: true },
      }));

      try {
        const data = await api.getProxyLogDetail(id);
        setDetailById((current) => ({
          ...current,
          [id]: { loading: false, data },
        }));
      } catch (e: any) {
        const message = e?.message || tr('pages.proxyLogs.logDetailsfailed');
        setDetailById((current) => ({
          ...current,
          [id]: { loading: false, error: message },
        }));
        toast.error(message);
      }
    },
    [detailById, toast],
  );

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
      },
    ) => {
      const existing = debugDetailByIdRef.current[id];
      if (debugDetailInFlightRef.current.has(id)) return;
      if (!options?.force && (existing?.loading || existing?.data)) return;

      debugDetailInFlightRef.current.add(id);

      if (!options?.preserveVisibleData || !existing?.data) {
        setDebugDetailById((current) => ({
          ...current,
          [id]: { loading: true },
        }));
      }

      try {
        const data = await api.getProxyDebugTraceDetail(id);
        setDebugDetailById((current) => ({
          ...current,
          [id]: { loading: false, data },
        }));
      } catch (error: any) {
        const message = error?.message || tr('pages.proxyLogs.debugtraceDetailsfailed');
        setDebugDetailById((current) => ({
          ...current,
          [id]: { loading: false, error: message },
        }));
        if (!options?.suppressToast) {
          toast.error(message);
        }
      } finally {
        debugDetailInFlightRef.current.delete(id);
      }
    },
    [toast],
  );

  const syncDebugTraceItems = useCallback(
    async (
      items: ProxyDebugTraceListItem[],
      options?: { refreshSelectedDetail?: boolean },
    ) => {
      setDebugTraces(items);
      const currentSelectedDebugTraceId = selectedDebugTraceIdRef.current;
      const nextSelectedDebugTraceId =
        currentSelectedDebugTraceId &&
        items.some((item) => item.id === currentSelectedDebugTraceId)
          ? currentSelectedDebugTraceId
          : null;
      selectedDebugTraceIdRef.current = nextSelectedDebugTraceId;
      setSelectedDebugTraceId(nextSelectedDebugTraceId);
      if (nextSelectedDebugTraceId && options?.refreshSelectedDetail) {
        await loadDebugTraceDetail(nextSelectedDebugTraceId, {
          force: true,
          suppressToast: true,
          preserveVisibleData: showDebugTraceDetailModal,
        });
      }
    },
    [loadDebugTraceDetail, showDebugTraceDetailModal],
  );

  const loadDebugTraceList = useCallback(
    async (options?: {
      silent?: boolean;
      refreshSelectedDetail?: boolean;
      suppressToast?: boolean;
    }) => {
      if (!options?.silent) setDebugPanelLoading(true);
      try {
        const traceResponse = await api.getProxyDebugTraces({
          limit: TRACE_TABLE_LIMIT,
        });
        const items = Array.isArray(traceResponse?.items)
          ? traceResponse.items
          : [];
        await syncDebugTraceItems(items, {
          refreshSelectedDetail: options?.refreshSelectedDetail,
        });
      } catch (error: any) {
        if (!options?.suppressToast) {
          toast.error(error?.message || tr('pages.proxyLogs.proxyDebugTraceFailed2'));
        }
      } finally {
        if (!options?.silent) setDebugPanelLoading(false);
      }
    },
    [syncDebugTraceItems, toast],
  );

  const loadDebugState = useCallback(
    async (silent = false) => {
      if (!silent) setDebugPanelLoading(true);
      try {
        const [runtimeSettings, traceResponse] = await Promise.all([
          api.getRuntimeSettings(),
          api.getProxyDebugTraces({ limit: TRACE_TABLE_LIMIT }),
        ]);
        applyLoadedDebugSettings(normalizeProxyDebugSettings(runtimeSettings), {
          syncDraft: true,
        });
        const items = Array.isArray(traceResponse?.items)
          ? traceResponse.items
          : [];
        await syncDebugTraceItems(items, { refreshSelectedDetail: true });
      } catch (error: any) {
        toast.error(error?.message || tr('pages.proxyLogs.proxyDebugTraceFailed'));
      } finally {
        if (!silent) setDebugPanelLoading(false);
      }
    },
    [applyLoadedDebugSettings, syncDebugTraceItems, toast],
  );

  useEffect(() => {
    void loadDebugState();
  }, [loadDebugState]);

  useEffect(() => {
    if (!selectedDebugTraceId || !showDebugTraceDetailModal) return;
    void loadDebugTraceDetail(selectedDebugTraceId);
  }, [loadDebugTraceDetail, selectedDebugTraceId, showDebugTraceDetailModal]);

  useEffect(() => {
    if (!debugSettings.proxyDebugTraceEnabled) return;
    const timer = setInterval(() => {
      void loadDebugTraceList({
        silent: true,
        refreshSelectedDetail: true,
        suppressToast: true,
      });
    }, DEBUG_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [debugSettings.proxyDebugTraceEnabled, loadDebugTraceList]);

  useEffect(() => {
    persistDebugTracePanelExpanded(debugTracePanelExpanded);
  }, [debugTracePanelExpanded]);

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
        if (normalized.proxyDebugTraceEnabled) {
          setDebugTracePanelExpanded(true);
        }
        if (options?.closeAfterSave) {
          setShowDebugSettingsModal(false);
        }
        if (options?.successMessage) {
          toast.success(options.successMessage);
        }
        await loadDebugTraceList({
          silent: true,
          refreshSelectedDetail: true,
          suppressToast: true,
        });
        return normalized;
      } catch (error: any) {
        toast.error(error?.message || tr('pages.proxyLogs.saveProxyDebugSettingsFailed'));
        return null;
      } finally {
        setDebugPanelSaving(false);
      }
    },
    [applyLoadedDebugSettings, loadDebugTraceList, toast],
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
    (id: number) => {
      const shouldExpand = expanded !== id;
      setExpanded(shouldExpand ? id : null);
      if (shouldExpand) {
        void loadDetail(id);
      }
    },
    [expanded, loadDetail],
  );
  const selectedDebugTraceDetail = selectedDebugTraceId
    ? debugDetailById[selectedDebugTraceId]
    : undefined;
  const selectedDebugTraceListItem = selectedDebugTraceId
    ? debugTraces.find((trace) => trace.id === selectedDebugTraceId) || null
    : null;
  const closeDebugTraceDetailModal = useCallback(() => {
    setShowDebugTraceDetailModal(false);
  }, []);
  const openDebugTraceDetailModal = useCallback((traceId: number) => {
    selectedDebugTraceIdRef.current = traceId;
    setSelectedDebugTraceId(traceId);
    setShowDebugTraceDetailModal(true);
  }, []);
  const handleCopyStoredDebugValue = useCallback(
    async (label: string, value: unknown) => {
      const normalized = parseStoredDebugPreview(value);
      if (!normalized.raw) {
        toast.error(`${label}为空，无法复制`);
        return;
      }
      try {
        await copyTextToClipboard(normalized.raw);
        toast.success(`已复制${label}`);
      } catch (error: any) {
        toast.error(error?.message || `复制${label}失败`);
      }
    },
    [toast],
  );

  function renderTraceStatusBadge(trace: ProxyDebugTraceListItem) {
    const failed = trace.finalStatus === "failed";
    return (
      <ToneBadge tone={failed ? "error" : "success"}
       
       
      >
        {failed ? tr('pages.checkinLog.failed') : tr('pages.checkinLog.success')}
      </ToneBadge>
    );
  }

  function renderAttemptDetail(attempt: ProxyDebugTraceAttempt) {
    const failed =
      typeof attempt.responseStatus === "number" && attempt.responseStatus >= 400;

    return (
      <TraceTimelineItem
        key={attempt.id}
        index={attempt.attemptIndex}
        title={attempt.endpoint}
        meta={`${attempt.requestPath} · ${attempt.targetUrl || "-"}`}
        tone={failed || attempt.rawErrorText ? "-error" : "-success"}
      >
        <div className="grid gap-3">
          <div className="proxy-trace-attempt-grid">
            <DetailField label={tr('pages.proxyLogs.executor')}>
              {attempt.runtimeExecutor || "-"}
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
          {attempt.downgradeReason || attempt.fallbackScope || attempt.failureClass ? (
            <div className="text-xs text-muted-foreground">
              {tr('pages.proxyLogs.executionFallbackReason')}
              {[
                attempt.fallbackScope ? formatProxyFallbackScope(attempt.fallbackScope) : null,
                attempt.failureClass ? formatProxyFailureClass(attempt.failureClass) : null,
                attempt.downgradeReason || null,
              ].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          {attempt.rawErrorText ? (
            <div className="proxy-trace-error">
              <div className="text-xs font-semibold">{tr('pages.proxyLogs.mistakeinfo')}</div>
              <div className="whitespace-pre-wrap text-xs">{attempt.rawErrorText}</div>
            </div>
          ) : null}
          <div className="proxy-trace-attempt-artifacts">
            {renderStoredDebugDetails(
              tr('pages.proxyLogs.requestResponseHeaders'),
              {
                requestHeaders: attempt.requestHeadersJson,
                responseHeaders: attempt.responseHeadersJson,
              },
              {
                copyLabel: tr('pages.proxyLogs.requestResponseHeaders'),
              },
            )}
            {renderStoredDebugDetails(
              tr('pages.proxyLogs.requestResponseBody'),
              {
                requestBody: attempt.requestBodyJson,
                responseBody: attempt.responseBodyJson,
              },
              {
                copyLabel: tr('pages.proxyLogs.requestResponseBody'),
              },
            )}
            {renderStoredDebugDetails(
              tr('pages.proxyLogs.memoryWrite'),
              attempt.memoryWriteJson,
              {
                copyLabel: tr('pages.proxyLogs.memoryWrite'),
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
    options?: { defaultOpen?: boolean; copyLabel?: string },
  ) {
    const normalized = parseStoredDebugPreview(value);
    const copyLabel = options?.copyLabel || title;

    return (
      <DetailDisclosureCard title={title} defaultOpen={options?.defaultOpen}>
        <div className="grid gap-2.5 p-3">
          <div className="flex justify-end">
            <Button variant="outline"
              type="button"
             
             
              aria-label={`复制${copyLabel}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleCopyStoredDebugValue(copyLabel, value);
              }}
            >
              {tr('pages.proxyLogs.copySavecontent')}
            </Button>
          </div>
          {normalized.note ? (
            <div className="text-xs text-muted-foreground">
              {normalized.note}
            </div>
          ) : null}
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed">{normalized.displayText}</pre>
        </div>
      </DetailDisclosureCard>
    );
  }

  function renderDebugTraceDetailContent() {
    if (!selectedDebugTraceId) {
      return (
        <div className="text-sm text-muted-foreground">
          {tr('pages.proxyLogs.noTraceDetailsSelectItemsrecentTracesViewing')}
        </div>
      );
    }

    if (selectedDebugTraceDetail?.loading) {
      return (
        <div className="text-sm text-muted-foreground">
          {tr('pages.proxyLogs.loadingTraceDetails')}
        </div>
      );
    }

    if (selectedDebugTraceDetail?.error) {
      return (
        <div className="text-sm text-destructive">
          {selectedDebugTraceDetail.error}
        </div>
      );
    }

    if (!selectedDebugTraceDetail?.data) {
      return (
        <div className="text-sm text-muted-foreground">
          {tr('pages.proxyLogs.noTraceDetails')}
        </div>
      );
    }

    const traceDetail = selectedDebugTraceDetail.data.trace;
    const attempts = selectedDebugTraceDetail.data.attempts;
    const failed = traceDetail.finalStatus === "failed";
    const finalStatusTone = failed ? "-error" : "-success";

    return (
      <div className="proxy-trace-detail-workbench">
        <div className="proxy-trace-detail-hero">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={finalStatusTone}>
                {failed ? tr('pages.checkinLog.failed') : tr('pages.checkinLog.success')}
              </ToneBadge>
              {traceDetail.finalHttpStatus ? (
                <ToneBadge tone={traceDetail.finalHttpStatus >= 400 ? "-error" : "-success"}>
                  HTTP {traceDetail.finalHttpStatus}
                </ToneBadge>
              ) : null}
              {traceDetail.clientKind ? (
                <ToneBadge tone="-muted">{traceDetail.clientKind}</ToneBadge>
              ) : null}
            </div>
            <div className="mt-2 min-w-0 break-words text-base font-semibold">
              {traceDetail.requestedModel || tr('pages.proxyLogs.traceDetails')}
            </div>
            <div className="mt-1 min-w-0 break-words font-mono text-xs text-muted-foreground">
              {traceDetail.sessionId || traceDetail.traceHint || `trace-${traceDetail.id}`}
            </div>
          </div>
          <div className="proxy-trace-detail-metrics">
            <TraceDetailMetric
              label={tr('pages.proxyLogs.attemptCount')}
              value={attempts.length.toLocaleString()}
            />
          </div>
        </div>

        {traceDetail.stickySessionKey ? (
          <div className="proxy-trace-detail-grid">
            <DetailField label={tr('pages.proxyLogs.stickySession')}>
              {traceDetail.stickySessionKey}
            </DetailField>
          </div>
        ) : null}

        <DebugTraceRouteDecisionFlow trace={traceDetail} />

        <div className="proxy-trace-artifact-grid">
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.endpoint'),
            traceDetail.endpointCandidatesJson,
            {
              copyLabel: tr('pages.proxyLogs.endpoint'),
            },
          )}
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.rawDownstreamRequestHeaders'),
            traceDetail.requestHeadersJson,
            {
              copyLabel: tr('pages.proxyLogs.rawDownstreamRequestHeaders'),
            },
          )}
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.rawDownstreamRequestBody'),
            traceDetail.requestBodyJson,
            {
              copyLabel: tr('pages.proxyLogs.rawDownstreamRequestBody'),
            },
          )}
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.finalResponse'),
            traceDetail.finalResponseBodyJson,
            {
              copyLabel: tr('pages.proxyLogs.finalResponse'),
            },
          )}
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.requestResponseHeaders'),
            traceDetail.finalResponseHeadersJson,
            {
              copyLabel: tr('pages.proxyLogs.requestResponseHeaders'),
            },
          )}
          {renderStoredDebugDetails(
            tr('pages.proxyLogs.routeDecision'),
            traceDetail.decisionSummaryJson,
            {
              copyLabel: tr('pages.proxyLogs.routeDecision'),
            },
          )}
        </div>

        <div className="proxy-trace-timeline-panel">
          <div className="proxy-trace-section-head">
            <div>
              <div className="text-sm font-semibold">{tr('pages.proxyLogs.attemptTimeline')}</div>
              <div className="text-xs text-muted-foreground">
                {tr('pages.proxyLogs.attemptTimelineDescription')}
              </div>
            </div>
            <ToneBadge tone="-muted">
              {attempts.length.toLocaleString()} {tr('pages.programLogs.items')}
            </ToneBadge>
          </div>
          {attempts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {tr('pages.proxyLogs.noAttemptRecords')}
            </div>
          ) : (
            <div className="proxy-trace-timeline">
              {attempts.map(renderAttemptDetail)}
            </div>
          )}
        </div>
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

  const latestDebugTrace = debugTraces[0] || null;
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
        {tr('pages.proxyLogs.debugTraceTargetFilterDescription')}
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
            <CardTitle>{tr('pages.proxyLogs.targetedFilter')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.targetSessionId')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugTargetSessionId}
              data-debug-setting="target-session-id"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugTargetSessionId: e.target.value,
                }))
              }
              placeholder={tr('pages.proxyLogs.leaveEmptyDisableFiltering')}
            />
          </Label>
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.targetClient')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugTargetClientKind}
              data-debug-setting="target-client-kind"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugTargetClientKind: e.target.value,
                }))
              }
              placeholder={tr('pages.proxyLogs.codexClaudeCode')}
            />
          </Label>
          <Label className="grid gap-2">
            <span>{tr('pages.proxyLogs.targetmodel')}</span>
            <Input
              type="text"
              value={debugDraftSettings.proxyDebugTargetModel}
              data-debug-setting="target-model"
              onChange={(e) =>
                setDebugDraftSettings((current) => ({
                  ...current,
                  proxyDebugTargetModel: e.target.value,
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          value={`$${summary.totalCost.toFixed(4)}`}
        />
        <OverviewMetric
          label={tr('pages.proxyLogs.currentRange')}
          value={`${displayedStart}-${displayedEnd} / ${total.toLocaleString()}`}
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

      <Card className="proxy-debug-summary-card">
        <CardHeader className="proxy-debug-summary-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Bug className="size-4 text-primary" />
              <CardTitle>{tr('pages.proxyLogs.proxyDebugTrace')}</CardTitle>
              <ToneBadge tone={debugSettings.proxyDebugTraceEnabled ? "-success" : "-muted"}>
                {debugSettings.proxyDebugTraceEnabled ? tr('common.enabled') : tr('common.disabled')}
              </ToneBadge>
            </div>
            <CardDescription>
              {tr('pages.proxyLogs.debugTraceDetailsDescription')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline"
              type="button"
             
             
              aria-expanded={debugTracePanelExpanded}
              data-debug-trace-panel-toggle
              onClick={() => setDebugTracePanelExpanded((current) => !current)}
            >
              {debugTracePanelExpanded ? tr('pages.proxyLogs.collapse') : tr('pages.proxyLogs.expand2')}
            </Button>
            <Button variant="outline"
              type="button"
             
             
              onClick={() => void handleQuickToggleDebugTrace()}
              disabled={debugPanelSaving}
            >
              {debugSettings.proxyDebugTraceEnabled ? tr('pages.proxyLogs.closedebug') : tr('pages.proxyLogs.enableDebug')}
            </Button>
            <Button variant="outline"
              type="button"
             
             
              onClick={() => {
                setDebugDraftSettings(debugSettings);
                setShowDebugSettingsModal(true);
              }}
            >
              {tr('pages.proxyLogs.debugsettings')}
            </Button>
            <Button variant="outline"
              type="button"
             
             
              onClick={() => void loadDebugState()}
              disabled={debugPanelLoading}
            >
              {debugPanelLoading ? tr('pages.downstreamKeys.refreshing') : tr('pages.proxyLogs.refresh')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="proxy-debug-summary-body">
        <div className="proxy-debug-summary-metrics">
          <CompactSummaryMetric
            label={tr('components.notificationPanel.status')}
            value={debugSettings.proxyDebugTraceEnabled ? tr('common.enabled') : tr('common.disabled')}
          />
          <CompactSummaryMetric
            label={tr('pages.proxyLogs.recentTraces')}
            value={`${debugTraces.length} 条`}
          />
          <CompactSummaryMetric
            label={tr('pages.proxyLogs.time')}
            value={
              latestDebugTrace
                ? formatDateTimeLocal(latestDebugTrace.createdAt)
              : tr('pages.proxyLogs.none')
            }
          />
        </div>

        <div className="proxy-debug-summary-lines">
          <div>
            {tr('pages.proxyLogs.content')}{formatProxyDebugCaptureSummary(debugSettings)}
          </div>
          <div>
            {tr('pages.proxyLogs.filterRange')}{formatProxyDebugTargetSummary(debugSettings)}
          </div>
        </div>
        </CardContent>
      </Card>

      <div
        className={`anim-collapse ${debugTracePanelExpanded ? "is-open mb-3" : ""}`.trim()}
        data-debug-trace-panel-body
      >
        <div className="anim-collapse-inner">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>{tr('pages.proxyLogs.recentDebugTraces')}</CardTitle>
                <CardDescription>
                  {tr('pages.proxyLogs.20Items5ItemsOpendetailsContentExpand')}
                </CardDescription>
              </div>
              <div className="text-xs text-muted-foreground">
                {debugSettings.proxyDebugTraceEnabled
                  ? tr('pages.proxyLogs.autoRefreshEnabledNotice')
                  : tr('pages.proxyLogs.debugTraceNotEnabled')}
              </div>
            </CardHeader>
            <CardContent>

            {debugPanelLoading && debugTraces.length === 0 ? (
              <div className="pb-3 text-sm text-muted-foreground">
                {tr('pages.proxyLogs.loadingDebugTraces')}
              </div>
            ) : debugTraces.length === 0 ? (
              <Alert>
                <AlertDescription>
                {debugSettings.proxyDebugTraceEnabled
                  ? tr('pages.proxyLogs.noNewDebugTracesDescription')
                  : tr('pages.proxyLogs.debugTraceDisabledDescription')}
                </AlertDescription>
              </Alert>
            ) : isMobile ? (
              <div className="grid gap-3">
                {visibleDebugTraces.map((trace) => (
                  <MobileCard
                    key={trace.id}
                    title={trace.sessionId || `trace-${trace.id}`}
                    subtitle={formatDateTimeLocal(trace.createdAt)}
                    compact
                    headerActions={renderTraceStatusBadge(trace)}
                    footerActions={
                      <Button variant="ghost" size="sm"
                        type="button"
                       
                        onClick={() => openDebugTraceDetailModal(trace.id)}
                      >
                        {tr('pages.proxyLogs.viewingdetails')}
                      </Button>
                    }
                  >
                    <MobileField
                      label={tr('components.modelAnalysisPanel.model')}
                      value={trace.requestedModel || "-"}
                    />
                    <MobileField
                      label={tr('pages.proxyLogs.downstreamPath')}
                      value={trace.downstreamPath || "-"}
                    />
                    <MobileField
                      label={tr('pages.proxyLogs.upstreamPath')}
                      value={trace.finalUpstreamPath || "-"}
                    />
                    <MobileField
                      label={tr('pages.proxyLogs.client')}
                      value={trace.clientKind || "-"}
                    />
                  </MobileCard>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('pages.checkinLog.time')}</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>{tr('components.modelAnalysisPanel.model')}</TableHead>
                    <TableHead>{tr('pages.proxyLogs.downstreamPath')}</TableHead>
                    <TableHead>{tr('pages.proxyLogs.upstreamPath')}</TableHead>
                    <TableHead>{tr('pages.proxyLogs.client')}</TableHead>
                    <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                    <TableHead className="text-right">{tr('pages.accounts.actions2')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDebugTraces.map((trace) => (
                    <TableRow key={trace.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDateTimeLocal(trace.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {trace.sessionId || `trace-${trace.id}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        {trace.requestedModel || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {trace.downstreamPath || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {trace.finalUpstreamPath || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {trace.clientKind || "-"}
                      </TableCell>
                      <TableCell>{renderTraceStatusBadge(trace)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm"
                          type="button"
                         
                          onClick={() => openDebugTraceDetailModal(trace.id)}
                        >
                          {tr('pages.proxyLogs.viewingdetails')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {debugTraces.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="mr-auto text-xs text-muted-foreground">
                  {tr('pages.proxyLogs.showing')} {debugTraceDisplayedStart} - {debugTraceDisplayedEnd}{" "}
                  {tr('pages.proxyLogs.itemsTotal')} {debugTraces.length} {tr('pages.programLogs.items')}
                </div>
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        type="button"
                        aria-label={tr('pages.proxyLogs.previousDebugTracePage')}
                        disabled={safeDebugTracePage <= 1}
                        onClick={() => setDebugTracePage((current) => current - 1)}
                      />
                    </PaginationItem>
                {Array.from(
                  { length: debugTraceTotalPages },
                  (_, index) => index + 1,
                ).map((num) => (
                  <PaginationItem key={`debug-trace-page-${num}`}>
                    <PaginationLink
                      type="button"
                      isActive={num === safeDebugTracePage}
                      onClick={() => setDebugTracePage(num)}
                    >
                      {num}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                    <PaginationItem>
                      <PaginationNext
                        type="button"
                        aria-label={tr('pages.proxyLogs.nextDebugTracePage')}
                        disabled={safeDebugTracePage >= debugTraceTotalPages}
                        onClick={() => setDebugTracePage((current) => current + 1)}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

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

      {isMobile ? (
        <MobileDrawer
          open={showDebugTraceDetailModal}
          onClose={closeDebugTraceDetailModal}
          title={selectedDebugTraceListItem?.sessionId || tr('pages.proxyLogs.traceDetails')}
          closeLabel={tr('pages.proxyLogs.closetraceDetails')}
          side="right"
        >
          <div className="grid gap-4 p-4">
            {renderDebugTraceDetailContent()}
          </div>
        </MobileDrawer>
      ) : (
        <CenteredModal
          open={showDebugTraceDetailModal}
          onClose={closeDebugTraceDetailModal}
          title={selectedDebugTraceListItem?.sessionId || tr('pages.proxyLogs.traceDetails')}
          maxWidth={920}
          closeOnBackdrop
          closeOnEscape
        >
          {renderDebugTraceDetailContent()}
        </CenteredModal>
      )}

      {hasInvalidTimeRange && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{tr('pages.checkinLog.endtimeStarttime')}</AlertDescription>
        </Alert>
      )}

      <DataTable minWidth={1180} density="compact" className="proxy-log-list-card">
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
        ) : isMobile ? (
          <div className="grid gap-3">
            {logs.map((log) => {
              const detailState = detailById[log.id];
              const detail = detailState?.data;
              const detailLog: ProxyLogRenderItem = detail
                ? { ...log, ...detail }
                : log;
              const pathMeta = parseProxyLogPathMeta(
                detailLog.errorMessage ?? undefined,
              );
              const billingDetailSummary = detail
                ? formatBillingDetailSummary(detailLog)
                : null;
              const billingProcessLines = detail
                ? buildBillingProcessLines(detailLog)
                : [];
              const downstreamKeySummary =
                renderDownstreamKeySummary(detailLog);
              const isExpanded = expanded === log.id;
              const clientDisplay = resolveProxyLogClientDisplay(detailLog);
              const streamModeLabel = formatStreamModeLabel(detailLog.isStream);
              const firstByteLabel = formatFirstByteLabel(
                detailLog.firstByteLatencyMs,
              );

              return (
                <MobileCard
                  key={log.id}
                  title={detailLog.modelRequested || tr('common.notAvailable')}
                  subtitle={formatDateTimeLocal(log.createdAt)}
                  compact
                  headerActions={
                    <ToneBadge tone={log.status === "success" ? "success" : "error"}
                     
                     
                    >
                      {log.status === "success" ? tr('pages.checkinLog.success') : tr('pages.checkinLog.failed')}
                    </ToneBadge>
                  }
                  footerActions={
                    <Button variant="ghost" size="sm"
                      type="button"
                     
                      onClick={() => handleToggleExpand(log.id)}
                    >
                      {isExpanded ? tr('pages.proxyLogs.collapsedetails') : tr('pages.accounts.details')}
                    </Button>
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SiteBadgeLink
                      siteId={siteIdByName.get(
                        String(log.siteName || "").trim(),
                      )}
                      siteName={log.siteName}
                      badgeStyle={{ fontSize: 11 }}
                    />
                    {clientDisplay.primary ? (
                      <ToneBadge tone="-muted">
                        {clientDisplay.primary}
                      </ToneBadge>
                    ) : null}
                    {clientDisplay.secondary ? (
                      <ToneBadge tone="-muted">
                        {clientDisplay.secondary}
                      </ToneBadge>
                    ) : null}
                    {streamModeLabel ? (
                      <ToneBadge tone="-muted">
                        {streamModeLabel}
                      </ToneBadge>
                    ) : null}
                    {firstByteLabel ? (
                      <ToneBadge tone="">
                        {firstByteLabel}
                      </ToneBadge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
                    <div className="grid min-w-0 gap-0.5 rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="inline-flex items-center gap-1 text-[10px] leading-tight text-primary">
                        <Timer className="size-3" />
                        {tr('pages.proxyLogs.duration')}
                      </div>
                      <div className="break-words text-sm font-semibold leading-snug">
                        {formatLatency(log.latencyMs)}
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-0.5 rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="inline-flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
                        <Hash className="size-3" />
                        {tr('pages.proxyLogs.input')}
                      </div>
                      <div className="break-words text-sm font-semibold leading-snug">
                        {formatProxyLogTokenValue(log.promptTokens)}
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-0.5 rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="inline-flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
                        <Hash className="size-3" />
                        {tr('pages.proxyLogs.output')}
                      </div>
                      <div className="break-words text-sm font-semibold leading-snug">
                        {formatProxyLogTokenValue(log.completionTokens)}
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-0.5 rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="inline-flex items-center gap-1 text-[10px] leading-tight text-primary">
                        <Coins className="size-3" />
                        {tr('pages.proxyLogs.cost')}
                      </div>
                      <div className="break-words text-sm font-semibold leading-snug">
                        {typeof log.estimatedCost === "number"
                          ? `$${log.estimatedCost.toFixed(6)}`
                          : "-"}
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="mt-3 grid gap-2">
                      <MobileField
                        label={tr('pages.checkinLog.time')}
                        value={formatDateTimeLocal(log.createdAt)}
                      />
                      <MobileField
                        label={tr('components.searchModal.sites2')}
                        value={
                          <SiteBadgeLink
                            siteId={siteIdByName.get(
                              String(log.siteName || "").trim(),
                            )}
                            siteName={log.siteName}
                            badgeStyle={{ fontSize: 11 }}
                          />
                        }
                      />
                      {streamModeLabel ? (
                        <MobileField label={tr('pages.modelTester.mode')} value={streamModeLabel} />
                      ) : null}
                      {firstByteLabel ? (
                        <MobileField
                          label={tr('pages.proxyLogs.ttft2')}
                          value={firstByteLabel.replace(/^首字\s*/, "")}
                        />
                      ) : null}
                      <MobileField
                        label={tr('pages.dashboard.retry')}
                        value={log.retryCount > 0 ? log.retryCount : 0}
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
                      {billingDetailSummary && (
                        <div className="text-muted-foreground">
                          {billingDetailSummary}
                        </div>
                      )}
                      <MobileField
                        label={tr('pages.proxyLogs.clientDetails')}
                        value={renderProxyLogClientCell(detailLog, {
                          includeGeneric: true,
                        })}
                      />
                      {downstreamKeySummary && (
                        <div className="text-muted-foreground">
                          {downstreamKeySummary}
                        </div>
                      )}
                      {billingProcessLines.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {billingProcessLines.map((line, index) => (
                            <span key={`${log.id}-billing-mobile-${index}`}>
                              {line}
                            </span>
                          ))}
                        </div>
                      )}
                      {detail && pathMeta.errorMessage.trim().length > 0 && (
                        <div className="text-destructive">
                          {pathMeta.errorMessage}
                        </div>
                      )}
                    </div>
                  ) : null}
                </MobileCard>
              );
            })}
          </div>
        ) : (
          <Table className="proxy-log-table w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="min-w-36">{tr('pages.checkinLog.time')}</TableHead>
                <TableHead className="min-w-60">{tr('components.modelAnalysisPanel.model')}</TableHead>
                <TableHead className="min-w-56">{tr('pages.proxyLogs.target')}</TableHead>
                <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                <TableHead className="text-right">{tr('pages.proxyLogs.performance')}</TableHead>
                <TableHead className="text-right">{tr('pages.proxyLogs.usage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const detailState = detailById[log.id];
                const detail = detailState?.data;
                const detailLog: ProxyLogRenderItem = detail
                  ? { ...log, ...detail }
                  : log;
                const pathMeta = parseProxyLogPathMeta(
                  detailLog.errorMessage ?? undefined,
                );
                const billingDetailSummary = detail
                  ? formatBillingDetailSummary(detailLog)
                  : null;
                const billingProcessLines = detail
                  ? buildBillingProcessLines(detailLog)
                  : [];
                const downstreamKeySummary =
                  renderDownstreamKeySummary(detailLog);
                const streamModeLabel = formatStreamModeLabel(
                  detailLog.isStream,
                );
                const firstByteLabel = formatFirstByteLabel(
                  detailLog.firstByteLatencyMs,
                );
                const routeDecision = detailLog.routeDecision;
                const routeDecisionRoute = routeDecision?.route || null;
                const routeDecisionTarget = routeDecision?.target || null;
                const routeDecisionToken = routeDecision?.token || null;
                const hasRouteDecisionContext = !!(
                  routeDecisionRoute ||
                  routeDecisionTarget ||
                  routeDecisionToken
                );
                const routeSnapshot = routeDecisionRoute?.snapshotSummary || null;

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
                          <span className="whitespace-nowrap font-mono text-xs font-medium">
                            {formatDateTimeLocal(log.createdAt)}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            #{log.id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="proxy-log-model-cell">
                          <ModelBadge model={log.modelRequested} />
                          {log.modelActual && log.modelActual !== log.modelRequested ? (
                            <div className="text-xs text-muted-foreground">
                              {tr('pages.proxyLogs.model')} {log.modelActual}
                            </div>
                          ) : null}
                          {downstreamKeySummary ? (
                            <div className="text-xs leading-relaxed text-muted-foreground">
                              {downstreamKeySummary}
                            </div>
                          ) : null}
                          {streamModeLabel || firstByteLabel ? (
                            <div className="flex flex-wrap gap-1.5">
                              {streamModeLabel ? (
                                <ToneBadge tone="-muted">
                                  {streamModeLabel}
                                </ToneBadge>
                              ) : null}
                              {firstByteLabel ? (
                                <ToneBadge tone="">
                                  {firstByteLabel}
                                </ToneBadge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="proxy-log-target-cell">
                          <SiteBadgeLink
                            siteId={siteIdByName.get(
                              String(log.siteName || "").trim(),
                            )}
                            siteName={log.siteName}
                          />
                          <div className="text-xs text-muted-foreground">
                            {renderProxyLogClientCell(detailLog)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1">
                          <ToneBadge tone={log.status === "success" ? "success" : "error"}>
                            {log.status === "success" ? tr('pages.checkinLog.success') : tr('pages.checkinLog.failed')}
                          </ToneBadge>
                          {log.retryCount > 0 ? (
                            <ToneBadge tone="-warning">
                              {tr('pages.dashboard.retry')} {log.retryCount}
                            </ToneBadge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="proxy-log-table-metric-stack">
                          <LogInlineMetric
                            label={tr('pages.proxyLogs.duration')}
                            value={formatLatency(log.latencyMs)}
                            tone={latencyTone(log.latencyMs)}
                          />
                          {firstByteLabel ? (
                            <LogInlineMetric
                              label={tr('pages.proxyLogs.ttft2')}
                              value={formatLatency(detailLog.firstByteLatencyMs ?? 0)}
                              tone={firstByteTone(detailLog.firstByteLatencyMs)}
                            />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="proxy-log-table-metric-stack">
                          <LogInlineMetric
                            label={tr('pages.proxyLogs.input')}
                            value={formatProxyLogTokenValue(log.promptTokens)}
                          />
                          <LogInlineMetric
                            label={tr('pages.proxyLogs.output')}
                            value={formatProxyLogTokenValue(log.completionTokens)}
                          />
                          <LogInlineMetric
                            label={tr('pages.proxyLogs.cost')}
                            value={
                              typeof log.estimatedCost === "number"
                                ? `$${log.estimatedCost.toFixed(6)}`
                                : "-"
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded === log.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="p-0">
                          <div className="anim-collapse is-open">
                            <div className="anim-collapse-inner">
                              <div className="proxy-log-detail-panel animate-fade-in">
                                <div className="proxy-log-detail-panel-header">
                                  <div>
                                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                                      {tr('pages.proxyLogs.logDetails')}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <ModelBadge model={detailLog.modelRequested} />
                                      {detailLog.modelActual && detailLog.modelActual !== detailLog.modelRequested ? (
                                        <ToneBadge tone="-muted">
                                          {tr('pages.proxyLogs.model')} {detailLog.modelActual}
                                        </ToneBadge>
                                      ) : null}
                                      <ToneBadge tone={detailLog.status === "success" ? "success" : "error"}>
                                        {detailLog.status === "success"
                                          ? tr('pages.checkinLog.success')
                                          : tr('pages.checkinLog.failed')}
                                      </ToneBadge>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <ToneBadge tone={latencyTone(detailLog.latencyMs)}>
                                      {tr('pages.proxyLogs.duration')} {formatLatency(detailLog.latencyMs)}
                                    </ToneBadge>
                                    {firstByteLabel ? (
                                      <ToneBadge tone={firstByteTone(detailLog.firstByteLatencyMs)}>
                                        {tr('pages.proxyLogs.ttft2')} {formatLatency(detailLog.firstByteLatencyMs ?? 0)}
                                      </ToneBadge>
                                    ) : null}
                                    {streamModeLabel ? (
                                      <ToneBadge tone="-muted">{streamModeLabel}</ToneBadge>
                                    ) : null}
                                  </div>
                                </div>

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

                                <div className="proxy-log-detail-grid">
                                  <DetailField label={tr('components.searchModal.sites2')}>
                                    {detailLog.siteName || tr('pages.proxyLogs.unknownSite')}
                                  </DetailField>
                                  <DetailField label={tr('pages.accounts.username')}>
                                    {detailLog.username || tr('pages.proxyLogs.unknownAccount')}
                                  </DetailField>
                                  <DetailField label={tr('pages.proxyLogs.client')}>
                                    {renderProxyLogClientCell(detailLog, {
                                      includeGeneric: true,
                                    })}
                                  </DetailField>
                                  <DetailField label={tr('pages.proxyLogs.usageSource')}>
                                    {formatProxyLogUsageSource(
                                      detailLog.usageSource ?? pathMeta.usageSource,
                                    ) || tr('pages.accounts.unknown2')}
                                  </DetailField>
                                </div>

                                {billingDetailSummary ? (
                                  <div className="text-xs text-muted-foreground">
                                    {billingDetailSummary}
                                  </div>
                                ) : null}
                                {downstreamKeySummary ? (
                                  <div className="text-xs text-muted-foreground">
                                    {downstreamKeySummary}
                                  </div>
                                ) : null}

                                <div className="proxy-log-detail-section">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-xs font-semibold text-primary">
                                      {tr('pages.proxyLogs.routeDecision')}
                                    </div>
                                    {!hasRouteDecisionContext ? (
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.noRouteDecision')}
                                      </ToneBadge>
                                    ) : null}
                                  </div>
                                  {routeDecision && hasRouteDecisionContext ? (
                                    <RouteDecisionFlow
                                      decision={routeDecision}
                                      fallbackRequestedModel={detailLog.modelRequested}
                                    />
                                  ) : null}
                                  {routeDecisionTarget ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      <ToneBadge tone={routeDecisionTarget.enabled === false ? "-error" : "-success"}>
                                        {routeDecisionTarget.enabled === false ? tr('common.disabled') : tr('common.enabled')}
                                      </ToneBadge>
                                      {routeDecisionTarget.cooldownUntil ? (
                                        <ToneBadge tone="-warning">
                                          {tr('pages.proxyLogs.cooldown')} {formatDateTimeLocal(routeDecisionTarget.cooldownUntil)}
                                        </ToneBadge>
                                      ) : null}
                                      {routeDecisionTarget.manualOverride ? (
                                        <ToneBadge tone="-info">
                                          {tr('pages.proxyLogs.manualOverride')}
                                        </ToneBadge>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {routeDecisionTarget ? (
                                    <div className="proxy-log-decision-stats">
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.priority')} {formatNullableNumber(routeDecisionTarget.priority)}
                                      </ToneBadge>
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.weight')} {formatNullableNumber(routeDecisionTarget.weight)}
                                      </ToneBadge>
                                      <ToneBadge tone="-success">
                                        {tr('pages.checkinLog.success')} {formatNullableNumber(routeDecisionTarget.successCount)}
                                      </ToneBadge>
                                      <ToneBadge tone="-error">
                                        {tr('pages.checkinLog.failed')} {formatNullableNumber(routeDecisionTarget.failCount)}
                                      </ToneBadge>
                                      {routeDecisionTarget.consecutiveFailCount ? (
                                        <ToneBadge tone="-warning">
                                          {tr('pages.proxyLogs.consecutiveFailures')} {formatNullableNumber(routeDecisionTarget.consecutiveFailCount)}
                                        </ToneBadge>
                                      ) : null}
                                      {routeDecisionTarget.lastSelectedAt ? (
                                        <ToneBadge tone="-muted">
                                          {tr('pages.proxyLogs.lastSelected')} {formatDateTimeLocal(routeDecisionTarget.lastSelectedAt)}
                                        </ToneBadge>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {routeSnapshot ? (
                                    <div className="proxy-log-decision-snapshot">
                                      <DetailField label={tr('pages.proxyLogs.matchRule')}>
                                        {formatProxyDecisionMatchKind(routeSnapshot.matchKind)}
                                        {routeSnapshot.requestedModelPattern ? ` · ${routeSnapshot.requestedModelPattern}` : ""}
                                      </DetailField>
                                      <DetailField label={tr('pages.proxyLogs.backend')}>
                                        {formatProxyDecisionBackendKind(routeSnapshot.backendKind)}
                                        {routeSnapshot.sourceRouteIds.length > 0
                                          ? ` · ${routeSnapshot.sourceRouteIds.map((routeId: number) => `#${routeId}`).join(" / ")}`
                                          : ""}
                                      </DetailField>
                                    </div>
                                  ) : null}
                                </div>

                                <div className="proxy-log-detail-section">
                                  <div className="text-xs font-semibold text-primary">
                                    {tr('pages.proxyLogs.billingProcess')}
                                  </div>
                                  {billingProcessLines.length > 0 ? (
                                    <div className="grid gap-1 text-xs text-muted-foreground">
                                      {billingProcessLines.map((line, index) => (
                                        <span key={`${log.id}-billing-${index}`}>
                                          {line}
                                        </span>
                                      ))}
                                      <span>{tr('pages.proxyLogs.referenceOnlyActualBillingPrevails')}</span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.input')} {formatProxyLogTokenValue(detailLog.promptTokens)}
                                      </ToneBadge>
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.output')} {formatProxyLogTokenValue(detailLog.completionTokens)}
                                      </ToneBadge>
                                      <ToneBadge tone="-muted">
                                        {tr('pages.proxyLogs.total')} {formatProxyLogTokenValue(detailLog.totalTokens)}
                                      </ToneBadge>
                                      {typeof detailLog.estimatedCost === "number" ? (
                                        <ToneBadge tone="-success">
                                          {tr('pages.proxyLogs.cost')} ${detailLog.estimatedCost.toFixed(6)}
                                        </ToneBadge>
                                      ) : null}
                                    </div>
                                  )}
                                </div>

                                <div className="proxy-log-detail-paths">
                                  <DetailField label={tr('pages.proxyLogs.downstreamRequestPath')}>
                                    {detail && pathMeta.downstreamPath ? (
                                      <code className="proxy-log-path-code">
                                        {pathMeta.downstreamPath}
                                      </code>
                                    ) : (
                                      <span className="text-muted-foreground">
                                        {tr('pages.proxyLogs.notRecorded')}
                                      </span>
                                    )}
                                  </DetailField>
                                  <DetailField label={tr('pages.proxyLogs.upstreamRequestPath')}>
                                    {detail && pathMeta.upstreamPath ? (
                                      <code className="proxy-log-path-code">
                                        {pathMeta.upstreamPath}
                                      </code>
                                    ) : (
                                      <span className="text-muted-foreground">
                                        {tr('pages.proxyLogs.notRecorded')}
                                      </span>
                                    )}
                                  </DetailField>
                                </div>

                                {detail && pathMeta.errorMessage.trim().length > 0 ? (
                                  <div className="proxy-log-detail-error">
                                    <div className="text-xs font-semibold">
                                      {tr('pages.proxyLogs.mistakeinfo')}
                                    </div>
                                    <div className="whitespace-pre-wrap text-xs">
                                      {pathMeta.errorMessage}
                                    </div>
                                  </div>
                                ) : null}
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
