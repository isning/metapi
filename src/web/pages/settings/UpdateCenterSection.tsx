import React, { useEffect, useRef, useState } from 'react';

import { api } from '../../api.js';
import ModernSelect from '../../components/ModernSelect.js';
import { useToast } from '../../components/Toast.js';
import { useIsMobile } from '../../components/useIsMobile.js';
import {
  buildUpdateReminder,
  describeDockerDeployState,
  describeGitHubDeployState,
} from '../helpers/updateCenterPresentation.js';
import UpdateCenterHistoryModal from './UpdateCenterHistoryModal.js';
import UpdateCenterHistoryEntryCard from './UpdateCenterHistoryEntryCard.js';
import { Button } from '../../components/ui/button/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import { Input } from '../../components/ui/input/index.js';
import { cn } from '../../lib/utils.js';
import { SettingsCard, SettingsToggleRow } from './SettingsLayout.js';

import { tr } from '../../i18n.js';
type UpdateCenterStatus = {
  currentVersion?: string;
  config?: {
    enabled: boolean;
    helperBaseUrl: string;
    namespace: string;
    releaseName: string;
    chartRef: string;
    imageRepository: string;
    githubReleasesEnabled: boolean;
    dockerHubTagsEnabled: boolean;
    defaultDeploySource: 'github-release' | 'docker-hub-tag';
  };
  githubRelease?: {
    normalizedVersion?: string;
    displayVersion?: string;
    tagName?: string;
    digest?: string | null;
    publishedAt?: string | null;
  } | null;
  dockerHubTag?: {
    normalizedVersion?: string;
    displayVersion?: string;
    tagName?: string;
    digest?: string | null;
    publishedAt?: string | null;
  } | null;
  dockerHubRecentTags?: Array<{
    normalizedVersion?: string;
    displayVersion?: string;
    tagName?: string;
    digest?: string | null;
    publishedAt?: string | null;
  }> | null;
  helper?: {
    ok?: boolean;
    healthy?: boolean;
    error?: string | null;
    revision?: string | null;
    imageTag?: string | null;
    imageDigest?: string | null;
    history?: Array<{
      revision?: string;
      updatedAt?: string | null;
      status?: string | null;
      description?: string | null;
      imageRepository?: string | null;
      imageTag?: string | null;
      imageDigest?: string | null;
    }>;
  } | null;
  runningTask?: {
    id?: string;
    status?: string;
  } | null;
  lastFinishedTask?: {
    id?: string;
    status?: string;
    finishedAt?: string | null;
  } | null;
  runtime?: {
    lastCheckedAt?: string | null;
    lastCheckError?: string | null;
    lastResolvedSource?: 'github-release' | 'docker-hub-tag' | null;
    lastResolvedDisplayVersion?: string | null;
    lastResolvedCandidateKey?: string | null;
    lastNotifiedCandidateKey?: string | null;
    lastNotifiedAt?: string | null;
  } | null;
};

const DEFAULT_CONFIG: NonNullable<UpdateCenterStatus['config']> = {
  enabled: false,
  helperBaseUrl: '',
  namespace: 'default',
  releaseName: '',
  chartRef: '',
  imageRepository: '1467078763/metapi',
  githubReleasesEnabled: true,
  dockerHubTagsEnabled: true,
  defaultDeploySource: 'github-release',
};

const DEPLOY_SOURCE_OPTIONS = [
  {
    value: 'github-release',
    label: 'GitHub Releases',
    description: tr('pages.settings.updateCenterSection.stableRelease'),
  },
  {
    value: 'docker-hub-tag',
    label: 'Docker Hub Tags',
    description: tr('pages.settings.updateCenterSection.suitableDeployingDirectlyFollowingImageTag'),
  },
] as const;

const sectionPanelClassName = 'rounded-lg border bg-muted p-3.5';
const summaryLabelClassName = 'mb-1.5 text-xs text-muted-foreground';
const summaryValueClassName = 'text-sm font-semibold leading-snug text-foreground';
const fieldLabelClassName = 'mb-1.5 text-xs text-muted-foreground';
const fieldHintClassName = 'text-xs leading-normal text-muted-foreground';

