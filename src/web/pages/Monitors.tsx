import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Input } from '../components/ui/input/index.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs/index.js';

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
    description: 'LinuxDo 可用性监控',
  },
  {
    id: 'ldoh-105117',
    name: 'ldoh.105117.xyz',
    url: 'https://ldoh.105117.xyz',
    description: 'LDOH 监控面板',
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
      toast.error(err?.message || '加载监控配置失败');
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
      toast.success('LDOH Cookie 已更新');
    } catch (err: any) {
      toast.error(err?.message || '保存 Cookie 失败');
    } finally {
      setSavingCookie(false);
    }
  };

  const fallbackHint = usingCookieProxy
    ? '代理模式已启用：若仍无法加载，请检查 Cookie 是否过期后重新保存。'
    : '当前站点可能禁止 iframe 内嵌，或 OAuth 跨站 Cookie 受限。建议先新窗口授权再回到此页刷新。';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{tr('监控内嵌')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在 metapi 内查看外部站点监控页面。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline"
            type="button"
           
           
            onClick={() => setReloadSeed((prev) => prev + 1)}
            data-tooltip="重新加载当前站点"
            aria-label="重新加载当前站点"
          >
            刷新
          </Button>
          <Button
            type="button"
           
            onClick={() => window.open(directSiteUrl, '_blank', 'noopener,noreferrer')}
            data-tooltip="在新窗口直接打开目标站点"
            aria-label="在新窗口直接打开目标站点"
          >
            新窗口打开
          </Button>
        </div>
      </div>

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
            <CardTitle>{usingCookieProxy ? '已启用 Cookie 代理模式' : '该站点需要 LinuxDo OAuth 授权'}</CardTitle>
            <CardDescription className="leading-6">
            {!usingCookieProxy && (
              <>
                1. 先点击“授权登录（新窗口）”完成 LinuxDo 登录。<br />
                2. 回来后把 `ld_auth_session` 填到下方，启用 Cookie 代理内嵌。<br />
              </>
            )}
            {usingCookieProxy && (
              <>
                当前使用服务端代理访问，不依赖跨站第三方 Cookie。<br />
                已保存 Cookie：{monitorConfig.ldohCookieMasked || '(已配置)'}<br />
              </>
            )}
            Cookie 过期后请重新粘贴保存。
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Input
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="粘贴 ld_auth_session 或 ld_auth_session=xxx"
                className="min-w-0 flex-1"
            />
            <Button
              type="button"
              onClick={handleSaveCookie}
              disabled={savingCookie}
            >
              {savingCookie ? '保存中...' : (cookieInput.trim() ? '保存 Cookie' : '清空 Cookie')}
            </Button>
            </div>

            <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              type="button"
              onClick={() => window.open(ldohOauthUrl, '_blank', 'noopener,noreferrer')}
            >
              授权登录（新窗口）
            </Button>
            {usingCookieProxy && (
              <Button variant="outline"
                type="button"
                onClick={() => window.open('/monitor-proxy/ldoh/', '_blank', 'noopener,noreferrer')}
              >
                通过代理打开
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
    </div>
  );
}
