import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import { useIsMobile } from '../components/useIsMobile.js';
import ChangeKeyModal from '../components/ChangeKeyModal.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import ModernSelect from '../components/ModernSelect.js';
import ResponsiveFormGrid from '../components/ResponsiveFormGrid.js';
import FactoryResetModal from './settings/FactoryResetModal.js';
import ModelAvailabilityProbeConfirmModal from './settings/ModelAvailabilityProbeConfirmModal.js';
import {
  createCodexDefaultHighReasoningVisualPreset,
  createVisualPayloadRule,
  isVisualPayloadRuleBlank,
  payloadRulesToVisualRules,
  type PayloadRuleAction,
  type VisualPayloadRule,
  type VisualPayloadRuleValueMode,
  visualRulesToPayloadRules,
} from './settings/payloadRulesVisual.js';
import { PAYLOAD_RULE_PROTOCOL_OPTIONS } from './settings/payloadRuleProtocolOptions.js';
import UpdateCenterSection from './settings/UpdateCenterSection.js';
import {
  applyRoutingProfilePreset,
  resolveRoutingProfilePreset,
  type RoutingWeights,
} from './helpers/routingProfiles.js';
import { clearAuthSession } from '../authSession.js';
import { clearAppInstallationState } from '../appLocalState.js';
import { tr } from '../i18n.js';
import { generateDownstreamSkKey } from './helpers/generateDownstreamSkKey.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import { Textarea } from '../components/ui/textarea/index.js';

const PROXY_TOKEN_PREFIX = 'sk-';
const FACTORY_RESET_ADMIN_TOKEN = 'change-me-admin-token';
const FACTORY_RESET_CONFIRM_SECONDS = 3;
const MODEL_AVAILABILITY_PROBE_CONFIRM_TEXT = '我确认我使用的中转站全部允许批量测活，如因开启此功能被中转站封号，自行负责。';
const SECONDS_PER_DAY = 24 * 60 * 60;
const ROUTE_COOLDOWN_UNIT_OPTIONS = [
  { value: 'second', label: '秒', multiplierSec: 1 },
  { value: 'minute', label: '分钟', multiplierSec: 60 },
  { value: 'hour', label: '小时', multiplierSec: 60 * 60 },
  { value: 'day', label: '天', multiplierSec: SECONDS_PER_DAY },
] as const;
const CHECKIN_SCHEDULE_MODE_OPTIONS = [
  { value: 'cron', label: 'Cron' },
  { value: 'interval', label: '间隔签到' },
] as const;
const CHECKIN_INTERVAL_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const hour = index + 1;
  return {
    value: String(hour),
    label: `${hour} 小时`,
  };
});
type DbDialect = 'sqlite' | 'mysql' | 'postgres';
type RouteCooldownUnit = typeof ROUTE_COOLDOWN_UNIT_OPTIONS[number]['value'];
type SettingsPillTone = 'neutral' | 'primary' | 'danger' | 'warning';
type PayloadRulesEditorSectionKey = PayloadRuleAction;
type PayloadRulesEditorDrafts = Record<PayloadRulesEditorSectionKey, string>;

type RuntimeSettings = {
  checkinCron: string;
  checkinScheduleMode: 'cron' | 'interval';
  checkinIntervalHours: number;
  balanceRefreshCron: string;
  logCleanupCron: string;
  logCleanupUsageLogsEnabled: boolean;
  logCleanupProgramLogsEnabled: boolean;
  logCleanupRetentionDays: number;
  modelAvailabilityProbeEnabled: boolean;
  codexUpstreamWebsocketEnabled: boolean;
  responsesCompactFallbackToResponsesEnabled: boolean;
  disableCrossProtocolFallback: boolean;
  proxySessionChannelConcurrencyLimit: number;
  proxySessionChannelQueueWaitMs: number;
  routingFallbackUnitCost: number;
  proxyFirstByteTimeoutSec: number;
  routeFailureCooldownMaxValue: number;
  routeFailureCooldownMaxUnit: RouteCooldownUnit;
  routingWeights: RoutingWeights;
  systemProxyUrl: string;
  proxyErrorKeywords: string[];
  proxyEmptyContentFailEnabled: boolean;
  proxyTokenMasked?: string;
  adminIpAllowlist?: string[];
  currentAdminIp?: string;
  globalBlockedBrands?: string[];
  globalAllowedModels?: string[];
};

type SystemProxyTestState =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }
  | null;

type DatabaseMigrationSummary = {
  dialect: DbDialect;
  connection: string;
  overwrite: boolean;
  version: string;
  timestamp: number;
  rows: {
    sites: number;
    accounts: number;
    accountTokens: number;
    tokenRoutes: number;
    routeChannels: number;
    settings: number;
  };
};

type RuntimeDatabaseState = {
  active: {
    dialect: DbDialect;
    connection: string;
    ssl: boolean;
  };
  saved: {
    dialect: DbDialect;
    connection: string;
    ssl: boolean;
  } | null;
  restartRequired: boolean;
};

type ShorthandConnection = {
  host: string;
  user: string;
  password: string;
  port: string;
  database: string;
};

const PAYLOAD_RULES_EDITOR_SECTIONS = [
  {
    key: 'default',
    title: 'default',
    description: '字段缺失时才注入，适合补默认参数。',
    placeholder: `[
  {
    "models": [{ "name": "gpt-*", "protocol": "codex" }],
    "params": {
      "reasoning.effort": "high"
    }
  }
]`,
  },
  {
    key: 'default-raw',
    title: 'default-raw',
    description: '字段缺失时注入原始 JSON，适合 schema、复杂对象等值。',
    placeholder: `[
  {
    "models": [{ "name": "gpt-*", "protocol": "codex" }],
    "params": {
      "response_format": "{\"type\":\"json_schema\"}"
    }
  }
]`,
  },
  {
    key: 'override',
    title: 'override',
    description: '无论原请求是否已有该字段，都强制覆盖。',
    placeholder: `[
  {
    "models": [{ "name": "gpt-*", "protocol": "codex" }],
    "params": {
      "text.verbosity": "low"
    }
  }
]`,
  },
  {
    key: 'override-raw',
    title: 'override-raw',
    description: '无论原请求是否已有该字段，都强制覆盖为原始 JSON。',
    placeholder: `[
  {
    "models": [{ "name": "gemini-*", "protocol": "gemini" }],
    "params": {
      "generationConfig.responseJsonSchema": "{\"type\":\"object\"}"
    }
  }
]`,
  },
  {
    key: 'filter',
    title: 'filter',
    description: '删除匹配请求中的字段。',
    placeholder: `[
  {
    "models": [{ "name": "gpt-*", "protocol": "codex" }],
    "params": ["safety_identifier"]
  }
]`,
  },
] as const satisfies ReadonlyArray<{
  key: PayloadRulesEditorSectionKey;
  title: string;
  description: string;
  placeholder: string;
}>;

const PAYLOAD_RULE_ACTION_OPTIONS: Array<{ value: PayloadRuleAction; label: string }> = [
  { value: 'default', label: '默认注入' },
  { value: 'default-raw', label: '默认注入 JSON' },
  { value: 'override', label: '强制覆盖' },
  { value: 'override-raw', label: '强制覆盖 JSON' },
  { value: 'filter', label: '删除字段' },
];

const PAYLOAD_RULE_VALUE_MODE_OPTIONS: Array<{ value: VisualPayloadRuleValueMode; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'json', label: 'JSON' },
];

function createEmptyPayloadRuleDrafts(): PayloadRulesEditorDrafts {
  return {
    default: '',
    'default-raw': '',
    override: '',
    'override-raw': '',
    filter: '',
  };
}

function formatPayloadRuleSectionForEditor(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value) && value.length <= 0) return '';
  return JSON.stringify(value, null, 2);
}

function normalizePayloadRulesForEditor(value: unknown): PayloadRulesEditorDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyPayloadRuleDrafts();
  }

  const record = value as Record<string, unknown>;
  return {
    default: formatPayloadRuleSectionForEditor(record.default),
    'default-raw': formatPayloadRuleSectionForEditor(record.defaultRaw ?? record['default-raw']),
    override: formatPayloadRuleSectionForEditor(record.override),
    'override-raw': formatPayloadRuleSectionForEditor(record.overrideRaw ?? record['override-raw']),
    filter: formatPayloadRuleSectionForEditor(record.filter),
  };
}

function parsePayloadRulesFromDrafts(
  drafts: PayloadRulesEditorDrafts,
): { success: true; value: Record<string, unknown> } | { success: false; message: string } {
  const next: Record<string, unknown> = {};

  for (const section of PAYLOAD_RULES_EDITOR_SECTIONS) {
    const raw = drafts[section.key].trim();
    if (!raw) continue;
    try {
      next[section.key] = JSON.parse(raw);
    } catch (error: any) {
      return {
        success: false,
        message: `Payload 规则 ${section.title} 不是合法 JSON：${error?.message || '解析失败'}`,
      };
    }
  }

  return {
    success: true,
    value: next,
  };
}

const defaultWeights: RoutingWeights = {
  baseWeightFactor: 0.5,
  valueScoreFactor: 0.5,
  costWeight: 0.4,
  balanceWeight: 0.3,
  usageWeight: 0.3,
};

function getDialectDefaults(dialect: DbDialect) {
  if (dialect === 'mysql') {
    return { port: '3306', database: 'mysql' };
  }
  if (dialect === 'postgres') {
    return { port: '5432', database: 'postgres' };
  }
  return { port: '', database: '' };
}