function formatTaskTime(value?: string | null) {
  if (!value) return tr('pages.settings.updateCenterSection.noCompletedRecords');
  const normalizedValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const timestamp = Date.parse(normalizedValue);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTaskBadge(status?: string | null) {
  switch (status) {
    case 'running':
      return { tone: 'info', label: tr('pages.programLogs.progress') };
    case 'pending':
      return { tone: 'warning', label: tr('pages.settings.updateCenterSection.queued') };
    case 'succeeded':
      return { tone: 'success', label: tr('pages.programLogs.completed') };
    case 'failed':
      return { tone: 'error', label: tr('pages.checkinLog.failed') };
    default:
      return { tone: 'muted', label: tr('pages.settings.updateCenterSection.idle') };
  }
}

function getHelperBadge(helper?: UpdateCenterStatus['helper'] | null, helperBaseUrl?: string) {
  if (!helperBaseUrl) {
    return { tone: 'muted', label: tr('pages.settings.notConfigured') };
  }
  if (helper?.healthy) {
    return { tone: 'success', label: 'Healthy' };
  }
  if (helper?.ok) {
    return { tone: 'warning', label: tr('pages.settings.updateCenterSection.ready') };
  }
  return { tone: 'error', label: tr('pages.settings.updateCenterSection.notAvailable') };
}

function getSourceBadge(enabled: boolean, version?: string) {
  if (!enabled) {
    return { tone: 'muted', label: tr('pages.helpers.updateCenterPresentation.stopped') };
  }
  if (version) {
    return { tone: 'success', label: tr('pages.helpers.updateCenterPresentation.deployable') };
  }
  return { tone: 'warning', label: tr('pages.helpers.updateCenterPresentation.noVersionFound') };
}

function formatShortDigest(digest?: string | null) {
  const value = String(digest || '').trim();
  if (!value) return '';
  return value.slice(0, 'sha256:'.length + 12);
}

function formatImageTarget(tag?: string | null, digest?: string | null) {
  const normalizedTag = String(tag || '').trim();
  const shortDigest = formatShortDigest(digest);
  if (normalizedTag && shortDigest) {
    return `${normalizedTag} @ ${shortDigest}`;
  }
  if (normalizedTag) return normalizedTag;
  if (shortDigest) return shortDigest;
  return '';
}

type RecentDockerCandidate = NonNullable<NonNullable<UpdateCenterStatus['dockerHubRecentTags']>[number]>;

function normalizeRecentDockerCandidates(
  input?: UpdateCenterStatus['dockerHubRecentTags'] | null,
): Array<RecentDockerCandidate & { tagName: string }> {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (entry): entry is RecentDockerCandidate & { tagName: string } => !!String(entry?.tagName || '').trim(),
  );
}

