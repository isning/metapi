import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Input } from '../components/ui/input/index.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs/index.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';

type MonitorSite = {
  id: string;
  name: string;
  url: string;
  description: string;
  requiresLinuxDoOAuth?: boolean;
};

type MonitorConfig = {
  ldohCookieConfigured: boolean;
  ldohCookieMasked?: string;
};

const MONITOR_SITES: MonitorSite[] = [
  {
    id: 'check-linux-do',
    name: 'check.linux.do',
    url: 'https://check.linux.do',
    description: tr('pages.monitors.linuxdoAvailabilityMonitoring'),
  },
  {
    id: 'ldoh-105117',
    name: 'ldoh.105117.xyz',
    url: 'https://ldoh.105117.xyz',
    description: tr('pages.monitors.ldohMonitoringPanel'),
    requiresLinuxDoOAuth: true,
  },
];

export default function Monitors() {
  const toast = useToast();
  const [activeSiteId, setActiveSiteId] = useState(MONITOR_SITES[0].id);
  const [reloadSeed, setReloadSeed] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const [monitorConfig, setMonitorConfig] = useState<MonitorConfig>({ ldohCookieConfigured: false });
  const [cookieInput, setCookieInput] = useState('');
  const [savingCookie, setSavingCookie] = useState(false);

  const activeSite = useMemo(
    () => MONITOR_SITES.find((site) => site.id === activeSiteId) || MONITOR_SITES[0],
    [activeSiteId],
  );

  const loadMonitorConfig = async () => {
    try {
      const res = await api.getMonitorConfig();
      setMonitorConfig({
        ldohCookieConfigured: !!res?.ldohCookieConfigured,
        ldohCookieMasked: typeof res?.ldohCookieMasked === 'string' ? res.ldohCookieMasked : '',
      });
    } catch (err: any) {
      toast.error(err?.message || tr('pages.monitors.failedLoadMonitoringConfiguration'));
    }
  };

  useEffect(() => {
    void loadMonitorConfig();
    // Set HttpOnly monitor auth cookie for iframe proxy.
    void api.initMonitorSession().catch(() => {});
  }, []);

  useEffect(() => {
    setLoaded(false);
    setShowFallbackHint(false);
    const timer = window.setTimeout(() => {
      setShowFallbackHint(true);
    }, 4500);
    void api.initMonitorSession().catch(() => {});
    return () => window.clearTimeout(timer);
  }, [activeSiteId, reloadSeed]);

  const usingCookieProxy = activeSite.id === 'ldoh-105117' && monitorConfig.ldohCookieConfigured;
  const oauthHintPresence = useAnimatedVisibility(Boolean(activeSite.requiresLinuxDoOAuth), 220);
  const fallbackHintPresence = useAnimatedVisibility(showFallbackHint && !loaded, 180);
  const directSiteUrl = `${activeSite.url.replace(/\/$/, '')}/`;
  const iframeUrl = usingCookieProxy ? '/monitor-proxy/ldoh/' : directSiteUrl;
  const ldohOauthUrl = `${directSiteUrl}api/oauth/initiate?returnTo=%2F`;

  const handleSaveCookie = async () => {
    setSavingCookie(true);
    try {
      await api.updateMonitorConfig({ ldohCookie: cookieInput.trim() || null });
      await loadMonitorConfig();
      setCookieInput('');
      setReloadSeed((prev) => prev + 1);
      toast.success(tr('pages.monitors.ldohCookieUpdated'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.monitors.failedSaveCookie'));
    } finally {
      setSavingCookie(false);
    }
  };

  const fallbackHint = usingCookieProxy
    ? tr('pages.monitors.proxyModeEnabledIfItStillCannot')
    : tr('pages.monitors.currentSiteMayProhibitIframeEmbeddingOauth');

  return (
    <PageShell>
      <PageHeader
        title={tr('pages.monitors.embeddedMonitor')}
        description={tr('pages.monitors.embeddedMonitorDescription')}
        actions={(
          <>
          <Button variant="outline"
            type="button"
           
           
            onClick={() => setReloadSeed((prev) => prev + 1)}
            data-tooltip={tr('pages.monitors.reloadCurrentSite')}
            aria-label={tr('pages.monitors.reloadCurrentSite')}
          >
            {tr('pages.accounts.refresh')}
          </Button>
          <Button
            type="button"
           
            onClick={() => window.open(directSiteUrl, '_blank', 'noopener,noreferrer')}
            data-tooltip={tr('pages.monitors.openTargetSiteDirectlyNewWindow')}
            aria-label={tr('pages.monitors.openTargetSiteDirectlyNewWindow')}
          >
            {tr('pages.monitors.open')}
          </Button>
          </>
        )}
      />

      <Tabs value={activeSite.id} onValueChange={setActiveSiteId}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          {MONITOR_SITES.map((site) => (
            <TabsTrigger key={site.id} value={site.id} className="h-auto flex-col items-start gap-1 px-4 py-3 text-left">
              <span>{site.name}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{site.description}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {oauthHintPresence.shouldRender && (
        <Card className={oauthHintPresence.isVisible ? '' : 'opacity-0'}>
          <CardHeader>
            <CardTitle>{usingCookieProxy ? tr('pages.monitors.cookieProxyModeEnabled') : tr('pages.monitors.siteRequiresLinuxdoOauthAuthorization')}</CardTitle>
            <CardDescription className="leading-6">
            {!usingCookieProxy && (
              <>
                {tr('pages.monitors.1SignLinuxdoSign')}<br />
                {tr('pages.monitors.cookieProxySetupStep')}<br />
              </>
            )}
            {usingCookieProxy && (
              <>
                {tr('pages.monitors.serverProxyAccessDescription')}<br />
                {tr('pages.monitors.saveCookie')}{monitorConfig.ldohCookieMasked || tr('pages.monitors.configured')}<br />
              </>
            )}
            {tr('pages.monitors.cookieExpiredDescription')}
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Input
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder={tr('pages.monitors.pasteLdAuthSessionLdAuthSession')}
                className="min-w-0 flex-1"
            />
            <Button
              type="button"
              onClick={handleSaveCookie}
              disabled={savingCookie}
            >
              {savingCookie ? tr('pages.accounts.saving') : (cookieInput.trim() ? tr('pages.monitors.saveCookie2') : tr('pages.monitors.clearCookies'))}
            </Button>
            </div>

            <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              type="button"
              onClick={() => window.open(ldohOauthUrl, '_blank', 'noopener,noreferrer')}
            >
              {tr('pages.monitors.sign')}
            </Button>
            {usingCookieProxy && (
              <Button variant="outline"
                type="button"
                onClick={() => window.open('/monitor-proxy/ldoh/', '_blank', 'noopener,noreferrer')}
              >
                {tr('pages.monitors.openThroughProxy')}
              </Button>
            )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        {fallbackHintPresence.shouldRender && (
          <div className={`border-b px-4 py-3 text-sm text-muted-foreground ${fallbackHintPresence.isVisible ? '' : 'opacity-0'}`.trim()}>
            {fallbackHint}
          </div>
        )}
        <iframe
          key={`${activeSite.id}-${reloadSeed}-${usingCookieProxy ? 'proxy' : 'direct'}`}
          src={iframeUrl}
          title={`monitor-${activeSite.id}`}
          className="h-[70vh] min-h-[560px] w-full"
          onLoad={() => setLoaded(true)}
        />
      </Card>
    </PageShell>
  );
}
