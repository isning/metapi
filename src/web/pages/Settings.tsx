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
import JsonCodeEditor from '../components/JsonCodeEditor.js';

const PROXY_TOKEN_PREFIX = 'sk-';
const FACTORY_RESET_ADMIN_TOKEN = 'change-me-admin-token';
const FACTORY_RESET_CONFIRM_SECONDS = 3;
const MODEL_AVAILABILITY_PROBE_CONFIRM_TEXT = tr('pages.settings.usageZhAllBatchHealthCheckTurn');
const SECONDS_PER_DAY = 24 * 60 * 60;
const ROUTE_COOLDOWN_UNIT_OPTIONS = [
  { value: 'second', label: tr('pages.settings.seconds'), multiplierSec: 1 },
  { value: 'minute', label: tr('pages.settings.minutes'), multiplierSec: 60 },
  { value: 'hour', label: tr('pages.settings.hours'), multiplierSec: 60 * 60 },
  { value: 'day', label: tr('pages.dashboard.days'), multiplierSec: SECONDS_PER_DAY },
] as const;
const CHECKIN_SCHEDULE_MODE_OPTIONS = [
  { value: 'cron', label: 'Cron' },
  { value: 'interval', label: tr('pages.settings.sign4') },
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
    description: tr('pages.settings.default2'),
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
    description: tr('pages.settings.jsonSchema'),
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
    description: tr('pages.settings.alwaysOverrideFieldEvenIfOriginalRequest'),
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
    description: tr('pages.settings.noneRequestForceOverrideJson'),
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
    description: tr('pages.settings.deletematchrequestzh'),
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
  { value: 'default', label: tr('pages.settings.default') },
  { value: 'default-raw', label: tr('pages.settings.defaultJson') },
  { value: 'override', label: tr('pages.settings.forceOverride') },
  { value: 'override-raw', label: tr('pages.settings.forceOverrideJson') },
  { value: 'filter', label: tr('pages.settings.delete') },
];

