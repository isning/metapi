import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Code2,
  FileText,
  Globe2,
  KeyRound,
  Loader2,
  UserRound,
} from 'lucide-react';
import { api } from '../api.js';
import { formatDateLocal, formatDateTimeMinuteLocal } from '../pages/helpers/checkinLogTime.js';
import { buildAccountFocusPath, buildSiteFocusPath, buildTokenFocusPath } from '../pages/helpers/navigationFocus.js';
import { useI18n } from '../i18n.js';
import { Badge } from './ui/badge/index.js';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command/index.js';

interface SiteResult {
  id: number;
  name: string;
  url: string;
}

interface AccountResult {
  id: number;
  username: string | null;
  status?: string | null;
  balance?: number | null;
  segment?: 'session' | 'apikey';
  site?: { name: string } | null;
}

interface AccountTokenResult {
  id: number;
  accountId: number;
  name: string;
  tokenGroup?: string | null;
  account?: {
    username?: string | null;
    segment?: 'session' | 'apikey';
  } | null;
  site?: { name: string } | null;
}

interface CheckinLogResult {
  id: number;
  accountId: number;
  message?: string | null;
  createdAt?: string | null;
  account?: { username?: string | null } | null;
}

interface ProxyLogResult {
  id: number;
  modelRequested?: string | null;
  status?: string | null;
  latencyMs?: number | null;
  createdAt?: string | null;
}

interface ModelSearchResult {
  name: string;
  accountCount: number;
  tokenCount: number;
  siteCount: number;
}

interface SearchResult {
  accounts: AccountResult[];
  accountTokens: AccountTokenResult[];
  sites: SiteResult[];
  checkinLogs: CheckinLogResult[];
  proxyLogs: ProxyLogResult[];
  models: ModelSearchResult[];
}

export default function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const timerRef = useRef<number>();

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      return;
    }

    setLoading(true);
    try {
      const res = await api.search(q);
      setResults({
        models: Array.isArray(res?.models) ? res.models : [],
        accounts: Array.isArray(res?.accounts) ? res.accounts : [],
        accountTokens: Array.isArray(res?.accountTokens) ? res.accountTokens : [],
        sites: Array.isArray(res?.sites) ? res.sites : [],
        checkinLogs: Array.isArray(res?.checkinLogs) ? res.checkinLogs : [],
        proxyLogs: Array.isArray(res?.proxyLogs) ? res.proxyLogs : [],
      });
    } catch {
      // ignore search errors in modal
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => doSearch(val), 300);
  };

  const goTo = (path: string) => {
    onClose();
    navigate(path);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const hasResults = results && (
    results.models.length
    || results.accounts.length
    || results.accountTokens.length
    || results.sites.length
    || results.checkinLogs.length
    || results.proxyLogs.length
  );

  return (
    <CommandDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Command shouldFilter={false}>
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={handleInput}
          placeholder={t('搜索站点、账号、模型、日志...')}
        />
        {loading ? (
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('搜索中...')}
          </div>
        ) : null}
        <CommandList>
          {query && !loading && !hasResults ? <CommandEmpty>{t('没有找到匹配结果')}</CommandEmpty> : null}

          {results?.models.length ? (
            <CommandGroup heading={t('模型广场')}>
              {results.models.map((m) => (
                <CommandItem key={m.name} value={`model-${m.name}`} onSelect={() => goTo(`/models?q=${encodeURIComponent(m.name)}`)}>
                  <Code2 className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.accountCount} {t('个账号')} · {m.tokenCount} {t('个令牌')} · {m.siteCount} {t('个站点')}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results?.sites.length ? (
            <CommandGroup heading={t('站点')}>
              {results.sites.map((s) => (
                <CommandItem key={s.id} value={`site-${s.id}`} onSelect={() => goTo(buildSiteFocusPath(s.id))}>
                  <Globe2 className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.url}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results?.accounts.length ? (
            <CommandGroup heading={t('账号')}>
              {results.accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`account-${a.id}`}
                  onSelect={() => goTo(buildAccountFocusPath(a.id, {
                    openRebind: a.status === 'expired',
                    segment: a.segment,
                  }))}
                >
                  <UserRound className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">
                      {a.username?.trim() || (a.segment === 'apikey' ? t('API Key 连接') : `ID:${a.id}`)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.site?.name || t('未关联站点')}
                      {a.segment === 'apikey' ? ` · ${t('API Key 连接')}` : ''}
                      {' · '}
                      {t('余额')} ${(a.balance || 0).toFixed(2)}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results?.accountTokens.length ? (
            <CommandGroup heading={t('账号令牌')}>
              {results.accountTokens.map((token) => (
                <CommandItem
                  key={token.id}
                  value={`token-${token.id}`}
                  onSelect={() => goTo(buildTokenFocusPath(token.id))}
                >
                  <KeyRound className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{token.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(token.account?.username?.trim() || (token.account?.segment === 'apikey' ? t('API Key 连接') : t('未命名')))}
                      {' · '}
                      {token.site?.name || t('未关联站点')}
                      {token.tokenGroup ? ` · ${token.tokenGroup}` : ''}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results?.checkinLogs.length ? (
            <CommandGroup heading={t('签到记录')}>
              {results.checkinLogs.map((l) => (
                <CommandItem key={l.id} value={`checkin-${l.id}`} onSelect={() => goTo('/checkin')}>
                  <CheckCircle2 className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{l.account?.username || `ID:${l.accountId}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.message || '-'} · {formatDateLocal(l.createdAt)}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results?.proxyLogs.length ? (
            <CommandGroup heading={t('使用日志')}>
              {results.proxyLogs.map((l) => (
                <CommandItem key={l.id} value={`proxy-${l.id}`} onSelect={() => goTo('/logs')}>
                  <FileText className="size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{l.modelRequested || '-'}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.status || '-'} · {l.latencyMs || 0}ms · {formatDateTimeMinuteLocal(l.createdAt)}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <Badge variant="outline">↑↓</Badge>
          {t('导航')}
          <Badge variant="outline">Enter</Badge>
          {t('打开')}
          <CommandShortcut>Esc</CommandShortcut>
        </div>
      </Command>
    </CommandDialog>
  );
}