function buildShorthandConnectionString(dialect: DbDialect, input: ShorthandConnection): string {
  if (dialect === 'sqlite') return '';
  const host = input.host.trim();
  const user = input.user.trim();
  const password = input.password;
  if (!host || !user || !password) return '';
  const defaults = getDialectDefaults(dialect);
  const port = (input.port || defaults.port).trim() || defaults.port;
  const database = (input.database || defaults.database).trim() || defaults.database;
  const protocol = dialect === 'mysql' ? 'mysql' : 'postgres';
  return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function inferUrlDialect(connectionString: string): 'mysql' | 'postgres' | null {
  const normalized = (connectionString || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('mysql://')) return 'mysql';
  if (normalized.startsWith('postgres://') || normalized.startsWith('postgresql://')) return 'postgres';
  return null;
}

function resolveRouteCooldownInput(seconds: number | null | undefined): {
  value: number;
  unit: RouteCooldownUnit;
} {
  const normalizedSeconds = Number.isFinite(Number(seconds)) && Number(seconds) > 0
    ? Math.max(1, Math.trunc(Number(seconds)))
    : 30 * SECONDS_PER_DAY;

  for (const option of [...ROUTE_COOLDOWN_UNIT_OPTIONS].reverse()) {
    if (normalizedSeconds % option.multiplierSec === 0) {
      return {
        value: normalizedSeconds / option.multiplierSec,
        unit: option.value,
      };
    }
  }

  return {
    value: normalizedSeconds,
    unit: 'second',
  };
}

function toRouteCooldownSeconds(value: number, unit: RouteCooldownUnit): number {
  const normalizedValue = Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : 1;
  const unitConfig = ROUTE_COOLDOWN_UNIT_OPTIONS.find((option) => option.value === unit) || ROUTE_COOLDOWN_UNIT_OPTIONS[0];
  return normalizedValue * unitConfig.multiplierSec;
}

function SettingsCard({
  title,
  description,
  children,
  footer,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent className="grid gap-4">{children}</CardContent> : null}
      {footer ? <CardContent className="flex flex-wrap gap-2 pt-0">{footer}</CardContent> : null}
    </Card>
  );
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function SettingsCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
      {children}
    </code>
  );
}

