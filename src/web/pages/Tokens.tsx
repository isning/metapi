import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import CenteredModal from '../components/CenteredModal.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import ResponsiveFormGrid from '../components/ResponsiveFormGrid.js';
import ResponsiveBatchActionBar from '../components/ResponsiveBatchActionBar.js';
import { useToast } from '../components/Toast.js';
import { formatDateTimeLocal } from './helpers/checkinLogTime.js';
import {
  isTruthyFlag,
  parsePositiveInt,
  resolveAccountCredentialMode,
} from './helpers/accountConnection.js';
import ModernSelect from '../components/ModernSelect.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import { useIsMobile } from '../components/useIsMobile.js';
import DeleteConfirmModal from '../components/DeleteConfirmModal.js';
import { clearFocusParams, readFocusTokenId } from './helpers/navigationFocus.js';
import { shouldIgnoreRowSelectionClick } from './helpers/rowSelection.js';
import { tr } from '../i18n.js';
import { UpstreamCompatibilityPolicyEditor } from '../components/UpstreamCompatibilityPolicyEditor.js';
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import InfoNote from '../components/InfoNote.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { DataTable } from '../components/ui/data-table/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import { Input } from '../components/ui/input/index.js';
import {
  emptyUpstreamCompatibilityPolicyForm,
  policyFormFromStoredValue,
  serializeCompatibilityPolicyForm,
} from '../lib/upstreamCompatibilityPolicyEditor.js';

type SyncStatus = 'success' | 'skipped' | 'failed';
type TokensPanelProps = {
  embedded?: boolean;
  onEmbeddedActionsChange?: (actions: React.ReactNode | null) => void;
};

type AccountTokenSyncResult = {
  status?: string;
  success?: boolean;
  synced?: boolean;
  message?: string;
  reason?: string;
  created?: number;
  updated?: number;
  maskedPending?: number;
  pendingTokenIds?: number[];
  accountId?: number;
  accountName?: string;
  account?: {
    id?: number;
    username?: string;
  };
};

type SyncableAccount = {
  id: number;
  username?: string | null;
  accessToken?: string | null;
  status?: string | null;
  credentialMode?: string | null;
  capabilities?: {
    proxyOnly?: boolean;
  } | null;
  site?: {
    status?: string | null;
    name?: string | null;
  } | null;
};

const ACCOUNT_SELECT_SEARCH_PLACEHOLDER = tr('pages.tokens.filteraccountsNameSites');

const isAccountSyncable = (account: any) =>
  resolveAccountCredentialMode(account) === 'session'
  && account?.status === 'active'
  && account?.site?.status !== 'disabled';

const resolveSyncStatus = (result: AccountTokenSyncResult | null | undefined): SyncStatus => {
  const raw = String(result?.status || '').toLowerCase();
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'skipped' || raw === 'skip') return 'skipped';
  if (raw === 'success' || raw === 'ok' || raw === 'succeeded') return 'success';
  if (result?.success === false) return 'failed';
  if (result?.synced === false) return 'skipped';
  return 'success';
};

const resolveSyncMessage = (result: AccountTokenSyncResult | null | undefined, fallback: string) => {
  const message = typeof result?.message === 'string' ? result.message.trim() : '';
  return message || fallback;
};

const isMaskedPendingToken = (token: any): boolean => token?.valueStatus === 'masked_pending';

const isMaskedPendingSyncResult = (result: AccountTokenSyncResult | null | undefined) =>
  String(result?.reason || '').trim().toLowerCase() === 'upstream_masked_tokens'
  && Number(result?.maskedPending || 0) > 0;

