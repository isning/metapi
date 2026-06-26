import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import { useIsMobile } from '../components/useIsMobile.js';
import ChangeKeyModal from '../components/ChangeKeyModal.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import ModernSelect from '../components/ModernSelect.js';
import ResponsiveFormGrid from '../components/ResponsiveFormGrid.js';
import FactoryResetModal from './settings/FactoryResetModal.js';
import ModelAvailabilityProbeConfirmModal from './settings/ModelAvailabilityProbeConfirmModal.js';
import UpdateCenterSection from './settings/UpdateCenterSection.js';
import CostPolicySettingsSection from './settings/CostPolicySettingsSection.js';
import {
  SettingsCard,
  SettingsCode,
  SettingsField,
  SettingsQuickLink,
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
} from './settings/SettingsLayout.js';
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
import { Database, KeyRound, LoaderCircle, RotateCcw, ShieldCheck, SlidersHorizontal, Timer, Wrench } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import { cn } from '../lib/utils.js';

const PROXY_TOKEN_PREFIX = 'sk-';
const FACTORY_RESET_ADMIN_TOKEN = 'change-me-admin-token';
const FACTORY_RESET_CONFIRM_SECONDS = 3;
const MODEL_AVAILABILITY_PROBE_CONFIRM_TEXT = tr('pages.settings.batchHealthCheckConfirmationPhrase');
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
const SETTINGS_NAV_SECTION_IDS = ['settings-runtime', 'settings-routing', 'settings-access', 'settings-maintenance'] as const;
type DbDialect = 'sqlite' | 'mysql' | 'postgres';
type RouteCooldownUnit = typeof ROUTE_COOLDOWN_UNIT_OPTIONS[number]['value'];
type SettingsNavSectionId = typeof SETTINGS_NAV_SECTION_IDS[number];
type SettingsPillTone = 'neutral' | 'primary' | 'danger' | 'warning';

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
  proxySessionTargetConcurrencyLimit: number;
  proxySessionTargetQueueWaitMs: number;
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
    siteApiEndpoints?: number;
    apiEndpointProfiles?: number;
    credentialEndpointBindings?: number;
    siteAnnouncements?: number;
    siteDisabledModels?: number;
    accounts: number;
    accountTokens: number;
    tokenRoutes: number;
    routeEndpointTargets: number;
    routeGroupSources?: number;
    checkinLogs?: number;
    modelAvailability?: number;
    tokenModelAvailability?: number;
    proxyLogs?: number;
    proxyVideoTasks?: number;
    proxyFiles?: number;
    downstreamApiKeys?: number;
    events?: number;
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
    proxySessionTargetConcurrencyLimit: 2,
    proxySessionTargetQueueWaitMs: 1500,
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
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsNavSectionId>('settings-runtime');
  const toast = useToast();

  const activeRoutingProfile = useMemo(
    () => resolveRoutingProfilePreset(runtime.routingWeights),
    [runtime.routingWeights],
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

  const proxyTransportModeLabel = runtime.codexUpstreamWebsocketEnabled ? tr('pages.settings.upstreamWebSocketEnabled') : tr('pages.settings.http');
  const proxyTransportQueueLabel = `会话池 ${runtime.proxySessionTargetConcurrencyLimit} 并发 / ${runtime.proxySessionTargetQueueWaitMs}ms`;
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
        proxySessionTargetConcurrencyLimit: Number(runtimeInfo.proxySessionTargetConcurrencyLimit) >= 0
          ? Math.trunc(Number(runtimeInfo.proxySessionTargetConcurrencyLimit))
          : 2,
        proxySessionTargetQueueWaitMs: Number(runtimeInfo.proxySessionTargetQueueWaitMs) >= 0
          ? Math.trunc(Number(runtimeInfo.proxySessionTargetQueueWaitMs))
          : 1500,
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

  useEffect(() => {
    if (loading || typeof IntersectionObserver === 'undefined') return;
    const sections = SETTINGS_NAV_SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    if (!sections.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const nextId = visible?.target.id;
      if (SETTINGS_NAV_SECTION_IDS.includes(nextId as SettingsNavSectionId)) {
        setActiveSettingsSection(nextId as SettingsNavSectionId);
      }
    }, {
      rootMargin: '-18% 0px -65% 0px',
      threshold: [0.1, 0.35, 0.6, 0.85],
    });

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [loading]);

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
      toast.success(tr('pages.settings.systemProxySaved'));
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
      toast.info(tr('pages.settings.batchHealthCheckSettingsUnchanged'));
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
        proxySessionTargetConcurrencyLimit: runtime.proxySessionTargetConcurrencyLimit,
        proxySessionTargetQueueWaitMs: runtime.proxySessionTargetQueueWaitMs,
      });
      setRuntime((prev) => ({
        ...prev,
        codexUpstreamWebsocketEnabled: typeof res?.codexUpstreamWebsocketEnabled === 'boolean'
          ? res.codexUpstreamWebsocketEnabled
          : prev.codexUpstreamWebsocketEnabled,
        responsesCompactFallbackToResponsesEnabled: typeof res?.responsesCompactFallbackToResponsesEnabled === 'boolean'
          ? res.responsesCompactFallbackToResponsesEnabled
          : prev.responsesCompactFallbackToResponsesEnabled,
        proxySessionTargetConcurrencyLimit: Number(res?.proxySessionTargetConcurrencyLimit) >= 0
          ? Math.trunc(Number(res.proxySessionTargetConcurrencyLimit))
          : prev.proxySessionTargetConcurrencyLimit,
        proxySessionTargetQueueWaitMs: Number(res?.proxySessionTargetQueueWaitMs) >= 0
          ? Math.trunc(Number(res.proxySessionTargetQueueWaitMs))
          : prev.proxySessionTargetQueueWaitMs,
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
      const message = tr('pages.settings.systemProxyUrlRequired');
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
      const message = err?.message || tr('pages.settings.systemProxyTestFailed');
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
      toast.success(tr('pages.settings.proxyFailureRulesSaved'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSavingProxyFailureRules(false);
    }
  };

  const saveRouting = async () => {
    setSavingRouting(true);
    try {
      await api.updateRuntimeSettings({
        routingWeights: runtime.routingWeights,
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
      toast.error(err?.message || tr('pages.settings.saveBlockedBrandSettingsFailed'));
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
      toast.error(err?.message || tr('pages.settings.saveModelWhitelistSettingsFailed'));
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
      toast.error(err?.message || tr('pages.settings.systemReinitializationFailed'));
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
      <PageShell>
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </PageShell>
    );
  }

  const settingsNavItems = [
    {
      id: 'settings-runtime' as const,
      href: '#settings-runtime',
      icon: Timer,
      title: tr('pages.settings.runtimeOperations'),
      description: tr('pages.settings.runtimeOperationsDescription'),
    },
    {
      id: 'settings-routing' as const,
      href: '#settings-routing',
      icon: SlidersHorizontal,
      title: tr('pages.settings.routingAndPricing'),
      description: tr('pages.settings.routingAndPricingDescription'),
    },
    {
      id: 'settings-access' as const,
      href: '#settings-access',
      icon: ShieldCheck,
      title: tr('pages.settings.accessAndSecurity'),
      description: tr('pages.settings.accessAndSecurityDescription'),
    },
    {
      id: 'settings-maintenance' as const,
      href: '#settings-maintenance',
      icon: Wrench,
      title: tr('pages.settings.maintenanceAndData'),
      description: tr('pages.settings.maintenanceAndDataDescription'),
    },
  ];
  const settingsStatusItems = [
    {
      icon: <Timer className="size-3.5" />,
      label: tr('pages.settings.sign3'),
      tone: runtime.checkinScheduleMode === 'interval' ? '-info' : '-muted',
      value: runtime.checkinScheduleMode === 'interval' ? tr('pages.settings.sign4') : 'Cron',
    },
    {
      icon: <RotateCcw className="size-3.5" />,
      label: tr('pages.settings.systemProxy'),
      tone: runtime.systemProxyUrl ? '-success' : '-muted',
      value: runtime.systemProxyUrl ? tr('pages.settings.enabled2') : tr('pages.settings.close'),
    },
    {
      icon: <SlidersHorizontal className="size-3.5" />,
      label: tr('pages.settings.batchHealthCheck'),
      tone: runtime.modelAvailabilityProbeEnabled ? '-warning' : '-muted',
      value: runtime.modelAvailabilityProbeEnabled ? tr('pages.settings.enabled2') : tr('pages.settings.close'),
    },
    {
      icon: <Database className="size-3.5" />,
      label: tr('pages.settings.runtimeDatabase'),
      tone: runtimeDatabaseState?.restartRequired ? '-warning' : '-muted',
      value: runtimeDatabaseState?.active?.dialect || 'sqlite',
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title={tr('pages.importExport.systemSettings')}
        description={tr('pages.settings.systemSettingsPageDescription')}
        actions={runtimeDatabaseState?.restartRequired ? (
          <ToneBadge tone={runtimeDatabaseState?.restartRequired ? '-warning' : '-muted'}>
            {tr('pages.settings.restartRequired')}
          </ToneBadge>
        ) : undefined}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {settingsNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <SettingsQuickLink
              key={item.href}
              href={item.href}
              icon={<Icon className="size-4" />}
              title={item.title}
              description={item.description}
            />
          );
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6">
          <SettingsSection
            id="settings-runtime"
            title={tr('pages.settings.runtimeOperations')}
            description={tr('pages.settings.runtimeOperationsDescription')}
          >
        <SettingsCard title={tr('pages.settings.adminSignInToken')}>
          <SettingsCode>
            {maskedToken || '****'}
          </SettingsCode>
          <Button type="button" onClick={() => setShowChangeKey(true)}>{tr('pages.settings.changeSignInToken')}</Button>
          <ChangeKeyModal
            open={showChangeKey}
            onClose={() => {
              setShowChangeKey(false);
              api.getAuthInfo().then((r: any) => setMaskedToken(r.masked || '****')).catch(() => { });
            }}
          />
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.scheduledTasks')}>
          <SettingsSubsection
            title={tr('pages.settings.scheduledCheckin')}
            description={tr('pages.settings.scheduledCheckinDescription')}
          >
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
                {testingCheckin ? tr('pages.checkinLog.triggering') : tr('pages.settings.sign2')}
              </Button>
            </div>
            <SettingsField label={tr('pages.settings.signCron')}>
              <Input
                className="font-mono"
                value={runtime.checkinCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, checkinCron: e.target.value }))}
                disabled={runtime.checkinScheduleMode !== 'cron'}
              />
            </SettingsField>
          </SettingsSubsection>

          <SettingsSubsection
            title={tr('pages.settings.balanceRefreshSchedule')}
            description={tr('pages.settings.balanceRefreshScheduleDescription')}
          >
            <SettingsField label={tr('pages.settings.balanceRefreshCron')}>
              <Input
                className="font-mono"
                value={runtime.balanceRefreshCron}
                onChange={(e) => setRuntime((prev) => ({ ...prev, balanceRefreshCron: e.target.value }))}
              />
            </SettingsField>
          </SettingsSubsection>

          <SettingsSubsection
            title={tr('pages.settings.logCleanupSchedule')}
            description={tr('pages.settings.logCleanupScheduleDescription')}
          >
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
            <div className="grid gap-2 md:grid-cols-2">
              <SettingsToggleRow
                title={tr('pages.settings.usageLogs')}
                checked={runtime.logCleanupUsageLogsEnabled}
                onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, logCleanupUsageLogsEnabled: checked }))}
                className="p-3"
              />
              <SettingsToggleRow
                title={tr('pages.settings.systemLogs')}
                checked={runtime.logCleanupProgramLogsEnabled}
                onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, logCleanupProgramLogsEnabled: checked }))}
                className="p-3"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {tr('pages.settings.defaultDays6ScheduledTasksTimeRetention')}
            </div>
          </SettingsSubsection>
          <div>
            <Button type="button" onClick={saveSchedule} disabled={savingSchedule}>
              {savingSchedule ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveScheduledTasks')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard
          title={tr('pages.settings.systemProxy')}
          description={tr('pages.settings.systemProxyDescription')}
        >
          <Input
            className="font-mono"
            value={runtime.systemProxyUrl}
            onChange={(e) => {
              setRuntime((prev) => ({ ...prev, systemProxyUrl: e.target.value }));
              setSystemProxyTestState(null);
            }}
            placeholder={tr('pages.settings.systemProxyUrlPlaceholder')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveSystemProxy} disabled={savingSystemProxy}>
              {savingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveSystemProxy')}
            </Button>
            <Button type="button" variant="outline"
              onClick={testSystemProxy}
              disabled={testingSystemProxy}
             
             
            >
              {testingSystemProxy ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.testing')}</> : tr('pages.settings.testSystemProxy')}
            </Button>
          </div>
          {systemProxyTestState && (
            <div className={systemProxyTestState.kind === 'success' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>
              {systemProxyTestState.text}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.proxyFailureDetection')} description={tr('pages.settings.failureKeywordRetryDescription')}>
          <Textarea
            className="min-h-24 font-mono"
            value={proxyErrorKeywordsText}
            onChange={(e) => setProxyErrorKeywordsText(e.target.value)}
            placeholder={tr('pages.settings.oneKeywordPerLineCommaSeparated')}
          />
          <SettingsToggleRow
            title={tr('pages.settings.contentCompletion0PromptTokenFailed')}
            checked={runtime.proxyEmptyContentFailEnabled}
            onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, proxyEmptyContentFailEnabled: checked }))}
          />
          <div>
            <Button type="button" onClick={saveProxyFailureRules} disabled={savingProxyFailureRules}>
              {savingProxyFailureRules ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveFailedrules')}
            </Button>
          </div>
        </SettingsCard>
          </SettingsSection>

          <SettingsSection
            id="settings-routing"
            title={tr('pages.settings.routingAndPricing')}
            description={tr('pages.settings.routingAndPricingDescription')}
          >
        <CostPolicySettingsSection />

        <SettingsCard
          dataSettingsCard="proxy-transport"
          title={tr('pages.settings.codex')}
          description={tr('pages.settings.defaultHttpTurnMetapiCodexRequestWebsocket')}
          actions={(
            <>
              <ToneBadge tone={runtime.codexUpstreamWebsocketEnabled ? 'primary' : 'muted'}>
                {proxyTransportModeLabel}
              </ToneBadge>
              <ToneBadge tone="muted">
                {proxyTransportQueueLabel}
              </ToneBadge>
            </>
          )}
        >
          <SettingsToggleRow
            title={tr('pages.settings.metapiCodexUsageWebsocket')}
            description={tr('pages.settings.codexClientSyncturnV1ResponsesWebsocketEnabled')}
            checked={runtime.codexUpstreamWebsocketEnabled}
            onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, codexUpstreamWebsocketEnabled: checked }))}
          />
          <SettingsToggleRow
            title={tr('pages.settings.compactUnsupportedResponses')}
            description={tr('pages.settings.compactUnsupportedFallbackDescription')}
            checked={runtime.responsesCompactFallbackToResponsesEnabled}
            onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, responsesCompactFallbackToResponsesEnabled: checked }))}
          />
          <ResponsiveFormGrid columns={2}>
            <SettingsField
              label={tr('pages.settings.targets')}
              hint={tr('pages.settings.stableSessionIdRequestRequestLease')}
            >
              <Input
                type="number"
                min={0}
                value={runtime.proxySessionTargetConcurrencyLimit}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setRuntime((prev) => ({
                    ...prev,
                    proxySessionTargetConcurrencyLimit: Number.isFinite(nextValue) && nextValue >= 0
                      ? Math.trunc(nextValue)
                      : prev.proxySessionTargetConcurrencyLimit,
                  }));
                }}
              />
            </SettingsField>
            <SettingsField
              label={tr('pages.settings.timeSeconds')}
              hint={tr('pages.settings.timeTargetsRequest')}
            >
              <Input
                type="number"
                min={0}
                step={100}
                value={runtime.proxySessionTargetQueueWaitMs}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setRuntime((prev) => ({
                    ...prev,
                    proxySessionTargetQueueWaitMs: Number.isFinite(nextValue) && nextValue >= 0
                      ? Math.trunc(nextValue)
                      : prev.proxySessionTargetQueueWaitMs,
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
        </SettingsCard>

        <SettingsCard
          dataSettingsCard="model-availability-probe"
          title={tr('pages.settings.batchHealthCheck')}
          description={tr('pages.settings.defaultcloseTurnMetapiAccountModelsendRequestModels')}
          actions={(
            <>
              <ToneBadge tone={modelAvailabilityProbeStatusTone === "danger" ? "danger" : modelAvailabilityProbeStatusTone === "warning" ? "warning" : "muted"}>
                {modelAvailabilityProbeStatusLabel}
              </ToneBadge>
              <ToneBadge tone="danger">
                {tr('pages.settings.highRiskActions')}
              </ToneBadge>
            </>
          )}
        >
          <Alert variant="destructive">
            <AlertTitle>{tr('pages.settings.riskWarning')}</AlertTitle>
            <AlertDescription>
              {tr('pages.settings.batchHealthCheckRiskWarning')}
            </AlertDescription>
          </Alert>
          <SettingsToggleRow
            title={tr('pages.settings.metapiBatchHealthCheck')}
            description={tr('pages.settings.closeTurnManualinputCloseSave')}
            checked={runtime.modelAvailabilityProbeEnabled}
            onCheckedChange={(checked) => setRuntime((prev) => ({ ...prev, modelAvailabilityProbeEnabled: checked }))}
            tone="destructive"
          />
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={saveModelAvailabilityProbeSettings} disabled={savingModelAvailabilityProbe}>
              {savingModelAvailabilityProbe ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveBatchHealthCheckSettings')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.routingStrategy')} description={tr('pages.settings.selectStrategyExpandAdvancedParameters')}>
          <SettingsField
            label={tr('pages.settings.failedcooldown')}
            hint={tr('pages.settings.supportedsecondsMinutesHoursDaysFailedRoundRobin')}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-44 flex-1"
                type="number"
                aria-label={tr('pages.settings.routeFailureCooldownCap')}
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

          <SettingsToggleRow
            title={tr('pages.settings.failedOtherprotocol')}
            description={tr('pages.settings.chatMessagesResponsesProtocolCloseProtocolRetry')}
            checked={runtime.disableCrossProtocolFallback}
            onCheckedChange={(checked) => setRuntime((prev) => ({
              ...prev,
              disableCrossProtocolFallback: checked,
            }))}
          />

          <SettingsField
            label={tr('pages.settings.ttfttimeOutNoneToken')}
            hint={tr('pages.settings.ttftTimeoutDescription')}
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
          </SettingsSection>

          <SettingsSection
            id="settings-access"
            title={tr('pages.settings.accessAndSecurity')}
            description={tr('pages.settings.accessAndSecurityDescription')}
          >
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
              <KeyRound className="size-4" />
              {tr('pages.settings.generateRandomly')}
            </Button>
          </div>
          <Button type="button" onClick={saveProxyToken} disabled={savingToken}>
            {savingToken ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.updateDownstreamAccessToken')}
          </Button>
        </SettingsCard>

        {/* Global Brand Filter */}
        <SettingsCard title={tr('pages.settings.brands2')} description={tr('pages.settings.blockedBrandsDescription')}>
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
              <span className="text-sm text-muted-foreground">{tr('pages.settings.loadingBrands')}</span>
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
            {savingBrandFilter ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveBlockedBrands')}
          </Button>
        </SettingsCard>

        {/* Global Allowed Models Whitelist */}
        <SettingsCard title={tr('pages.settings.model')} description={tr('pages.settings.modelWhitelistDescription')}>
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
                  {tr('pages.settings.availableModelSelectHint')}
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
            {savingAllowedModels ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.settings.saveModelWhitelist')}
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
          </SettingsSection>

          <SettingsSection
            id="settings-maintenance"
            title={tr('pages.settings.maintenanceAndData')}
            description={tr('pages.settings.maintenanceAndDataDescription')}
          >

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

          <div className="grid gap-2 md:grid-cols-2">
            {migrationDialect !== 'sqlite' && (
              <SettingsToggleRow
                title={tr('pages.settings.enableSslTlsEncryptedConnection')}
                checked={migrationSsl}
                onCheckedChange={setMigrationSsl}
                className="p-3"
              />
            )}
            <SettingsToggleRow
              title={tr('pages.settings.allowOverwritingExistingDataTargetDatabase')}
              checked={migrationOverwrite}
              onCheckedChange={setMigrationOverwrite}
              className="p-3"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={handleTestExternalDatabaseConnection}
              disabled={testingMigrationConnection || migratingDatabase || savingRuntimeDatabase}
             
             
            >
              {testingMigrationConnection ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.testing')}</> : tr('pages.settings.testConnection')}
            </Button>
            <Button type="button"
              onClick={handleMigrateToExternalDatabase}
              disabled={migratingDatabase || testingMigrationConnection || savingRuntimeDatabase}
             
            >
              {migratingDatabase ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.migrating')}</> : tr('pages.settings.startMigration')}
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
              <div>{tr('pages.settings.sites')} {migrationSummary.rows.sites} {tr('pages.importExport.accounts')} {migrationSummary.rows.accounts} {tr('pages.importExport.token')} {migrationSummary.rows.accountTokens} {tr('pages.importExport.routes')} {migrationSummary.rows.tokenRoutes} {tr('pages.importExport.targets')} {migrationSummary.rows.routeEndpointTargets} {tr('pages.importExport.settings')} {migrationSummary.rows.settings}</div>
            </div>
          )}
        </SettingsCard>

        <UpdateCenterSection />

        <SettingsCard title={tr('pages.settings.maintenanceTools')}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleClearCache} disabled={clearingCache}>
              {clearingCache ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.clearing')}</> : tr('pages.settings.clearCacheRebuildRoutes')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleClearUsage} disabled={clearingUsage}>
              {clearingUsage ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.settings.clearing')}</> : tr('pages.settings.clearOccupancyUsageLogs')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard title={tr('pages.settings.actions')}>
          <Alert variant="destructive">
            <AlertTitle>{tr('pages.settings.riskWarning')}</AlertTitle>
            <AlertDescription>
              {tr('pages.settings.factoryResetDescription')}
            </AlertDescription>
          </Alert>
          <div className="text-sm text-muted-foreground">
            {tr('pages.settings.adminTokenReset')} <code className="font-mono">{FACTORY_RESET_ADMIN_TOKEN}</code>{tr('pages.settings.refresh')}
          </div>
          <Button type="button" variant="destructive" onClick={() => setFactoryResetOpen(true)}>
            {tr('pages.settings.system')}
          </Button>
        </SettingsCard>

          </SettingsSection>
        </div>

        <aside className="sticky top-[calc(var(--topbar-height)+1rem)] hidden max-h-[calc(100dvh-var(--topbar-height)-2rem)] overflow-y-auto xl:block">
          <div className="pl-1">
            <div className="mb-3 grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{tr('pages.settings.settingsMap')}</div>
                <ToneBadge tone="-muted" className="shrink-0 tabular-nums">
                  {settingsNavItems.length}
                </ToneBadge>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{tr('pages.settings.settingsMapDescription')}</p>
            </div>

            <nav
              className="relative grid gap-1"
              aria-label={tr('pages.settings.settingsMap')}
            >
              {settingsNavItems.map((item) => {
                const active = item.id === activeSettingsSection;
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'location' : undefined}
                    onClick={() => setActiveSettingsSection(item.id)}
                    className={cn(
                      'group grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-2 transition-colors',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-7 place-items-center rounded-md border transition-colors',
                        active
                          ? 'border-primary/40 bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className={cn('truncate text-sm font-medium', active && 'font-semibold')}>
                        {item.title}
                      </span>
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description}</span>
                    </span>
                  </a>
                );
              })}
            </nav>

            <div className="mt-5 border-t pt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{tr('pages.settings.status')}</div>
                {runtimeDatabaseState?.restartRequired ? (
                  <ToneBadge tone="-warning" className="shrink-0">
                    {tr('pages.settings.restartRequired')}
                  </ToneBadge>
                ) : null}
              </div>
              <div className="grid gap-1 text-xs">
                {settingsStatusItems.map((item) => (
                  <div key={item.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5">
                    <span className="grid size-6 place-items-center rounded-md border bg-background text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
                    <ToneBadge tone={item.tone} className="max-w-28 shrink-0 truncate">
                      {item.value}
                    </ToneBadge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
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
    </PageShell>
  );
}
