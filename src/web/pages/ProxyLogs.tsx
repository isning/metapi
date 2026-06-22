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
import { Alert, AlertDescription } from '../components/ui/alert/index.js';
import { ChevronRight, Coins, Filter, Hash, Timer } from 'lucide-react';
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
const DEFAULT_PAGE_SIZE = 50;
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
          <ToneBadge tone=""
           
           
          >
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
  return parts.length > 0 ? parts.join("，") : tr('pages.proxyLogs.zhRequest');
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
          toast.error(error?.message || tr('pages.proxyLogs.actingdebugFailed2'));
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
        toast.error(error?.message || tr('pages.proxyLogs.actingdebugFailed'));
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
        toast.error(error?.message || tr('pages.proxyLogs.saveactingdebugsettingsfailed'));
        return null;
      } finally {
        setDebugPanelSaving(false);
      }
    },
    [applyLoadedDebugSettings, loadDebugTraceList, toast],
  );

  const handleSaveDebugSettings = useCallback(async () => {
    await persistDebugSettings(debugDraftSettings, {
      successMessage: tr('pages.proxyLogs.actingdebugsettingsSave'),
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
          ? tr('pages.proxyLogs.actingdebugClose')
          : tr('pages.proxyLogs.actingdebugTurn'),
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
    const serializedAttempt = [
      `targetUrl: ${attempt.targetUrl}`,
      `runtimeExecutor: ${attempt.runtimeExecutor || "-"}`,
      `recoverApplied: ${attempt.recoverApplied ? "true" : "false"}`,
      `downgradeDecision: ${attempt.downgradeDecision ? "true" : "false"}`,
      `downgradeReason: ${attempt.downgradeReason || "-"}`,
      "",
      "requestHeaders:",
      stringifyStoredDebugValue(attempt.requestHeadersJson) || "-",
      "",
      "requestBody:",
      stringifyStoredDebugValue(attempt.requestBodyJson) || "-",
      "",
      "responseHeaders:",
      stringifyStoredDebugValue(attempt.responseHeadersJson) || "-",
      "",
      "responseBody:",
      stringifyStoredDebugValue(attempt.responseBodyJson) || "-",
      "",
      "rawErrorText:",
      attempt.rawErrorText || "-",
      "",
      "memoryWrite:",
      stringifyStoredDebugValue(attempt.memoryWriteJson) || "-",
    ].join("\n");

    return (
      <DetailDisclosureCard
        key={attempt.id}
        title={`#${attempt.attemptIndex + 1} · ${attempt.endpoint} · ${attempt.responseStatus ?? "-"} · ${attempt.requestPath}`}
      >
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.targetUrl')}</div>
              <div className="min-w-0 break-words font-mono text-xs font-medium">
                {attempt.targetUrl || "-"}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.executor')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {attempt.runtimeExecutor || "-"}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.recoveryLogic')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {attempt.recoverApplied ? tr('pages.proxyLogs.applied') : tr('pages.proxyLogs.notApplied')}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.downgrade')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {attempt.downgradeDecision ? tr('pages.proxyLogs.triggered') : tr('pages.proxyLogs.notTriggered')}
              </div>
            </div>
          </div>
          {attempt.downgradeReason ? (
            <div className="text-xs text-muted-foreground">
              {tr('pages.proxyLogs.downgrade2')}{attempt.downgradeReason}
            </div>
          ) : null}
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed">{serializedAttempt}</pre>
        </div>
      </DetailDisclosureCard>
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
          {tr('pages.proxyLogs.traceDetailszh')}
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

    return (
      <div className="grid gap-3">
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle>{tr('pages.proxyLogs.basicInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.downstreamPath')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {traceDetail.downstreamPath || "-"}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">Session</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {traceDetail.sessionId || "-"}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('components.modelAnalysisPanel.model')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {traceDetail.requestedModel || "-"}
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <div className="text-xs text-muted-foreground">{tr('pages.proxyLogs.finalUpstreamPath')}</div>
              <div className="min-w-0 break-words text-sm font-medium">
                {traceDetail.finalUpstreamPath || "-"}
              </div>
            </div>
          </div>
          </CardContent>
        </Card>

        <div className="grid gap-2.5">
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
        </div>

        <DetailDisclosureCard
          title={`Attempt 记录 (${selectedDebugTraceDetail.data.attempts.length})`}
        >
          <div className="grid gap-2 p-3">
            {selectedDebugTraceDetail.data.attempts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {tr('pages.proxyLogs.noneAttempt')}
              </div>
            ) : (
              selectedDebugTraceDetail.data.attempts.map(renderAttemptDetail)
            )}
          </div>
        </DetailDisclosureCard>
      </div>
    );
  }

  const filterControls = (
    <div className="flex flex-wrap items-end gap-2">
      <ButtonGroup>
        {[
          {
            key: "all" as ProxyLogStatusFilter,
            label: tr('components.notificationPanel.all'),
            count: summary.totalCount,
          },
          {
            key: "success" as ProxyLogStatusFilter,
            label: tr('pages.checkinLog.success'),
            count: summary.successCount,
          },
          {
            key: "failed" as ProxyLogStatusFilter,
            label: tr('pages.checkinLog.failed'),
            count: summary.failedCount,
          },
        ].map((tab) => (
          <Button
            type="button"
            key={tab.key}
            variant={statusFilter === tab.key ? "secondary" : "outline"}
            onClick={() => {
              setStatusFilter(tab.key);
              setPage(1);
            }}
          >
            {tab.label}{" "}
            <ToneBadge tone="-muted">{tab.count}</ToneBadge>
          </Button>
        ))}
      </ButtonGroup>
      <div className="w-44">
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
      <div className="w-44">
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
      <SearchInput
        className="w-72 max-w-full"
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.target.value);
          setPage(1);
        }}
        placeholder={tr('pages.proxyLogs.searchmodelKeyPrimaryGroupTags')}
      />
      <Button variant="outline"
        type="button"
       
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
        {tr('pages.proxyLogs.turnRequestSessionClientModeltargetedFilter')}
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.proxyLogs.content2')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {renderDebugCheckbox("proxyDebugTraceEnabled", tr('pages.proxyLogs.turnOndebug2'), tr('pages.proxyLogs.newRequestsWillWrittenDebugTracesOld'), "trace-enabled")}
          {renderDebugCheckbox("proxyDebugCaptureHeaders", tr('pages.proxyLogs.captureRawRequestResponseHeaders'), tr('pages.proxyLogs.keepRawDownstreamHeadersUpstreamResponseHeaders'), "capture-headers")}
          {renderDebugCheckbox("proxyDebugCaptureBodies", tr('pages.proxyLogs.captureRequestResponseBodies'), tr('pages.proxyLogs.defaultBodyTurn'), "capture-bodies")}
          {renderDebugCheckbox("proxyDebugCaptureStreamChunks", tr('pages.proxyLogs.streaming2'), tr('pages.proxyLogs.sseStreamingZh'), "capture-stream-chunks")}
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
    <div className="animate-fade-in">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{tr('app.usageLogs')}</h2>
          <div className="mt-1 text-sm text-muted-foreground">
            {tr('pages.proxyLogs.sitesClientTimefilteractingrequestViewingrecentDebugTraces')}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ToneBadge tone="-muted">{activeSiteLabel}</ToneBadge>
          <ToneBadge tone="-success">
            {tr('pages.proxyLogs.totalSpend')}{summary.totalCost.toFixed(4)}
          </ToneBadge>
          <ToneBadge tone="-warning">
            {summary.totalTokensAll.toLocaleString()} tokens
          </ToneBadge>
          <Button type="button" variant="outline"
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? tr('pages.proxyLogs.closeautomaticrefresh') : tr('pages.proxyLogs.turnOnautomaticrefresh2seconds')}
          >
            {autoRefresh ? tr('pages.proxyLogs.automaticrefreshzh') : tr('pages.oAuthManagement.automaticrefresh')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => {
              void load();
              void loadMeta(true);
            }}
            disabled={loading}
          >
            {loading ? tr('pages.oAuthManagement.loading') : tr('pages.accounts.refresh')}
          </Button>
        </div>
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('pages.proxyLogs.filter')}
        mobileContent={filterControls}
        desktopContent={
          <div className="mb-3">
            {filterControls}
          </div>
        }
      />

      <Card className="mb-3">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{tr('pages.proxyLogs.actingdebug')}</CardTitle>
            <CardDescription>
              {tr('pages.proxyLogs.turnTraceDetailsViewing')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
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
              {debugSettings.proxyDebugTraceEnabled ? tr('pages.proxyLogs.closedebug') : tr('pages.proxyLogs.turnOndebug')}
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
              {debugPanelLoading ? tr('pages.downstreamKeys.refreshzh') : tr('pages.proxyLogs.refresh')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <CompactSummaryMetric
            label={tr('components.notificationPanel.status')}
            value={debugSettings.proxyDebugTraceEnabled ? tr('pages.proxyLogs.turn3') : tr('pages.proxyLogs.turn2')}
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

        <div className="grid gap-1 text-xs text-muted-foreground">
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
                  ? tr('pages.proxyLogs.turnOnzhAutomaticrefresh')
                  : tr('pages.proxyLogs.turn')}
              </div>
            </CardHeader>
            <CardContent>

            {debugPanelLoading && debugTraces.length === 0 ? (
              <div className="pb-3 text-sm text-muted-foreground">
                {tr('pages.proxyLogs.debugZh')}
              </div>
            ) : debugTraces.length === 0 ? (
              <Alert>
                <AlertDescription>
                {debugSettings.proxyDebugTraceEnabled
                  ? tr('pages.proxyLogs.turnRequestActingrequestNow')
                  : tr('pages.proxyLogs.debugTurnTurnOndebugDebugsettingsActingrequestNow')}
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

      <Card>
        {loading ? (
          <CardContent className="grid gap-3 p-6">
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
          </CardContent>
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
                  title={detailLog.modelRequested || "unknown"}
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
                      <ToneBadge tone="-muted"
                       
                       
                      >
                        {clientDisplay.primary}
                      </ToneBadge>
                    ) : null}
                    {clientDisplay.secondary ? (
                      <ToneBadge tone="-muted"
                       
                       
                      >
                        {clientDisplay.secondary}
                      </ToneBadge>
                    ) : null}
                    {streamModeLabel ? (
                      <ToneBadge tone="-muted"
                       
                       
                      >
                        {streamModeLabel}
                      </ToneBadge>
                    ) : null}
                    {firstByteLabel ? (
                      <ToneBadge tone=""
                       
                       
                      >
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
                          {tr('pages.proxyLogs.detailszh')}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{tr('pages.checkinLog.time')}</TableHead>
                <TableHead>{tr('components.modelAnalysisPanel.model')}</TableHead>
                <TableHead>{tr('components.searchModal.sites2')}</TableHead>
                <TableHead>{tr('pages.proxyLogs.client')}</TableHead>
                <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                <TableHead className="text-center">{tr('pages.proxyLogs.duration')}</TableHead>
                <TableHead className="text-right">{tr('pages.proxyLogs.input')}</TableHead>
                <TableHead className="text-right">{tr('pages.proxyLogs.output')}</TableHead>
                <TableHead className="text-right">{tr('pages.proxyLogs.cost')}</TableHead>
                <TableHead className="text-center">{tr('pages.dashboard.retry')}</TableHead>
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

                return (
                  <React.Fragment key={log.id}>
                    <TableRow
                      data-testid={`proxy-log-row-${log.id}`}
                      onClick={() => handleToggleExpand(log.id)}
                      className="cursor-pointer"
                      data-state={expanded === log.id ? "selected" : undefined}
                    >
                      <TableCell className="text-muted-foreground">
                        <ChevronRight className={`size-4 transition-transform ${expanded === log.id ? "rotate-90" : ""}`} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDateTimeLocal(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1">
                          <ModelBadge model={log.modelRequested} />
                          {downstreamKeySummary ? (
                            <div className="text-xs leading-relaxed text-muted-foreground">
                              {downstreamKeySummary}
                            </div>
                          ) : null}
                          {streamModeLabel || firstByteLabel ? (
                            <div className="flex flex-wrap gap-1.5">
                              {streamModeLabel ? (
                                <ToneBadge tone="-muted"
                                 
                                 
                                >
                                  {streamModeLabel}
                                </ToneBadge>
                              ) : null}
                              {firstByteLabel ? (
                                <ToneBadge tone=""
                                 
                                 
                                >
                                  {firstByteLabel}
                                </ToneBadge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <SiteBadgeLink
                          siteId={siteIdByName.get(
                            String(log.siteName || "").trim(),
                          )}
                          siteName={log.siteName}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {renderProxyLogClientCell(detailLog)}
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={log.status === "success" ? "success" : "error"}
                         
                         
                        >
                          {log.status === "success" ? tr('pages.checkinLog.success') : tr('pages.checkinLog.failed')}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="text-center">
                        <ToneBadge tone={latencyTone(log.latencyMs)}>
                          {formatLatency(log.latencyMs)}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatProxyLogTokenValue(log.promptTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatProxyLogTokenValue(log.completionTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium">
                        {typeof log.estimatedCost === "number"
                          ? `$${log.estimatedCost.toFixed(6)}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {log.retryCount > 0 ? (
                          <ToneBadge tone="-warning"
                           
                           
                          >
                            {log.retryCount}
                          </ToneBadge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded === log.id && (
                      <TableRow>
                        <TableCell colSpan={11}>
                          <div className="anim-collapse is-open">
                            <div className="anim-collapse-inner">
                              <div className="animate-fade-in border-y px-5 py-3.5 pl-10 text-xs leading-loose text-muted-foreground">
                                <div className="flex gap-1.5">
                                  <span className="shrink-0 font-semibold text-amber-600">
                                    {tr('pages.proxyLogs.logDetails')}
                                  </span>
                                  <div>
                                    <div>
                                      {tr('pages.proxyLogs.requestmodel')}{" "}
                                      <strong className="text-foreground">
                                        {detailLog.modelRequested}
                                      </strong>
                                      {detailLog.modelActual &&
                                        detailLog.modelActual !==
                                          detailLog.modelRequested && (
                                          <>
                                            {" -> "}{tr('pages.proxyLogs.model')}{" "}
                                            <strong className="text-foreground">
                                              {detailLog.modelActual}
                                            </strong>
                                          </>
                                        )}
                                      {tr('pages.proxyLogs.status')}{" "}
                                      <strong className={detailLog.status === "success" ? "text-emerald-600" : "text-destructive"}>
                                        {detailLog.status === "success"
                                          ? tr('pages.checkinLog.success')
                                          : tr('pages.checkinLog.failed')}
                                      </strong>
                                      {streamModeLabel && (
                                        <>
                                          {tr('pages.proxyLogs.mode')}{" "}
                                          <strong className="text-foreground">
                                            {streamModeLabel}
                                          </strong>
                                        </>
                                      )}
                                      {firstByteLabel && (
                                        <>
                                          {tr('pages.proxyLogs.ttft')}{" "}
                                          <ToneBadge tone={firstByteTone(detailLog.firstByteLatencyMs)}>
                                            {formatLatency(
                                              detailLog.firstByteLatencyMs ?? 0,
                                            )}
                                          </ToneBadge>
                                        </>
                                      )}
                                      {tr('pages.proxyLogs.duration2')}{" "}
                                      <ToneBadge tone={latencyTone(detailLog.latencyMs)}>
                                        {formatLatency(detailLog.latencyMs)}
                                      </ToneBadge>
                                      {detail && (
                                        <>
                                          {tr('pages.proxyLogs.sites2')}{" "}
                                          <strong className="text-foreground">
                                            {detailLog.siteName || tr('pages.proxyLogs.unknownSite')}
                                          </strong>
                                          {tr('pages.proxyLogs.accounts')}{" "}
                                          <strong className="text-foreground">
                                            {detailLog.username || tr('pages.proxyLogs.unknownAccount')}
                                          </strong>
                                        </>
                                      )}
                                    </div>
                                    {detailState?.loading && (
                                      <div className="text-muted-foreground">
                                        {tr('pages.proxyLogs.detailszh')}
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
                                    <div className="text-muted-foreground">
                                      {tr('pages.proxyLogs.usageSource2')}
                                      {formatProxyLogUsageSource(
                                        detailLog.usageSource ??
                                          pathMeta.usageSource,
                                      ) || tr('pages.accounts.unknown2')}
                                    </div>
                                    <div className="flex items-start gap-1.5">
                                      <span className="shrink-0 text-muted-foreground">
                                        {tr('pages.proxyLogs.client')}
                                      </span>
                                      <div className="min-w-0">
                                        {renderProxyLogClientCell(detailLog, {
                                          includeGeneric: true,
                                        })}
                                      </div>
                                    </div>
                                    {downstreamKeySummary && (
                                      <div className="text-muted-foreground">
                                        {downstreamKeySummary}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {detailLog.billingDetails &&
                                  detailLog.billingDetails.usage
                                    .cacheReadTokens > 0 && (
                                    <div className="flex gap-1.5">
                                      <span className="shrink-0 font-semibold text-amber-600">
                                        {tr('pages.proxyLogs.tokens2')}
                                      </span>
                                      <span>
                                        {detailLog.billingDetails.usage.cacheReadTokens.toLocaleString()}
                                      </span>
                                    </div>
                                  )}

                                {detailLog.billingDetails &&
                                  detailLog.billingDetails.usage
                                    .cacheCreationTokens > 0 && (
                                    <div className="flex gap-1.5">
                                      <span className="shrink-0 font-semibold text-amber-600">
                                        {tr('pages.proxyLogs.tokens')}
                                      </span>
                                      <span>
                                        {detailLog.billingDetails.usage.cacheCreationTokens.toLocaleString()}
                                      </span>
                                    </div>
                                  )}

                                <div className="flex gap-1.5">
                                  <span className="shrink-0 font-semibold text-blue-600">
                                    {tr('pages.proxyLogs.billingProcess')}
                                  </span>
                                  {billingProcessLines.length > 0 ? (
                                    <div className="flex flex-col gap-0.5">
                                      {billingProcessLines.map(
                                        (line, index) => (
                                          <span
                                            key={`${log.id}-billing-${index}`}
                                          >
                                            {line}
                                          </span>
                                        ),
                                      )}
                                      <span className="text-muted-foreground">
                                        {tr('pages.proxyLogs.referenceOnlyActualBillingPrevails')}
                                      </span>
                                    </div>
                                  ) : (
                                    <span>
                                      {tr('pages.proxyLogs.input')}{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.promptTokens,
                                      )}{" "}
                                      tokens
                                      {" + "}{tr('pages.proxyLogs.output')}{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.completionTokens,
                                      )}{" "}
                                      tokens
                                      {" = "}{tr('pages.proxyLogs.total')}{" "}
                                      {formatProxyLogTokenValue(
                                        detailLog.totalTokens,
                                      )}{" "}
                                      tokens
                                      {typeof detailLog.estimatedCost ===
                                        "number" && (
                                        <>
                                          {tr('pages.proxyLogs.estimatedCost')}{" "}
                                          <strong className="text-foreground">
                                            $
                                            {detailLog.estimatedCost.toFixed(6)}
                                          </strong>
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0 font-semibold text-primary">
                                    {tr('pages.proxyLogs.downstreamRequestPath')}
                                  </span>
                                  {detail && pathMeta.downstreamPath ? (
                                    <code className="rounded border bg-card px-2 py-px font-mono text-xs">
                                      {pathMeta.downstreamPath}
                                    </code>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      {tr('pages.proxyLogs.notRecorded')}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0 font-semibold text-primary">
                                    {tr('pages.proxyLogs.upstreamRequestPath')}
                                  </span>
                                  {detail && pathMeta.upstreamPath ? (
                                    <code className="rounded border bg-card px-2 py-px font-mono text-xs">
                                      {pathMeta.upstreamPath}
                                    </code>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      {tr('pages.proxyLogs.notRecorded')}
                                    </span>
                                  )}
                                </div>

                                {detail &&
                                  pathMeta.errorMessage.trim().length > 0 && (
                                    <div className="flex gap-1.5">
                                      <span className="shrink-0 font-semibold text-destructive">
                                        {tr('pages.proxyLogs.mistakeinfo')}
                                      </span>
                                      <span className="whitespace-pre-wrap text-destructive">
                                        {pathMeta.errorMessage}
                                      </span>
                                    </div>
                                  )}
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
          <EmptyStateBlock title={tr('pages.proxyLogs.noUsageLogs')} description={tr('pages.proxyLogs.requestActing')} />
        )}
      </Card>

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
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
            <span>{tr('pages.proxyLogs.rowsPerPage')}</span>
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