const resolveAccountLabel = (result: AccountTokenSyncResult | null | undefined) => {
  const name = typeof result?.accountName === 'string' ? result.accountName.trim() : '';
  if (name) return name;
  const username = typeof result?.account?.username === 'string' ? result.account.username.trim() : '';
  if (username) return username;
  const accountId = result?.accountId ?? result?.account?.id;
  if (accountId) return `#${accountId}`;
  return tr('pages.proxyLogs.unknownAccount');
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function TokensPanel({ embedded = false, onEmbeddedActionsChange }: TokensPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const initialCreateForm = {
    accountId: 0,
    name: '',
    group: 'default',
    unlimitedQuota: true,
    remainQuota: '',
    expiredTime: '',
    allowIps: '',
  };

  const [tokens, setTokens] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingToken, setEditingToken] = useState<any | null>(null);
  const [editingTokenValueLoading, setEditingTokenValueLoading] = useState(false);
  const [editingTokenPendingMessage, setEditingTokenPendingMessage] = useState('');
  const [createHintModelName, setCreateHintModelName] = useState('');
  const [highlightTokenId, setHighlightTokenId] = useState<number | null>(null);
  const [pendingAutoOpenTokenId, setPendingAutoOpenTokenId] = useState<number | null>(null);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [selectedTokenIds, setSelectedTokenIds] = useState<number[]>([]);
  const [expandedTokenIds, setExpandedTokenIds] = useState<number[]>([]);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | {
    mode: 'single' | 'batch';
    tokenId?: number;
    tokenName?: string;
    count?: number;
  }>(null);
  const [form, setForm] = useState(initialCreateForm);
  const [createCompatibilityPolicyForm, setCreateCompatibilityPolicyForm] = useState(() => emptyUpstreamCompatibilityPolicyForm());
  const [editForm, setEditForm] = useState({
    name: '',
    token: '',
    group: 'default',
    enabled: true,
    isDefault: false,
  });
  const [editCompatibilityPolicyForm, setEditCompatibilityPolicyForm] = useState(() => emptyUpstreamCompatibilityPolicyForm());
  const [groupOptions, setGroupOptions] = useState<string[]>(['default']);
  const [groupLoading, setGroupLoading] = useState(false);
  const [editGroupOptions, setEditGroupOptions] = useState<string[]>(['default']);
  const [editGroupLoading, setEditGroupLoading] = useState(false);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingTokenIdRef = useRef<number | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenRows, accountSnapshot] = await Promise.all([
        api.getAccountTokens(),
        api.getAccountsSnapshot(),
      ]);
      const nextTokens = tokenRows || [];
      setTokens(nextTokens);
      setSelectedTokenIds((current) => current.filter((id) => nextTokens.some((token: any) => token.id === id)));
      const latestAccounts: SyncableAccount[] = Array.isArray(accountSnapshot?.accounts)
        ? accountSnapshot.accounts
        : [];
      setAccounts(latestAccounts);

      const syncableAccounts = latestAccounts.filter(isAccountSyncable);
      const hasCurrentSelected = syncableAccounts.some((account: SyncableAccount) => account.id === syncingAccountId);
      if (!hasCurrentSelected) {
        setSyncingAccountId(syncableAccounts[0]?.id || 0);
      }
      return {
        tokens: nextTokens,
        accounts: latestAccounts,
      };
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokens.failedLoadToken'));
      return {
        tokens: [] as any[],
        accounts: [] as any[],
      };
    } finally {
      setLoading(false);
    }
  }, [syncingAccountId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showAdd || !form.accountId) {
      setGroupLoading(false);
      setGroupOptions(['default']);
      return;
    }

    let cancelled = false;
    setGroupLoading(true);
    api.getAccountTokenGroups(form.accountId)
      .then((res: any) => {
        if (cancelled) return;
        const groups: string[] = Array.isArray(res?.groups)
          ? res.groups.map((item: any) => String(item || '').trim()).filter(Boolean)
          : [];
        const normalized = Array.from(new Set(groups));
        const nextOptions = normalized.length > 0 ? normalized : ['default'];
        setGroupOptions(nextOptions);
        setForm((prev) => {
          if (nextOptions.includes(prev.group)) return prev;
          return { ...prev, group: nextOptions[0] };
        });
      })
      .catch((error: any) => {
        if (cancelled) return;
        setGroupOptions(['default']);
        setForm((prev) => ({ ...prev, group: 'default' }));
        toast.error(error?.message || tr('pages.tokens.failedPullGroupHasFallenBackDefault'));
      })
      .finally(() => {
        if (cancelled) return;
        setGroupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showAdd, form.accountId]);

  useEffect(() => {
    if (!editingToken?.id || !editingToken?.accountId) {
      setEditGroupLoading(false);
      setEditGroupOptions(['default']);
      return;
    }

    const currentGroup = (editingToken?.tokenGroup || '').trim() || 'default';
    let cancelled = false;
    setEditGroupLoading(true);
    api.getAccountTokenGroups(editingToken.accountId)
      .then((res: any) => {
        if (cancelled) return;
        const groups = Array.isArray(res?.groups)
          ? res.groups.map((item: any) => String(item || '').trim()).filter(Boolean)
          : [];
        const normalized = Array.from(new Set(groups));
        setEditGroupOptions((current) => {
          const next = normalized.length > 0 ? normalized : ['default'];
          if (next.includes(currentGroup)) return next;
          return [...next, currentGroup];
        });
      })
      .catch((error: any) => {
        if (cancelled) return;
        setEditGroupOptions((current) => (current.includes(currentGroup) ? current : [...current, currentGroup]));
        toast.error(error?.message || tr('pages.tokens.failedPullGroupGroup'));
      })
      .finally(() => {
        if (cancelled) return;
        setEditGroupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingToken?.id, editingToken?.accountId]);

  const accountClusteredTokens = useMemo(() => {
    const accountLabel = (token: any) => String(token?.account?.username || `account-${token?.accountId || 0}`).toLowerCase();
    const siteLabel = (token: any) => String(token?.site?.name || '').toLowerCase();
    const tokenName = (token: any) => String(token?.name || '').toLowerCase();

    return [...tokens].sort((left, right) => {
      const accountCmp = accountLabel(left).localeCompare(accountLabel(right));
      if (accountCmp !== 0) return accountCmp;
      const siteCmp = siteLabel(left).localeCompare(siteLabel(right));
      if (siteCmp !== 0) return siteCmp;
      const nameCmp = tokenName(left).localeCompare(tokenName(right));
      if (nameCmp !== 0) return nameCmp;
      return Number(left?.id || 0) - Number(right?.id || 0);
    });
  }, [tokens]);
  const allVisibleTokensSelected = accountClusteredTokens.length > 0
    && accountClusteredTokens.every((token) => selectedTokenIds.includes(token.id));

  const activeAccounts = useMemo(() => accounts.filter(isAccountSyncable), [accounts]);
  const activeAccountSelectOptions = useMemo(() => (
    activeAccounts.map((account) => {
      const accountName = account.username || `account-${account.id}`;
      const siteName = account.site?.name || '-';
      return {
        value: String(account.id),
        label: `${accountName} @ ${siteName}`,
        description: siteName,
      };
    })
  ), [activeAccounts]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shouldOpenCreate = isTruthyFlag(params.get('create'));
    const requestedAccountId = parsePositiveInt(params.get('accountId'));
    const requestedModel = (params.get('model') || '').trim();
    if (!shouldOpenCreate || !requestedAccountId) return;

    const preferredAccount = activeAccounts.find((account) => account.id === requestedAccountId);
    const fallbackAccount = preferredAccount || activeAccounts[0] || null;
    if (!fallbackAccount) return;

    setShowAdd(true);
    setCreateHintModelName(requestedModel);
    setSyncingAccountId(fallbackAccount.id);
    setForm((prev) => ({
      ...prev,
      accountId: fallbackAccount.id,
      group: 'default',
    }));

    if (!preferredAccount) {
      toast.info(tr('pages.tokens.accountsnotAvailableAutomaticAvailableaccounts'));
    }

    params.delete('create');
    params.delete('accountId');
    params.delete('model');
    params.delete('from');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [activeAccounts, location.pathname, location.search, navigate, toast]);

  useEffect(() => {
    const focusTokenId = readFocusTokenId(location.search);
    if (!focusTokenId || loading) return;

    const row = rowRefs.current.get(focusTokenId);
    const cleanedSearch = clearFocusParams(location.search);
    if (!row) {
      navigate({ pathname: location.pathname, search: cleanedSearch }, { replace: true });
      return;
    }

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightTokenId(focusTokenId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightTokenId((current) => (current === focusTokenId ? null : current));
    }, 2200);

    navigate({ pathname: location.pathname, search: cleanedSearch }, { replace: true });
  }, [loading, location.pathname, location.search, navigate, tokens]);

  const focusTokenRow = useCallback((tokenId: number) => {
    const row = rowRefs.current.get(tokenId);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightTokenId(tokenId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightTokenId((current) => (current === tokenId ? null : current));
    }, 2200);
  }, []);

  const withRowLoading = async (key: string, fn: () => Promise<void>) => {
    setRowLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
    } finally {
      setRowLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const toggleTokenSelection = (tokenId: number, checked: boolean) => {
    setSelectedTokenIds((current) => (
      checked
        ? Array.from(new Set([...current, tokenId]))
        : current.filter((id) => id !== tokenId)
    ));
  };

  const toggleSelectAllTokens = (checked: boolean) => {
    if (!checked) {
      setSelectedTokenIds((current) => current.filter((id) => !accountClusteredTokens.some((token) => token.id === id)));
      return;
    }
    setSelectedTokenIds((current) => Array.from(new Set([...current, ...accountClusteredTokens.map((token) => token.id)])));
  };

  const toggleTokenDetails = (tokenId: number) => {
    setExpandedTokenIds((current) => (
      current.includes(tokenId)
        ? current.filter((id) => id !== tokenId)
        : [...current, tokenId]
    ));
  };

  const runBatchTokenAction = async (action: 'enable' | 'disable' | 'delete', skipDeleteConfirm = false) => {
    if (selectedTokenIds.length === 0) return;
    if (action === 'delete' && !skipDeleteConfirm) {
      setDeleteConfirm({ mode: 'batch', count: selectedTokenIds.length });
      return;
    }

    setBatchActionLoading(true);
    try {
      const result = await api.batchUpdateAccountTokens({
        ids: selectedTokenIds,
        action,
      });
      const successIds = Array.isArray(result?.successIds) ? result.successIds.map((id: unknown) => Number(id)) : [];
      const failedItems = Array.isArray(result?.failedItems) ? result.failedItems : [];
      if (failedItems.length > 0) {
        toast.info(`批量操作完成：成功 ${successIds.length}，失败 ${failedItems.length}`);
      } else {
        toast.success(`批量操作完成：成功 ${successIds.length}`);
      }
      setSelectedTokenIds(failedItems.map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id) && id > 0));
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.operationFailed'));
    } finally {
      setBatchActionLoading(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteConfirm;
    if (!target) return;

    setDeleteConfirm(null);
    if (target.mode === 'single' && target.tokenId) {
      await withRowLoading(`token-${target.tokenId}-delete`, async () => {
        await api.deleteAccountToken(target.tokenId!);
        toast.success(tr('pages.tokens.tokenDeleted'));
        await load();
      });
      return;
    }

    await runBatchTokenAction('delete', true);
  };

  const openEditPanel = useCallback((token: any) => {
    setShowAdd(false);
    setCreateHintModelName('');
    setEditingToken(token);
    editingTokenIdRef.current = token.id;
    setEditingTokenPendingMessage(
      isMaskedPendingToken(token)
        ? tr('pages.tokens.tokenSaveUpstreamResponse')
        : '',
    );
    setEditForm({
      name: token?.name || '',
      token: '',
      group: (token?.tokenGroup || '').trim() || 'default',
      enabled: isMaskedPendingToken(token) ? true : token?.enabled !== false,
      isDefault: !!token?.isDefault,
    });
    setEditCompatibilityPolicyForm(policyFormFromStoredValue(token?.compatibilityPolicy));

    if (isMaskedPendingToken(token)) {
      setEditingTokenValueLoading(false);
      return;
    }

    setEditingTokenValueLoading(true);

    void api.getAccountTokenValue(token.id)
      .then((res: any) => {
        if (editingTokenIdRef.current !== token.id) return;
        setEditForm((prev) => ({
          ...prev,
          token: typeof res?.token === 'string' ? res.token : prev.token,
        }));
      })
      .catch((error: any) => {
        if (editingTokenIdRef.current !== token.id) return;
        toast.error(error?.message || tr('pages.tokens.tokendetailsfailed'));
      })
      .finally(() => {
        if (editingTokenIdRef.current !== token.id) return;
        setEditingTokenValueLoading(false);
      });
  }, [toast]);

  const closeEditPanel = useCallback(() => {
    editingTokenIdRef.current = null;
    setEditingToken(null);
    setSavingEdit(false);
    setEditingTokenValueLoading(false);
    setEditingTokenPendingMessage('');
    setEditForm({
      name: '',
      token: '',
      group: 'default',
      enabled: true,
      isDefault: false,
    });
    setEditCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm());
  }, []);

  const saveEditPanel = async () => {
    if (!editingToken) return;
    if (isMaskedPendingToken(editingToken) && !editForm.token.trim()) {
      toast.error(tr('pages.tokens.tokenSave'));
      return;
    }
    const serializedCompatibilityPolicy = serializeCompatibilityPolicyForm(editCompatibilityPolicyForm);
    if (!serializedCompatibilityPolicy.ok) {
      toast.error(serializedCompatibilityPolicy.error);
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateAccountToken(editingToken.id, {
        name: editForm.name.trim() || editingToken.name,
        token: editForm.token.trim() || undefined,
        group: editForm.group || 'default',
        enabled: editForm.enabled,
        isDefault: editForm.isDefault,
        compatibilityPolicy: serializedCompatibilityPolicy.policy,
      });
      toast.success(tr('pages.tokens.token2'));
      closeEditPanel();
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.updateTokenFailed'));
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    if (!pendingAutoOpenTokenId || loading) return;
    const token = tokens.find((item: any) => item.id === pendingAutoOpenTokenId);
    if (!token) return;
    focusTokenRow(token.id);
    openEditPanel(token);
    setPendingAutoOpenTokenId(null);
  }, [focusTokenRow, loading, openEditPanel, pendingAutoOpenTokenId, tokens]);

  const handleTokenRowClick = (tokenId: number, event: React.MouseEvent<HTMLTableRowElement>) => {
    if (shouldIgnoreRowSelectionClick(event.target)) return;
    const isSelected = selectedTokenIds.includes(tokenId);
    toggleTokenSelection(tokenId, !isSelected);
  };

  const handleCopyToken = async (tokenId: number, tokenName: string) => {
    try {
      await withRowLoading(`token-${tokenId}-copy`, async () => {
        const res = await api.getAccountTokenValue(tokenId);
        const tokenValue = (res?.token || '').trim();
        if (!tokenValue) {
          toast.error(tr('pages.tokens.tokenEmptyCannotCopied'));
          return;
        }

        await copyText(tokenValue);
        toast.success(`已复制令牌：${tokenName || `token-${tokenId}`}`);
      });
    } catch (error: any) {
      toast.error(error?.message || tr('pages.tokens.copytokenfailed'));
    }
  };

  const handleAddToken = async () => {
    if (!form.accountId) return;
    if (!form.unlimitedQuota) {
      const remainQuota = Number.parseInt(form.remainQuota, 10);
      if (!Number.isFinite(remainQuota) || remainQuota <= 0) {
        toast.error(tr('pages.tokens.limitedTokensPleaseFillPositiveIntegerAmount'));
        return;
      }
    }
    const serializedCompatibilityPolicy = serializeCompatibilityPolicyForm(createCompatibilityPolicyForm);
    if (!serializedCompatibilityPolicy.ok) {
      toast.error(serializedCompatibilityPolicy.error);
      return;
    }
    setSaving(true);
    try {
      const remainQuota = form.unlimitedQuota
        ? undefined
        : Number.parseInt(form.remainQuota, 10);
      await api.addAccountToken({
        accountId: form.accountId,
        name: form.name,
        group: form.group || 'default',
        unlimitedQuota: form.unlimitedQuota,
        remainQuota,
        expiredTime: form.expiredTime || undefined,
        allowIps: form.allowIps,
        compatibilityPolicy: serializedCompatibilityPolicy.policy,
      });
      toast.success(tr('pages.tokens.tokenHasBeenCreatedSynchronizedSite'));
      setForm(initialCreateForm);
      setCreateCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm());
      setShowAdd(false);
      setCreateHintModelName('');
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokens.failedCreateToken'));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = useCallback(async () => {
    if (!syncingAccountId) return;
    setSyncing(true);
    try {
      const res = await api.syncAccountTokens(syncingAccountId) as AccountTokenSyncResult;
      const status = resolveSyncStatus(res);
      if (status === 'failed') {
        toast.error(`同步失败：${resolveSyncMessage(res, tr('pages.tokens.checkaccountstokenSitesstatus'))}`);
      } else if (isMaskedPendingSyncResult(res)) {
        toast.info(resolveSyncMessage(res, tr('pages.tokens.upstreamResponseTokenToken')));
        const loaded = await load();
        const pendingIds = Array.isArray(res.pendingTokenIds)
          ? res.pendingTokenIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
          : [];
        const nextTokens = Array.isArray(loaded?.tokens) ? loaded.tokens : [];
        if (pendingIds.length === 1) {
          const pendingToken = nextTokens.find((token: any) => token.id === pendingIds[0]);
          if (pendingToken) {
            focusTokenRow(pendingToken.id);
            openEditPanel(pendingToken);
          } else {
            setPendingAutoOpenTokenId(pendingIds[0] || null);
          }
        } else if (pendingIds.length > 1) {
          focusTokenRow(pendingIds[0]!);
        }
        return;
      } else if (status === 'skipped') {
        toast.info(`同步已跳过：${resolveSyncMessage(res, tr('pages.tokens.noAvailableSessionCookieAccount'))}`);
      } else {
        toast.success(`同步完成：新增 ${res.created || 0}，更新 ${res.updated || 0}`);
      }
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokens.syncTokenFailed'));
    } finally {
      setSyncing(false);
    }
  }, [focusTokenRow, load, openEditPanel, syncingAccountId, toast]);

  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true);
    try {
      const res = await api.syncAllAccountTokens();
      if (res?.queued) {
        toast.info(res.message || tr('pages.tokens.tokenSynchronizationHasStartedPleaseCheckLog'));
        await load();
        return;
      }

      const syncResults = (
        Array.isArray(res?.results) ? res.results
          : Array.isArray(res?.items) ? res.items
            : Array.isArray(res?.accounts) ? res.accounts
              : []
      ) as AccountTokenSyncResult[];

      if (syncResults.length === 0) {
        const status = resolveSyncStatus(res as AccountTokenSyncResult);
        if (status === 'failed') {
          toast.error(`全部同步失败：${resolveSyncMessage(res, tr('pages.tokens.tryAgainLater'))}`);
        } else if (status === 'skipped') {
          toast.info(`全部同步已跳过：${resolveSyncMessage(res, tr('pages.tokens.syncAccounts'))}`);
        } else {
          toast.success(tr('pages.tokens.allAccountsHaveBeenSynchronized'));
        }
      } else {
        const failedRows = syncResults.filter((item) => resolveSyncStatus(item) === 'failed');
        const skippedRows = syncResults.filter((item) => resolveSyncStatus(item) === 'skipped');
        const successRows = syncResults.filter((item) => resolveSyncStatus(item) === 'success');
        const maskedRows = syncResults.filter((item) => isMaskedPendingSyncResult(item));

        toast.success(`全部同步完成：成功 ${successRows.length}，跳过 ${skippedRows.length}，失败 ${failedRows.length}`);

        failedRows.slice(0, 3).forEach((item) => {
          toast.error(`${resolveAccountLabel(item)} 同步失败：${resolveSyncMessage(item, tr('pages.tokens.checkaccountsconfiguration'))}`);
        });
        maskedRows.slice(0, 3).forEach((item) => {
          toast.info(`${resolveAccountLabel(item)} 需要补全明文 token：${resolveSyncMessage(item, tr('pages.tokens.upstreamResponseToken'))}`);
        });
        skippedRows.slice(0, 3).forEach((item) => {
          toast.info(`${resolveAccountLabel(item)} 已跳过：${resolveSyncMessage(item, tr('pages.tokens.syncitems'))}`);
        });

        if (failedRows.length > 3) {
          toast.error(`另有 ${failedRows.length - 3} 个失败账号，请查看日志`);
        }
        if (skippedRows.length > 3) {
          toast.info(`另有 ${skippedRows.length - 3} 个跳过账号，请查看日志`);
        }
      }

      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokens.allSynchronizationFailed'));
    } finally {
      setSyncingAll(false);
    }
  }, [load, toast]);

  const handleToggleAdd = useCallback(() => {
    setShowAdd((prev) => {
      const nextOpen = !prev;
      if (!nextOpen) {
        setCreateHintModelName('');
        setCreateCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm());
      }
      return nextOpen;
    });
  }, []);

  const headerActions = useMemo(() => (
    <div className="flex flex-wrap items-center gap-2">
      {isMobile ? (
        <>
          <Button variant="outline"
            type="button"
            onClick={() => setShowMobileTools(true)}
           
           
          >
            {tr('pages.tokens.syncFilter')}
          </Button>
          <Button variant="outline"
            type="button"
            data-testid="tokens-mobile-select-all"
            onClick={() => toggleSelectAllTokens(!allVisibleTokensSelected)}
           
           
          >
            {allVisibleTokensSelected ? tr('pages.accounts.cancelselectAll') : tr('pages.accounts.selectVisibleItems')}
          </Button>
        </>
      ) : (
        <>
          <div className="relative min-w-56">
            <ModernSelect
              size="sm"
              value={String(syncingAccountId || 0)}
              onChange={(nextValue) => setSyncingAccountId(Number.parseInt(nextValue, 10) || 0)}
              options={[
                { value: '0', label: tr('pages.tokens.selectAccountSyncSiteTokens') },
                ...activeAccountSelectOptions,
              ]}
              placeholder={tr('pages.tokens.selectAccountSyncSiteTokens')}
              searchable
              searchPlaceholder={ACCOUNT_SELECT_SEARCH_PLACEHOLDER}
            />
          </div>
          <Button type="button" variant="outline"
            onClick={handleSync}
            disabled={syncing || syncingAll || !syncingAccountId}
           
           
          >
            {syncing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.tokens.syncing')}</> : tr('pages.tokens.syncSiteTokens')}
          </Button>
          <Button type="button" variant="outline"
            onClick={handleSyncAll}
            disabled={syncing || syncingAll || activeAccounts.length === 0}
           
           
          >
            {syncingAll ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.tokens.syncing')}</> : tr('pages.tokens.syncAllAccounts')}
          </Button>
        </>
      )}
      <Button type="button"
        onClick={handleToggleAdd}
       
      >
        {showAdd ? tr('app.cancel') : tr('pages.tokens.newToken')}
      </Button>
    </div>
  ), [activeAccountSelectOptions, activeAccounts.length, allVisibleTokensSelected, embedded, handleSync, handleSyncAll, handleToggleAdd, isMobile, showAdd, syncing, syncingAccountId, syncingAll]);

  useEffect(() => {
    if (!embedded || !onEmbeddedActionsChange) return;
    onEmbeddedActionsChange(headerActions);
    return () => {
      onEmbeddedActionsChange(null);
    };
  }, [embedded, headerActions, onEmbeddedActionsChange]);

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {(!embedded || !onEmbeddedActionsChange) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {!embedded ? <h2 className="text-xl font-semibold">{tr('components.searchModal.accountstoken')}</h2> : <div />}
          {headerActions}
        </div>
      )}

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileTools}
        onMobileClose={() => setShowMobileTools(false)}
        mobileTitle={tr('pages.tokens.tokensyncFilter')}
        mobileContent={(
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">{tr('pages.tokens.syncaccounts')}</div>
              <ModernSelect
                value={String(syncingAccountId || 0)}
                onChange={(nextValue) => setSyncingAccountId(Number.parseInt(nextValue, 10) || 0)}
                options={[
                  { value: '0', label: tr('pages.tokens.selectAccountSyncSiteTokens') },
                  ...activeAccountSelectOptions,
                ]}
                placeholder={tr('pages.tokens.selectAccountSyncSiteTokens')}
                searchable
                searchPlaceholder={ACCOUNT_SELECT_SEARCH_PLACEHOLDER}
              />
            </div>
            <Button type="button" variant="outline"
              onClick={handleSync}
              disabled={syncing || syncingAll || !syncingAccountId}
             
             
            >
              {syncing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.tokens.syncing')}</> : tr('pages.tokens.syncSiteTokens')}
            </Button>
            <Button type="button" variant="outline"
              onClick={handleSyncAll}
              disabled={syncing || syncingAll || activeAccounts.length === 0}
             
             
            >
              {syncingAll ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.tokens.syncing')}</> : tr('pages.tokens.syncAllAccounts')}
            </Button>
          </div>
        )}
      />

      <InfoNote className="mb-3">
        {tr('pages.tokens.tokenCallssitesApiKeyAutomaticsyncSupportedsettingsgroupQuota')}
      </InfoNote>

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title={tr('pages.tokens.deletetoken2')}
        confirmText={tr('components.deleteConfirmModal.delete')}
        loading={batchActionLoading || (deleteConfirm?.mode === 'single' && !!rowLoading[`token-${deleteConfirm?.tokenId}-delete`])}
        description={deleteConfirm?.mode === 'single'
          ? <>{tr('pages.tokens.deletetoken')} <strong>{deleteConfirm.tokenName || `#${deleteConfirm.tokenId}`}</strong> {tr('pages.accounts.textqcmnqj')}</>
          : <>{tr('pages.accounts.deleteZh')} <strong>{deleteConfirm?.count || 0}</strong> {tr('pages.tokens.tokens')}</>}
      />

      <CenteredModal
        open={Boolean(editingToken)}
        onClose={closeEditPanel}
        title={tr('pages.tokens.edittoken')}
        maxWidth={760}
        bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeEditPanel}>{tr('app.cancel')}</Button>
            <Button type="button" onClick={saveEditPanel} disabled={savingEdit || editingTokenValueLoading}>
              {savingEdit ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.accounts.saveChanges')}
            </Button>
          </>
        )}
      >
        {editingToken ? (
          <>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {tr('pages.tokens.accounts')} {editingToken.account?.username || `account-${editingToken.accountId}`} @ {editingToken.site?.name || '-'}
            </div>
            {editingTokenPendingMessage ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {editingTokenPendingMessage}
              </div>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{tr('pages.tokens.info')}</CardTitle>
              </CardHeader>
              <CardContent>
              <ResponsiveFormGrid>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.tokenname')}</div>
                  <Input
                    placeholder={tr('pages.tokens.tokenname')}
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.group')}</div>
                  <ModernSelect
                    value={editForm.group || 'default'}
                    onChange={(nextValue) => setEditForm((prev) => ({ ...prev, group: nextValue || 'default' }))}
                    options={(editGroupOptions.length > 0 ? editGroupOptions : ['default']).map((group) => ({
                      value: group,
                      label: group,
                    }))}
                    placeholder={editGroupLoading ? tr('pages.tokens.groupLoading') : tr('pages.tokens.selectGroup')}
                    disabled={editGroupLoading}
                  />
                </div>
                <div className="col-span-full">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.token3')}</div>
                  <Textarea
                    placeholder={editingTokenValueLoading ? tr('pages.tokens.tokenloading') : tr('pages.tokens.token3')}
                    value={editForm.token}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, token: e.target.value }))}
                    className="min-h-24 font-mono leading-relaxed"
                    disabled={editingTokenValueLoading}
                  />
                </div>
              </ResponsiveFormGrid>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{tr('pages.tokens.statussettings')}</CardTitle>
              </CardHeader>
              <CardContent>
              <ResponsiveFormGrid>
                <label className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                   
                    checked={editForm.enabled}
                    onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, enabled: checked === true }))}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{tr('pages.tokens.enabledtoken')}</span>
                    <span className="text-xs text-muted-foreground">{tr('pages.tokens.closeToken')}</span>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                   
                    checked={editForm.isDefault}
                    onCheckedChange={(checked) => setEditForm((prev) => ({ ...prev, isDefault: checked === true }))}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{tr('pages.tokens.defaultToken')}</span>
                    <span className="text-xs text-muted-foreground">{tr('pages.tokens.accountsDefaultToken')}</span>
                  </div>
                </label>
              </ResponsiveFormGrid>
              </CardContent>
            </Card>
            <UpstreamCompatibilityPolicyEditor
              value={editCompatibilityPolicyForm}
              disabled={savingEdit || editingTokenValueLoading}
              inheritFrom={tr('upstreamCompatibility.inheritSource.tokenChain')}
              onChange={setEditCompatibilityPolicyForm}
            />
          </>
        ) : null}
      </CenteredModal>

      {selectedTokenIds.length > 0 && (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={`已选 ${selectedTokenIds.length} 项`}
        >
          <Button type="button" variant="outline" onClick={() => runBatchTokenAction('enable')} disabled={batchActionLoading}>
            {tr('pages.accounts.enabled')}
          </Button>
          <Button type="button" variant="outline" onClick={() => runBatchTokenAction('disable')} disabled={batchActionLoading}>
            {tr('pages.accounts.disabled')}
          </Button>
          <Button type="button" variant="destructive" size="sm" data-testid="tokens-batch-delete" onClick={() => runBatchTokenAction('delete')} disabled={batchActionLoading}>
            {tr('pages.accounts.delete2')}
          </Button>
        </ResponsiveBatchActionBar>
      )}

      <CenteredModal
        open={showAdd}
        onClose={handleToggleAdd}
        title={tr('pages.tokens.token')}
        maxWidth={820}
        bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <ResponsiveFormGrid>
          <div className="col-span-full">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.accounts2')}</div>
            <ModernSelect
              value={String(form.accountId || 0)}
              onChange={(nextValue) => {
                setForm((prev) => ({
                  ...prev,
                  accountId: Number.parseInt(nextValue, 10) || 0,
                  group: '',
                }));
              }}
              options={[
                { value: '0', label: tr('pages.tokens.selectAccount') },
                ...activeAccountSelectOptions,
              ]}
              placeholder={tr('pages.tokens.selectAccount')}
              searchable
              searchPlaceholder={ACCOUNT_SELECT_SEARCH_PLACEHOLDER}
            />
          </div>
          {createHintModelName ? (
            <div className="col-span-full rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {tr('pages.tokens.routesModel')} <code className="text-xs">{createHintModelName}</code> {tr('pages.tokens.accountstokenAutomaticChannels')}
            </div>
          ) : null}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.tokenname2')}</div>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={tr('pages.tokens.exampleMetapi')}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.group')}</div>
            <ModernSelect
              value={form.group || ''}
              onChange={(nextValue) => setForm((prev) => ({ ...prev, group: nextValue }))}
              options={(groupOptions.length > 0 ? groupOptions : ['default']).map((group) => ({
                value: group,
                label: group,
              }))}
              placeholder={groupLoading ? tr('pages.tokens.groupLoading') : tr('pages.tokens.selectGroup')}
              disabled={!form.accountId || groupLoading}
            />
          </div>
          <div className="col-span-full flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
               
                checked={form.unlimitedQuota}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, unlimitedQuota: checked === true }))}  />
              {tr('pages.tokens.unlimitedQuota')}
            </label>
            {!form.unlimitedQuota && (
              <Input
                value={form.remainQuota}
                onChange={(e) => setForm((prev) => ({ ...prev, remainQuota: e.target.value.replace(/[^\d]/g, '') }))}
                placeholder={tr('pages.tokens.amountPositiveInteger')}
                className="max-w-56"
              />
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.expiredtime')}</div>
            <Input
              type="datetime-local"
              value={form.expiredTime}
              onChange={(e) => setForm((prev) => ({ ...prev, expiredTime: e.target.value }))}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('pages.tokens.ip')}</div>
            <Input
              value={form.allowIps}
              onChange={(e) => setForm((prev) => ({ ...prev, allowIps: e.target.value }))}
              placeholder={tr('pages.tokens.multipleSeparatedCommas')}
            />
          </div>
          <div className="col-span-full flex items-center text-xs text-muted-foreground">
            {tr('pages.tokens.zhaccountsSitesKey')}
          </div>
        </ResponsiveFormGrid>
        <UpstreamCompatibilityPolicyEditor
          value={createCompatibilityPolicyForm}
          disabled={saving}
          inheritFrom={tr('upstreamCompatibility.inheritSource.tokenChain')}
          onChange={setCreateCompatibilityPolicyForm}
        />

        <div className="mt-2 flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={handleToggleAdd}>{tr('app.cancel')}</Button>
          <Button type="button"
            onClick={handleAddToken}
            disabled={saving || !form.accountId}
           
          >
            {saving ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.oAuthManagement.creating')}</> : tr('pages.tokens.createSyncTokens')}
          </Button>
        </div>
      </CenteredModal>

      <>
        {loading ? (
          <div className="p-5">
            <Skeleton className="mb-2 h-[34px] w-full" />
            <Skeleton className="mb-2 h-[34px] w-full" />
            <Skeleton className="h-[34px] w-full" />
          </div>
        ) : tokens.length > 0 ? (
          isMobile ? (
            <div className="grid gap-3">
              {accountClusteredTokens.map((token: any) => {
                const loadingPrefix = `token-${token.id}`;
                const isPending = isMaskedPendingToken(token);
                const isExpanded = expandedTokenIds.includes(token.id);
                return (
                  <MobileCard
                    key={token.id}
                    title={token.name || '-'}
                    headerActions={(
                      <Checkbox
                       
                        aria-label={`选择令牌 ${token.name || token.id}`}
                        checked={selectedTokenIds.includes(token.id)}
                        onCheckedChange={(checked) => toggleTokenSelection(token.id, checked === true)}          />
                    )}
                    footerActions={(
                      <>
                        <Button variant="ghost" size="sm"
                          type="button"
                          onClick={() => toggleTokenDetails(token.id)}
                         
                        >
                          {isExpanded ? tr('pages.accounts.collapse') : tr('pages.accounts.details')}
                        </Button>
                        {!isPending ? (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => handleCopyToken(token.id, token.name || '')}
                            disabled={!!rowLoading[`${loadingPrefix}-copy`]}
                           
                            data-testid={`token-copy-${token.id}`}
                          >
                            {rowLoading[`${loadingPrefix}-copy`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.modelTester.copy')}
                          </Button>
                        ) : null}
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => openEditPanel(token)}
                         
                        >
                          {isPending ? tr('pages.tokens.edit') : tr('pages.accounts.edit')}
                        </Button>
                      </>
                    )}
                  >
                    <MobileField label={tr('components.searchModal.accounts2')} value={token.account?.username || `account-${token.accountId}`} />
                    <MobileField label={tr('pages.tokens.group')} value={token.tokenGroup || 'default'} />
                    <MobileField
                      label={tr('components.notificationPanel.status')}
                      value={(
                        <ToneBadge tone={isPending ? 'warning' : (token.enabled ? 'success' : 'muted')}>
                          {isPending ? tr('pages.tokens.incomplete') : (token.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled'))}
                        </ToneBadge>
                      )}
                    />
                    {isExpanded ? (
                      <div className="mt-3 grid gap-2">
                        <MobileField
                          label={tr('pages.tokens.token3')}
                          stacked
                          value={<span className="break-all font-mono text-xs">{token.tokenMasked || '***'}</span>}
                        />
                        <MobileField
                          label={tr('pages.tokens.sites')}
                          value={token.site?.url ? (
                            <a
                              href={token.site.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex"
                            >
                              <ToneBadge tone="-muted">
                                {token.site?.name || 'unknown'}
                              </ToneBadge>
                            </a>
                          ) : (
                            <ToneBadge tone="-muted">
                              {token.site?.name || 'unknown'}
                            </ToneBadge>
                          )}
                        />
                        <MobileField
                          label={tr('pages.tokens.default')}
                          value={token.isDefault ? <ToneBadge tone="-warning">{tr('pages.tokens.default')}</ToneBadge> : '-'}
                        />
                        <MobileField label={tr('pages.tokens.time')} value={formatDateTimeLocal(token.updatedAt)} />
                        <div className="flex flex-wrap items-center gap-2">
                          {!isPending && !token.isDefault && (
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => withRowLoading(`${loadingPrefix}-default`, async () => {
                                await api.setDefaultAccountToken(token.id);
                                toast.success(tr('pages.tokens.defaultTokenUpdated'));
                                await load();
                              })}
                              disabled={!!rowLoading[`${loadingPrefix}-default`]}
                             
                            >
                              {rowLoading[`${loadingPrefix}-default`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.tokens.setDefault')}
                            </Button>
                          )}
                          {!isPending ? (
                            <Button type="button" variant="secondary" size="sm"
                              onClick={() => withRowLoading(`${loadingPrefix}-toggle`, async () => {
                                await api.updateAccountToken(token.id, { enabled: !token.enabled });
                                toast.success(token.enabled ? tr('pages.tokens.tokenDisabled') : tr('pages.tokens.tokenEnabled'));
                                await load();
                              })}
                              disabled={!!rowLoading[`${loadingPrefix}-toggle`]}
                             
                            >
                              {rowLoading[`${loadingPrefix}-toggle`] ? <LoaderCircle className="size-4 animate-spin" /> : (token.enabled ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled'))}
                            </Button>
                          ) : null}
                          <Button type="button" variant="destructive" size="sm"
                            onClick={() => setDeleteConfirm({ mode: 'single', tokenId: token.id, tokenName: token.name || '' })}
                            disabled={!!rowLoading[`${loadingPrefix}-delete`]}
                           
                          >
                            {rowLoading[`${loadingPrefix}-delete`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.accounts.delete3')}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </MobileCard>
                );
              })}
            </div>
          ) : (
            <DataTable minWidth={1180} density="compact">
              <Table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-11">
                  <Checkbox
                   
                    checked={allVisibleTokensSelected}
                    onCheckedChange={(checked) => toggleSelectAllTokens(checked === true)}      />
                </TableHead>
                <TableHead>{tr('pages.tokens.tokenname')}</TableHead>
                <TableHead>{tr('pages.tokens.token3')}</TableHead>
                <TableHead>{tr('pages.tokens.sites')}</TableHead>
                <TableHead>{tr('components.searchModal.accounts2')}</TableHead>
                <TableHead>{tr('pages.tokens.group')}</TableHead>
                <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                <TableHead>{tr('pages.tokens.default')}</TableHead>
                <TableHead>{tr('pages.tokens.time')}</TableHead>
                <TableHead className="min-w-56 text-right">{tr('pages.accounts.actions2')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountClusteredTokens.map((token: any, i: number) => {
                const loadingPrefix = `token-${token.id}`;
                const isPending = isMaskedPendingToken(token);
                return (
                  <TableRow
                    key={token.id}
                    data-testid={`token-row-${token.id}`}
                    ref={(node) => {
                      if (node) rowRefs.current.set(token.id, node);
                      else rowRefs.current.delete(token.id);
                    }}
                    onClick={(event) => handleTokenRowClick(token.id, event)}
                    className={`animate-slide-up stagger-${Math.min(i + 1, 5)} row-selectable ${selectedTokenIds.includes(token.id) ? 'row-selected' : ''} ${highlightTokenId === token.id ? 'row-focus-highlight' : ''}`.trim()}
                  >
                    <TableCell>
                      <Checkbox
                        data-testid={`token-select-${token.id}`}
                       
                        checked={selectedTokenIds.includes(token.id)}
                        onCheckedChange={(checked) => toggleTokenSelection(token.id, checked === true)}            onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell className="font-semibold">{token.name || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{token.tokenMasked || '***'}</TableCell>
                    <TableCell>
                      {token.site?.url ? (
                        <a
                          href={token.site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ToneBadge tone="-muted">
                            {token.site?.name || 'unknown'}
                          </ToneBadge>
                        </a>
                      ) : (
                        <ToneBadge tone="-muted">
                          {token.site?.name || 'unknown'}
                        </ToneBadge>
                      )}
                    </TableCell>
                    <TableCell>{token.account?.username || `account-${token.accountId}`}</TableCell>
                    <TableCell>{token.tokenGroup || 'default'}</TableCell>
                    <TableCell>
                      {isPending ? (
                        <ToneBadge tone="-warning">{tr('pages.tokens.incomplete')}</ToneBadge>
                      ) : (
                        <ToneBadge tone={token.enabled ? 'success' : 'muted'}>
                          {token.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
                        </ToneBadge>
                      )}
                    </TableCell>
                    <TableCell>{token.isDefault ? <ToneBadge tone="-warning">{tr('pages.tokens.default')}</ToneBadge> : '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTimeLocal(token.updatedAt)}</TableCell>
                    <TableCell className="min-w-56 text-right">
                      <ButtonGroup className="flex-wrap justify-end">
                        {!isPending && !token.isDefault && (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => withRowLoading(`${loadingPrefix}-default`, async () => {
                              await api.setDefaultAccountToken(token.id);
                              toast.success(tr('pages.tokens.defaultTokenUpdated'));
                              await load();
                            })}
                            disabled={!!rowLoading[`${loadingPrefix}-default`]}
                           
                          >
                            {rowLoading[`${loadingPrefix}-default`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.tokens.setDefault')}
                          </Button>
                        )}
                        {!isPending ? (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => handleCopyToken(token.id, token.name || '')}
                            disabled={!!rowLoading[`${loadingPrefix}-copy`]}
                           
                            data-testid={`token-copy-${token.id}`}
                          >
                            {rowLoading[`${loadingPrefix}-copy`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.modelTester.copy')}
                          </Button>
                        ) : null}
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => openEditPanel(token)}
                         
                        >
                          {isPending ? tr('pages.tokens.edit') : tr('pages.accounts.edit')}
                        </Button>
                        {!isPending ? (
                          <Button type="button" variant="secondary" size="sm"
                            onClick={() => withRowLoading(`${loadingPrefix}-toggle`, async () => {
                              await api.updateAccountToken(token.id, { enabled: !token.enabled });
                              toast.success(token.enabled ? tr('pages.tokens.tokenDisabled') : tr('pages.tokens.tokenEnabled'));
                              await load();
                            })}
                            disabled={!!rowLoading[`${loadingPrefix}-toggle`]}
                           
                          >
                            {rowLoading[`${loadingPrefix}-toggle`] ? <LoaderCircle className="size-4 animate-spin" /> : (token.enabled ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled'))}
                          </Button>
                        ) : null}
                        <Button type="button" variant="destructive" size="sm"
                          onClick={() => setDeleteConfirm({ mode: 'single', tokenId: token.id, tokenName: token.name || '' })}
                          disabled={!!rowLoading[`${loadingPrefix}-delete`]}
                         
                        >
                          {rowLoading[`${loadingPrefix}-delete`] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.accounts.delete3')}
                        </Button>
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
              </Table>
            </DataTable>
          )
        ) : (
          <EmptyStateBlock
            title={tr('pages.tokens.nonetoken')}
            description={tr('pages.tokens.syncSiteTokensSitesToken')}
          />
        )}
      </>
    </div>
  );
}

export default function Tokens() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('segment', 'tokens');
  const nextSearch = params.toString();
  return <Navigate to={`/accounts${nextSearch ? `?${nextSearch}` : ''}`} replace />;
}
