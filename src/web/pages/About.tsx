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
  { icon: '🌐', title: '统一代理网关', desc: '一个 Key、一个入口，兼容 OpenAI / Claude 下游格式' },
  { icon: '🧠', title: '智能路由引擎', desc: '按成本、延迟、成功率自动选择最优通道，故障自动转移' },
  { icon: '📡', title: '多站点聚合', desc: '集中管理 New API / One API / OneHub / DoneHub / Veloera 等' },
  { icon: '🔍', title: '自动模型发现', desc: '上游新增模型自动出现在模型列表，零配置路由生成' },
  { icon: '🏪', title: '模型广场', desc: '跨站模型覆盖、定价对比、延迟与成功率实测数据' },
  { icon: '✅', title: '自动签到', desc: '定时签到 + 余额刷新，不再手动操心' },
  { icon: '🔔', title: '多渠道告警', desc: 'Webhook / Bark / Server酱 / 邮件，余额不足及时提醒' },
  { icon: '📦', title: '轻量部署', desc: '单 Docker 容器，内置 SQLite，无外部依赖' },
];

const TECH_STACK = [
  { name: 'Fastify', desc: '高性能 Node.js 后端框架' },
  { name: 'React', desc: '用户界面库' },
  { name: 'TypeScript', desc: '端到端类型安全' },
  { name: 'Tailwind CSS v4', desc: '原子化样式框架' },
  { name: 'Drizzle ORM', desc: '轻量 TypeScript ORM' },
  { name: 'SQLite', desc: '零配置嵌入式数据库' },
];

const LINKS = [
  { label: 'GitHub', href: 'https://github.com/cita-777/metapi', icon: '📂' },
  { label: 'Docker Hub', href: 'https://hub.docker.com/r/1467078763/metapi', icon: '🐳' },
  { label: '站点文档', href: SITE_DOCS_URL, icon: '📚' },
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
        <h2 className="text-2xl font-semibold tracking-tight">{tr('关于 Metapi')}</h2>
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
          {tr('中转站的中转站 — 将你在各处注册的 New API / One API / OneHub 等 AI 中转站聚合为一个统一网关。一个 API Key、一个入口，自动发现模型、智能路由、成本最优。')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>更新提醒</CardTitle>
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
          <div>GitHub 稳定版：{latestGitHubVersion || '暂无数据'}</div>
          <div>Docker Hub：{latestDockerHubVersion || '暂无数据'}</div>
          <div>
              <Button asChild variant="ghost" className="h-auto p-0">
                <Link to="/settings">
              前往更新中心
            </Link>
              </Button>
          </div>
        </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr('核心特色')}</CardTitle>
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
          <CardTitle>{tr('技术栈')}</CardTitle>
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
          <CardTitle>{tr('项目链接')}</CardTitle>
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
          <CardTitle>{tr('数据与隐私')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-7 text-muted-foreground">
          {tr('Metapi 完全自托管，所有数据（账号、令牌、路由、日志）均存储在本地 SQLite 数据库中，不会向任何第三方发送数据。代理请求仅在你的服务器与上游站点之间直连传输。')}
        </CardContent>
      </Card>
    </div>
  );
}