const PAYLOAD_RULE_VALUE_MODE_OPTIONS: Array<{ value: VisualPayloadRuleValueMode; label: string }> = [
  { value: 'text', label: tr('pages.settings.text') },
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
        message: `Payload 规则 ${section.title} 不是合法 JSON：${error?.message || tr('pages.settings.failed')}`,
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

  const proxyTransportModeLabel = runtime.codexUpstreamWebsocketEnabled ? tr('pages.settings.websocketEnabled') : tr('pages.settings.http');
  const proxyTransportQueueLabel = `会话池 ${runtime.proxySessionChannelConcurrencyLimit} 并发 / ${runtime.proxySessionChannelQueueWaitMs}ms`;
  const modelAvailabilityProbeDirty = runtime.modelAvailabilityProbeEnabled !== savedModelAvailabilityProbeEnabled;
  const modelAvailabilityProbeStatusTone: SettingsPillTone = modelAvailabilityProbeDirty
    ? 'warning'
    : savedModelAvailabilityProbeEnabled
      ? 'danger'
      : 'neutral';
  const modelAvailabilityProbeStatusLabel = modelAvailabilityProbeDirty
    ? tr('pages.settings.save5')
    : savedModelAvailabilityProbeEnabled
      ? tr('pages.settings.enabled2')
      : tr('pages.settings.close');

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
      toast.error(err?.message || tr('pages.settings.failedLoadSettings'));
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
      toast.success(tr('pages.settings.scheduledTaskSettingsHaveBeenSaved'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSavingSchedule(false);
    }
  };

  const triggerScheduleCheckin = async () => {
    setTestingCheckin(true);
    try {
      await api.triggerCheckinAll();
      toast.success(tr('pages.settings.allSignInsHaveStartedPleaseCheck'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.checkinLog.failedTriggerSign'));
    } finally {
      setTestingCheckin(false);
    }
  };

  const saveProxyToken = async () => {
    const suffix = proxyTokenSuffix.trim();
    if (!suffix) {
      toast.info(tr('pages.settings.enterTokenContentAfterSk'));
      return;
    }
    setSavingToken(true);
    try {
      const res = await api.updateRuntimeSettings({ proxyToken: `${PROXY_TOKEN_PREFIX}${suffix}` });
      setRuntime((prev) => ({ ...prev, proxyTokenMasked: res.proxyTokenMasked || prev.proxyTokenMasked }));
      setProxyTokenSuffix('');
      toast.success('Proxy token updated');
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
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
      toast.success(tr('pages.settings.systemactingSave'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
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
      toast.success(nextEnabled ? tr('pages.settings.batchHealthCheckTurn') : tr('pages.settings.batchHealthCheckClose'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSavingModelAvailabilityProbe(false);
    }
  };

  const saveModelAvailabilityProbeSettings = async () => {
    if (runtime.modelAvailabilityProbeEnabled === savedModelAvailabilityProbeEnabled) {
      toast.info(tr('pages.settings.batchHealthChecksettings'));
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
      toast.success(tr('pages.settings.settingsSave'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSavingProxyTransport(false);
    }
  };

  const testSystemProxy = async () => {
    const proxyUrl = runtime.systemProxyUrl.trim();
    if (!proxyUrl) {
      const message = tr('pages.settings.systemacting');
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
      const message = err?.message || tr('pages.settings.systemactingFailed');
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
      toast.success(tr('pages.settings.actingfailedrulesSave'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
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
      toast.success(tr('pages.settings.payloadRulesSave'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.settings.savePayloadRulesfailed'));
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
    toast.success(tr('pages.settings.codexDefaulthigh2'));
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
    toast.success(tr('pages.settings.advancedJsonSyncRules'));
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
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
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
      toast.success(tr('pages.settings.brandsSettingsSave'));
      try {
        await api.rebuildRoutes(false);
        toast.success(tr('pages.settings.routes'));
      } catch {
        toast.error(tr('pages.settings.brandsSaveRoutesFailedManual'));
      }
    } catch (err: any) {
      toast.error(err?.message || tr('pages.settings.savebrandsSettingsfailed'));
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
      toast.success(tr('pages.settings.modelSettingsSave'));
      try {
        await api.rebuildRoutes(false);
        toast.success(tr('pages.settings.routes'));
      } catch {
        toast.error(tr('pages.settings.modelSaveRoutesFailedManual'));
      }
    } catch (err: any) {
      toast.error(err?.message || tr('pages.settings.savemodelSettingsfailed'));
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
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSavingSecurity(false);
    }
  };


  const handleClearCache = async () => {
    if (!window.confirm(tr('pages.settings.youSureYouWantClearModelCache'))) return;
    setClearingCache(true);
    try {
      const res = await api.clearRuntimeCache();
      toast.success(`缓存已清理（模型缓存 ${res.deletedModelAvailability || 0} 条）`);
    } catch (err: any) {
      toast.error(err?.message || tr('pages.settings.failedClearCache'));
    } finally {
      setClearingCache(false);
    }
  };

  const handleClearUsage = async () => {
    if (!window.confirm(tr('pages.settings.youSureYouWantClearUsageStatistics'))) return;
    setClearingUsage(true);
    try {
      const res = await api.clearUsageData();
      toast.success(`占用统计已清理（日志 ${res.deletedProxyLogs || 0} 条）`);
    } catch (err: any) {
      toast.error(err?.message || tr('pages.settings.failedClearOccupation'));
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
      toast.error(err?.message || tr('pages.settings.systemfailed'));
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
        <h2 className="text-2xl font-semibold tracking-tight">{tr('pages.importExport.systemSettings')}</h2>
      </div>

      <div className="grid max-w-3xl gap-4">
        <SettingsCard title={tr('pages.settings.adminsignIntoken')}>
          <SettingsCode>
            {maskedToken || '****'}
          </SettingsCode>
          <Button type="button" onClick={() => setShowChangeKey(true)}>{tr('pages.settings.signIntoken')}</Button>
          <ChangeKeyModal
            open={showChangeKey}
            onClose={() => {
              setShowChangeKey(false);
              api.getAuthInfo().then((r: any) => setMaskedToken(r.masked || '****')).catch(() => { });
            }}
          />
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.scheduledTasks')}>
          <div className="grid items-end gap-3 md:grid-cols-[180px_180px_auto]">
            <SettingsField label={tr('pages.settings.sign3')}>
              <ModernSelect
                value={runtime.checkinScheduleMode}
                onChange={(value) => setRuntime((prev) => ({
                  ...prev,
                  checkinScheduleMode: value === 'interval' ? 'interval' : 'cron',
                }))}
                options={CHECKIN_SCHEDULE_MODE_OPTIONS.map((item) => ({ ...item }))}
              />
            </SettingsField>
            <SettingsField label={tr('pages.settings.sign')}>
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
              {testingCheckin ? tr('pages.checkinLog.zh') : tr('pages.settings.sign2')}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsField label={tr('pages.settings.signCron')}>
              <Input
                className="font-mono"
                value={runtime.checkinCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, checkinCron: e.target.value }))}
                disabled={runtime.checkinScheduleMode !== 'cron'}
              />
            </SettingsField>
            <SettingsField label={tr('pages.settings.balanceRefreshCron')}>
              <Input
                className="font-mono"
                value={runtime.balanceRefreshCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, balanceRefreshCron: e.target.value }))}
              />
            </SettingsField>
          </div>
          <div className="grid gap-3 border-t pt-4">
            <div className="text-sm font-semibold">{tr('pages.settings.automatic')}</div>
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <SettingsField label={tr('pages.settings.cron')}>
                <Input
                  className="font-mono"
                  value={runtime.logCleanupCron}
                  onChange={(e) => setRuntime((prev) => ({ ...prev, logCleanupCron: e.target.value }))}
                />
              </SettingsField>
              <SettingsField label={tr('pages.settings.retentionDays')}>
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
                {tr('pages.settings.usageLogs')}
              </Label>
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={runtime.logCleanupProgramLogsEnabled}
                  onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, logCleanupProgramLogsEnabled: checked === true }))}
                />
                {tr('pages.settings.systemLogs')}
              </Label>
            </div>
            <div className="text-xs text-muted-foreground">
              {tr('pages.settings.defaultDays6ScheduledTasksTimeRetention')}
            </div>
          </div>
          <div>
            <Button type="button" onClick={saveSchedule} disabled={savingSchedule}>
              {savingSchedule ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveScheduledTasks')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard
          title={tr('pages.settings.systemacting3')}
          description={tr('pages.settings.configurationActingSitesSitesEnabledsystemacting')}
        >
          <Input
            className="font-mono"
            value={runtime.systemProxyUrl}
            onChange={(e) => {
              setRuntime((prev) => ({ ...prev, systemProxyUrl: e.target.value }));
              setSystemProxyTestState(null);
            }}
            placeholder={tr('pages.settings.systemactingUrlHttp127001')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveSystemProxy} disabled={savingSystemProxy}>
              {savingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.savesystemacting')}
            </Button>
            <Button type="button" variant="outline"
              onClick={testSystemProxy}
              disabled={testingSystemProxy}
             
             
            >
              {testingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.zh')}</> : tr('pages.settings.systemacting2')}
            </Button>
          </div>
          {systemProxyTestState && (
            <div className={systemProxyTestState.kind === 'success' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>
              {systemProxyTestState.text}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.actingfailed')} description={tr('pages.settings.zhContentFailedRetry')}>
          <Textarea
            className="min-h-24 font-mono"
            value={proxyErrorKeywordsText}
            onChange={(e) => setProxyErrorKeywordsText(e.target.value)}
            placeholder={tr('pages.settings.oneKeywordPerLineCommaSeparated')}
          />
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={runtime.proxyEmptyContentFailEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, proxyEmptyContentFailEnabled: checked === true }))}
            />
            {tr('pages.settings.contentCompletion0PromptTokenFailed')}
          </Label>
          <div>
            <Button type="button" onClick={saveProxyFailureRules} disabled={savingProxyFailureRules}>
              {savingProxyFailureRules ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveFailedrules')}
            </Button>
          </div>
        </SettingsCard>

        <Card data-settings-card="payload-rules">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>{tr('pages.settings.payloadRules')}</CardTitle>
              <CardDescription>
                {tr('pages.settings.matchmodelRequestDefaultForceOverrideRulesCpa')}
                {' '}
                <code className="font-mono">reasoning.effort</code>
                {' '}
                {tr('pages.settings.similarParameters')}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToneBadge tone={configuredPayloadRuleCount > 0 ? 'primary' : 'muted'}>
                {configuredPayloadRuleCount > 0 ? `已配置 ${configuredPayloadRuleCount} 条` : tr('pages.settings.notConfigured')}
              </ToneBadge>
              <ToneBadge tone={payloadAdvancedDirty ? 'warning' : 'muted'}>
                {payloadAdvancedDirty ? tr('pages.settings.advancedJsonSyncSave') : tr('pages.settings.save3')}
              </ToneBadge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
          <div className="grid gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.commonPresets')}</div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  {tr('pages.settings.ruleseditAdvancedJson')}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={applyCodexDefaultHighReasoningPreset}>
                  {tr('pages.settings.codexDefaulthigh')}
                </Button>
                <Button variant="outline" type="button" onClick={addPayloadVisualRule}>
                  {tr('pages.settings.newRule')}
                </Button>
                <Button variant="outline" type="button" onClick={() => setShowPayloadRulesEditor((prev) => !prev)}>
                  {showPayloadRulesEditor ? tr('pages.settings.collapseadvancedJsonEdit') : tr('pages.settings.expandadvancedJsonEdit')}
                </Button>
              </div>
            </div>
          </div>
          {payloadVisualRules.length <= 0 ? (
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.noVisualRulesYet')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.itemsrulesSelectActionProtocolModelmatchFieldPath')}
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
                    <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.rules')} {index + 1}</div>
                    <Button variant="outline" type="button" onClick={() => removePayloadVisualRule(rule.id)}>
                      {tr('pages.accounts.delete3')}
                    </Button>
                  </div>
                  <ResponsiveFormGrid columns={2}>
                    <SettingsField label={tr('pages.settings.action')}>
                      <ModernSelect
                        size="sm"
                        data-testid={`payload-rule-action-${index + 1}`}
                        value={rule.action}
                        onChange={(value) => updatePayloadVisualRule(rule.id, { action: value as PayloadRuleAction })}
                        options={PAYLOAD_RULE_ACTION_OPTIONS}
                        placeholder={tr('pages.settings.selectAction')}
                      />
                    </SettingsField>
                    <SettingsField label={tr('pages.settings.protocol')}>
                      <ModernSelect
                        size="sm"
                        data-testid={`payload-rule-protocol-${index + 1}`}
                        value={rule.protocol}
                        onChange={(value) => updatePayloadVisualRule(rule.id, { protocol: String(value || '') })}
                        options={PAYLOAD_RULE_PROTOCOL_OPTIONS}
                        placeholder={tr('pages.settings.allprotocol')}
                      />
                    </SettingsField>
                    <SettingsField label={tr('pages.settings.modelmatch')}>
                      <Input
                        type="text"
                        aria-label={`Payload 规则可视化模型 ${index + 1}`}
                        value={rule.modelPattern}
                        onChange={(e) => updatePayloadVisualRule(rule.id, { modelPattern: e.target.value })}
                        placeholder={tr('pages.settings.gpt')}
                      />
                    </SettingsField>
                    <SettingsField label={tr('pages.settings.fieldPath')}>
                      <Input
                        className="font-mono"
                        type="text"
                        aria-label={`Payload 规则可视化路径 ${index + 1}`}
                        value={rule.path}
                        onChange={(e) => updatePayloadVisualRule(rule.id, { path: e.target.value })}
                        placeholder={tr('pages.settings.reasoningEffort')}
                      />
                    </SettingsField>
                  </ResponsiveFormGrid>
                  {rule.action === 'filter' ? (
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {tr('pages.settings.deleteRulesZhRequestzhremoveItems')}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {(rule.action === 'default' || rule.action === 'override') && (
                        <div className="w-full md:w-44">
                          <Label>{tr('pages.settings.type')}</Label>
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
                            placeholder={tr('pages.settings.type')}
                          />
                        </div>
                      )}
                      <SettingsField
                        label={
                          rule.action === 'default-raw' || rule.action === 'override-raw'
                            ? tr('pages.settings.json2')
                            : (rule.valueMode === 'json' ? tr('pages.settings.json') : tr('pages.settings.textValue'))
                        }
                      >
                        {(rule.action === 'default-raw' || rule.action === 'override-raw' || rule.valueMode === 'json') ? (
                          <JsonCodeEditor
                            aria-label={`Payload 规则可视化值 ${index + 1}`}
                            value={rule.value}
                            onChange={(value) => updatePayloadVisualRule(rule.id, { value })}
                            placeholder={rule.action === 'default-raw' || rule.action === 'override-raw'
                              ? '{"type":"json_schema"}'
                              : '{"effort":"high"}'}
                            minHeight={160}
                            maxHeight={320}
                          />
                        ) : (
                          <Input
                            type="text"
                            aria-label={`Payload 规则可视化值 ${index + 1}`}
                            value={rule.value}
                            onChange={(e) => updatePayloadVisualRule(rule.id, { value: e.target.value })}
                            placeholder={tr('pages.settings.high')}
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
                    <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.advancedJsonEdit')}</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {tr('pages.settings.cpaRulesManualSyncRulesLowEdit')}
                    </div>
                  </div>
                  <Button variant="outline" type="button" onClick={syncVisualRulesFromAdvancedJson}>
                    {tr('pages.settings.syncRules')}
                  </Button>
                </div>
              </div>
              <ResponsiveFormGrid columns={2}>
                {PAYLOAD_RULES_EDITOR_SECTIONS.map((section) => (
                  <div key={section.key} className="grid gap-3 rounded-md border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">{section.title}</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">{section.description}</div>
                    <JsonCodeEditor
                      aria-label={`Payload 规则 ${section.key}`}
                      value={payloadRuleDrafts[section.key]}
                      onChange={(nextValue) => {
                        setPayloadRuleDrafts((prev) => ({
                          ...prev,
                          [section.key]: nextValue,
                        }));
                        setPayloadAdvancedDirty(true);
                      }}
                      placeholder={section.placeholder}
                      minHeight={240}
                      maxHeight={520}
                    />
                  </div>
                ))}
              </ResponsiveFormGrid>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={savePayloadRules} disabled={savingPayloadRules}>
              {savingPayloadRules ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.savePayloadRules')}
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card data-settings-card="proxy-transport">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>{tr('pages.settings.codex')}</CardTitle>
              <CardDescription>
                {tr('pages.settings.defaultHttpTurnMetapiCodexRequestWebsocket')}
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
              <span className="text-sm font-semibold">{tr('pages.settings.metapiCodexUsageWebsocket')}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.codexClientSyncturnV1ResponsesWebsocketEnabled')}
              </span>
            </div>
            <Checkbox
              checked={runtime.codexUpstreamWebsocketEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, codexUpstreamWebsocketEnabled: checked === true }))}
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-4">
            <div className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold">{tr('pages.settings.compactUnsupportedResponses')}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.v1ResponsesCompactCompactUnsupportedAutomaticResponses')}
              </span>
            </div>
            <Checkbox
              checked={runtime.responsesCompactFallbackToResponsesEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, responsesCompactFallbackToResponsesEnabled: checked === true }))}
            />
          </label>
          <ResponsiveFormGrid columns={2}>
            <SettingsField
              label={tr('pages.settings.channels')}
              hint={tr('pages.settings.stableSessionIdRequestRequestLease')}
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
              label={tr('pages.settings.timeSeconds')}
              hint={tr('pages.settings.timeChannelsRequest')}
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
              {savingProxyTransport ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.save')}
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card data-settings-card="model-availability-probe">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <CardTitle>{tr('pages.settings.batchHealthCheck')}</CardTitle>
              <CardDescription>
                {tr('pages.settings.defaultcloseTurnMetapiAccountModelsendRequestModels')}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToneBadge tone={modelAvailabilityProbeStatusTone === "danger" ? "danger" : modelAvailabilityProbeStatusTone === "warning" ? "warning" : "muted"}>
                {modelAvailabilityProbeStatusLabel}
              </ToneBadge>
              <ToneBadge tone="danger">
                {tr('pages.settings.highriskactions')}
              </ToneBadge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
          <div className="grid gap-2 rounded-md border p-4">
            <div className="text-xs font-semibold">{tr('pages.settings.risktip')}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {tr('pages.settings.usageZhBatchHealthCheckTurnRisk')}
            </div>
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-4">
            <div className="grid min-w-0 gap-1">
              <span className="text-sm font-semibold">{tr('pages.settings.metapiBatchHealthCheck')}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.closeTurnManualinputCloseSave')}
              </span>
            </div>
            <Checkbox
              checked={runtime.modelAvailabilityProbeEnabled}
              onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, modelAvailabilityProbeEnabled: checked === true }))}
            />
          </label>
          <ResponsiveFormGrid columns={2}>
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.status')}</div>
              <div className="flex flex-wrap gap-2">
                <ToneBadge tone={modelAvailabilityProbeStatusTone === "danger" ? "danger" : modelAvailabilityProbeStatusTone === "warning" ? "warning" : "muted"}>
                  {modelAvailabilityProbeStatusLabel}
                </ToneBadge>
              </div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                {savedModelAvailabilityProbeEnabled
                  ? tr('pages.settings.requestModelavailable')
                  : tr('pages.settings.modelavailableRequest')}
              </div>
            </div>
            <div className="grid gap-3 rounded-md border p-4">
              <div className="text-xs font-semibold text-muted-foreground">{tr('pages.settings.enabled')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.turnManualinputHighrisk')}
              </div>
            </div>
          </ResponsiveFormGrid>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveModelAvailabilityProbeSettings} disabled={savingModelAvailabilityProbe}>
              {savingModelAvailabilityProbe ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.savebatchHealthChecksettings')}
            </Button>
          </div>
          </CardContent>
        </Card>

        <SettingsCard
          title={tr('pages.settings.downstreamAccessTokenProxyToken')}
          description={tr('pages.settings.usedDownstreamSitesClientsAccessServiceProxy')}
        >
          <SettingsCode>
            {tr('pages.settings.current')}{runtime.proxyTokenMasked || tr('pages.notificationSettings.notSet')}
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
                placeholder={tr('pages.settings.enterTokenContentAfterSk')}
                className="min-w-0 flex-1 border-0 font-mono shadow-none focus-visible:ring-0"
              />
            </div>
            <Button
              type="button"
             
              aria-label={tr('pages.settings.generateRandomlyaccessToken')}
              title={tr('pages.settings.highRandomAutomaticsave')}
             
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
              {tr('pages.settings.generateRandomly')}
            </Button>
          </div>
          <Button type="button" onClick={saveProxyToken} disabled={savingToken}>
            {savingToken ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.updateDownstreamAccessToken')}
          </Button>
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.routesstrategy')} description={tr('pages.settings.selectStrategyExpandAdvancedParameters')}>
          <div className="grid max-w-sm gap-3">
            <SettingsField label={tr('pages.settings.noneactualMeasurementConfigurationTableContentsDefault')}>
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
            label={tr('pages.settings.failedcooldown')}
            hint={tr('pages.settings.supportedsecondsMinutesHoursDaysFailedRoundRobin')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-44 flex-1"
                type="number"
                aria-label={tr('pages.settings.routesfailedcooldown')}
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
                  placeholder={tr('pages.settings.selectUnit')}
                />
              </div>
            </div>
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('balanced')}
             
             
            >
              {tr('pages.settings.balanced')}
            </Button>
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('stable')}
             
             
            >
              {tr('pages.settings.stableFirst')}
            </Button>
            <Button type="button" variant="outline"
              onClick={() => applyRoutingPreset('cost')}
             
             
            >
              {tr('pages.settings.cost')}
            </Button>
            <Button type="button" variant="outline"
              onClick={() => setShowAdvancedRouting((prev) => !prev)}
             
             
            >
              {showAdvancedRouting ? tr('pages.settings.closeAdvancedParameters') : tr('pages.settings.expandAdvancedParameters')}
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
                {tr('pages.settings.failedOtherprotocol')}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {tr('pages.settings.chatMessagesResponsesProtocolCloseProtocolRetry')}
              </span>
            </span>
          </label>

          <SettingsField
            label={tr('pages.settings.ttfttimeOutNoneToken')}
            hint={tr('pages.settings.0CloseTimeTokenStartoutputRequestTime')}
          >
            <Input
              type="number"
              min={0}
              step={1}
              aria-label={tr('pages.settings.ttfttimeOutseconds')}
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
                ['baseWeightFactor', tr('pages.settings.basicWeightFactor')],
                ['valueScoreFactor', tr('pages.settings.valueFactor')],
                ['costWeight', tr('pages.settings.costWeight')],
                ['balanceWeight', tr('pages.settings.balanceWeight')],
                ['usageWeight', tr('pages.settings.useFrequencyWeight')],
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
              {savingRouting ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveRoutingPolicy')}
            </Button>
          </div>
        </SettingsCard>

        {/* Global Brand Filter */}
        <SettingsCard title={tr('pages.settings.brands2')} description={tr('pages.settings.brandsRoutesAutomaticjumpOvermatchBrandModelsBrands')}>
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
              <span className="text-sm text-muted-foreground">{tr('pages.settings.brandsZh')}</span>
            )}
            {allBrandNames !== null && allBrandNames.length === 0 && (
              <span className="text-sm text-muted-foreground">{tr('pages.settings.noneavailablebrands')}</span>
            )}
          </div>
          {blockedBrands.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {tr('pages.settings.blocked')} {blockedBrands.length} {tr('pages.settings.brands')}{blockedBrands.join('、')}
            </div>
          )}
          <Button type="button" onClick={handleSaveBrandFilter} disabled={savingBrandFilter}>
            {savingBrandFilter ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.savebrands')}
          </Button>
        </SettingsCard>

        {/* Global Allowed Models Whitelist */}
        <SettingsCard title={tr('pages.settings.model')} description={tr('pages.settings.configurationRoutesZhmodelsModelSaveAutomaticRoutes')}>
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder={tr('pages.settings.inputmodelNameGpt4')}
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
                {tr('pages.oAuthManagement.add')}
              </Button>
            </div>
            {availableModels && availableModels.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs text-muted-foreground">
                  {tr('pages.settings.availablemodelzhselect')}
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
                  {tr('pages.oAuthManagement.selected')} {allowedModels.length} {tr('pages.settings.models')}
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
                        title={tr('pages.settings.remove')}
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
            {savingAllowedModels ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.savemodel')}
          </Button>
        </SettingsCard>

        <SettingsCard
          title={tr('pages.settings.sqliteMysqlPostgresql')}
          description={tr('pages.settings.testConnectionSaveConfiguration')}
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
                  {connectionMode === 'shorthand' ? tr('pages.settings.advancedInputConnectionString') : tr('pages.settings.usageAutomatic')}
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
                  {showShorthandOptional ? tr('pages.settings.collapseport') : tr('pages.settings.expandport')}
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
              {tr('pages.settings.enableSslTlsEncryptedConnection')}
            </Label>
          )}

          <Label className="mb-3 flex items-center gap-2">
              <Checkbox
                checked={migrationOverwrite}
                onCheckedChange={(checked) => setMigrationOverwrite(checked === true)}
              />
            {tr('pages.settings.allowOverwritingExistingDataTargetDatabase')}
          </Label>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={handleTestExternalDatabaseConnection}
              disabled={testingMigrationConnection || migratingDatabase || savingRuntimeDatabase}
             
             
            >
              {testingMigrationConnection ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.zh')}</> : tr('pages.settings.testConnection')}
            </Button>
            <Button type="button"
              onClick={handleMigrateToExternalDatabase}
              disabled={migratingDatabase || testingMigrationConnection || savingRuntimeDatabase}
             
            >
              {migratingDatabase ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.zh2')}</> : tr('pages.settings.startMigration')}
            </Button>
            <Button type="button" variant="outline"
              onClick={handleSaveRuntimeDatabaseConfig}
              disabled={savingRuntimeDatabase || migratingDatabase || testingMigrationConnection}
             
             
            >
              {savingRuntimeDatabase ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.save6')}
            </Button>
          </div>

          {runtimeDatabaseState && (
            <div className="grid gap-1 rounded-md border p-3 text-sm text-muted-foreground">
              <div>{tr('pages.settings.currentlyRunning')}{runtimeDatabaseState.active.dialect}（{runtimeDatabaseState.active.connection || '(empty)' }）{runtimeDatabaseState.active.ssl && ' [SSL]'}</div>
              <div>
                {tr('pages.settings.save2')}
                {runtimeDatabaseState.saved
                  ? ` ${runtimeDatabaseState.saved.dialect}（${runtimeDatabaseState.saved.connection}）${runtimeDatabaseState.saved.ssl ? ' [SSL]' : ''}`
                  : tr('pages.settings.save4')}
              </div>
              {runtimeDatabaseState.restartRequired && (
                <div>{tr('pages.settings.configuration')}</div>
              )}
            </div>
          )}

          {migrationSummary && (
            <div className="grid gap-1 rounded-md border p-3 text-sm text-muted-foreground">
              <div>{tr('pages.settings.target')}{migrationSummary.dialect}（{migrationSummary.connection}）</div>
              <div>{tr('pages.importExport.version')}{migrationSummary.version}{tr('pages.importExport.time')}{new Date(migrationSummary.timestamp).toLocaleString()}</div>
              <div>{tr('pages.settings.sites')} {migrationSummary.rows.sites} {tr('pages.importExport.accounts')} {migrationSummary.rows.accounts} {tr('pages.importExport.token')} {migrationSummary.rows.accountTokens} {tr('pages.importExport.routes')} {migrationSummary.rows.tokenRoutes} {tr('pages.importExport.channels')} {migrationSummary.rows.routeChannels} {tr('pages.importExport.settings')} {migrationSummary.rows.settings}</div>
            </div>
          )}
        </SettingsCard>

        <UpdateCenterSection />

        <SettingsCard title={tr('pages.settings.maintenanceTools')}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleClearCache} disabled={clearingCache}>
              {clearingCache ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.zh3')}</> : tr('pages.settings.clearCacheRebuildRoutes')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleClearUsage} disabled={clearingUsage}>
              {clearingUsage ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.zh3')}</> : tr('pages.settings.clearOccupancyUsageLogs')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.actions')}>
          <div className="text-sm text-muted-foreground">
            {tr('pages.settings.systemClearMetapiUsagezhAllContentCurrently')}
          </div>
          <div className="text-sm text-muted-foreground">
            {tr('pages.settings.adminTokenReset')} <code className="font-mono">{FACTORY_RESET_ADMIN_TOKEN}</code>{tr('pages.settings.refresh')}
          </div>
          <Button type="button" variant="destructive" onClick={() => setFactoryResetOpen(true)}>
            {tr('pages.settings.system')}
          </Button>
        </SettingsCard>

        <SettingsCard
          title={tr('pages.settings.sessionSecurity')}
          description={tr('pages.settings.signDefault12HoursautomaticexpiredConfigurationmanagementIpWhitelist')}
        >
          <SettingsField label={tr('pages.settings.ip')}>
          <SettingsCode>
            {runtime.currentAdminIp || tr('pages.accounts.unknown2')}
          </SettingsCode>
          </SettingsField>
          <SettingsField label={tr('pages.settings.managementIpWhitelist')}>
          <Textarea
            className="font-mono"
            value={adminIpAllowlistText}
            onChange={(e) => setAdminIpAllowlistText(e.target.value)}
            placeholder={tr('pages.settings.cidrIp1921681024')}
            rows={4}
          />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={saveSecuritySettings} disabled={savingSecurity}>
              {savingSecurity ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveSecuritySettings')}
            </Button>
            <Button type="button" variant="destructive"
              onClick={() => {
                clearAuthSession(localStorage);
                window.location.reload();
              }}
             
            >
              {tr('app.signOut')}
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