export default function UpdateCenterSection() {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [status, setStatus] = useState<UpdateCenterStatus | null>(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [manualDockerTarget, setManualDockerTarget] = useState({
    tag: '',
    digest: '',
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [taskStatus, setTaskStatus] = useState('');
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  const applyStatus = (next: UpdateCenterStatus) => {
    setStatus(next);
    setConfig(next.config || DEFAULT_CONFIG);
  };

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await api.getUpdateCenterStatus() as UpdateCenterStatus;
      applyStatus(next);
    } catch (error: any) {
      toast.error(error?.message || tr('pages.settings.updateCenterSection.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async (showErrorToast = true) => {
    try {
      const next = await api.checkUpdateCenter() as UpdateCenterStatus;
      applyStatus(next);
      return next;
    } catch (error: any) {
      if (showErrorToast) {
        toast.error(error?.message || tr('pages.settings.updateCenterSection.checkupdateFailed'));
      }
      throw error;
    }
  };

  useEffect(() => {
    void loadStatus();
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const result = await api.saveUpdateCenterConfig(config) as { config?: UpdateCenterStatus['config'] };
      const nextConfig = result.config || config;
      setConfig(nextConfig);
      setStatus((prev) => ({
        ...(prev || {}),
        config: nextConfig,
      }));
      toast.success(tr('pages.settings.updateCenterSection.configurationSaved'));
    } catch (error: any) {
      toast.error(error?.message || tr('pages.settings.updateCenterSection.saveConfigurationFailed'));
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      await refreshStatus(true);
      toast.success(tr('pages.settings.updateCenterSection.refreshInfo'));
    } catch {
      // refreshStatus already handled the toast
    } finally {
      setChecking(false);
    }
  };

  const streamTaskLogs = async (taskId: string) => {
    await api.streamUpdateCenterTaskLogs(taskId, {
      signal: streamAbortRef.current?.signal,
      onLog: (entry) => {
        const message = String(entry?.message || '').trim();
        if (!message) return;
        setLogs((prev) => [...prev, message].slice(-200));
      },
      onDone: (payload) => {
        setTaskStatus(String(payload?.status || 'unknown'));
      },
    });
  };

  const hydrateTaskSnapshot = async (taskId: string) => {
    const taskResponse = await api.getTask(taskId) as { task?: { status?: string; logs?: Array<{ message?: string }> } };
    const task = taskResponse.task;
    if (!task) return false;
    setTaskStatus(String(task.status || 'unknown'));
    setLogs(Array.isArray(task.logs) ? task.logs.map((entry) => String(entry?.message || '')).filter(Boolean) : []);
    toast.info(tr('pages.settings.updateCenterSection.liveLogStreamDisconnectedFallingBackTask'));
    return true;
  };

  const runDeploy = async (
    source: 'github-release' | 'docker-hub-tag',
    target: { tag?: string | null; digest?: string | null },
  ) => {
    const targetTag = String(target.tag || '').trim();
    if (!targetTag) return;
    setDeploying(true);
    setLogs([]);
    setTaskStatus('running');
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();
    let taskId = '';

    try {
      const response = await api.deployUpdateCenter({
        source,
        targetTag,
        targetDigest: target.digest || null,
      }) as { task?: { id: string } };
      taskId = response.task?.id || '';
      if (!taskId) {
        throw new Error(tr('pages.settings.updateCenterSection.missingDeployTaskId'));
      }

      await streamTaskLogs(taskId);
    } catch (error: any) {
      if (taskId) {
        try {
          if (await hydrateTaskSnapshot(taskId)) {
            return;
          }
        } catch {
          // fall through to the generic error state
        }
      }
      setTaskStatus('failed');
      toast.error(error?.message || tr('pages.settings.updateCenterSection.deployfailed'));
    } finally {
      setDeploying(false);
      void refreshStatus(false).catch(() => {});
    }
  };

  const runRollback = async (targetRevision: string) => {
    if (!targetRevision) return;
    setDeploying(true);
    setLogs([]);
    setTaskStatus('running');
    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();
    let taskId = '';

    try {
      const response = await api.rollbackUpdateCenter({ targetRevision }) as { task?: { id: string } };
      taskId = response.task?.id || '';
      if (!taskId) {
        throw new Error(tr('pages.settings.updateCenterSection.missingRollbackTaskId'));
      }

      await streamTaskLogs(taskId);
    } catch (error: any) {
      if (taskId) {
        try {
          if (await hydrateTaskSnapshot(taskId)) {
            return;
          }
        } catch {
          // fall through to the generic error state
        }
      }
      setTaskStatus('failed');
      toast.error(error?.message || tr('pages.settings.updateCenterSection.failed'));
    } finally {
      setDeploying(false);
      void refreshStatus(false).catch(() => {});
    }
  };

  const helperHealthy = !!status?.helper?.healthy;
  const helperBadge = getHelperBadge(status?.helper, config.helperBaseUrl);
  const runningTaskBadge = getTaskBadge(status?.runningTask?.status || taskStatus || undefined);
  const lastFinishedTaskBadge = getTaskBadge(status?.lastFinishedTask?.status || undefined);
  const visibleTaskStatus = taskStatus || status?.runningTask?.status || status?.lastFinishedTask?.status || 'idle';
  const githubDeployState = describeGitHubDeployState({
    enabled: config.enabled && config.githubReleasesEnabled,
    helperHealthy,
    helperError: status?.helper?.error,
    currentVersion: status?.currentVersion,
    helperImageTag: status?.helper?.imageTag,
    candidate: status?.githubRelease,
  });
  const dockerDeployState = describeDockerDeployState({
    enabled: config.enabled && config.dockerHubTagsEnabled,
    helperHealthy,
    helperError: status?.helper?.error,
    currentVersion: status?.currentVersion,
    helper: status?.helper,
    candidate: status?.dockerHubTag,
  });
  const updateReminder = buildUpdateReminder({
    currentVersion: status?.currentVersion,
    helper: status?.helper,
    githubRelease: status?.githubRelease,
    dockerHubTag: status?.dockerHubTag,
  });
  const canDeployGithub = !deploying && githubDeployState.canDeploy;
  const canDeployDocker = !deploying && dockerDeployState.canDeploy;
  const manualDockerTag = String(manualDockerTarget.tag || '').trim();
  const manualDockerDigest = String(manualDockerTarget.digest || '').trim();
  const recentDockerCandidates = normalizeRecentDockerCandidates(status?.dockerHubRecentTags);
  const canDeployManualDocker = !deploying
    && config.enabled
    && config.dockerHubTagsEnabled
    && helperHealthy
    && !!manualDockerTag;
  const helperHistory = Array.isArray(status?.helper?.history) ? status.helper.history : [];
  const historyPreview = helperHistory.slice(0, 2);
  const currentRevision = String(status?.helper?.revision || '').trim();
  const runtimeStatus = status?.runtime || null;

  if (loading) {
    return (
      <SettingsCard
        title={tr('pages.settings.updateCenterSection.title')}
        description={tr('pages.settings.updateCenterSection.deployStatusHelperHealthycheck')}
      />
    );
  }

  return (
    <SettingsCard
      title={tr('pages.settings.updateCenterSection.title')}
      description={tr('pages.settings.updateCenterSection.settingsViewingGithubReleasesDockerHubK3s')}
      actions={(
        <ToneBadge tone={updateReminder.badgeTone} className={updateReminder.highlight ? 'stat-value-glow' : undefined}>
          {updateReminder.label}
        </ToneBadge>
      )}
    >
      <div className="mb-3.5">
        <div className="mt-1.5 text-xs leading-normal text-muted-foreground">
          {updateReminder.detail}
        </div>
      </div>

      <div className={`mb-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <div className={sectionPanelClassName}>
          <div className={summaryLabelClassName}>{tr('pages.settings.updateCenterSection.currentRunningVersion')}</div>
          <div className={cn(summaryValueClassName, 'font-mono')}>
            {status?.currentVersion || '-'}
          </div>
          <div className={fieldHintClassName}>{tr('pages.settings.updateCenterSection.useVersionCurrentlyRunningContainer')}</div>
        </div>
        <div className={sectionPanelClassName}>
          <div className={summaryLabelClassName}>Deploy Helper</div>
          <div className="mb-1.5">
            <ToneBadge tone={helperBadge.tone}>{helperBadge.label}</ToneBadge>
          </div>
          <div className={cn(fieldHintClassName, config.helperBaseUrl && 'font-mono')}>
            {config.helperBaseUrl || tr('pages.settings.updateCenterSection.notConfiguredHelperUrl')}
          </div>
        </div>
        <div className={sectionPanelClassName}>
          <div className={summaryLabelClassName}>{tr('pages.settings.updateCenterSection.defaultdeploy')}</div>
          <div className={summaryValueClassName}>
            {DEPLOY_SOURCE_OPTIONS.find((item) => item.value === config.defaultDeploySource)?.label || 'GitHub Releases'}
          </div>
          <div className={fieldHintClassName}>{tr('pages.settings.updateCenterSection.saveconfigurationManualdeploydefaultUsage')}</div>
        </div>
        <div className={sectionPanelClassName}>
          <div className={summaryLabelClassName}>{tr('pages.settings.updateCenterSection.recentTasks')}</div>
          <div className="mb-1.5">
            <ToneBadge tone={status?.runningTask ? runningTaskBadge.tone : lastFinishedTaskBadge.tone}>
              {status?.runningTask ? `运行中 · ${runningTaskBadge.label}` : lastFinishedTaskBadge.label}
            </ToneBadge>
          </div>
          <div className={fieldHintClassName}>
            {status?.runningTask?.id
              ? `任务 ID: ${status.runningTask.id}`
              : formatTaskTime(status?.lastFinishedTask?.finishedAt)}
          </div>
        </div>
        <div className={sectionPanelClassName}>
          <div className={summaryLabelClassName}>{tr('pages.settings.updateCenterSection.backgroundCheck')}</div>
          <div className={summaryValueClassName}>
            {runtimeStatus?.lastCheckedAt ? formatTaskTime(runtimeStatus.lastCheckedAt) : tr('pages.settings.updateCenterSection.noCheckRecordsYet')}
          </div>
          <div className={fieldHintClassName}>
            {runtimeStatus?.lastCheckError
              ? `最近错误：${runtimeStatus.lastCheckError}`
              : runtimeStatus?.lastResolvedDisplayVersion
                ? `最近发现：${runtimeStatus.lastResolvedDisplayVersion}`
                : tr('pages.settings.updateCenterSection.backgroundTaskChecksNewVersionsPeriodicallyReminds')}
          </div>
        </div>
      </div>

      <div className={`mb-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
        <SettingsToggleRow
          title={tr('pages.settings.updateCenterSection.enableUpdateCenter')}
          description={tr('pages.settings.updateCenterSection.k3sDeployEnabledCheck')}
          checked={config.enabled}
          onCheckedChange={(enabled) => setConfig((prev) => ({ ...prev, enabled }))}
          className={sectionPanelClassName}
        />
        <SettingsToggleRow
          title="GitHub Releases"
          description={tr('pages.settings.updateCenterSection.stableReleaseSemverDeploy')}
          checked={config.githubReleasesEnabled}
          onCheckedChange={(githubReleasesEnabled) => setConfig((prev) => ({ ...prev, githubReleasesEnabled }))}
          className={sectionPanelClassName}
        />
        <SettingsToggleRow
          title="Docker Hub"
          description={tr('pages.settings.updateCenterSection.automaticStableDevShaTags')}
          checked={config.dockerHubTagsEnabled}
          onCheckedChange={(dockerHubTagsEnabled) => setConfig((prev) => ({ ...prev, dockerHubTagsEnabled }))}
          className={sectionPanelClassName}
        />
      </div>

      <div className={cn(sectionPanelClassName, 'mb-3')}>
        <div className="mb-1.5 text-sm font-semibold">{tr('pages.settings.updateCenterSection.deployconfiguration')}</div>
        <div className="mb-3 text-xs text-muted-foreground">
          {tr('pages.settings.updateCenterSection.settingsFormSaveHelperTargetReleaseConfiguration')}
        </div>

        <div className={`mb-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <label>
            <div className={fieldLabelClassName}>Deploy Helper URL</div>
            <Input
              value={config.helperBaseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, helperBaseUrl: e.target.value }))}
              className="font-mono"
              placeholder="http://metapi-deploy-helper.namespace.svc.cluster.local:9850"
            />
          </label>
          <label>
            <div className={fieldLabelClassName}>{tr('pages.settings.updateCenterSection.defaultdeploy')}</div>
            <ModernSelect
              value={config.defaultDeploySource}
              onChange={(value) => setConfig((prev) => ({
                ...prev,
                defaultDeploySource: value === 'docker-hub-tag' ? 'docker-hub-tag' : 'github-release',
              }))}
              options={DEPLOY_SOURCE_OPTIONS.map((item) => ({ ...item }))}
            />
          </label>
          <label>
            <div className={fieldLabelClassName}>Namespace</div>
            <Input
              value={config.namespace}
              onChange={(e) => setConfig((prev) => ({ ...prev, namespace: e.target.value }))}
              
              placeholder="default"
            />
          </label>
          <label>
            <div className={fieldLabelClassName}>Release Name</div>
            <Input
              value={config.releaseName}
              onChange={(e) => setConfig((prev) => ({ ...prev, releaseName: e.target.value }))}
              
              placeholder="metapi"
            />
          </label>
          <label>
            <div className={fieldLabelClassName}>Chart Ref</div>
            <Input
              value={config.chartRef}
              onChange={(e) => setConfig((prev) => ({ ...prev, chartRef: e.target.value }))}
              className="font-mono"
              placeholder="oci://ghcr.io/cita-777/charts/metapi"
            />
          </label>
          <label>
            <div className={fieldLabelClassName}>Image Repository</div>
            <Input
              value={config.imageRepository}
              onChange={(e) => setConfig((prev) => ({ ...prev, imageRepository: e.target.value }))}
              className="font-mono"
              placeholder="1467078763/metapi"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={saveConfig} disabled={saving}>
            {saving ? tr('pages.accounts.saving') : tr('pages.settings.updateCenterSection.saveConfiguration')}
          </Button>
          <Button variant="outline"
            type="button"
            onClick={checkNow}
            disabled={checking}
           
           
          >
            {checking ? tr('pages.settings.updateCenterSection.checking') : tr('pages.settings.updateCenterSection.checkUpdates')}
          </Button>
        </div>
      </div>

      <div className={cn(sectionPanelClassName, 'mb-3')}>
        <div className="mb-1.5 text-sm font-semibold">{tr('pages.settings.updateCenterSection.deployableVersion')}</div>
        <div className="mb-3 text-xs text-muted-foreground">
          {tr('pages.settings.updateCenterSection.defaultHelperReadyDeployAutomaticdisabledInvalid')}
        </div>

        <div className={`mb-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className={sectionPanelClassName}>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">GitHub Releases</div>
              <div className="flex flex-wrap gap-1.5">
                <ToneBadge tone={getSourceBadge(config.githubReleasesEnabled, status?.githubRelease?.normalizedVersion).tone}>
                  {getSourceBadge(config.githubReleasesEnabled, status?.githubRelease?.normalizedVersion).label}
                </ToneBadge>
                <ToneBadge tone={githubDeployState.badgeTone} className={githubDeployState.highlight ? 'stat-value-glow' : undefined}>
                  {githubDeployState.badgeLabel}
                </ToneBadge>
                {config.defaultDeploySource === 'github-release' ? (
                  <ToneBadge tone="-info">{tr('pages.settings.updateCenterSection.default')}</ToneBadge>
                ) : null}
              </div>
            </div>
            <div className="mb-2.5 text-xs text-muted-foreground">{tr('pages.settings.updateCenterSection.usageStableRelease')}</div>
            <div className={cn(summaryValueClassName, 'mb-2 font-mono', githubDeployState.highlight && 'stat-value-glow')}>
              {status?.githubRelease?.displayVersion || status?.githubRelease?.normalizedVersion || tr('pages.settings.updateCenterSection.notFound')}
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              {githubDeployState.reason}
            </div>
            <Button
              type="button"
              onClick={() => {
                if (!helperHealthy) return;
                void runDeploy('github-release', {
                  tag: status?.githubRelease?.tagName || status?.githubRelease?.normalizedVersion || '',
                  digest: null,
                });
              }}
              disabled={!canDeployGithub}
             
             
            >
              {tr('pages.settings.updateCenterSection.deployGitHubStableRelease')}
            </Button>
          </div>

          <div className={sectionPanelClassName}>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Docker Hub</div>
              <div className="flex flex-wrap gap-1.5">
                <ToneBadge tone={getSourceBadge(config.dockerHubTagsEnabled, status?.dockerHubTag?.normalizedVersion).tone}>
                  {getSourceBadge(config.dockerHubTagsEnabled, status?.dockerHubTag?.normalizedVersion).label}
                </ToneBadge>
                <ToneBadge tone={dockerDeployState.badgeTone} className={dockerDeployState.highlight ? 'stat-value-glow' : undefined}>
                  {dockerDeployState.badgeLabel}
                </ToneBadge>
                {config.defaultDeploySource === 'docker-hub-tag' ? (
                  <ToneBadge tone="-info">{tr('pages.settings.updateCenterSection.default')}</ToneBadge>
                ) : null}
              </div>
            </div>
            <div className="mb-2.5 text-xs text-muted-foreground">{tr('pages.settings.updateCenterSection.latestMainStableSemverAutomaticDevSha')}</div>
            <div className={cn(summaryValueClassName, 'mb-2 font-mono', dockerDeployState.highlight && 'stat-value-glow')}>
              {status?.dockerHubTag?.displayVersion || status?.dockerHubTag?.normalizedVersion || tr('pages.settings.updateCenterSection.notFound')}
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              {dockerDeployState.reason}
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              {tr('pages.settings.updateCenterSection.lastPushed')}{formatTaskTime(status?.dockerHubTag?.publishedAt)}
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (!helperHealthy) return;
                  void runDeploy('docker-hub-tag', {
                    tag: status?.dockerHubTag?.tagName || status?.dockerHubTag?.normalizedVersion || '',
                    digest: status?.dockerHubTag?.digest || null,
                  });
                }}
                disabled={!canDeployDocker}
               
               
              >
                {tr('pages.settings.updateCenterSection.deployDockerHubTags')}
              </Button>
              {status?.dockerHubTag?.tagName ? (
                <Button variant="outline"
                  type="button"
                 
                 
                  onClick={() => {
                    setManualDockerTarget({
                      tag: status?.dockerHubTag?.tagName || '',
                      digest: status?.dockerHubTag?.digest || '',
                    });
                  }}
                >
                  {tr('pages.settings.updateCenterSection.fillCurrentCandidate')}
                </Button>
              ) : null}
            </div>
            <div className="mb-3 mt-1 border-t border-dashed pt-3">
              <div className="mb-1.5 text-xs font-semibold text-foreground">
                {tr('pages.settings.updateCenterSection.stableDockerTags')}
              </div>
              <div className="mb-2.5 text-xs text-muted-foreground">
                {tr('pages.settings.updateCenterSection.automaticDevShaTagsDeployUsageManualinput')}
              </div>
              {recentDockerCandidates.length ? (
                <div className="grid gap-2">
                  {recentDockerCandidates.map((candidate) => {
                    const candidateTag = String(candidate.tagName || '').trim();
                    const candidateDigest = String(candidate.digest || '').trim();
                    const candidateLabel = candidate.displayVersion || candidate.normalizedVersion || candidateTag;
                    const candidateDeployState = describeDockerDeployState({
                      enabled: config.enabled && config.dockerHubTagsEnabled,
                      helperHealthy,
                      helperError: status?.helper?.error,
                      currentVersion: status?.currentVersion,
                      helper: status?.helper,
                      candidate,
                    });
                    const canDeployCandidate = !deploying && candidateDeployState.canDeploy;
                    return (
                      <div
                        key={`${candidateTag}:${candidateDigest || 'no-digest'}`}
                        className="grid gap-2 rounded-lg border p-2.5"
                      >
                        <div className={cn(summaryValueClassName, 'font-mono')}>
                          {candidateLabel}
                        </div>
                        <div className={fieldHintClassName}>
                          {tr('pages.settings.updateCenterSection.lastPushed')}{formatTaskTime(candidate.publishedAt)}
                        </div>
                        {candidateDigest ? (
                          <div className={cn(fieldHintClassName, 'font-mono')} title={candidateDigest}>
                            Digest：{formatShortDigest(candidateDigest)}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline"
                            type="button"
                           
                           
                            disabled={!canDeployCandidate || !candidateTag}
                            title={candidateDeployState.reason}
                            onClick={() => {
                              if (!canDeployCandidate || !candidateTag) return;
                              void runDeploy('docker-hub-tag', {
                                tag: candidateTag,
                                digest: candidateDigest || null,
                              });
                            }}
                          >
                            {tr('pages.settings.updateCenterSection.deploy')} {candidateTag}
                          </Button>
                          <Button variant="outline"
                            type="button"
                           
                           
                            onClick={() => {
                              setManualDockerTarget({
                                tag: candidateTag,
                                digest: candidateDigest,
                              });
                            }}
                          >
                            {tr('pages.settings.updateCenterSection.manual')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={fieldHintClassName}>
                  {tr('pages.settings.updateCenterSection.notFoundDevShaTagsManualDocker')}
                </div>
              )}
            </div>
            <div className="mt-1 border-t border-dashed pt-3">
              <div className="mb-1.5 text-xs font-semibold text-foreground">
                {tr('pages.settings.updateCenterSection.manualdeployDockerHubTags')}
              </div>
              <div className="mb-2.5 text-xs text-muted-foreground">
                {tr('pages.settings.updateCenterSection.automaticStabletagsDeployTag')}
              </div>
              <div className={`mb-2 grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <Input
                  value={manualDockerTarget.tag}
                  onChange={(e) => setManualDockerTarget((prev) => ({ ...prev, tag: e.target.value }))}
                  className="font-mono"
                  placeholder="dev / dev-20260417-f67ade2 / sha-f67ade2"
                />
                <Input
                  value={manualDockerTarget.digest}
                  onChange={(e) => setManualDockerTarget((prev) => ({ ...prev, digest: e.target.value }))}
                  className="font-mono"
                  placeholder={tr('pages.settings.updateCenterSection.digestSha256')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline"
                  type="button"
                 
                 
                  disabled={!canDeployManualDocker}
                  onClick={() => {
                    if (!canDeployManualDocker) return;
                    void runDeploy('docker-hub-tag', {
                      tag: manualDockerTag,
                      digest: manualDockerDigest || null,
                    });
                  }}
                >
                  {tr('pages.settings.updateCenterSection.deployDockerTags')}
                </Button>
                <span className={fieldHintClassName}>
                  {tr('pages.settings.updateCenterSection.digestChartDigestSuggestionTagDigest')}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className={sectionPanelClassName}>
            <div className={fieldLabelClassName}>{tr('pages.settings.updateCenterSection.helperHealthy')}</div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <ToneBadge tone={helperBadge.tone}>{helperBadge.label}</ToneBadge>
              <ToneBadge tone={runningTaskBadge.tone}>{tr('pages.settings.updateCenterSection.currentTask')} {runningTaskBadge.label}</ToneBadge>
            </div>
            <div className={fieldHintClassName}>
              {status?.helper?.error || tr('pages.settings.updateCenterSection.helperNormalHelmUpgradeKubectlRolloutStatus')}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {tr('pages.settings.updateCenterSection.currentImage')}{formatImageTarget(status?.helper?.imageTag, status?.helper?.imageDigest) || tr('pages.settings.updateCenterSection.waitingForHelperImage')}
            </div>
          </div>

          <div className={sectionPanelClassName}>
            <div className={fieldLabelClassName}>{tr('pages.settings.updateCenterSection.taskSnapshot')}</div>
            <div className="grid gap-1.5 text-sm text-foreground">
              <div>
                {tr('pages.settings.updateCenterSection.runningTask')}
                <span className="ml-1.5 text-muted-foreground">
                  {status?.runningTask?.id ? `${status.runningTask.id} · ${status.runningTask.status || '-'}` : tr('pages.importExport.none')}
                </span>
              </div>
              <div>
                {tr('pages.settings.updateCenterSection.lastCompleted')}
                <span className="ml-1.5 text-muted-foreground">
                  {status?.lastFinishedTask?.id
                    ? `${status.lastFinishedTask.id} · ${status.lastFinishedTask.status || '-'}`
                    : tr('pages.importExport.none')}
                </span>
              </div>
              <div className={fieldHintClassName}>
                {tr('pages.settings.updateCenterSection.time')}{formatTaskTime(status?.lastFinishedTask?.finishedAt)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={cn(sectionPanelClassName, 'mb-3')}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">{tr('pages.settings.updateCenterSection.rollbackHistory')}</div>
          <div className="flex flex-wrap gap-1.5">
            <ToneBadge tone="-muted">{tr('pages.settings.updateCenterSection.revision')}</ToneBadge>
            {helperHistory.length > historyPreview.length ? (
              <Button
                variant="outline"
                type="button"
                onClick={() => setHistoryModalOpen(true)}
              >
                {tr('pages.settings.updateCenterSection.expandall')} {helperHistory.length} {tr('pages.programLogs.items')}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mb-2.5 text-xs text-muted-foreground">
          {tr('pages.settings.updateCenterSection.defaultRevisionPreviewSettings')}
        </div>
        {helperHistory.length > 0 ? (
          <div className="grid gap-2.5">
            {historyPreview.map((entry) => {
              const revision = String(entry?.revision || '').trim();
              return (
                <UpdateCenterHistoryEntryCard
                  key={revision || 'unknown-revision'}
                  entry={entry}
                  currentRevision={currentRevision}
                  helperHealthy={helperHealthy}
                  deploying={deploying}
                  compact
                  formatTaskTime={formatTaskTime}
                  formatImageTarget={formatImageTarget}
                  onRollback={(nextRevision) => {
                    void runRollback(nextRevision);
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className={fieldHintClassName}>
            {tr('pages.settings.updateCenterSection.helperRevisionSuccessdeployStable')}
          </div>
        )}
      </div>

      <div className={sectionPanelClassName}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">{tr('pages.settings.updateCenterSection.deploymentLogs')}</div>
          <ToneBadge tone={getTaskBadge(visibleTaskStatus).tone}>
            {tr('pages.settings.updateCenterSection.status2')} {getTaskBadge(visibleTaskStatus).label}
          </ToneBadge>
        </div>
        <div className="mb-2.5 text-xs text-muted-foreground">
          {tr('pages.settings.updateCenterSection.automaticTaskSnapshot200ItemsoutputHelmRollout')}
        </div>
        <div className="min-h-30 rounded-lg border bg-card p-3">
          {logs.length > 0 ? (
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
              {logs.join('\n')}
            </pre>
          ) : (
            <div className="flex min-h-24 items-center text-xs text-muted-foreground">
              {tr('pages.settings.updateCenterSection.deploystartHelmUpgradeKubectlRolloutStatus')}
            </div>
          )}
        </div>
      </div>
      {status?.helper?.error ? (
        <div className="mt-2.5 text-xs text-destructive">
          {tr('pages.settings.updateCenterSection.helperMistake')}{status.helper.error}
        </div>
      ) : null}
      <div className="mt-2.5 text-xs text-muted-foreground">
        {tr('pages.settings.updateCenterSection.status')}{visibleTaskStatus}
      </div>
      <UpdateCenterHistoryModal
        open={historyModalOpen}
        helperHealthy={helperHealthy}
        deploying={deploying}
        currentRevision={currentRevision}
        history={helperHistory}
        formatTaskTime={formatTaskTime}
        formatImageTarget={formatImageTarget}
        onClose={() => setHistoryModalOpen(false)}
        onRollback={(revision) => {
          setHistoryModalOpen(false);
          void runRollback(revision);
        }}
      />
    </SettingsCard>
  );
}
