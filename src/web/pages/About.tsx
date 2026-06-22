import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api.js';
import { tr } from '../i18n.js';
import { SITE_DOCS_URL } from '../docsLink.js';
import { buildUpdateReminder } from './helpers/updateCenterPresentation.js';
import ToneBadge from '../components/ToneBadge.js';
import { Button } from '../components/ui/button/index.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card/index.js';

const VERSION = '1.3.0';

const FEATURES = [
  { icon: '🌐', title: tr('app.unifiedProxyGateway'), desc: tr('app.oneKeyOneEndpointCompatibleOpenaiClaude') },
  { icon: '🧠', title: tr('app.smartRoutingEngine'), desc: tr('app.autoSelectsOptimalChannelCostLatencySuccess') },
  { icon: '📡', title: tr('pages.about.multiSiteAggregation'), desc: tr('pages.about.centrallyManageNewApiOneApiOnehub') },
  { icon: '🔍', title: tr('app.autoModelDiscovery'), desc: tr('app.newUpstreamModelsAppearAutomaticallyZeroConfig') },
  { icon: '🏪', title: tr('app.modelMarketplace'), desc: tr('pages.about.crossSiteModelCoveragePricingComparisonLatency') },
  { icon: '✅', title: tr('pages.about.autoCheck'), desc: tr('pages.about.scheduledCheckBalanceRefreshNeverMissOne') },
  { icon: '🔔', title: tr('pages.about.multiChannelAlerts'), desc: tr('pages.about.webhookBarkServerchanEmailGetNotifiedWhen') },
  { icon: '📦', title: tr('pages.about.lightweightDeployment'), desc: tr('pages.about.singleDockerContainerBuiltSqliteNoExternal') },
];

const TECH_STACK = [
  { name: 'Fastify', desc: tr('pages.about.highPerformanceNodeJsBackendFramework') },
  { name: 'React', desc: tr('pages.about.userInterfaceLibrary') },
  { name: 'TypeScript', desc: tr('pages.about.endEndTypeSafety') },
  { name: 'Tailwind CSS v4', desc: tr('pages.about.utilityFirstCssFramework') },
  { name: 'Drizzle ORM', desc: tr('pages.about.lightweightTypescriptOrm') },
  { name: 'SQLite', desc: tr('pages.about.zeroConfigEmbeddedDatabase') },
];

const LINKS = [
  { label: 'GitHub', href: 'https://github.com/cita-777/metapi', icon: '📂' },
  { label: 'Docker Hub', href: 'https://hub.docker.com/r/1467078763/metapi', icon: '🐳' },
  { label: tr('pages.about.siteDocs'), href: SITE_DOCS_URL, icon: '📚' },
];

export default function About() {
  const [currentVersion, setCurrentVersion] = useState(`v${VERSION}`);
  const [latestGitHubVersion, setLatestGitHubVersion] = useState('');
  const [latestDockerHubVersion, setLatestDockerHubVersion] = useState('');
  const [updateReminder, setUpdateReminder] = useState(() => buildUpdateReminder({
    currentVersion: VERSION,
    helper: null,
    githubRelease: null,
    dockerHubTag: null,
  }));

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const status = await api.getUpdateCenterStatus() as {
          currentVersion?: string;
          githubRelease?: { normalizedVersion?: string; displayVersion?: string; tagName?: string | null; digest?: string | null } | null;
          dockerHubTag?: { normalizedVersion?: string; displayVersion?: string; tagName?: string | null; digest?: string | null } | null;
          helper?: { imageTag?: string | null; imageDigest?: string | null } | null;
        };
        const resolvedCurrentVersion = String(status.currentVersion || VERSION);
        if (cancelled) return;
        setCurrentVersion(`v${resolvedCurrentVersion}`);
        setLatestGitHubVersion(String(status.githubRelease?.displayVersion || status.githubRelease?.normalizedVersion || ''));
        setLatestDockerHubVersion(String(status.dockerHubTag?.displayVersion || status.dockerHubTag?.normalizedVersion || ''));
        setUpdateReminder(buildUpdateReminder({
          currentVersion: resolvedCurrentVersion,
          helper: status.helper,
          githubRelease: status.githubRelease,
          dockerHubTag: status.dockerHubTag,
        }));
      } catch {
        // ignore update-center lookup failures on about page
      }
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid max-w-4xl gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{tr('pages.about.aboutMetapi')}</h2>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Metapi"
              className="h-12 w-12 shrink-0 rounded-lg"
          />
            <div>
              <CardTitle>Metapi</CardTitle>
              <CardDescription>{currentVersion}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm leading-7 text-muted-foreground">
          {tr('pages.about.hubHubsAggregateAllYourNewApi')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.about.updateReminders')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={updateReminder.badgeTone} className={updateReminder.highlight ? 'stat-value-glow' : undefined}>
            {updateReminder.label}
          </ToneBadge>
            <span className={updateReminder.highlight ? 'stat-value-glow font-semibold' : 'font-semibold'}>
            {updateReminder.detail}
          </span>
          </div>
          <div className="grid gap-2">
          <div>{tr('pages.about.githubStable')}{latestGitHubVersion || tr('pages.about.noData')}</div>
          <div>Docker Hub：{latestDockerHubVersion || tr('pages.about.noData')}</div>
          <div>
              <Button asChild variant="ghostPrimary" className="h-auto p-0">
                <Link to="/settings">
              {tr('pages.about.zh')}
            </Link>
              </Button>
          </div>
        </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.about.keyFeatures')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex gap-3 rounded-md border p-3">
              <span className="shrink-0 text-lg leading-6">{f.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{tr(f.title)}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {tr(f.desc)}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.about.techStack')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TECH_STACK.map((t) => (
            <div key={t.name} className="rounded-md border p-3">
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {tr(t.desc)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.about.projectLinks')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {LINKS.map((l) => (
            <Button key={l.label} asChild variant="outline">
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                <span>{l.icon}</span>
                <span>{tr(l.label)}</span>
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.about.dataPrivacy')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-7 text-muted-foreground">
          {tr('pages.about.metapiFullySelfHostedAllDataAccounts')}
        </CardContent>
      </Card>
    </div>
  );
}