export default function Settings() {
  const isMobile = useIsMobile();
  const [runtime, setRuntime] = useState<RuntimeSettings>({
    checkinCron: '0 8 * * *',
    checkinScheduleMode: 'cron',
    checkinIntervalHours: 6,
    balanceRefreshCron: '0 * * * *',
    logCleanupCron: '0 6 * * *',
    logCleanupUsageLogsEnabled: false,
    logCleanupProgramLogsEnabled: false,
    logCleanupRetentionDays: 30,
    modelAvailabilityProbeEnabled: false,
    codexUpstreamWebsocketEnabled: false,
    responsesCompactFallbackToResponsesEnabled: false,
    disableCrossProtocolFallback: false,
    proxySessionChannelConcurrencyLimit: 2,
    proxySessionChannelQueueWaitMs: 1500,
    routingFallbackUnitCost: 1,
    proxyFirstByteTimeoutSec: 0,
    routeFailureCooldownMaxValue: 30,
    routeFailureCooldownMaxUnit: 'day',
    routingWeights: defaultWeights,
    systemProxyUrl: '',
    proxyErrorKeywords: [],
    proxyEmptyContentFailEnabled: false,
  });
  const [proxyTokenSuffix, setProxyTokenSuffix] = useState('');
  const [proxyErrorKeywordsText, setProxyErrorKeywordsText] = useState('');
  const [maskedToken, setMaskedToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [testingCheckin, setTestingCheckin] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [savingSystemProxy, setSavingSystemProxy] = useState(false);
  const [savingModelAvailabilityProbe, setSavingModelAvailabilityProbe] = useState(false);
  const [savingProxyTransport, setSavingProxyTransport] = useState(false);
  const [testingSystemProxy, setTestingSystemProxy] = useState(false);
  const [systemProxyTestState, setSystemProxyTestState] = useState<SystemProxyTestState>(null);
  const [savingProxyFailureRules, setSavingProxyFailureRules] = useState(false);
  const [payloadVisualRules, setPayloadVisualRules] = useState<VisualPayloadRule[]>([]);
  const [payloadRuleDrafts, setPayloadRuleDrafts] = useState<PayloadRulesEditorDrafts>(createEmptyPayloadRuleDrafts());
  const [payloadAdvancedDirty, setPayloadAdvancedDirty] = useState(false);
  const [savingPayloadRules, setSavingPayloadRules] = useState(false);
  const [showPayloadRulesEditor, setShowPayloadRulesEditor] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [showAdvancedRouting, setShowAdvancedRouting] = useState(false);
  const [allBrandNames, setAllBrandNames] = useState<string[] | null>(null);
  const [blockedBrands, setBlockedBrands] = useState<string[]>([]);
  const [savingBrandFilter, setSavingBrandFilter] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [allowedModelsInput, setAllowedModelsInput] = useState('');
  const [savingAllowedModels, setSavingAllowedModels] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [adminIpAllowlistText, setAdminIpAllowlistText] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [clearingUsage, setClearingUsage] = useState(false);
  const [migrationDialect, setMigrationDialect] = useState<DbDialect>('postgres');
  const [migrationConnectionString, setMigrationConnectionString] = useState('');
  const [connectionMode, setConnectionMode] = useState<'shorthand' | 'advanced'>('shorthand');
  const [showShorthandOptional, setShowShorthandOptional] = useState(false);
  const [shorthandConnection, setShorthandConnection] = useState<ShorthandConnection>({
    host: '',
    user: '',
    password: '',
    port: '5432',
    database: 'postgres',
  });
  const [migrationOverwrite, setMigrationOverwrite] = useState(true);
  const [migrationSsl, setMigrationSsl] = useState(false);
  const [testingMigrationConnection, setTestingMigrationConnection] = useState(false);
  const [migratingDatabase, setMigratingDatabase] = useState(false);
  const [savingRuntimeDatabase, setSavingRuntimeDatabase] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<DatabaseMigrationSummary | null>(null);
  const [runtimeDatabaseState, setRuntimeDatabaseState] = useState<RuntimeDatabaseState | null>(null);
  const [showChangeKey, setShowChangeKey] = useState(false);
  const [modelAvailabilityProbeConfirmOpen, setModelAvailabilityProbeConfirmOpen] = useState(false);
  const modelAvailabilityProbeConfirmPresence = useAnimatedVisibility(modelAvailabilityProbeConfirmOpen, 220);
  const [modelAvailabilityProbeConfirmationInput, setModelAvailabilityProbeConfirmationInput] = useState('');
  const [savedModelAvailabilityProbeEnabled, setSavedModelAvailabilityProbeEnabled] = useState(false);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const factoryResetPresence = useAnimatedVisibility(factoryResetOpen, 220);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [factoryResetSecondsLeft, setFactoryResetSecondsLeft] = useState(FACTORY_RESET_CONFIRM_SECONDS);
  const toast = useToast();

  const activeRoutingProfile = useMemo(
    () => resolveRoutingProfilePreset(runtime.routingWeights),
    [runtime.routingWeights],
  );

  const configuredPayloadRuleCount = useMemo(
    () => payloadVisualRules.filter((rule) => !isVisualPayloadRuleBlank(rule)).length,
    [payloadVisualRules],
  );

  const generatedConnectionString = useMemo(() => (
    buildShorthandConnectionString(migrationDialect, shorthandConnection)
  ), [migrationDialect, shorthandConnection]);

  const effectiveMigrationConnectionString = useMemo(() => {
    if (migrationDialect === 'sqlite') return migrationConnectionString.trim();
    if (connectionMode === 'advanced') return migrationConnectionString.trim();
    return generatedConnectionString.trim();
  }, [connectionMode, generatedConnectionString, migrationConnectionString, migrationDialect]);

  useEffect(() => {
    const defaults = getDialectDefaults(migrationDialect);
    if (migrationDialect === 'sqlite') {
      setConnectionMode('advanced');
      return;
    }
    setShorthandConnection((prev) => ({
      ...prev,
      port: defaults.port,
      database: defaults.database,
    }));
  }, [migrationDialect]);

  useEffect(() => {
    if (!modelAvailabilityProbeConfirmOpen) {
      setModelAvailabilityProbeConfirmationInput('');
    }
  }, [modelAvailabilityProbeConfirmOpen]);

  useEffect(() => {
    if (!factoryResetOpen) {
      setFactoryResetSecondsLeft(FACTORY_RESET_CONFIRM_SECONDS);
      return;
    }
    setFactoryResetSecondsLeft(FACTORY_RESET_CONFIRM_SECONDS);
    const timer = globalThis.setInterval(() => {
      setFactoryResetSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [factoryResetOpen]);

  const proxyTransportModeLabel = runtime.codexUpstreamWebsocketEnabled ? '上游 WebSocket 已启用' : 'HTTP 优先';
  const proxyTransportQueueLabel = `会话池 ${runtime.proxySessionChannelConcurrencyLimit} 并发 / ${runtime.proxySessionChannelQueueWaitMs}ms`;
  const modelAvailabilityProbeDirty = runtime.modelAvailabilityProbeEnabled !== savedModelAvailabilityProbeEnabled;
  const modelAvailabilityProbeStatusTone: SettingsPillTone = modelAvailabilityProbeDirty
    ? 'warning'
    : savedModelAvailabilityProbeEnabled
      ? 'danger'
      : 'neutral';
  const modelAvailabilityProbeStatusLabel = modelAvailabilityProbeDirty
    ? '待保存'
    : savedModelAvailabilityProbeEnabled
      ? '已启用'
      : '已关闭';

  const syncPayloadRuleDraftsFromObject = (value: unknown) => {
    setPayloadRuleDrafts(normalizePayloadRulesForEditor(value));
    setPayloadAdvancedDirty(false);
  };

  const syncPayloadVisualRulesFromObject = (value: unknown) => {
    setPayloadVisualRules(payloadRulesToVisualRules(value));
  };

  const applyVisualPayloadRules = (
    nextRulesOrUpdater: VisualPayloadRule[] | ((current: VisualPayloadRule[]) => VisualPayloadRule[]),
  ) => {
    setPayloadVisualRules((currentRules) => {
      const nextRules = typeof nextRulesOrUpdater === 'function'
        ? nextRulesOrUpdater(currentRules)
        : nextRulesOrUpdater;
      const serialized = visualRulesToPayloadRules(nextRules);
      if (serialized.success) {
        syncPayloadRuleDraftsFromObject(serialized.value);
      }
      return nextRules;
    });
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [authInfo, runtimeInfo, runtimeDatabaseInfo] = await Promise.all([
        api.getAuthInfo(),
        api.getRuntimeSettings(),
        api.getRuntimeDatabaseConfig(),
      ]);
      setMaskedToken(authInfo.masked || '****');
      const routeCooldownInput = resolveRouteCooldownInput(runtimeInfo.tokenRouterFailureCooldownMaxSec);
      setRuntime({
        checkinCron: runtimeInfo.checkinCron || '0 8 * * *',
        checkinScheduleMode: runtimeInfo.checkinScheduleMode === 'interval' ? 'interval' : 'cron',
        checkinIntervalHours: Number(runtimeInfo.checkinIntervalHours) >= 1
          ? Math.min(24, Math.trunc(Number(runtimeInfo.checkinIntervalHours)))
          : 6,
        balanceRefreshCron: runtimeInfo.balanceRefreshCron || '0 * * * *',
        logCleanupCron: runtimeInfo.logCleanupCron || '0 6 * * *',
        logCleanupUsageLogsEnabled: !!runtimeInfo.logCleanupUsageLogsEnabled,
        logCleanupProgramLogsEnabled: !!runtimeInfo.logCleanupProgramLogsEnabled,
        logCleanupRetentionDays: Number(runtimeInfo.logCleanupRetentionDays) >= 1
          ? Math.trunc(Number(runtimeInfo.logCleanupRetentionDays))
          : 30,
        modelAvailabilityProbeEnabled: !!runtimeInfo.modelAvailabilityProbeEnabled,
        codexUpstreamWebsocketEnabled: !!runtimeInfo.codexUpstreamWebsocketEnabled,
        responsesCompactFallbackToResponsesEnabled: !!runtimeInfo.responsesCompactFallbackToResponsesEnabled,
        disableCrossProtocolFallback: !!runtimeInfo.disableCrossProtocolFallback,
        proxySessionChannelConcurrencyLimit: Number(runtimeInfo.proxySessionChannelConcurrencyLimit) >= 0
          ? Math.trunc(Number(runtimeInfo.proxySessionChannelConcurrencyLimit))
          : 2,
        proxySessionChannelQueueWaitMs: Number(runtimeInfo.proxySessionChannelQueueWaitMs) >= 0
          ? Math.trunc(Number(runtimeInfo.proxySessionChannelQueueWaitMs))
          : 1500,
        routingFallbackUnitCost: Number(runtimeInfo.routingFallbackUnitCost) > 0
          ? Number(runtimeInfo.routingFallbackUnitCost)
          : 1,
        proxyFirstByteTimeoutSec: Number(runtimeInfo.proxyFirstByteTimeoutSec) >= 0
          ? Math.trunc(Number(runtimeInfo.proxyFirstByteTimeoutSec))
          : 0,
        routeFailureCooldownMaxValue: routeCooldownInput.value,
        routeFailureCooldownMaxUnit: routeCooldownInput.unit,
        routingWeights: {
          ...defaultWeights,
          ...(runtimeInfo.routingWeights || {}),
        },
        systemProxyUrl: typeof runtimeInfo.systemProxyUrl === 'string' ? runtimeInfo.systemProxyUrl : '',
        proxyErrorKeywords: Array.isArray(runtimeInfo.proxyErrorKeywords)
          ? runtimeInfo.proxyErrorKeywords.filter((item: unknown) => typeof item === 'string')
          : [],
        proxyEmptyContentFailEnabled: !!runtimeInfo.proxyEmptyContentFailEnabled,
        proxyTokenMasked: runtimeInfo.proxyTokenMasked || '',
        adminIpAllowlist: Array.isArray(runtimeInfo.adminIpAllowlist)
          ? runtimeInfo.adminIpAllowlist.filter((item: unknown) => typeof item === 'string')
          : [],
        currentAdminIp: typeof runtimeInfo.currentAdminIp === 'string' ? runtimeInfo.currentAdminIp : '',
        globalBlockedBrands: Array.isArray(runtimeInfo.globalBlockedBrands) ? runtimeInfo.globalBlockedBrands : [],
        globalAllowedModels: Array.isArray(runtimeInfo.globalAllowedModels) ? runtimeInfo.globalAllowedModels : [],
      });
      setSavedModelAvailabilityProbeEnabled(!!runtimeInfo.modelAvailabilityProbeEnabled);
      setBlockedBrands(Array.isArray(runtimeInfo.globalBlockedBrands) ? runtimeInfo.globalBlockedBrands : []);
      setAllowedModels(Array.isArray(runtimeInfo.globalAllowedModels) ? runtimeInfo.globalAllowedModels : []);
      setProxyErrorKeywordsText(
        Array.isArray(runtimeInfo.proxyErrorKeywords)
          ? runtimeInfo.proxyErrorKeywords.filter((item: unknown) => typeof item === 'string').join('\n')
          : '',
      );
      syncPayloadRuleDraftsFromObject(runtimeInfo.payloadRules);
      syncPayloadVisualRulesFromObject(runtimeInfo.payloadRules);
      setAdminIpAllowlistText(
        Array.isArray(runtimeInfo.adminIpAllowlist)
          ? runtimeInfo.adminIpAllowlist.join('\n')
          : '',
      );
      if (runtimeDatabaseInfo?.active?.dialect) {
        const preferredDialect = (runtimeDatabaseInfo?.saved?.dialect || runtimeDatabaseInfo.active.dialect) as DbDialect;
        setMigrationDialect(preferredDialect);
      }
      setRuntimeDatabaseState({
        active: {
          dialect: (runtimeDatabaseInfo?.active?.dialect || 'sqlite') as DbDialect,
          connection: String(runtimeDatabaseInfo?.active?.connection || ''),
          ssl: !!runtimeDatabaseInfo?.active?.ssl,
        },
        saved: runtimeDatabaseInfo?.saved
          ? {
            dialect: runtimeDatabaseInfo.saved.dialect as DbDialect,
            connection: String(runtimeDatabaseInfo.saved.connection || ''),
            ssl: !!runtimeDatabaseInfo.saved.ssl,
          }
          : null,
        restartRequired: !!runtimeDatabaseInfo?.restartRequired,
      });
    } catch (err: any) {
      toast.error(err?.message || '加载设置失败');
    } finally {
      setLoading(false);
    }
    // Load brand list in background (non-blocking, best-effort)
    api.getBrandList()
      .then((res: any) => setAllBrandNames(Array.isArray(res?.brands) ? res.brands : []))
      .catch(() => setAllBrandNames([]));
    // Load available models in background (non-blocking, best-effort)
    api.getModelTokenCandidates()
      .then((res: any) => {
        const models = res?.models || {};
        const modelNames = Object.keys(models);
        setAvailableModels(modelNames.sort());
      })
      .catch(() => setAvailableModels([]));
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const normalizeProxyTokenSuffix = (raw: string) => {
    const compact = raw.replace(/\s+/g, '');
    if (compact.toLowerCase().startsWith(PROXY_TOKEN_PREFIX)) {
      return compact.slice(PROXY_TOKEN_PREFIX.length);
    }
    return compact;
  };

  const parseProxyErrorKeywords = (raw: string) => raw
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await api.updateRuntimeSettings({
        checkinCron: runtime.checkinCron,
        checkinScheduleMode: runtime.checkinScheduleMode,
        checkinIntervalHours: runtime.checkinIntervalHours,
        balanceRefreshCron: runtime.balanceRefreshCron,
        logCleanupCron: runtime.logCleanupCron,
        logCleanupUsageLogsEnabled: runtime.logCleanupUsageLogsEnabled,
        logCleanupProgramLogsEnabled: runtime.logCleanupProgramLogsEnabled,
        logCleanupRetentionDays: runtime.logCleanupRetentionDays,
      });
      toast.success('定时任务设置已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingSchedule(false);
    }
  };

  const triggerScheduleCheckin = async () => {
    setTestingCheckin(true);
    try {
      await api.triggerCheckinAll();
      toast.success('已开始全部签到，请稍后查看签到日志');
    } catch (err: any) {
      toast.error(err?.message || '触发签到失败');
    } finally {
      setTestingCheckin(false);
    }
  };

  const saveProxyToken = async () => {
    const suffix = proxyTokenSuffix.trim();
    if (!suffix) {
      toast.info('请输入 sk- 后的令牌内容');
      return;
    }
    setSavingToken(true);
    try {
      const res = await api.updateRuntimeSettings({ proxyToken: `${PROXY_TOKEN_PREFIX}${suffix}` });
      setRuntime((prev) => ({ ...prev, proxyTokenMasked: res.proxyTokenMasked || prev.proxyTokenMasked }));
      setProxyTokenSuffix('');
      toast.success('Proxy token updated');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingToken(false);
    }
  };

  const saveSystemProxy = async () => {
    setSavingSystemProxy(true);
    try {
      const res = await api.updateRuntimeSettings({
        systemProxyUrl: runtime.systemProxyUrl.trim(),
      });
      setRuntime((prev) => ({
        ...prev,
        systemProxyUrl: typeof res?.systemProxyUrl === 'string'
          ? res.systemProxyUrl
          : prev.systemProxyUrl,
      }));
      toast.success('系统代理已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingSystemProxy(false);
    }
  };

  const persistModelAvailabilityProbeSetting = async (enabled: boolean) => {
    setSavingModelAvailabilityProbe(true);
    try {
      const res = await api.updateRuntimeSettings({
        modelAvailabilityProbeEnabled: enabled,
      });
      const nextEnabled = typeof res?.modelAvailabilityProbeEnabled === 'boolean'
        ? res.modelAvailabilityProbeEnabled
        : enabled;
      setRuntime((prev) => ({
        ...prev,
        modelAvailabilityProbeEnabled: nextEnabled,
      }));
      setSavedModelAvailabilityProbeEnabled(nextEnabled);
      setModelAvailabilityProbeConfirmOpen(false);
      setModelAvailabilityProbeConfirmationInput('');
      toast.success(nextEnabled ? '批量测活已开启' : '批量测活已关闭');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingModelAvailabilityProbe(false);
    }
  };

  const saveModelAvailabilityProbeSettings = async () => {
    if (runtime.modelAvailabilityProbeEnabled === savedModelAvailabilityProbeEnabled) {
      toast.info('批量测活设置未变化');
      return;
    }
    if (runtime.modelAvailabilityProbeEnabled) {
      setModelAvailabilityProbeConfirmOpen(true);
      return;
    }
    await persistModelAvailabilityProbeSetting(false);
  };

  const saveProxyTransportSettings = async () => {
    setSavingProxyTransport(true);
    try {
      const res = await api.updateRuntimeSettings({
        codexUpstreamWebsocketEnabled: runtime.codexUpstreamWebsocketEnabled,
        responsesCompactFallbackToResponsesEnabled: runtime.responsesCompactFallbackToResponsesEnabled,
        proxySessionChannelConcurrencyLimit: runtime.proxySessionChannelConcurrencyLimit,
        proxySessionChannelQueueWaitMs: runtime.proxySessionChannelQueueWaitMs,
      });
      setRuntime((prev) => ({
        ...prev,
        codexUpstreamWebsocketEnabled: typeof res?.codexUpstreamWebsocketEnabled === 'boolean'
          ? res.codexUpstreamWebsocketEnabled
          : prev.codexUpstreamWebsocketEnabled,
        responsesCompactFallbackToResponsesEnabled: typeof res?.responsesCompactFallbackToResponsesEnabled === 'boolean'
          ? res.responsesCompactFallbackToResponsesEnabled
          : prev.responsesCompactFallbackToResponsesEnabled,
        proxySessionChannelConcurrencyLimit: Number(res?.proxySessionChannelConcurrencyLimit) >= 0
          ? Math.trunc(Number(res.proxySessionChannelConcurrencyLimit))
          : prev.proxySessionChannelConcurrencyLimit,
        proxySessionChannelQueueWaitMs: Number(res?.proxySessionChannelQueueWaitMs) >= 0
          ? Math.trunc(Number(res.proxySessionChannelQueueWaitMs))
          : prev.proxySessionChannelQueueWaitMs,
      }));
      toast.success('传输与会话并发设置已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingProxyTransport(false);
    }
  };

  const testSystemProxy = async () => {
    const proxyUrl = runtime.systemProxyUrl.trim();
    if (!proxyUrl) {
      const message = '请先填写系统代理地址';
      setSystemProxyTestState({ kind: 'error', text: message });
      toast.info(message);
      return;
    }

    setTestingSystemProxy(true);
    setSystemProxyTestState(null);
    try {
      const res = await api.testSystemProxy({ proxyUrl });
      const summary = `连通成功，延迟 ${res.latencyMs} ms`;
      setSystemProxyTestState({ kind: 'success', text: summary });
      toast.success(`系统代理测试成功（${res.latencyMs} ms）`);
    } catch (err: any) {
      const message = err?.message || '系统代理测试失败';
      setSystemProxyTestState({ kind: 'error', text: message });
      toast.error(message);
    } finally {
      setTestingSystemProxy(false);
    }
  };

  const saveProxyFailureRules = async () => {
    setSavingProxyFailureRules(true);
    try {
      const keywords = parseProxyErrorKeywords(proxyErrorKeywordsText);
      const res = await api.updateRuntimeSettings({
        proxyErrorKeywords: keywords,
        proxyEmptyContentFailEnabled: runtime.proxyEmptyContentFailEnabled,
      });
      const nextKeywords = Array.isArray(res?.proxyErrorKeywords)
        ? res.proxyErrorKeywords
        : keywords;
      setRuntime((prev) => ({
        ...prev,
        proxyErrorKeywords: nextKeywords,
        proxyEmptyContentFailEnabled: typeof res?.proxyEmptyContentFailEnabled === 'boolean'
          ? res.proxyEmptyContentFailEnabled
          : prev.proxyEmptyContentFailEnabled,
      }));
      setProxyErrorKeywordsText(nextKeywords.join('\n'));
      toast.success('代理失败规则已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingProxyFailureRules(false);
    }
  };

  const savePayloadRules = async () => {
    const nextPayloadRules = payloadAdvancedDirty
      ? parsePayloadRulesFromDrafts(payloadRuleDrafts)
      : visualRulesToPayloadRules(payloadVisualRules);
    if (!nextPayloadRules.success) {
      toast.error(nextPayloadRules.message);
      return;
    }

    setSavingPayloadRules(true);
    try {
      const res = await api.updateRuntimeSettings({
        payloadRules: nextPayloadRules.value,
      });
      syncPayloadRuleDraftsFromObject(res?.payloadRules);
      syncPayloadVisualRulesFromObject(res?.payloadRules);
      toast.success('Payload 规则已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存 Payload 规则失败');
    } finally {
      setSavingPayloadRules(false);
    }
  };

  const applyCodexDefaultHighReasoningPreset = () => {
    applyVisualPayloadRules((currentRules) => [
      ...currentRules.filter((rule) => !isVisualPayloadRuleBlank(rule)),
      ...createCodexDefaultHighReasoningVisualPreset(),
    ]);
    setShowPayloadRulesEditor(true);
    toast.success('已填入 Codex 默认高推理预设');
  };

  const addPayloadVisualRule = () => {
    applyVisualPayloadRules((currentRules) => [
      ...currentRules,
      createVisualPayloadRule(),
    ]);
  };

  const updatePayloadVisualRule = (ruleId: string, patch: Partial<VisualPayloadRule>) => {
    applyVisualPayloadRules((currentRules) => currentRules.map((rule) => {
      if (rule.id !== ruleId) return rule;
      const nextAction = (patch.action ?? rule.action) as PayloadRuleAction;
      const nextValueMode = patch.valueMode ?? (
        nextAction === 'default-raw' || nextAction === 'override-raw'
          ? 'json'
          : rule.valueMode
      );
      return {
        ...rule,
        ...patch,
        action: nextAction,
        valueMode: nextAction === 'filter' ? 'text' : nextValueMode,
        value: nextAction === 'filter' ? '' : (patch.value ?? rule.value),
      };
    }));
  };

  const removePayloadVisualRule = (ruleId: string) => {
    applyVisualPayloadRules((currentRules) => currentRules.filter((rule) => rule.id !== ruleId));
  };

  const syncVisualRulesFromAdvancedJson = () => {
    const parsedPayloadRules = parsePayloadRulesFromDrafts(payloadRuleDrafts);
    if (!parsedPayloadRules.success) {
      toast.error(parsedPayloadRules.message);
      return;
    }
    syncPayloadVisualRulesFromObject(parsedPayloadRules.value);
    setPayloadAdvancedDirty(false);
    toast.success('已将高级 JSON 同步到可视化规则');
  };

  const saveRouting = async () => {
    setSavingRouting(true);
    try {
      await api.updateRuntimeSettings({
        routingWeights: runtime.routingWeights,
        routingFallbackUnitCost: runtime.routingFallbackUnitCost,
        proxyFirstByteTimeoutSec: Number.isFinite(runtime.proxyFirstByteTimeoutSec)
          ? Math.max(0, Math.trunc(runtime.proxyFirstByteTimeoutSec))
          : 0,
        tokenRouterFailureCooldownMaxSec: toRouteCooldownSeconds(
          runtime.routeFailureCooldownMaxValue,
          runtime.routeFailureCooldownMaxUnit,
        ),
        disableCrossProtocolFallback: runtime.disableCrossProtocolFallback,
      });
      toast.success('Routing weights saved');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingRouting(false);
    }
  };

  const applyRoutingPreset = (preset: 'balanced' | 'stable' | 'cost') => {
    setRuntime((prev) => ({
      ...prev,
      routingWeights: applyRoutingProfilePreset(preset),
    }));
  };

  const handleSaveBrandFilter = async () => {
    setSavingBrandFilter(true);
    try {
      const res = await api.updateRuntimeSettings({ globalBlockedBrands: blockedBrands });
      const resolved = Array.isArray(res?.globalBlockedBrands) ? res.globalBlockedBrands : blockedBrands;
      setRuntime((prev) => ({ ...prev, globalBlockedBrands: resolved }));
      setBlockedBrands(resolved);
      toast.success('品牌屏蔽设置已保存');
      try {
        await api.rebuildRoutes(false);
        toast.success('路由已重建');
      } catch {
        toast.error('品牌屏蔽已保存，但路由重建失败，请手动重建');
      }
    } catch (err: any) {
      toast.error(err?.message || '保存品牌屏蔽设置失败');
    } finally {
      setSavingBrandFilter(false);
    }
  };

  const handleSaveAllowedModels = async () => {
    setSavingAllowedModels(true);
    try {
      const res = await api.updateRuntimeSettings({ globalAllowedModels: allowedModels });
      const resolved = Array.isArray(res?.globalAllowedModels) ? res.globalAllowedModels : allowedModels;
      setRuntime((prev) => ({ ...prev, globalAllowedModels: resolved }));
      setAllowedModels(resolved);
      toast.success('模型白名单设置已保存');
      try {
        await api.rebuildRoutes(false);
        toast.success('路由已重建');
      } catch {
        toast.error('模型白名单已保存，但路由重建失败，请手动重建');
      }
    } catch (err: any) {
      toast.error(err?.message || '保存模型白名单设置失败');
    } finally {
      setSavingAllowedModels(false);
    }
  };

  const saveSecuritySettings = async () => {
    setSavingSecurity(true);
    try {
      const allowlist = adminIpAllowlistText
        .split(/\r?\n|,/g)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      const res = await api.updateRuntimeSettings({
        adminIpAllowlist: allowlist,
      });
      setRuntime((prev) => ({
        ...prev,
        adminIpAllowlist: allowlist,
        currentAdminIp: typeof res?.currentAdminIp === 'string'
          ? res.currentAdminIp
          : prev.currentAdminIp,
      }));
      toast.success('Security settings saved');
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingSecurity(false);
    }
  };


  const handleClearCache = async () => {
    if (!window.confirm('确认清理模型缓存并重建路由？')) return;
    setClearingCache(true);
    try {
      const res = await api.clearRuntimeCache();
      toast.success(`缓存已清理（模型缓存 ${res.deletedModelAvailability || 0} 条）`);
    } catch (err: any) {
      toast.error(err?.message || '清理缓存失败');
    } finally {
      setClearingCache(false);
    }
  };

  const handleClearUsage = async () => {
    if (!window.confirm('确认清理占用统计与使用日志？')) return;
    setClearingUsage(true);
    try {
      const res = await api.clearUsageData();
      toast.success(`占用统计已清理（日志 ${res.deletedProxyLogs || 0} 条）`);
    } catch (err: any) {
      toast.error(err?.message || '清理占用失败');
    } finally {
      setClearingUsage(false);
    }
  };

  const closeFactoryResetModal = () => {
    if (factoryResetting) return;
    setFactoryResetOpen(false);
  };

  const closeModelAvailabilityProbeConfirmModal = () => {
    if (savingModelAvailabilityProbe) return;
    setModelAvailabilityProbeConfirmOpen(false);
  };

  const handleConfirmModelAvailabilityProbe = async () => {
    if (modelAvailabilityProbeConfirmationInput.trim() !== MODEL_AVAILABILITY_PROBE_CONFIRM_TEXT) return;
    await persistModelAvailabilityProbeSetting(true);
  };

  const handleFactoryReset = async () => {
    if (factoryResetSecondsLeft > 0 || factoryResetting) return;
    setFactoryResetting(true);
    try {
      await api.factoryReset();
      clearAppInstallationState(localStorage);
      window.location.reload();
    } catch (err: any) {
      toast.error(err?.message || '重新初始化系统失败');
      setFactoryResetting(false);
    }
  };

  const handleTestExternalDatabaseConnection = async () => {
    if (!effectiveMigrationConnectionString) {
      toast.info('Please fill target database connection first');
      return;
    }

    const inferredDialect = inferUrlDialect(effectiveMigrationConnectionString);
    if (migrationDialect === 'sqlite' && inferredDialect) {
      toast.error(`当前选择 SQLite，但连接串是 ${inferredDialect.toUpperCase()} URL，请先切换方言`);
      return;
    }

    setTestingMigrationConnection(true);
    try {
      const res = await api.testExternalDatabaseConnection({
        dialect: migrationDialect,
        connectionString: effectiveMigrationConnectionString,
        ssl: migrationSsl,
      });
      toast.success(`Connection success: ${res.connection || migrationDialect}`);
    } catch (err: any) {
      toast.error(err?.message || 'Target database connection failed');
    } finally {
      setTestingMigrationConnection(false);
    }
  };

  const handleMigrateToExternalDatabase = async () => {
    if (!effectiveMigrationConnectionString) {
      toast.info('Please fill target database connection first');
      return;
    }

    const inferredDialect = inferUrlDialect(effectiveMigrationConnectionString);
    if (migrationDialect === 'sqlite' && inferredDialect) {
      toast.error(`当前选择 SQLite，但连接串是 ${inferredDialect.toUpperCase()} URL，请先切换方言`);
      return;
    }

    const warning = migrationOverwrite
      ? 'Confirm migration and overwrite existing data in target database?'
      : 'Confirm migration to target database? If target has data, migration may fail.';
    if (!window.confirm(warning)) return;

    setMigratingDatabase(true);
    try {
      const res = await api.migrateExternalDatabase({
        dialect: migrationDialect,
        connectionString: effectiveMigrationConnectionString,
        overwrite: migrationOverwrite,
        ssl: migrationSsl,
      });
      setMigrationSummary(res);
      toast.success(res?.message || 'Database migration completed');
    } catch (err: any) {
      toast.error(err?.message || 'Database migration failed');
    } finally {
      setMigratingDatabase(false);
    }
  };

  const handleSaveRuntimeDatabaseConfig = async () => {
    if (!effectiveMigrationConnectionString) {
      toast.info('Please fill target database connection first');
      return;
    }

    const inferredDialect = inferUrlDialect(effectiveMigrationConnectionString);
    if (migrationDialect === 'sqlite' && inferredDialect) {
      toast.error(`当前选择 SQLite，但连接串是 ${inferredDialect.toUpperCase()} URL，请先切换方言`);
      return;
    }

    setSavingRuntimeDatabase(true);
    try {
      const res = await api.updateRuntimeDatabaseConfig({
        dialect: migrationDialect,
        connectionString: effectiveMigrationConnectionString,
        ssl: migrationSsl,
      });
      setRuntimeDatabaseState({
        active: {
          dialect: (res?.active?.dialect || 'sqlite') as DbDialect,
          connection: String(res?.active?.connection || ''),
          ssl: !!res?.active?.ssl,
        },
        saved: res?.saved
          ? {
            dialect: res.saved.dialect as DbDialect,
            connection: String(res.saved.connection || ''),
            ssl: !!res.saved.ssl,
          }
          : null,
        restartRequired: !!res?.restartRequired,
      });
      toast.success(res?.message || 'Runtime database config saved');
    } catch (err: any) {
      toast.error(err?.message || 'Runtime database config save failed');
    } finally {
      setSavingRuntimeDatabase(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">系统设置</h2>
      </div>

      <div className="grid max-w-3xl gap-4">
        <SettingsCard title="管理员登录令牌">
          <SettingsCode>
            {maskedToken || '****'}
          </SettingsCode>
          <Button type="button" onClick={() => setShowChangeKey(true)}>修改登录令牌</Button>
          <ChangeKeyModal
            open={showChangeKey}
            onClose={() => {
              setShowChangeKey(false);
              api.getAuthInfo().then((r: any) => setMaskedToken(r.masked || '****')).catch(() => { });
            }}
          />
        </SettingsCard>

        <SettingsCard title="定时任务">
          <div className="grid items-end gap-3 md:grid-cols-[180px_180px_auto]">
            <SettingsField label="签到方式">
              <ModernSelect
                value={runtime.checkinScheduleMode}
                onChange={(value) => setRuntime((prev) => ({
                  ...prev,
                  checkinScheduleMode: value === 'interval' ? 'interval' : 'cron',
                }))}
                options={CHECKIN_SCHEDULE_MODE_OPTIONS.map((item) => ({ ...item }))}
              />
            </SettingsField>
            <SettingsField label="签到间隔">
              <ModernSelect
                value={String(runtime.checkinIntervalHours)}
                onChange={(value) => setRuntime((prev) => ({
                  ...prev,
                  checkinIntervalHours: Math.min(24, Math.max(1, Math.trunc(Number(value) || 1))),
                }))}
                disabled={runtime.checkinScheduleMode !== 'interval'}
                options={CHECKIN_INTERVAL_OPTIONS}
              />
            </SettingsField>
            <Button type="button" variant="outline"
              onClick={triggerScheduleCheckin}
              disabled={testingCheckin}
            >
              {testingCheckin ? '触发中...' : '测试一次签到'}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsField label="签到 Cron">
              <Input
                className="font-mono"
                value={runtime.checkinCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, checkinCron: e.target.value }))}
                disabled={runtime.checkinScheduleMode !== 'cron'}
              />
            </SettingsField>
            <SettingsField label="余额刷新 Cron">
              <Input
                className="font-mono"
                value={runtime.balanceRefreshCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, balanceRefreshCron: e.target.value }))}
              />
            </SettingsField>
          </div>
          <div className="grid gap-3 border-t pt-4">
            <div className="text-sm font-semibold">自动清理日志</div>
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <SettingsField label="清理 Cron">
                <Input
                  className="font-mono"
                  value={runtime.logCleanupCron}
                  onChange={(e) => setRuntime((prev) => ({ ...prev, logCleanupCron: e.target.value }))}
                />
              </SettingsField>
              <SettingsField label="保留天数">
                <Input
                  type="number"
                  min={1}
                  value={runtime.logCleanupRetentionDays}
                  onChange={(e) => setRuntime((prev) => {
                    const nextValue = Number(e.target.value);
                    return {
                      ...prev,
                      logCleanupRetentionDays: Number.isFinite(nextValue) && nextValue >= 1
                        ? Math.trunc(nextValue)
                        : prev.logCleanupRetentionDays,
                    };
                  })}
                />
              </SettingsField>
            </div>
            <div className="flex flex-wrap gap-4">
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={runtime.logCleanupUsageLogsEnabled}
                  onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, logCleanupUsageLogsEnabled: checked === true }))}
                />
                清理使用日志
              </Label>
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={runtime.logCleanupProgramLogsEnabled}
                  onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, logCleanupProgramLogsEnabled: checked === true }))}
                />
                清理程序日志
              </Label>
            </div>
            <div className="text-xs text-muted-foreground">
              默认每天早上 6 点执行。按每次定时任务执行时间，清理早于“保留天数”的日志；两个选项都不勾选时不会实际删除日志。
            </div>
          </div>
          <div>
            <Button type="button" onClick={saveSchedule} disabled={savingSchedule}>
              {savingSchedule ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存定时任务'}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="系统代理"
          description="配置一个全局出站代理地址，站点页可按站点决定是否启用系统代理。"
        >
          <Input
            className="font-mono"
            value={runtime.systemProxyUrl}
            onChange={(e) => {
              setRuntime((prev) => ({ ...prev, systemProxyUrl: e.target.value }));
              setSystemProxyTestState(null);
            }}
            placeholder="系统代理 URL（可选，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080）"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveSystemProxy} disabled={savingSystemProxy}>
              {savingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存系统代理'}
            </Button>
            <Button type="button" variant="outline"
              onClick={testSystemProxy}
              disabled={testingSystemProxy}
             
             
            >
              {testingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> 测试中...</> : '测试系统代理'}
            </Button>
          </div>
          {systemProxyTestState && (
            <div className={systemProxyTestState.kind === 'success' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>
              {systemProxyTestState.text}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title="代理失败判定" description="命中任一关键词或空内容时判定失败，可触发重试。">
          <Textarea
            className="min-h-24 font-mono"
            value={proxyErrorKeywordsText}
            onChange={(e) => setProxyErrorKeywordsText(e.target.value)}
            placeholder="一行一个关键词，或逗号分隔"
          />
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={runtime.proxyEmptyContentFailEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, proxyEmptyContentFailEnabled: checked === true }))}
            />
            空内容（completion=0，即使 prompt 有 token 也算）判定失败
          </Label>
          <div>
            <Button type="button" onClick={saveProxyFailureRules} disabled={savingProxyFailureRules}>
              {savingProxyFailureRules ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存失败规则'}
            </Button>
          </div>
        </SettingsCard>

        <Card data-settings-card="payload-rules">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>Payload 规则</CardTitle>
              <CardDescription>
                对匹配模型的上游请求做默认注入、强制覆盖或字段过滤。规则结构参考 CPA 的 payload 配置，常见场景可直接注入
                {' '}
                <code className="font-mono">reasoning.effort</code>
                {' '}
                之类的参数。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToneBadge tone={configuredPayloadRuleCount > 0 ? 'primary' : 'muted'}>
                {configuredPayloadRuleCount > 0 ? `已配置 ${configuredPayloadRuleCount} 条` : '未配置'}
              </ToneBadge>
              <ToneBadge tone={payloadAdvancedDirty ? 'warning' : 'muted'}>
                {payloadAdvancedDirty ? '高级 JSON 待同步/保存' : '保存后立即生效'}
              </ToneBadge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
          <div className="grid gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <div className="text-xs font-semibold text-muted-foreground">常用预设</div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  先用预设快速填充，再通过下面的可视化规则编辑器细调。复杂场景仍可回退到高级 JSON。
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={applyCodexDefaultHighReasoningPreset}>
                  Codex 默认高推理
                </Button>
                <Button variant="outline" type="button" onClick={addPayloadVisualRule}>
                  新增规则
                </Button>
                <Button variant="outline" type="button" onClick={() => setShowPayloadRulesEditor((prev) => !prev)}>
                  {showPayloadRulesEditor ? '收起高级 JSON 编辑' : '展开高级 JSON 编辑'}
                </Button>
              </div>
            </div>
          </div>
          {payloadVisualRules.length <= 0 ? (
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">还没有可视化规则</div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                可以先点上面的预设，也可以直接新增一条规则：选择动作、协议、模型匹配、字段路径和值即可。
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {payloadVisualRules.map((rule, index) => (
                <div
                  key={rule.id}
                  className="grid gap-3 rounded-md border p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-muted-foreground">规则 {index + 1}</div>
                    <Button variant="outline" type="button" onClick={() => removePayloadVisualRule(rule.id)}>
                      删除
                    </Button>
                  </div>
                  <ResponsiveFormGrid columns={2}>
                    <SettingsField label="动作">
                      <ModernSelect
                        size="sm"
                        data-testid={`payload-rule-action-${index + 1}`}
                        value={rule.action}
                        onChange={(value) => updatePayloadVisualRule(rule.id, { action: value as PayloadRuleAction })}
                        options={PAYLOAD_RULE_ACTION_OPTIONS}
                        placeholder="选择动作"
                      />
                    </SettingsField>
                    <SettingsField label="协议">
                      <ModernSelect
                        size="sm"
                        data-testid={`payload-rule-protocol-${index + 1}`}
                        value={rule.protocol}
                        onChange={(value) => updatePayloadVisualRule(rule.id, { protocol: String(value || '') })}
                        options={PAYLOAD_RULE_PROTOCOL_OPTIONS}
                        placeholder="全部协议"
                      />
                    </SettingsField>
                    <SettingsField label="模型匹配">
                      <Input
                        type="text"
                        aria-label={`Payload 规则可视化模型 ${index + 1}`}
                        value={rule.modelPattern}
                        onChange={(e) => updatePayloadVisualRule(rule.id, { modelPattern: e.target.value })}
                        placeholder="例如 gpt-*"
                      />
                    </SettingsField>
                    <SettingsField label="字段路径">
                      <Input
                        className="font-mono"
                        type="text"
                        aria-label={`Payload 规则可视化路径 ${index + 1}`}
                        value={rule.path}
                        onChange={(e) => updatePayloadVisualRule(rule.id, { path: e.target.value })}
                        placeholder="例如 reasoning.effort"
                      />
                    </SettingsField>
                  </ResponsiveFormGrid>
                  {rule.action === 'filter' ? (
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      删除字段规则不需要填写值，命中后会从请求中移除这条路径。
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {(rule.action === 'default' || rule.action === 'override') && (
                        <div className="w-full md:w-44">
                          <Label>值类型</Label>
                          <ModernSelect
                            size="sm"
                            data-testid={`payload-rule-value-mode-${index + 1}`}
                            value={rule.valueMode}
                            onChange={(value) => updatePayloadVisualRule(rule.id, {
                              valueMode: value as VisualPayloadRuleValueMode,
                              value: value === 'json' && rule.valueMode !== 'json'
                                ? (rule.value ? JSON.stringify(rule.value) : '')
                                : rule.value,
                            })}
                            options={PAYLOAD_RULE_VALUE_MODE_OPTIONS}
                            placeholder="值类型"
                          />
                        </div>
                      )}
                      <SettingsField
                        label={
                          rule.action === 'default-raw' || rule.action === 'override-raw'
                            ? '原始 JSON 值'
                            : (rule.valueMode === 'json' ? 'JSON 值' : '文本值')
                        }
                      >
                        {(rule.action === 'default-raw' || rule.action === 'override-raw' || rule.valueMode === 'json') ? (
                          <Textarea
                            className="min-h-24 font-mono"
                            aria-label={`Payload 规则可视化值 ${index + 1}`}
                            value={rule.value}
                            onChange={(e) => updatePayloadVisualRule(rule.id, { value: e.target.value })}
                            placeholder={rule.action === 'default-raw' || rule.action === 'override-raw'
                              ? '{"type":"json_schema"}'
                              : '{"effort":"high"}'}
                            rows={3}
                          />
                        ) : (
                          <Input
                            type="text"
                            aria-label={`Payload 规则可视化值 ${index + 1}`}
                            value={rule.value}
                            onChange={(e) => updatePayloadVisualRule(rule.id, { value: e.target.value })}
                            placeholder="例如 high"
                          />
                        )}
                      </SettingsField>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className={`anim-collapse ${showPayloadRulesEditor ? 'is-open' : ''}`.trim()}>
            <div className="anim-collapse-inner pt-0.5">
              <div className="grid gap-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="text-xs font-semibold text-muted-foreground">高级 JSON 编辑</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      适合直接粘贴 CPA 风格规则。手动改完后，可点击“同步到可视化规则”回到上面的低门槛编辑器。
                    </div>
                  </div>
                  <Button variant="outline" type="button" onClick={syncVisualRulesFromAdvancedJson}>
                    同步到可视化规则
                  </Button>
                </div>
              </div>
              <ResponsiveFormGrid columns={2}>
                {PAYLOAD_RULES_EDITOR_SECTIONS.map((section) => (
                  <div key={section.key} className="grid gap-3 rounded-md border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">{section.title}</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">{section.description}</div>
                    <Textarea
                      className="min-h-36 font-mono"
                      aria-label={`Payload 规则 ${section.key}`}
                      value={payloadRuleDrafts[section.key]}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setPayloadRuleDrafts((prev) => ({
                          ...prev,
                          [section.key]: nextValue,
                        }));
                        setPayloadAdvancedDirty(true);
                      }}
                      placeholder={section.placeholder}
                      rows={6}
                    />
                  </div>
                ))}
              </ResponsiveFormGrid>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={savePayloadRules} disabled={savingPayloadRules}>
              {savingPayloadRules ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存 Payload 规则'}
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card data-settings-card="proxy-transport">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>Codex 上游传输与会话并发</CardTitle>
              <CardDescription>
                默认采用 HTTP 优先。只有这里开启后，metapi 才会在 Codex 请求上尝试把上游升级为 WebSocket。下游 Codex 客户端也必须同时启用 `/v1/responses` websocket，单开这里不会生效。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToneBadge tone={runtime.codexUpstreamWebsocketEnabled ? 'primary' : 'muted'}>
                {proxyTransportModeLabel}
              </ToneBadge>
              <ToneBadge tone="muted">
                {proxyTransportQueueLabel}
              </ToneBadge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-4">
            <div className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold">允许 metapi 到 Codex 上游使用 WebSocket</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                仅在下游 Codex 客户端已同步开启 `/v1/responses` websocket 时启用；否则仍按 HTTP 优先执行。
              </span>
            </div>
            <Checkbox
              checked={runtime.codexUpstreamWebsocketEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, codexUpstreamWebsocketEnabled: checked === true }))}
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-4">
            <div className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold">Compact 明确不支持时回退到普通 Responses</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                仅对 `/v1/responses/compact` 生效。当上游明确返回 compact 不支持时，允许自动回退到普通 `/responses`。
              </span>
            </div>
            <Checkbox
              checked={runtime.responsesCompactFallbackToResponsesEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, responsesCompactFallbackToResponsesEnabled: checked === true }))}
            />
          </label>
          <ResponsiveFormGrid columns={2}>
            <SettingsField
              label="会话通道并发上限"
              hint="只作用于能识别稳定 session_id 的会话型请求；普通请求不会进入这组 lease 池。"
            >
              <Input
                type="number"
                min={0}
                value={runtime.proxySessionChannelConcurrencyLimit}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setRuntime((prev) => ({
                    ...prev,
                    proxySessionChannelConcurrencyLimit: Number.isFinite(nextValue) && nextValue >= 0
                      ? Math.trunc(nextValue)
                      : prev.proxySessionChannelConcurrencyLimit,
                  }));
                }}
              />
            </SettingsField>
            <SettingsField
              label="排队等待时间（毫秒）"
              hint="超过该时间仍拿不到会话通道时，本次请求会直接放弃排队，避免长期挂起。"
            >
              <Input
                type="number"
                min={0}
                step={100}
                value={runtime.proxySessionChannelQueueWaitMs}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setRuntime((prev) => ({
                    ...prev,
                    proxySessionChannelQueueWaitMs: Number.isFinite(nextValue) && nextValue >= 0
                      ? Math.trunc(nextValue)
                      : prev.proxySessionChannelQueueWaitMs,
                  }));
                }}
              />
            </SettingsField>
          </ResponsiveFormGrid>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveProxyTransportSettings} disabled={savingProxyTransport}>
              {savingProxyTransport ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存传输与并发'}
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card data-settings-card="model-availability-probe">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>批量测活</CardTitle>
              <CardDescription>
                默认关闭。开启后，metapi 会在后台定时对活跃账号模型发送最小化探测请求，用来校正“/models 能看到但实际不可用”的假阳性。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToneBadge tone={modelAvailabilityProbeStatusTone === "danger" ? "danger" : modelAvailabilityProbeStatusTone === "warning" ? "warning" : "muted"}>
                {modelAvailabilityProbeStatusLabel}
              </ToneBadge>
              <ToneBadge tone="danger">
                高风险操作
              </ToneBadge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
          <div className="grid gap-2 rounded-md border p-4">
            <div className="text-xs font-semibold">风险提示</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              只有在你确认自己使用的中转站明确允许批量测活时才应该开启。若上游不允许，这类探测可能带来封号或风控风险。
            </div>
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-4">
            <div className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold">允许 metapi 后台主动批量测活</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                首次从关闭切换到开启时，需要手动输入确认语句；关闭时可直接保存。
              </span>
            </div>
            <Checkbox
              checked={runtime.modelAvailabilityProbeEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, modelAvailabilityProbeEnabled: checked === true }))}
            />
          </label>
          <ResponsiveFormGrid columns={2}>
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">当前生效状态</div>
              <div className="flex flex-wrap gap-2">
                <ToneBadge tone={modelAvailabilityProbeStatusTone === "danger" ? "danger" : modelAvailabilityProbeStatusTone === "warning" ? "warning" : "muted"}>
                  {modelAvailabilityProbeStatusLabel}
                </ToneBadge>
              </div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                {savedModelAvailabilityProbeEnabled
                  ? '后台会定时执行最小化探测请求，用于校正模型可用性。'
                  : '后台不会主动发起模型可用性探测请求。'}
              </div>
            </div>
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">启用门槛</div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                首次开启必须手动输入确认语句，避免误把高风险探测当成普通开关。
              </div>
            </div>
          </ResponsiveFormGrid>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveModelAvailabilityProbeSettings} disabled={savingModelAvailabilityProbe}>
              {savingModelAvailabilityProbe ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存批量测活设置'}
            </Button>
          </div>
          </CardContent>
        </Card>

        <SettingsCard
          title="下游访问令牌（PROXY_TOKEN）"
          description="用于下游站点或客户端访问本服务代理接口。前缀 sk- 固定不可修改，只需填写后缀。"
        >
          <SettingsCode>
            当前：{runtime.proxyTokenMasked || '未设置'}
          </SettingsCode>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-md border">
              <span className="border-r px-3 py-2 font-mono text-sm text-muted-foreground">
                {PROXY_TOKEN_PREFIX}
              </span>
              <Input
                type="text"
                value={proxyTokenSuffix}
                onChange={(e) => setProxyTokenSuffix(normalizeProxyTokenSuffix(e.target.value))}
                placeholder="请输入 sk- 后的令牌内容"
                className="min-w-0 flex-1 border-0 font-mono shadow-none focus-visible:ring-0"
              />
            </div>
            <Button
              type="button"
             
              aria-label="随机生成访问令牌后缀"
              title="生成高熵随机后缀（不会自动保存）"
             
              onClick={() => {
                const full = generateDownstreamSkKey(PROXY_TOKEN_PREFIX);
                setProxyTokenSuffix(full.slice(PROXY_TOKEN_PREFIX.length));
              }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                />
              </svg>
              随机生成
            </Button>
          </div>
          <Button type="button" onClick={saveProxyToken} disabled={savingToken}>
            {savingToken ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '更新下游访问令牌'}
          </Button>
        </SettingsCard>

        <SettingsCard title="路由策略" description="先选择预设策略，只有需要精调时再展开高级参数。">
          <div className="grid max-w-sm gap-3">
            <SettingsField label="无实测/配置/目录价时默认单价">
            <Input
              type="number"
              min={0.000001}
              step={0.000001}
              value={runtime.routingFallbackUnitCost}
              onChange={(e) => {
                const nextValue = Number(e.target.value);
                setRuntime((prev) => ({
                  ...prev,
                  routingFallbackUnitCost: Number.isFinite(nextValue) && nextValue > 0 ? nextValue : prev.routingFallbackUnitCost,
                }));
              }}
            />
            </SettingsField>
          </div>
          <SettingsField
            label="普通失败冷却上限"
            hint="支持秒、分钟、小时、天。只封顶普通失败与轮询分级冷却；429 限额类冷却仍优先遵循上游 reset 提示，避免过早重试。"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-44 flex-1"
                type="number"
                aria-label="路由失败冷却上限数值"
                min={1}
                step={1}
                value={runtime.routeFailureCooldownMaxValue}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setRuntime((prev) => ({
                    ...prev,
                    routeFailureCooldownMaxValue: Number.isFinite(nextValue) && nextValue > 0
                      ? Math.max(1, Math.trunc(nextValue))
                      : prev.routeFailureCooldownMaxValue,
                    }));
                  }}
              />
              <div className="w-36">
                <ModernSelect
                  size="sm"
                  value={runtime.routeFailureCooldownMaxUnit}
                  onChange={(nextValue) => {
                    setRuntime((prev) => ({
                      ...prev,
                      routeFailureCooldownMaxUnit: nextValue as RouteCooldownUnit,
                    }));
                  }}
                  options={ROUTE_COOLDOWN_UNIT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  placeholder="选择单位"
                />
              </div>
            </div>
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('balanced')}
             
             
            >
              均衡
            </Button>
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('stable')}
             
             
            >
              稳定优先
            </Button>
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('cost')}
             
             
            >
              成本优先
            </Button>
            <Button type="button" variant="outline"
              onClick={() => setShowAdvancedRouting((prev) => !prev)}
             
             
            >
              {showAdvancedRouting ? '收起高级参数' : '展开高级参数'}
            </Button>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-4">
            <Checkbox
              checked={runtime.disableCrossProtocolFallback}
              onCheckedChange={(checked) => setRuntime((prev) => ({
                ...prev,
                disableCrossProtocolFallback: checked === true,
              }))}
            />
            <span className="grid gap-1">
              <span className="text-sm font-semibold">
                失败时不尝试其他协议
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                仅影响 chat / messages / responses 之间的协议切换；不会关闭同协议兼容重试、OAuth 刷新或通道级重试。
              </span>
            </span>
          </label>

          <SettingsField
            label="首字超时（无首包 / 首 token）"
            hint="0 表示关闭。只有在指定时间内完全没有任何首包 / 首 token 返回时才切换，已经开始输出的请求不会被这项超时打断。"
          >
            <Input
              type="number"
              min={0}
              step={1}
              aria-label="首字超时秒数"
              value={runtime.proxyFirstByteTimeoutSec}
              onChange={(e) => {
                const nextValue = Number(e.target.value);
                setRuntime((prev) => ({
                  ...prev,
                  proxyFirstByteTimeoutSec: Number.isFinite(nextValue) && nextValue >= 0
                    ? Math.trunc(nextValue)
                    : prev.proxyFirstByteTimeoutSec,
                }));
              }}
            />
          </SettingsField>

          <div className={`anim-collapse ${showAdvancedRouting ? 'is-open' : ''}`.trim()}>
            <div className="anim-collapse-inner pt-0.5">
              <div className="grid gap-3 md:grid-cols-2">
              {([
                ['baseWeightFactor', '基础权重因子'],
                ['valueScoreFactor', '价值分因子'],
                ['costWeight', '成本权重'],
                ['balanceWeight', '余额权重'],
                ['usageWeight', '使用频次权重'],
              ] as Array<[keyof RoutingWeights, string]>).map(([key, label]) => (
                <SettingsField key={key} label={label}>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={runtime.routingWeights[key]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRuntime((prev) => ({
                        ...prev,
                        routingWeights: {
                          ...prev.routingWeights,
                          [key]: Number.isFinite(v) ? v : 0,
                        },
                      }));
                    }}
                  />
                </SettingsField>
              ))}
              </div>
            </div>
          </div>

          <div>
            <Button type="button" onClick={saveRouting} disabled={savingRouting}>
              {savingRouting ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存路由策略'}
            </Button>
          </div>
        </SettingsCard>

        {/* Global Brand Filter */}
        <SettingsCard title="全局品牌屏蔽" description="屏蔽选定品牌后，路由重建时将自动跳过匹配该品牌的所有模型。点击品牌切换屏蔽状态，保存后自动触发路由重建。">
          <div className="flex flex-wrap gap-2">
            {(allBrandNames || []).map((brand) => {
              const isBlocked = blockedBrands.includes(brand);
              return (
                <Button
                  key={brand}
                  type="button"
                  role="switch"
                  aria-checked={isBlocked}
                  onClick={() => {
                    if (isBlocked) {
                      setBlockedBrands((prev) => prev.filter((b) => b !== brand));
                    } else {
                      setBlockedBrands((prev) => [...prev, brand]);
                    }
                  }}
                  className="h-auto"
                  variant={isBlocked ? 'secondary' : 'outline'}
                  size="sm"
                >
                  {brand}
                </Button>
              );
            })}
            {allBrandNames === null && (
              <span className="text-sm text-muted-foreground">加载品牌列表中...</span>
            )}
            {allBrandNames !== null && allBrandNames.length === 0 && (
              <span className="text-sm text-muted-foreground">暂无可用品牌</span>
            )}
          </div>
          {blockedBrands.length > 0 && (
            <div className="text-sm text-muted-foreground">
              已屏蔽 {blockedBrands.length} 个品牌：{blockedBrands.join('、')}
            </div>
          )}
          <Button type="button" onClick={handleSaveBrandFilter} disabled={savingBrandFilter}>
            {savingBrandFilter ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存品牌屏蔽'}
          </Button>
        </SettingsCard>

        {/* Global Allowed Models Whitelist */}
        <SettingsCard title="全局模型白名单" description="配置白名单后，路由重建和候选生成将只针对白名单中的模型。留空表示允许所有模型（向后兼容）。保存后自动触发路由重建。">
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="输入模型名称，如：gpt-4"
                value={allowedModelsInput}
                onChange={(e) => setAllowedModelsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && allowedModelsInput.trim()) {
                    const model = allowedModelsInput.trim();
                    if (!allowedModels.includes(model)) {
                      setAllowedModels((prev) => [...prev, model]);
                    }
                    setAllowedModelsInput('');
                  }
                }}
                className="flex-1"
              />
              <Button type="button" variant="outline"
                onClick={() => {
                  if (allowedModelsInput.trim()) {
                    const model = allowedModelsInput.trim();
                    if (!allowedModels.includes(model)) {
                      setAllowedModels((prev) => [...prev, model]);
                    }
                    setAllowedModelsInput('');
                  }
                }}
               
               
              >
                添加
              </Button>
            </div>
            {availableModels && availableModels.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">
                  或从当前可用模型中选择：
                </div>
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">
                  {availableModels.map((model) => {
                    const isAllowed = allowedModels.includes(model);
                    return (
                      <Button
                        key={model}
                        type="button"
                        onClick={() => {
                          if (isAllowed) {
                            setAllowedModels((prev) => prev.filter((m) => m !== model));
                          } else {
                            setAllowedModels((prev) => [...prev, model]);
                          }
                        }}
                        className="h-auto"
                        variant={isAllowed ? 'secondary' : 'outline'}
                        size="sm"
                      >
                        {model}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            {allowedModels.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">
                  已选择 {allowedModels.length} 个模型：
                </div>
                <div className="flex flex-wrap gap-2">
                  {allowedModels.map((model) => (
                    <ToneBadge key={model} tone="success">
                      {model}
                      <Button
                        type="button"
                        onClick={() => setAllowedModels((prev) => prev.filter((m) => m !== model))}
                        variant="ghost"
                        size="icon"
                        title="移除"
                      >
                        ×
                      </Button>
                    </ToneBadge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button type="button" onClick={handleSaveAllowedModels} disabled={savingAllowedModels}>
            {savingAllowedModels ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存模型白名单'}
          </Button>
        </SettingsCard>

        <SettingsCard
          title="数据库迁移（SQLite / MySQL / PostgreSQL）"
          description="可先测试连接，再迁移数据；迁移完成后可保存为运行数据库配置（重启容器后生效）。"
        >

          <div className="grid items-center gap-3 md:grid-cols-[180px_1fr]">
            <ModernSelect
              value={migrationDialect}
              onChange={(value) => setMigrationDialect(value as DbDialect)}
              options={[
                { value: 'postgres', label: 'PostgreSQL' },
                { value: 'mysql', label: 'MySQL' },
                { value: 'sqlite', label: 'SQLite' },
              ]}
            />
            <div className="flex justify-end gap-2">
              {migrationDialect !== 'sqlite' && (
                <Button type="button" variant="outline"
                 
                 
                  onClick={() => setConnectionMode((prev) => (prev === 'shorthand' ? 'advanced' : 'shorthand'))}
                >
                  {connectionMode === 'shorthand' ? '高级输入连接串' : '使用半自动简写'}
                </Button>
              )}
            </div>
          </div>

          {migrationDialect === 'sqlite' ? (
            <Input
              className="font-mono"
              value={migrationConnectionString}
              onChange={(e) => setMigrationConnectionString(e.target.value)}
              placeholder="./data/target.db or file:///abs/path.db"
            />
          ) : connectionMode === 'advanced' ? (
            <Input
              className="font-mono"
              value={migrationConnectionString}
              onChange={(e) => setMigrationConnectionString(e.target.value)}
              placeholder={migrationDialect === 'mysql'
                ? 'mysql://user:pass@host:3306/db'
                : 'postgres://user:pass@host:5432/db'}
            />
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={shorthandConnection.host}
                  onChange={(e) => setShorthandConnection((prev) => ({ ...prev, host: e.target.value }))}
                  placeholder="Host (required)"
                />
                <Input
                  value={shorthandConnection.user}
                  onChange={(e) => setShorthandConnection((prev) => ({ ...prev, user: e.target.value }))}
                  placeholder="User (required)"
                />
                <Input
                  value={shorthandConnection.password}
                  onChange={(e) => setShorthandConnection((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Password (required)"
                  type="password"
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline"
                 
                 
                  onClick={() => setShowShorthandOptional((prev) => !prev)}
                >
                  {showShorthandOptional ? '收起端口/库名' : '展开端口/库名'}
                </Button>
              </div>
              {showShorthandOptional && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    value={shorthandConnection.port}
                    onChange={(e) => setShorthandConnection((prev) => ({ ...prev, port: e.target.value }))}
                    placeholder={getDialectDefaults(migrationDialect).port}
                  />
                  <Input
                    value={shorthandConnection.database}
                    onChange={(e) => setShorthandConnection((prev) => ({ ...prev, database: e.target.value }))}
                    placeholder={getDialectDefaults(migrationDialect).database}
                  />
                </div>
              )}
              <SettingsCode>
                {generatedConnectionString || 'Fill host/user/password to generate connection string'}
              </SettingsCode>
            </div>
          )}

          {migrationDialect !== 'sqlite' && (
            <Label className="mb-3 flex items-center gap-2">
              <Checkbox
                checked={migrationSsl}
                onCheckedChange={(checked) => setMigrationSsl(checked === true)}
              />
              启用 SSL/TLS 加密连接
            </Label>
          )}

          <Label className="mb-3 flex items-center gap-2">
              <Checkbox
                checked={migrationOverwrite}
                onCheckedChange={(checked) => setMigrationOverwrite(checked === true)}
              />
            允许覆盖目标数据库现有数据
          </Label>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={handleTestExternalDatabaseConnection}
              disabled={testingMigrationConnection || migratingDatabase || savingRuntimeDatabase}
             
             
            >
              {testingMigrationConnection ? <><LoaderCircle className="size-4 animate-spin" /> 测试中...</> : '测试连接'}
            </Button>
            <Button type="button"
              onClick={handleMigrateToExternalDatabase}
              disabled={migratingDatabase || testingMigrationConnection || savingRuntimeDatabase}
             
            >
              {migratingDatabase ? <><LoaderCircle className="size-4 animate-spin" /> 迁移中...</> : '开始迁移'}
            </Button>
            <Button type="button" variant="outline"
              onClick={handleSaveRuntimeDatabaseConfig}
              disabled={savingRuntimeDatabase || migratingDatabase || testingMigrationConnection}
             
             
            >
              {savingRuntimeDatabase ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存为运行数据库（重启后生效）'}
            </Button>
          </div>

          {runtimeDatabaseState && (
            <div className="grid gap-1 rounded-md border p-3 text-sm text-muted-foreground">
              <div>当前运行：{runtimeDatabaseState.active.dialect}（{runtimeDatabaseState.active.connection || '(empty)' }）{runtimeDatabaseState.active.ssl && ' [SSL]'}</div>
              <div>
                已保存待生效：
                {runtimeDatabaseState.saved
                  ? ` ${runtimeDatabaseState.saved.dialect}（${runtimeDatabaseState.saved.connection}）${runtimeDatabaseState.saved.ssl ? ' [SSL]' : ''}`
                  : ' 未保存'}
              </div>
              {runtimeDatabaseState.restartRequired && (
                <div>检测到待生效数据库配置，请重启容器使其生效。</div>
              )}
            </div>
          )}

          {migrationSummary && (
            <div className="grid gap-1 rounded-md border p-3 text-sm text-muted-foreground">
              <div>目标：{migrationSummary.dialect}（{migrationSummary.connection}）</div>
              <div>版本：{migrationSummary.version}，时间：{new Date(migrationSummary.timestamp).toLocaleString()}</div>
              <div>迁移结果：站点 {migrationSummary.rows.sites} / 账号 {migrationSummary.rows.accounts} / 令牌 {migrationSummary.rows.accountTokens} / 路由 {migrationSummary.rows.tokenRoutes} / 通道 {migrationSummary.rows.routeChannels} / 设置 {migrationSummary.rows.settings}</div>
            </div>
          )}
        </SettingsCard>

        <UpdateCenterSection />

        <SettingsCard title="维护工具">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleClearCache} disabled={clearingCache}>
              {clearingCache ? <><LoaderCircle className="size-4 animate-spin" /> 清理中...</> : '清除缓存并重建路由'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleClearUsage} disabled={clearingUsage}>
              {clearingUsage ? <><LoaderCircle className="size-4 animate-spin" /> 清理中...</> : '清除占用与使用日志'}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard title="危险操作">
          <div className="text-sm text-muted-foreground">
            重新初始化系统会清空当前 metapi 使用中的全部数据库内容；若当前运行在外部 MySQL/Postgres，也会先清空该外部库中的 metapi 数据，然后切回默认 SQLite。
          </div>
          <div className="text-sm text-muted-foreground">
            完成后管理员 Token 会重置为 <code className="font-mono">{FACTORY_RESET_ADMIN_TOKEN}</code>，当前会话会立即退出并刷新页面。
          </div>
          <Button type="button" variant="destructive" onClick={() => setFactoryResetOpen(true)}>
            重新初始化系统
          </Button>
        </SettingsCard>

        <SettingsCard
          title="会话与安全"
          description="登录会话默认 12 小时自动过期。可选配置管理端 IP 白名单，支持每行一个 IP 或 IPv4 CIDR 网段。"
        >
          <SettingsField label="当前识别到的管理端 IP（由服务端判定）">
          <SettingsCode>
            {runtime.currentAdminIp || '未知'}
          </SettingsCode>
          </SettingsField>
          <SettingsField label="管理端 IP 白名单">
          <Textarea
            className="font-mono"
            value={adminIpAllowlistText}
            onChange={(e) => setAdminIpAllowlistText(e.target.value)}
            placeholder={'例如：\n127.0.0.1\n192.168.1.10\n192.168.1.0/24'}
            rows={4}
          />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={saveSecuritySettings} disabled={savingSecurity}>
              {savingSecurity ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存安全设置'}
            </Button>
            <Button type="button" variant="destructive"
              onClick={() => {
                clearAuthSession(localStorage);
                window.location.reload();
              }}
             
            >
              退出登录
            </Button>
          </div>
        </SettingsCard>
      </div>
      <FactoryResetModal
        presence={factoryResetPresence}
        factoryResetting={factoryResetting}
        factoryResetSecondsLeft={factoryResetSecondsLeft}
        adminToken={FACTORY_RESET_ADMIN_TOKEN}
        onClose={closeFactoryResetModal}
        onConfirm={handleFactoryReset}
      />
      <ModelAvailabilityProbeConfirmModal
        presence={modelAvailabilityProbeConfirmPresence}
        confirmText={MODEL_AVAILABILITY_PROBE_CONFIRM_TEXT}
        confirmationInput={modelAvailabilityProbeConfirmationInput}
        saving={savingModelAvailabilityProbe}
        onConfirmationInputChange={setModelAvailabilityProbeConfirmationInput}
        onClose={closeModelAvailabilityProbeConfirmModal}
        onConfirm={handleConfirmModelAvailabilityProbe}
      />
    </div>
  );
}
