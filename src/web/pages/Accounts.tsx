import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CenteredModal from "../components/CenteredModal.js";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.js";
import ResponsiveFormGrid from "../components/ResponsiveFormGrid.js";
import ResponsiveBatchActionBar from "../components/ResponsiveBatchActionBar.js";
import { useToast } from "../components/Toast.js";
import ModernSelect from "../components/ModernSelect.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import { useIsMobile } from "../components/useIsMobile.js";
import DeleteConfirmModal from "../components/DeleteConfirmModal.js";
import SiteBadgeLink from "../components/SiteBadgeLink.js";
import InfoNote from "../components/InfoNote.js";
import AccountModelsModal from "./accounts/AccountModelsModal.js";
import {
  buildAddAccountPrereqHint,
  buildVerifyFailureHint,
  normalizeVerifyFailureMessage,
} from "./helpers/accountVerifyFeedback.js";
import {
  isTruthyFlag,
  parsePositiveInt,
  resolveAccountCredentialMode,
} from "./helpers/accountConnection.js";
import {
  clearFocusParams,
  readFocusAccountIntent,
} from "./helpers/navigationFocus.js";
import { TokensPanel } from "./Tokens.js";
import { tr } from "../i18n.js";
import {
  buildCustomReorderUpdates,
  sortItemsForDisplay,
  type SortMode,
} from "./helpers/listSorting.js";
import { shouldIgnoreRowSelectionClick } from "./helpers/rowSelection.js";
import { SITE_DOCS_URL } from "../docsLink.js";
import { getSiteInitializationPreset } from "../../shared/siteInitializationPresets.js";
import { parseBatchApiKeys } from "../../shared/apiKeyBatch.js";
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../components/ToneBadge.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Card } from '../components/ui/card/index.js';
import EmptyStateBlock from "../components/EmptyStateBlock.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import { Input } from '../components/ui/input/index.js';

type ConnectionsSegment = "session" | "apikey" | "tokens";

const ACCOUNT_SEGMENTS: Array<{
  value: ConnectionsSegment;
  label: string;
  tooltip: string;
  tooltipSide: "top" | "bottom";
  tooltipAlign: "start" | "center" | "end";
}> = [
  {
    value: "session",
    label: "账号管理",
    tooltip: "用于签到、余额、状态维护",
    tooltipSide: "bottom",
    tooltipAlign: "start",
  },
  {
    value: "apikey",
    label: "API Key管理",
    tooltip: "只有 Base URL + Key 时使用，只负责代理调用",
    tooltipSide: "bottom",
    tooltipAlign: "center",
  },
  {
    value: "tokens",
    label: "账号令牌管理",
    tooltip: "从账号同步或手动维护，供路由实际调用",
    tooltipSide: "bottom",
    tooltipAlign: "end",
  },
];

const SITE_SELECT_SEARCH_PLACEHOLDER = "筛选站点（名称 / 平台 / URL）";

function createLoginForm() {
  return { siteId: 0, username: "", password: "" };
}

function createTokenForm(credentialMode: "session" | "apikey" = "session") {
  return {
    siteId: 0,
    username: "",
    accessToken: "",
    platformUserId: "",
    refreshToken: "",
    tokenExpiresAt: "",
    credentialMode,
    skipModelFetch: false,
  };
}

function createRebindForm(platformUserId = "") {
  return {
    accessToken: "",
    platformUserId,
    refreshToken: "",
    tokenExpiresAt: "",
  };
}

function resolveConnectionsSegment(search: string): ConnectionsSegment {
  const rawSegment = new URLSearchParams(search).get("segment");
  if (rawSegment === "apikey" || rawSegment === "tokens") return rawSegment;
  return "session";
}

export default function Accounts() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeSegment = useMemo(
    () => resolveConnectionsSegment(location.search),
    [location.search],
  );
  const [accounts, setAccounts] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [highlightAccountId, setHighlightAccountId] = useState<number | null>(
    null,
  );
  const [expandedAccountIds, setExpandedAccountIds] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"token" | "login">("token");
  const [loginForm, setLoginForm] = useState(createLoginForm);
  const [tokenForm, setTokenForm] = useState(() => createTokenForm("session"));
  const [createIntentPresetId, setCreateIntentPresetId] = useState<
    string | null
  >(null);
  const [applyCreatePresetModels, setApplyCreatePresetModels] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [embeddedTokenActions, setEmbeddedTokenActions] =
    useState<React.ReactNode>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | {
    mode: "single" | "batch";
    accountId?: number;
    accountName?: string;
    count?: number;
  }>(null);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    username: "",
    status: "active",
    checkinEnabled: true,
    unitCost: "",
    accessToken: "",
    apiToken: "",
    isPinned: false,
    refreshToken: "",
    tokenExpiresAt: "",
    proxyUrl: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [rebindTarget, setRebindTarget] = useState<any | null>(null);
  const [rebindForm, setRebindForm] = useState(() => createRebindForm());
  const [rebindVerifyResult, setRebindVerifyResult] = useState<any>(null);
  const [rebindVerifying, setRebindVerifying] = useState(false);
  const [rebindSaving, setRebindSaving] = useState(false);
  const [modelModal, setModelModal] = useState<{
    open: boolean;
    account: any | null;
    models: Array<{
      name: string;
      latencyMs: number | null;
      disabled: boolean;
      isManual?: boolean;
    }>;
    accountTokens?: Array<{
      id: number;
      name: string;
      tokenGroup?: string | null;
      enabled?: boolean;
      isDefault?: boolean;
      valueStatus?: string | null;
    }>;
    pendingDisabled: Set<string>;
    loading: boolean;
    saving: boolean;
    siteName: string;
    manualModelsInput: string;
    addingManualModels: boolean;
  }>({
    open: false,
    account: null,
    models: [],
    accountTokens: [],
    pendingDisabled: new Set(),
    loading: false,
    saving: false,
    siteName: "",
    manualModelsInput: "",
    addingManualModels: false,
  });
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRebindTargetRef = useRef<any | null>(null);
  const modelModalRequestSeqRef = useRef(0);
  const toast = useToast();
  if (rebindTarget) lastRebindTargetRef.current = rebindTarget;
  const activeRebindTarget = rebindTarget || lastRebindTargetRef.current;
  const isRebindSub2Api =
    (activeRebindTarget?.site?.platform || "").toLowerCase() === "sub2api";

  const load = async (forceRefresh = false) => {
    try {
      const snapshot = await api.getAccountsSnapshot(
        forceRefresh ? { refresh: true } : undefined,
      );
      const nextAccounts = Array.isArray(snapshot?.accounts)
        ? snapshot.accounts
        : [];
      const nextSites = Array.isArray(snapshot?.sites) ? snapshot.sites : [];
      setAccounts(nextAccounts);
      setSites(nextSites);
      setSelectedAccountIds((current) =>
        current.filter((id) =>
          nextAccounts.some((account: any) => account.id === id),
        ),
      );
    } catch (error: any) {
      toast.error(error?.message || "加载账号列表失败");
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const selectedTokenSite = useMemo(
    () => sites.find((item) => item.id === tokenForm.siteId) || null,
    [sites, tokenForm.siteId],
  );
  const parsedApiKeys = useMemo(
    () =>
      activeSegment === "apikey"
        ? parseBatchApiKeys(tokenForm.accessToken)
        : [],
    [activeSegment, tokenForm.accessToken],
  );
  const isBatchApiKeyInput =
    activeSegment === "apikey" && parsedApiKeys.length > 1;
  const siteSelectOptions = useMemo(
    () => [
      { value: "0", label: "选择站点" },
      ...sites.map((site: any) => ({
        value: String(site.id),
        label: `${site.name} (${site.platform})`,
        description: site.url || undefined,
      })),
    ],
    [sites],
  );
  const isSub2ApiSelected =
    (selectedTokenSite?.platform || "").toLowerCase() === "sub2api";
  const activeAddCredentialMode =
    activeSegment === "apikey" ? "apikey" : "session";
  const createIntentPreset = useMemo(
    () => getSiteInitializationPreset(createIntentPresetId),
    [createIntentPresetId],
  );

  const resetAddForms = (
    credentialMode: "session" | "apikey" = activeAddCredentialMode,
  ) => {
    setAddMode("token");
    setLoginForm(createLoginForm());
    setTokenForm(createTokenForm(credentialMode));
    setCreateIntentPresetId(null);
    setApplyCreatePresetModels(false);
    setVerifyResult(null);
  };

  const closeAddPanel = () => {
    setShowAdd(false);
    setVerifying(false);
    setSaving(false);
    resetAddForms();
  };

  const resolveAccountDisplayName = (account: any) => {
    const username =
      typeof account?.username === "string" ? account.username.trim() : "";
    if (username) return username;
    return resolveAccountCredentialMode(account) === "apikey"
      ? "API Key 连接"
      : "未命名";
  };

  const sortedAccounts = useMemo(
    () =>
      sortItemsForDisplay(
        accounts,
        sortMode,
        (account) => account.balance || 0,
      ),
    [accounts, sortMode],
  );
  const visibleAccounts = useMemo(() => {
    if (activeSegment === "tokens") return [];
    return sortedAccounts.filter(
      (account) => resolveAccountCredentialMode(account) === activeSegment,
    );
  }, [activeSegment, sortedAccounts]);
  const allVisibleAccountsSelected =
    visibleAccounts.length > 0 &&
    visibleAccounts.every((account) => selectedAccountIds.includes(account.id));
  const verifyFailureHint = buildVerifyFailureHint(verifyResult);
  const addAccountPrereqHint = buildAddAccountPrereqHint(verifyResult);

  const setSegment = (nextSegment: ConnectionsSegment) => {
    const params = new URLSearchParams(location.search);
    if (nextSegment === "session") params.delete("segment");
    else params.set("segment", nextSegment);
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: false },
    );
  };

  useEffect(() => {
    if (activeSegment !== "tokens") return;
    closeAddPanel();
    if (rebindTarget) closeRebindPanel();
    setEditingAccount(null);
  }, [activeSegment]);

  useEffect(() => {
    if (activeSegment === "tokens") return;
    setEmbeddedTokenActions(null);
  }, [activeSegment]);

  useEffect(() => {
    if (activeSegment === "tokens" || !loaded) return;
    const params = new URLSearchParams(location.search);
    const shouldOpenCreate = isTruthyFlag(params.get("create"));
    const requestedSiteId = parsePositiveInt(params.get("siteId"));
    if (!shouldOpenCreate || !requestedSiteId) return;

    const credentialMode = activeSegment === "apikey" ? "apikey" : "session";
    const initializationPreset = getSiteInitializationPreset(
      params.get("initPreset"),
    );
    setShowAdd(true);
    setAddMode("token");
    setVerifyResult(null);
    setCreateIntentPresetId(initializationPreset?.id || null);
    setApplyCreatePresetModels(
      Boolean(initializationPreset?.recommendedModels?.length),
    );
    setLoginForm(createLoginForm());
    setTokenForm({
      ...createTokenForm(credentialMode),
      siteId: requestedSiteId,
      skipModelFetch:
        credentialMode === "apikey" &&
        initializationPreset?.recommendedSkipModelFetch === true,
    });

    params.delete("create");
    params.delete("siteId");
    params.delete("from");
    params.delete("initPreset");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [activeSegment, loaded, location.pathname, location.search, navigate]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const handleLoginAdd = async () => {
    if (!loginForm.siteId || !loginForm.username || !loginForm.password) return;
    setSaving(true);
    try {
      const result = await api.loginAccount(loginForm);
      if (result.success) {
        closeAddPanel();
        const msg = result.apiTokenFound
          ? `账号 "${loginForm.username}" 已添加，API Key 已自动获取`
          : `账号 "${loginForm.username}" 已添加（未找到 API Key，请手动设置）`;
        toast.success(msg);
        load(true);
      } else {
        toast.error(result.message || "登录失败");
      }
    } catch (e: any) {
      toast.error(e.message || "登录请求失败");
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyToken = async () => {
    if (!tokenForm.siteId || !tokenForm.accessToken) return;
    if (isBatchApiKeyInput) {
      toast.info(
        `检测到 ${parsedApiKeys.length} 个 API Key，批量模式会在添加时逐条校验`,
      );
      return;
    }
    const credentialMode = activeSegment === "apikey" ? "apikey" : "session";
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.verifyToken({
        siteId: tokenForm.siteId,
        accessToken: tokenForm.accessToken,
        platformUserId: tokenForm.platformUserId
          ? parseInt(tokenForm.platformUserId)
          : undefined,
        credentialMode,
      });
      setVerifyResult(result);
      if (result.success) {
        if (result.tokenType === "apikey") {
          toast.success(
            `API Key 验证成功（可用模型 ${result.modelCount || 0} 个）`,
          );
        } else {
          toast.success(
            `Session 验证成功: ${result.userInfo?.username || "未知用户"}`,
          );
        }
      } else {
        toast.error(
          normalizeVerifyFailureMessage(result.message || "Token 无效"),
        );
      }
    } catch (e: any) {
      toast.error(normalizeVerifyFailureMessage(e?.message));
      setVerifyResult({ success: false, message: e?.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleTokenAdd = async () => {
    if (!tokenForm.siteId || !tokenForm.accessToken) return;
    if (
      !isBatchApiKeyInput &&
      !verifyResult?.success &&
      !tokenForm.skipModelFetch
    ) {
      toast.error("请先验证 Token 成功后再添加账号");
      return;
    }
    const credentialMode = activeSegment === "apikey" ? "apikey" : "session";
    const initializationPreset = createIntentPreset;
    setSaving(true);
    try {
      const result = await api.addAccount({
        siteId: tokenForm.siteId,
        username: tokenForm.username.trim() || undefined,
        accessToken: tokenForm.accessToken,
        accessTokens: isBatchApiKeyInput ? parsedApiKeys : undefined,
        platformUserId: tokenForm.platformUserId
          ? parseInt(tokenForm.platformUserId)
          : undefined,
        refreshToken:
          isSub2ApiSelected && tokenForm.refreshToken.trim()
            ? tokenForm.refreshToken.trim()
            : undefined,
        tokenExpiresAt:
          isSub2ApiSelected && tokenForm.tokenExpiresAt.trim()
            ? Number.parseInt(tokenForm.tokenExpiresAt.trim(), 10)
            : undefined,
        credentialMode,
        skipModelFetch: tokenForm.skipModelFetch,
      });
      if (result?.batch) {
        closeAddPanel();
        const createdCount = Number(result.createdCount) || 0;
        const failedCount = Number(result.failedCount) || 0;
        if (createdCount > 0) {
          toast.success(
            `批量添加完成：成功 ${createdCount}，失败 ${failedCount}`,
          );
        }
        const failedItems = Array.isArray(result.items)
          ? result.items.filter((item: any) => item?.status === "failed")
          : [];
        if (failedItems.length > 0) {
          const firstMessage = failedItems[0]?.message || "创建失败";
          toast.error(`失败 ${failedItems.length} 条：${firstMessage}`);
        }
        load(true);
        return;
      }
      let seededRecommendedModels = false;
      const recommendedModels = initializationPreset?.recommendedModels || [];
      const createdAccountId = Number(result?.id) || 0;
      const shouldSeedRecommendedModels =
        credentialMode === "apikey" &&
        tokenForm.skipModelFetch &&
        applyCreatePresetModels &&
        recommendedModels.length > 0 &&
        createdAccountId > 0;
      if (shouldSeedRecommendedModels) {
        try {
          await api.addAccountAvailableModels(
            createdAccountId,
            recommendedModels,
          );
          seededRecommendedModels = true;
        } catch (seedErr: any) {
          toast.error(seedErr?.message || "连接已添加，但推荐模型补录失败");
        }
      }
      closeAddPanel();
      if (result.queued) {
        toast.info(result.message || "账号已添加，后台正在同步初始化信息。");
      } else if (result.tokenType === "apikey") {
        toast.success("已添加为 API Key 账号（可用于代理转发）");
      } else {
        const parts: string[] = [];
        if (result.usernameDetected) parts.push("用户名已自动识别");
        if (result.apiTokenFound) parts.push("API Key 已自动获取");
        const extra = parts.length ? `（${parts.join("，")}）` : "";
        toast.success(`账号已添加${extra}`);
      }
      if (seededRecommendedModels) {
        toast.success(
          `已补入 ${recommendedModels.length} 个推荐模型并重建路由`,
        );
      }
      load(true);
    } catch (e: any) {
      toast.error(e.message || "添加失败");
    } finally {
      setSaving(false);
    }
  };

  const withLoading = async (
    key: string,
    fn: () => Promise<any>,
    successMsg?: string,
  ) => {
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
      void load(true);
    }
  };

  const formatModelSuccess = (refresh: any) => {
    const models = Array.isArray(refresh?.modelsPreview)
      ? refresh.modelsPreview
      : [];
    const count = Number.isFinite(refresh?.modelCount)
      ? refresh.modelCount
      : models.length;
    if (models.length === 0) return `已获取到模型（共 ${count} 个）`;
    const preview = models.slice(0, 6).join("、");
    const suffix = `（共 ${count} 个）`;
    return `已获取到模型：${preview}${suffix}`;
  };

  const formatModelFailure = (refresh: any, messageFallback?: string) => {
    const code = refresh?.errorCode;
    if (code === "timeout") return "模型获取失败（请求超时）";
    if (code === "unauthorized") return "模型获取失败，API Key 已无效";
    if (code === "empty_models") return "模型获取失败：未获取到可用模型";
    return messageFallback || refresh?.errorMessage || "模型获取失败";
  };

  const handleCheckModels = async (accountId: number) => {
    const key = `models-${accountId}`;
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      const result = await api.checkModels(accountId);
      const refresh = result?.refresh;
      if (!refresh || refresh.status !== "success") {
        toast.error(formatModelFailure(refresh, result?.message));
      } else {
        toast.success(formatModelSuccess(refresh));
      }
    } catch (e: any) {
      toast.error(e.message || "模型获取失败");
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
      void load(true);
    }
  };

  const applyLoadedModelModal = (account: any, result: any) => {
    const models = Array.isArray(result?.models) ? result.models : [];
    const disabledSet = new Set<string>(
      models.filter((m: any) => m.disabled).map((m: any) => m.name as string),
    );
    setModelModal((s) => ({
      ...s,
      loading: false,
      models,
      accountTokens: Array.isArray(result?.accountTokens) ? result.accountTokens : [],
      pendingDisabled: disabledSet,
      siteName: result?.siteName || account.site?.name || s.siteName,
    }));
  };

  const loadModelModalModels = async (
    account: any,
    options: {
      refreshUpstream?: boolean;
      resetBeforeLoad?: boolean;
      closeOnError?: boolean;
      successMessage?: string | null;
      errorMessage?: string;
    } = {},
  ) => {
    const requestId = ++modelModalRequestSeqRef.current;
    setModelModal((s) => ({
      ...s,
      open: true,
      account,
      loading: true,
      ...(options.resetBeforeLoad
        ? {
            models: [],
            accountTokens: [],
            pendingDisabled: new Set<string>(),
            siteName: "",
            manualModelsInput: "",
          }
        : {}),
    }));
    try {
      if (options.refreshUpstream) {
        await api.checkModels(account.id);
      }
      const result = await api.getAccountModels(account.id);
      if (modelModalRequestSeqRef.current !== requestId) return;
      applyLoadedModelModal(account, result);
      if (options.successMessage) {
        toast.success(options.successMessage);
      }
    } catch (e: any) {
      if (modelModalRequestSeqRef.current !== requestId) return;
      toast.error(e.message || options.errorMessage || "加载模型列表失败");
      setModelModal((s) =>
        options.closeOnError
          ? { ...s, open: false, account: null, loading: false }
          : { ...s, loading: false },
      );
    }
  };

  const openModelModal = async (account: any) => {
    await loadModelModalModels(account, {
      resetBeforeLoad: true,
      closeOnError: true,
      errorMessage: "加载模型列表失败",
    });
  };

  const closeModelModal = () => {
    modelModalRequestSeqRef.current += 1;
    setModelModal((s) => ({
      ...s,
      open: false,
      account: null,
      manualModelsInput: "",
      addingManualModels: false,
    }));
  };

  const toggleModelDisabled = (modelName: string) => {
    setModelModal((s) => {
      const next = new Set(s.pendingDisabled);
      if (next.has(modelName)) next.delete(modelName);
      else next.add(modelName);
      return { ...s, pendingDisabled: next };
    });
  };

  const saveModelDisabled = async () => {
    if (!modelModal.account) return;
    const siteId = modelModal.account.siteId;
    setModelModal((s) => ({ ...s, saving: true }));
    try {
      await api.updateSiteDisabledModels(
        siteId,
        Array.from(modelModal.pendingDisabled),
      );
      try {
        await api.rebuildRoutes(false, false);
        toast.success("模型禁用设置已保存，路由已重建");
      } catch {
        toast.error("模型禁用设置已保存，但路由重建失败，请手动刷新路由");
      }
      closeModelModal();
    } catch (e: any) {
      toast.error(e.message || "保存失败");
    } finally {
      setModelModal((s) => ({ ...s, saving: false }));
    }
  };

  const handleAddManualModels = async () => {
    if (!modelModal.account || !modelModal.manualModelsInput.trim()) return;
    const modelsToAdd = modelModal.manualModelsInput
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (modelsToAdd.length === 0) return;

    setModelModal((s) => ({ ...s, addingManualModels: true }));
    try {
      const res = await api.addAccountAvailableModels(
        modelModal.account.id,
        modelsToAdd,
      );
      if (res.success) {
        toast.success("模型已手动添加");
        setModelModal((s) => ({ ...s, manualModelsInput: "" }));
        await loadModelModalModels(modelModal.account, {
          refreshUpstream: false,
        });
      } else {
        toast.error(res.message || "手动添加模型失败");
      }
    } catch (e: any) {
      toast.error(e.message || "手动添加模型失败");
    } finally {
      setModelModal((s) => ({ ...s, addingManualModels: false }));
    }
  };

  const runtimeHealthMap: Record<
    string,
    {
      label: string;
      cls: string;
      dotClass: string;
      pulse: boolean;
    }
  > = {
    healthy: {
      label: "健康",
      cls: "success",
      dotClass: "status-dot-success",
      pulse: true,
    },
    unhealthy: {
      label: "异常",
      cls: "error",
      dotClass: "status-dot-error",
      pulse: true,
    },
    degraded: {
      label: "降级",
      cls: "warning",
      dotClass: "status-dot-pending",
      pulse: true,
    },
    disabled: {
      label: "已禁用",
      cls: "muted",
      dotClass: "status-dot-muted",
      pulse: false,
    },
    unknown: {
      label: "未知",
      cls: "muted",
      dotClass: "status-dot-pending",
      pulse: false,
    },
  };

  const resolveRuntimeHealth = (account: any) => {
    if (account.status === "expired") {
      return {
        ...runtimeHealthMap.unhealthy,
        label: "已过期",
        reason: account.runtimeHealth?.reason || "连接凭证已过期，请更新凭证",
      };
    }
    const capabilities = resolveAccountCapabilities(account);
    const fallbackState =
      account.status === "disabled" || account.site?.status === "disabled"
        ? "disabled"
        : !capabilities.proxyOnly && account.status === "expired"
          ? "unhealthy"
          : "unknown";
    const state = account.runtimeHealth?.state || fallbackState;
    const cfg = runtimeHealthMap[state] || runtimeHealthMap.unknown;
    const reason =
      account.runtimeHealth?.reason ||
      (state === "disabled"
        ? "账号或站点已禁用"
        : state === "unhealthy"
          ? "最近健康检查失败"
          : "尚未获取运行健康信息");
    return { state, reason, ...cfg };
  };

  const resolveAccountCapabilities = (account: any) => {
    const fromServer = account?.capabilities;
    if (fromServer && typeof fromServer === "object") {
      return {
        canCheckin: !!fromServer.canCheckin,
        canRefreshBalance: !!fromServer.canRefreshBalance,
        proxyOnly: !!fromServer.proxyOnly,
      };
    }
    const hasSession =
      typeof account?.accessToken === "string" &&
      account.accessToken.trim().length > 0;
    return {
      canCheckin: hasSession,
      canRefreshBalance: hasSession,
      proxyOnly: !hasSession,
    };
  };

  const handleRefreshRuntimeHealth = async () => {
    setActionLoading((s) => ({ ...s, "health-refresh": true }));
    try {
      const res = await api.refreshAccountHealth();
      if (res?.queued) {
        toast.info(res.message || "账号状态刷新任务已提交，完成后会自动更新。");
      } else {
        toast.success(res?.message || "账号状态已刷新");
      }
      load(true);
    } catch (e: any) {
      toast.error(e.message || "刷新账号状态失败");
    } finally {
      setActionLoading((s) => ({ ...s, "health-refresh": false }));
    }
  };

  const handleToggleCheckin = async (account: any) => {
    const key = `checkin-toggle-${account.id}`;
    const nextEnabled = !account.checkinEnabled;
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await api.updateAccount(account.id, { checkinEnabled: nextEnabled });
      toast.success(
        nextEnabled ? "已开启签到" : "已关闭签到（全部签到会忽略此账号）",
      );
      load(true);
    } catch (e: any) {
      toast.error(e.message || "切换签到状态失败");
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const handleTogglePin = async (account: any) => {
    const key = `pin-toggle-${account.id}`;
    const nextPinned = !account.isPinned;
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await api.updateAccount(account.id, { isPinned: nextPinned });
      toast.success(nextPinned ? "账号已置顶" : "账号已取消置顶");
      load(true);
    } catch (e: any) {
      toast.error(e.message || "切换账号置顶失败");
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const handleMoveCustomOrder = async (
    account: any,
    direction: "up" | "down",
  ) => {
    const key = `reorder-${account.id}`;
    const updates = buildCustomReorderUpdates(accounts, account.id, direction);
    if (updates.length === 0) return;

    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await Promise.all(
        updates.map((update) =>
          api.updateAccount(update.id, { sortOrder: update.sortOrder }),
        ),
      );
      load(true);
    } catch (e: any) {
      toast.error(e.message || "更新账号排序失败");
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const parseAccountExtraConfig = (account: any): Record<string, any> => {
    try {
      return JSON.parse(account?.extraConfig || "{}") || {};
    } catch {
      return {};
    }
  };

  const extractManagedSub2ApiAuth = (account: any) => {
    const parsed = parseAccountExtraConfig(account);
    const auth = parsed?.sub2apiAuth || {};
    return {
      refreshToken:
        typeof auth.refreshToken === "string" ? auth.refreshToken : "",
      tokenExpiresAt: auth.tokenExpiresAt ? String(auth.tokenExpiresAt) : "",
    };
  };

  const openEditPanel = (account: any) => {
    const managedAuth = extractManagedSub2ApiAuth(account);
    const proxyUrl = parseAccountExtraConfig(account)?.proxyUrl || "";
    closeAddPanel();
    setRebindTarget(null);
    setEditingAccount(account);
    setEditForm({
      username: account?.username || "",
      status: account?.status || "active",
      checkinEnabled: account?.checkinEnabled !== false,
      unitCost:
        account?.unitCost === null || account?.unitCost === undefined
          ? ""
          : String(account.unitCost),
      accessToken: account?.accessToken || "",
      apiToken: account?.apiToken || "",
      isPinned: !!account?.isPinned,
      refreshToken: managedAuth.refreshToken,
      tokenExpiresAt: managedAuth.tokenExpiresAt,
      proxyUrl,
    });
  };

  const closeEditPanel = () => {
    setEditingAccount(null);
    setSavingEdit(false);
  };

  const saveEditPanel = async () => {
    if (!editingAccount) return;
    setSavingEdit(true);
    try {
      await api.updateAccount(editingAccount.id, {
        username: editForm.username.trim() || undefined,
        status: editForm.status,
        checkinEnabled: editForm.checkinEnabled,
        unitCost: editForm.unitCost.trim()
          ? Number(editForm.unitCost.trim())
          : null,
        accessToken: editForm.accessToken.trim(),
        apiToken: editForm.apiToken.trim() || null,
        isPinned: editForm.isPinned,
        refreshToken: editForm.refreshToken.trim() || null,
        tokenExpiresAt: editForm.tokenExpiresAt.trim()
          ? Number.parseInt(editForm.tokenExpiresAt.trim(), 10)
          : null,
        proxyUrl: editForm.proxyUrl.trim() || null,
      });
      toast.success("账号已更新");
      closeEditPanel();
      load(true);
    } catch (e: any) {
      toast.error(e.message || "更新账号失败");
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleAccountSelection = (accountId: number, checked: boolean) => {
    setSelectedAccountIds((current) =>
      checked
        ? Array.from(new Set([...current, accountId]))
        : current.filter((id) => id !== accountId),
    );
  };

  const toggleSelectAllVisibleAccounts = (checked: boolean) => {
    if (!checked) {
      setSelectedAccountIds((current) =>
        current.filter(
          (id) => !visibleAccounts.some((account) => account.id === id),
        ),
      );
      return;
    }
    setSelectedAccountIds((current) =>
      Array.from(
        new Set([...current, ...visibleAccounts.map((account) => account.id)]),
      ),
    );
  };

  const toggleAccountDetails = (accountId: number) => {
    setExpandedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  };

  const runBatchAccountAction = async (
    action: "enable" | "disable" | "delete" | "refreshBalance",
    skipDeleteConfirm = false,
  ) => {
    if (selectedAccountIds.length === 0) return;
    if (action === "delete" && !skipDeleteConfirm) {
      setDeleteConfirm({ mode: "batch", count: selectedAccountIds.length });
      return;
    }

    setBatchActionLoading(true);
    try {
      const result = await api.batchUpdateAccounts({
        ids: selectedAccountIds,
        action,
      });
      const successIds = Array.isArray(result?.successIds)
        ? result.successIds.map((id: unknown) => Number(id))
        : [];
      const failedItems = Array.isArray(result?.failedItems)
        ? result.failedItems
        : [];
      if (failedItems.length > 0) {
        toast.info(
          `批量操作完成：成功 ${successIds.length}，失败 ${failedItems.length}`,
        );
      } else {
        toast.success(`批量操作完成：成功 ${successIds.length}`);
      }
      setSelectedAccountIds(
        failedItems
          .map((item: any) => Number(item.id))
          .filter((id: number) => Number.isFinite(id) && id > 0),
      );
      load(true);
    } catch (e: any) {
      toast.error(e.message || "批量操作失败");
    } finally {
      setBatchActionLoading(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteConfirm;
    if (!target) return;

    setDeleteConfirm(null);
    if (target.mode === "single" && target.accountId) {
      await withLoading(
        `delete-${target.accountId}`,
        () => api.deleteAccount(target.accountId!),
        "已删除",
      );
      return;
    }

    await runBatchAccountAction("delete", true);
  };

  const handleAccountRowClick = (
    accountId: number,
    event: React.MouseEvent<HTMLTableRowElement>,
  ) => {
    if (shouldIgnoreRowSelectionClick(event.target)) return;
    const isSelected = selectedAccountIds.includes(accountId);
    toggleAccountSelection(accountId, !isSelected);
  };

  const extractPlatformUserId = (account: any): string => {
    const parsed = parseAccountExtraConfig(account);
    const raw = parsed?.platformUserId;
    const value = Number.parseInt(String(raw ?? ""), 10);
    if (Number.isFinite(value) && value > 0) return String(value);
    const guessed = Number.parseInt(
      String(account?.username || "").match(/(\d{3,8})$/)?.[1] || "",
      10,
    );
    return Number.isFinite(guessed) && guessed > 0 ? String(guessed) : "";
  };

  const openRebindPanel = (account: any) => {
    closeAddPanel();
    setEditingAccount(null);
    setRebindTarget(account);
    setRebindForm(createRebindForm(extractPlatformUserId(account)));
    setRebindVerifyResult(null);
  };

  const closeRebindPanel = () => {
    setRebindTarget(null);
    setRebindForm(createRebindForm());
    setRebindVerifyResult(null);
    setRebindVerifying(false);
    setRebindSaving(false);
  };

  const handleVerifyRebindToken = async () => {
    if (!rebindTarget || !rebindForm.accessToken.trim()) return;
    setRebindVerifying(true);
    setRebindVerifyResult(null);
    try {
      const result = await api.verifyToken({
        siteId: rebindTarget.siteId,
        accessToken: rebindForm.accessToken.trim(),
        platformUserId: rebindForm.platformUserId
          ? Number.parseInt(rebindForm.platformUserId, 10)
          : undefined,
        credentialMode: "session",
      });
      setRebindVerifyResult(result);
      if (result.success && result.tokenType === "session") {
        toast.success("Session Token 验证成功，可以重新绑定");
      } else if (result.success && result.tokenType !== "session") {
        toast.error("当前是 API Key，不是 Session Token");
      } else {
        toast.error(
          normalizeVerifyFailureMessage(result.message || "Token 无效"),
        );
      }
    } catch (e: any) {
      toast.error(normalizeVerifyFailureMessage(e?.message));
      setRebindVerifyResult({ success: false, message: e?.message });
    } finally {
      setRebindVerifying(false);
    }
  };

  const handleSubmitRebind = async () => {
    if (!rebindTarget || !rebindForm.accessToken.trim()) return;
    if (
      !(
        rebindVerifyResult?.success &&
        rebindVerifyResult?.tokenType === "session"
      )
    ) {
      toast.error("请先验证新的 Session Token 成功");
      return;
    }
    const isSub2ApiRebindTarget =
      (rebindTarget?.site?.platform || "").toLowerCase() === "sub2api";
    setRebindSaving(true);
    try {
      await api.rebindAccountSession(rebindTarget.id, {
        accessToken: rebindForm.accessToken.trim(),
        platformUserId: rebindForm.platformUserId
          ? Number.parseInt(rebindForm.platformUserId, 10)
          : undefined,
        refreshToken:
          isSub2ApiRebindTarget && rebindForm.refreshToken.trim()
            ? rebindForm.refreshToken.trim()
            : undefined,
        tokenExpiresAt:
          isSub2ApiRebindTarget && rebindForm.tokenExpiresAt.trim()
            ? Number.parseInt(rebindForm.tokenExpiresAt, 10)
            : undefined,
      });
      toast.success("账号重新绑定成功，状态已恢复");
      closeRebindPanel();
      load(true);
    } catch (e: any) {
      toast.error(e.message || "重新绑定失败");
    } finally {
      setRebindSaving(false);
    }
  };

  useEffect(() => {
    const { accountId, openRebind } = readFocusAccountIntent(location.search);
    if (!accountId || !loaded || activeSegment === "tokens") return;

    const target = visibleAccounts.find((account) => account.id === accountId);
    const row = rowRefs.current.get(accountId);
    const cleanedSearch = clearFocusParams(location.search);
    if (!target || !row) {
      navigate(
        { pathname: location.pathname, search: cleanedSearch },
        { replace: true },
      );
      return;
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightAccountId(accountId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightAccountId((current) =>
        current === accountId ? null : current,
      );
    }, 2200);

    if (
      openRebind &&
      target.status === "expired" &&
      !resolveAccountCapabilities(target).proxyOnly
    ) {
      setShowAdd(false);
      if (!rebindTarget || rebindTarget.id !== target.id) {
        openRebindPanel(target);
      }
    }

    navigate(
      { pathname: location.pathname, search: cleanedSearch },
      { replace: true },
    );
  }, [
    activeSegment,
    loaded,
    location.pathname,
    location.search,
    navigate,
    openRebindPanel,
    rebindTarget,
    visibleAccounts,
  ]);

  const canAddVerifiedConnection = Boolean(
    verifyResult?.success &&
    ((activeSegment === "apikey" && verifyResult.tokenType === "apikey") ||
      (activeSegment === "session" && verifyResult.tokenType === "session")),
  );
  const canSubmitApiKeyConnection =
    activeSegment === "apikey"
      ? isBatchApiKeyInput ||
        canAddVerifiedConnection ||
        !!tokenForm.skipModelFetch
      : canAddVerifiedConnection;

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-xl font-semibold">{tr("连接管理")}</h2>
        {activeSegment !== "tokens" && (
          <div className="flex flex-wrap items-center gap-2">
            {isMobile ? (
              <>
                <Button variant="outline"
                  type="button"
                  onClick={() => setShowMobileTools(true)}
                 
                 
                >
                  排序与操作
                </Button>
                <Button variant="outline"
                  type="button"
                  data-testid="accounts-mobile-select-all"
                  onClick={() =>
                    toggleSelectAllVisibleAccounts(!allVisibleAccountsSelected)
                  }
                 
                 
                >
                  {allVisibleAccountsSelected ? "取消全选" : "全选可见项"}
                </Button>
              </>
            ) : (
              <>
                <div className="relative min-w-40">
                  <ModernSelect
                    size="sm"
                    value={sortMode}
                    onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                    options={[
                      { value: "custom", label: "自定义排序" },
                      { value: "balance-desc", label: "余额高到低" },
                      { value: "balance-asc", label: "余额低到高" },
                    ]}
                    placeholder="自定义排序"
                  />
                </div>
                {activeSegment === "session" && (
                  <Button type="button"
                    onClick={() =>
                      withLoading(
                        "checkin-all",
                        () => api.triggerCheckinAll(),
                        "已触发全部签到",
                      )
                    }
                    disabled={actionLoading["checkin-all"]}
                   
                  >
                    {actionLoading["checkin-all"] ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        {tr("签到中...")}
                      </>
                    ) : (
                      tr("全部签到")
                    )}
                  </Button>
                )}
                <Button type="button"
                  onClick={handleRefreshRuntimeHealth}
                  disabled={actionLoading["health-refresh"]}
                 
                >
                  {actionLoading["health-refresh"] ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      {tr("刷新状态中...")}
                    </>
                  ) : (
                    tr("刷新账户状态")
                  )}
                </Button>
              </>
            )}
            <Button type="button"
              onClick={() => {
                const nextOpen = !showAdd;
                if (!nextOpen) {
                  closeAddPanel();
                  return;
                }
                setEditingAccount(null);
                closeRebindPanel();
                setShowAdd(true);
                resetAddForms(activeAddCredentialMode);
              }}
             
            >
              {showAdd ? tr("取消") : tr("+ 添加连接")}
            </Button>
          </div>
        )}
        {activeSegment === "tokens" && embeddedTokenActions}
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileTools}
        onMobileClose={() => setShowMobileTools(false)}
        mobileTitle="连接排序与操作"
        mobileContent={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                排序方式
              </div>
              <ModernSelect
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: "custom", label: "自定义排序" },
                  { value: "balance-desc", label: "余额高到低" },
                  { value: "balance-asc", label: "余额低到高" },
                ]}
                placeholder="自定义排序"
              />
            </div>
            {activeSegment === "session" && (
              <Button type="button" variant="outline"
                onClick={async () => {
                  setShowMobileTools(false);
                  await withLoading(
                    "checkin-all",
                    () => api.triggerCheckinAll(),
                    "已触发全部签到",
                  );
                }}
                disabled={actionLoading["checkin-all"]}
               
               
              >
                {actionLoading["checkin-all"] ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    {tr("签到中...")}
                  </>
                ) : (
                  tr("全部签到")
                )}
              </Button>
            )}
            <Button type="button" variant="outline"
              onClick={async () => {
                setShowMobileTools(false);
                await handleRefreshRuntimeHealth();
              }}
              disabled={actionLoading["health-refresh"]}
             
             
            >
              {actionLoading["health-refresh"] ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {tr("刷新状态中...")}
                </>
              ) : (
                tr("刷新账户状态")
              )}
            </Button>
          </div>
        }
      />

      <ButtonGroup className="mb-4">
        {ACCOUNT_SEGMENTS.map((segment) => (
          <Button
            key={segment.value}
            type="button"
            variant={activeSegment === segment.value ? "secondary" : "outline"}
            onClick={() => setSegment(segment.value)}
            data-tooltip={segment.tooltip}
            data-tooltip-side={segment.tooltipSide}
            data-tooltip-align={segment.tooltipAlign}
          >
            {segment.label}
          </Button>
        ))}
      </ButtonGroup>

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="确认删除连接"
        confirmText="确认删除"
        loading={
          batchActionLoading ||
          (deleteConfirm?.mode === "single" &&
            !!actionLoading[`delete-${deleteConfirm?.accountId}`])
        }
        description={
          deleteConfirm?.mode === "single" ? (
            <>
              确定要删除连接{" "}
              <strong>
                {deleteConfirm.accountName || `#${deleteConfirm.accountId}`}
              </strong>{" "}
              吗？
            </>
          ) : (
            <>
              确定要删除选中的 <strong>{deleteConfirm?.count || 0}</strong>{" "}
              个连接吗？
            </>
          )
        }
      />

      {activeSegment !== "tokens" && selectedAccountIds.length > 0 && (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={`已选 ${selectedAccountIds.length} 项`}
        >
          <Button type="button" variant="outline"
            data-testid="accounts-batch-refresh-balance"
            onClick={() => runBatchAccountAction("refreshBalance")}
            disabled={batchActionLoading}
           
           
          >
            批量刷新余额
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAccountAction("enable")}
            disabled={batchActionLoading}
           
           
          >
            批量启用
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAccountAction("disable")}
            disabled={batchActionLoading}
           
           
          >
            批量禁用
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={() => runBatchAccountAction("delete")}
            disabled={batchActionLoading}
           
          >
            批量删除
          </Button>
        </ResponsiveBatchActionBar>
      )}

      {activeSegment === "tokens" ? (
        <TokensPanel
          embedded
          onEmbeddedActionsChange={setEmbeddedTokenActions}
        />
      ) : (
        <>
          <CenteredModal
            open={showAdd}
            onClose={closeAddPanel}
            title={
              activeSegment === "apikey"
                ? "添加 API Key 连接"
                : addMode === "login"
                  ? "账号密码登录"
                  : "添加 Session 连接"
            }
            maxWidth={860}
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
            footer={
              <Button type="button" variant="outline" onClick={closeAddPanel}>
                取消
              </Button>
            }
          >
            {activeSegment === "session" ? (
              <>
                <div className="mb-4 flex gap-0 rounded-md bg-muted p-1">
                  <Button
                    type="button"
                    variant={addMode === "token" ? "secondary" : "outline"}
                    className="flex-1"
                    onClick={() => {
                      setAddMode("token");
                      setVerifyResult(null);
                    }}
                  >
                    Session Token / Cookie
                  </Button>
                  <Button
                    type="button"
                    variant={addMode === "login" ? "secondary" : "outline"}
                    className="flex-1"
                    onClick={() => {
                      setAddMode("login");
                      setVerifyResult(null);
                    }}
                  >
                    账号密码登录
                  </Button>
                </div>

                {addMode === "token" ? (
                  <div className="flex flex-col gap-3">
                    <InfoNote>
                      <div>
                        <div className="mb-1 font-semibold">
                          当前分段仅创建 Session 连接
                        </div>
                        <div>
                          <strong>推荐</strong> 使用系统访问令牌（Access
                          Token）；浏览器 Cookie 仅用于兼容场景。
                        </div>
                        <div className="mt-0.5">
                          以 NewAPI 为例：控制台 → 个人设置 → 安全设置 →
                          生成「系统访问令牌」
                        </div>
                        <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">
                          获取 Cookie:{" "}
                          <kbd className="rounded border bg-card px-1.5 py-0.5 text-xs">
                            F12
                          </kbd>{" "}
                          → Application → Cookie
                        </div>
                        <div className="mt-1.5">
                          <a
                            href={SITE_DOCS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary underline"
                          >
                            查看认证方式与特殊站点说明文档
                          </a>
                        </div>
                      </div>
                    </InfoNote>
                    <ModernSelect
                      value={String(tokenForm.siteId || 0)}
                      onChange={(nextValue) => {
                        const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                        setTokenForm((f) => ({ ...f, siteId: nextSiteId }));
                        setVerifyResult(null);
                      }}
                      options={siteSelectOptions}
                      placeholder="选择站点"
                      searchable
                      searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                    />
                    <Input
                      placeholder="连接名称（可选）"
                      value={tokenForm.username}
                      onChange={(e) =>
                        setTokenForm((f) => ({
                          ...f,
                          username: e.target.value,
                        }))
                      }
                    />
                    <Textarea
                      placeholder="粘贴 Session Access Token 或浏览器 Cookie"
                      value={tokenForm.accessToken}
                      onChange={(e) => {
                        setTokenForm((f) => ({
                          ...f,
                          accessToken: e.target.value.trim(),
                        }));
                        setVerifyResult(null);
                      }}
                      className="h-[72px] resize-none font-mono"
                    />
                    <div className="grid gap-1">
                      <Input
                        placeholder="用户 ID（可选）"
                        value={tokenForm.platformUserId}
                        onChange={(e) => {
                          setTokenForm((f) => ({
                            ...f,
                            platformUserId: e.target.value.replace(/\D/g, ""),
                          }));
                          setVerifyResult(null);
                        }}
                      />
                      <div className="text-xs text-muted-foreground">
                        若站点要求 New-Api-User / User-ID，请在这里提前填写。
                      </div>
                    </div>
                    {isSub2ApiSelected && (
                      <>
                        <div className="grid gap-1">
                          <Input
                            placeholder="Sub2API refresh_token（可选，用于托管自动续期）"
                            value={tokenForm.refreshToken}
                            onChange={(e) =>
                              setTokenForm((f) => ({
                                ...f,
                                refreshToken: e.target.value.trim(),
                              }))
                            }
                            className="font-mono"
                          />
                          <div className="text-xs text-muted-foreground">
                            可在浏览器控制台执行{" "}
                            <code className="font-mono">
                              localStorage.getItem('refresh_token')
                            </code>{" "}
                            获取。
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <Input
                            placeholder="token_expires_at（可选，毫秒时间戳）"
                            value={tokenForm.tokenExpiresAt}
                            onChange={(e) =>
                              setTokenForm((f) => ({
                                ...f,
                                tokenExpiresAt: e.target.value.replace(
                                  /\D/g,
                                  "",
                                ),
                              }))
                            }
                          />
                          <div className="text-xs text-muted-foreground">
                            配置 refresh_token 后，metapi 会在 JWT 临近过期或
                            401 时自动续期并回写新 token。
                          </div>
                        </div>
                      </>
                    )}
                    {verifyResult &&
                      verifyResult.success &&
                      verifyResult.tokenType === "session" && (
                        <Alert className="animate-scale-in">
                          <AlertTitle className="flex items-center gap-1.5">
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            Session 凭证有效（Access Token / Cookie）
                          </AlertTitle>
                          <AlertDescription className="leading-relaxed">
                            <div>
                              用户名:{" "}
                              <strong>
                                {verifyResult.userInfo?.username || "未知"}
                              </strong>
                            </div>
                            {verifyResult.balance && (
                              <div>
                                余额:{" "}
                                <strong>
                                  $
                                  {(verifyResult.balance.balance || 0).toFixed(
                                    2,
                                  )}
                                </strong>
                              </div>
                            )}
                            <div>
                              API Key:{" "}
                              <span className={verifyResult.apiToken ? "font-medium text-foreground" : "font-medium text-muted-foreground"}>
                                {verifyResult.apiToken
                                  ? `已找到 (${verifyResult.apiToken.substring(0, 8)}...)`
                                  : "未找到"}
                              </span>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                    {verifyResult &&
                      verifyResult.success &&
                      verifyResult.tokenType === "apikey" && (
                        <Alert className="animate-scale-in">
                          <AlertTitle>
                            当前分段仅接受 Session 凭证，请切到「API Key
                            连接」分段创建。
                          </AlertTitle>
                        </Alert>
                      )}
                    {verifyResult &&
                      !verifyResult.success &&
                      verifyResult.needsUserId && (
                        <Alert className="animate-scale-in">
                          <AlertTitle>
                            此站点要求用户 ID，请补充后重新验证
                          </AlertTitle>
                        </Alert>
                      )}
                    {verifyResult &&
                      !verifyResult.success &&
                      !verifyResult.needsUserId && (
                        <Alert variant="destructive" className="animate-scale-in">
                          <AlertTitle>
                            {normalizeVerifyFailureMessage(
                              verifyResult.message,
                            ) || "Token 无效或已过期"}
                          </AlertTitle>
                          <AlertDescription>
                            {verifyFailureHint || "请检查 Token 是否正确"}
                          </AlertDescription>
                        </Alert>
                      )}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline"
                        onClick={handleVerifyToken}
                        disabled={
                          verifying ||
                          !tokenForm.siteId ||
                          !tokenForm.accessToken
                        }
                       
                       
                      >
                        {verifying ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" />
                            验证中...
                          </>
                        ) : (
                          "验证 Token"
                        )}
                      </Button>
                      <Button type="button"
                        onClick={handleTokenAdd}
                        disabled={
                          saving ||
                          !tokenForm.siteId ||
                          !tokenForm.accessToken ||
                          !canAddVerifiedConnection
                        }
                       
                      >
                        {saving ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" />
                            添加中...
                          </>
                        ) : (
                          "添加连接"
                        )}
                      </Button>
                    </div>
                    {!verifyResult?.success && (
                      <div className="text-xs text-muted-foreground">
                        {addAccountPrereqHint}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <InfoNote>
                      输入目标站点的账号密码，将自动登录并获取访问令牌和 API Key
                    </InfoNote>
                    <ModernSelect
                      value={String(loginForm.siteId || 0)}
                      onChange={(nextValue) => {
                        const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                        setLoginForm((f) => ({ ...f, siteId: nextSiteId }));
                      }}
                      options={siteSelectOptions}
                      placeholder="选择站点"
                      searchable
                      searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                    />
                <Input
                  placeholder="用户名"
                  value={loginForm.username}
                      onChange={(e) =>
                        setLoginForm((f) => ({
                          ...f,
                          username: e.target.value,
                        }))
                      }
                    />
                    <Input
                      type="password"
                      placeholder="密码"
                      value={loginForm.password}
                      onChange={(e) =>
                        setLoginForm((f) => ({
                          ...f,
                          password: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleLoginAdd()}
                    />
                    <Button type="button"
                      onClick={handleLoginAdd}
                      disabled={
                        saving ||
                        !loginForm.siteId ||
                        !loginForm.username ||
                        !loginForm.password
                      }
                     
                     
                    >
                      {saving ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          登录并添加...
                        </>
                      ) : (
                        "登录并添加"
                      )}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <InfoNote>
                  API Key
                  连接只用于代理转发，不会自动派生账号令牌。系统会按站点平台能力自动引导到
                  Session 或 API Key 创建流程。
                </InfoNote>
                {createIntentPreset && (
                  <Alert className="animate-scale-in">
                    <AlertTitle>
                      {createIntentPreset.label}
                    </AlertTitle>
                    <AlertDescription className="leading-relaxed">
                      <div>{createIntentPreset.description}</div>
                      <div>
                        推荐模型：
                        {createIntentPreset.recommendedModels.join(" / ")}
                      </div>
                      {createIntentPreset.recommendedSkipModelFetch && (
                        <div>
                          建议直接跳过模型验证，先保存 Base URL +
                          Key，再补入推荐模型完成初始化。
                        </div>
                      )}
                    </AlertDescription>
                    {createIntentPreset.recommendedModels.length > 0 && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                         
                          checked={applyCreatePresetModels}
                          onCheckedChange={(checked) => setApplyCreatePresetModels(checked === true)}
                        />
                        <span>添加后自动补入推荐模型并重建路由</span>
                      </label>
                    )}
                  </Alert>
                )}
                <ModernSelect
                  value={String(tokenForm.siteId || 0)}
                  onChange={(nextValue) => {
                    const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                    setTokenForm((f) => ({
                      ...f,
                      siteId: nextSiteId,
                      credentialMode: "apikey",
                    }));
                    setVerifyResult(null);
                    if (
                      createIntentPresetId &&
                      nextSiteId !== tokenForm.siteId
                    ) {
                      setCreateIntentPresetId(null);
                      setApplyCreatePresetModels(false);
                    }
                  }}
                  options={siteSelectOptions}
                  placeholder="选择站点"
                  searchable
                  searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                />
                <Input
                  placeholder="连接名称（可选）"
                  value={tokenForm.username}
                  onChange={(e) =>
                    setTokenForm((f) => ({
                      ...f,
                      username: e.target.value,
                      credentialMode: "apikey",
                    }))
                  }
                />
                <Textarea
                  placeholder="粘贴 API Key"
                  value={tokenForm.accessToken}
                  onChange={(e) => {
                    setTokenForm((f) => ({
                      ...f,
                      accessToken: e.target.value,
                      credentialMode: "apikey",
                    }));
                    setVerifyResult(null);
                  }}
                  className="h-[72px] resize-none font-mono"
                />
                {parsedApiKeys.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    已识别 {parsedApiKeys.length} 个 API Key
                    {isBatchApiKeyInput
                      ? "，添加时会逐条创建同站点连接并参与轮询"
                      : ""}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  支持换行、空格、逗号批量粘贴多个 API Key。
                </div>
                <div className="grid gap-1">
                  <Input
                    placeholder="用户 ID（可选）"
                    value={tokenForm.platformUserId}
                    onChange={(e) => {
                      setTokenForm((f) => ({
                        ...f,
                        platformUserId: e.target.value.replace(/\D/g, ""),
                        credentialMode: "apikey",
                      }));
                      setVerifyResult(null);
                    }}
                  />
                  <div className="text-xs text-muted-foreground">
                    若站点要求 New-Api-User / User-ID，请在这里提前填写。
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 self-start text-sm">
                  <Checkbox
                   
                    checked={!!tokenForm.skipModelFetch}
                    onCheckedChange={(checked) => setTokenForm((f) => ({
                        ...f,
                        skipModelFetch: checked === true,
                      }))}
                  />
                  <span>跳过模型验证（直接添加 API Key）</span>
                </label>
                {verifyResult &&
                  verifyResult.success &&
                  verifyResult.tokenType === "apikey" && (
                    <Alert className="animate-scale-in">
                      <AlertTitle className="flex items-center gap-1.5">
                        <svg
                          width="14"
                          height="14"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                          />
                        </svg>
                        API Key 验证成功
                      </AlertTitle>
                      <AlertDescription className="leading-relaxed">
                        <div>
                          可用模型:{" "}
                          <strong>{verifyResult.modelCount} 个</strong>
                        </div>
                        {verifyResult.models && (
                          <div className="text-muted-foreground">
                            包含: {verifyResult.models.join(", ")}
                            {verifyResult.modelCount > 10 ? " ..." : ""}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                {verifyResult &&
                  verifyResult.success &&
                  verifyResult.tokenType === "session" && (
                    <Alert className="animate-scale-in">
                      <AlertTitle>
                        当前分段仅接受 API Key，请切到「Session 连接」分段创建。
                      </AlertTitle>
                    </Alert>
                  )}
                {verifyResult &&
                  !verifyResult.success &&
                  verifyResult.needsUserId && (
                    <Alert className="animate-scale-in">
                      <AlertTitle>
                        此站点要求用户 ID，请补充后重新验证
                      </AlertTitle>
                    </Alert>
                  )}
                {verifyResult &&
                  !verifyResult.success &&
                  !verifyResult.needsUserId && (
                    <Alert variant="destructive" className="animate-scale-in">
                      <AlertTitle>
                        {normalizeVerifyFailureMessage(verifyResult.message) ||
                          "Token 无效或已过期"}
                      </AlertTitle>
                      <AlertDescription>
                        {verifyFailureHint || "请检查 Token 是否正确"}
                      </AlertDescription>
                    </Alert>
                  )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline"
                    onClick={handleVerifyToken}
                    disabled={
                      verifying ||
                      !tokenForm.siteId ||
                      !tokenForm.accessToken ||
                      isBatchApiKeyInput
                    }
                   
                   
                  >
                    {verifying ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        验证中...
                      </>
                    ) : isBatchApiKeyInput ? (
                      "批量添加时校验"
                    ) : (
                      "验证 API Key"
                    )}
                  </Button>
                  <Button type="button"
                    onClick={handleTokenAdd}
                    disabled={
                      saving ||
                      !tokenForm.siteId ||
                      !tokenForm.accessToken ||
                      !canSubmitApiKeyConnection
                    }
                   
                  >
                    {saving ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        添加中...
                      </>
                    ) : isBatchApiKeyInput ? (
                      "批量添加连接"
                    ) : (
                      "添加连接"
                    )}
                  </Button>
                </div>
                {!verifyResult?.success && (
                  <div className="text-xs text-muted-foreground">
                    {isBatchApiKeyInput
                      ? "批量模式下无需先点验证，提交后会逐条校验并创建。"
                      : addAccountPrereqHint}
                  </div>
                )}
              </div>
            )}
          </CenteredModal>

          {activeSegment === "session" && (
            <CenteredModal
              open={Boolean(rebindTarget)}
              onClose={closeRebindPanel}
              title="重新绑定 Session Token"
              maxWidth={820}
              bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
              footer={
                <Button type="button" variant="outline" onClick={closeRebindPanel}>
                  取消
                </Button>
              }
            >
              {activeRebindTarget ? (
                <>
                  <div className="mb-3 text-xs text-muted-foreground">
                    连接: {resolveAccountDisplayName(activeRebindTarget)} @{" "}
                    {activeRebindTarget.site?.name || "-"}。请粘贴新的 Session
                    Token，验证成功后再绑定。
                  </div>

                  <div className="mb-2.5 grid grid-cols-[minmax(0,1fr)_220px] gap-2.5">
                    <Textarea
                      placeholder="粘贴新的 Session Token"
                      value={rebindForm.accessToken}
                      onChange={(e) => {
                        setRebindForm((prev) => ({
                          ...prev,
                          accessToken: e.target.value.trim(),
                        }));
                        setRebindVerifyResult(null);
                      }}
                      className="h-[74px] resize-none font-mono"
                    />
                    <Input
                      placeholder="用户 ID（可选）"
                      value={rebindForm.platformUserId}
                      onChange={(e) => {
                        setRebindForm((prev) => ({
                          ...prev,
                          platformUserId: e.target.value.replace(/\D/g, ""),
                        }));
                        setRebindVerifyResult(null);
                      }}
                    />
                  </div>
                  {isRebindSub2Api && (
                    <>
                      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_220px] gap-2.5">
                        <Input
                          placeholder="Sub2API refresh_token（可选）"
                          value={rebindForm.refreshToken}
                          onChange={(e) =>
                            setRebindForm((prev) => ({
                              ...prev,
                              refreshToken: e.target.value.trim(),
                            }))
                          }
                          className="font-mono"
                        />
                        <Input
                          placeholder="token_expires_at（可选）"
                          value={rebindForm.tokenExpiresAt}
                          onChange={(e) =>
                            setRebindForm((prev) => ({
                              ...prev,
                              tokenExpiresAt: e.target.value.replace(/\D/g, ""),
                            }))
                          }
                        />
                      </div>
                      <div className="mb-2.5 text-xs text-muted-foreground">
                        留空将保持原有 refresh_token
                        不变。配置后可用于托管自动续期。
                      </div>
                    </>
                  )}

                  {rebindVerifyResult &&
                    rebindVerifyResult.success &&
                    rebindVerifyResult.tokenType === "session" && (
                      <Alert className="mb-2.5 animate-scale-in">
                        <AlertTitle>Session Token 有效</AlertTitle>
                        <AlertDescription>
                          用户:{" "}
                          {rebindVerifyResult.userInfo?.username || "未知"}
                          {rebindVerifyResult.apiToken
                            ? `，已识别 API Key (${String(rebindVerifyResult.apiToken).slice(0, 8)}...)`
                            : ""}
                        </AlertDescription>
                      </Alert>
                    )}
                  {rebindVerifyResult &&
                    (!rebindVerifyResult.success ||
                      rebindVerifyResult.tokenType !== "session") && (
                      <Alert variant="destructive" className="mb-2.5 animate-scale-in">
                        <AlertTitle>
                          {rebindVerifyResult.message ||
                            "Token 无效或类型不正确"}
                        </AlertTitle>
                      </Alert>
                    )}

                  <div className="flex gap-2">
                    <Button type="button" variant="outline"
                      onClick={handleVerifyRebindToken}
                      disabled={
                        rebindVerifying || !rebindForm.accessToken.trim()
                      }
                     
                     
                    >
                      {rebindVerifying ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          验证中...
                        </>
                      ) : (
                        "验证 Token"
                      )}
                    </Button>
                    <Button type="button"
                      onClick={handleSubmitRebind}
                      disabled={
                        rebindSaving ||
                        !(
                          rebindVerifyResult?.success &&
                          rebindVerifyResult?.tokenType === "session"
                        )
                      }
                     
                    >
                      {rebindSaving ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          绑定中...
                        </>
                      ) : (
                        "确认重新绑定"
                      )}
                    </Button>
                  </div>
                </>
              ) : null}
            </CenteredModal>
          )}

          <CenteredModal
            open={Boolean(editingAccount)}
            onClose={closeEditPanel}
            title="编辑账号"
            maxWidth={860}
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
            footer={
              <>
                <Button type="button" variant="outline" onClick={closeEditPanel}>
                  取消
                </Button>
                <Button type="button"
                  onClick={saveEditPanel}
                  disabled={savingEdit}
                 
                >
                  {savingEdit ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />{" "}
                      保存中...
                    </>
                  ) : (
                    "保存修改"
                  )}
                </Button>
              </>
            }
          >
            {editingAccount ? (
              <ResponsiveFormGrid>
                <Input
                  placeholder="账号名称"
                  value={editForm.username}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                />
                <ModernSelect
                  value={editForm.status}
                  onChange={(value) =>
                    setEditForm((prev) => ({ ...prev, status: value }))
                  }
                  options={[
                    { value: "active", label: "active" },
                    { value: "disabled", label: "disabled" },
                    { value: "expired", label: "expired" },
                  ]}
                  placeholder="状态"
                />
                <Input
                  placeholder="单位成本（可选）"
                  value={editForm.unitCost}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      unitCost: e.target.value,
                    }))
                  }
                />
                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                   
                    checked={editForm.checkinEnabled}
                    onCheckedChange={(checked) => setEditForm((prev) => ({
                        ...prev,
                        checkinEnabled: checked === true,
                      }))}      />
                  启用签到
                </label>
                <Input
                  placeholder="Access Token"
                  value={editForm.accessToken}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      accessToken: e.target.value,
                    }))
                  }
                  className="font-mono"
                />
                <Input
                  placeholder="API Token（可选）"
                  value={editForm.apiToken}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      apiToken: e.target.value,
                    }))
                  }
                  className="font-mono"
                />
                <Input
                  placeholder="代理地址（可选，如 http://127.0.0.1:7890）"
                  value={editForm.proxyUrl}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      proxyUrl: e.target.value,
                    }))
                  }
                />
                <div className="-mt-1 text-xs text-muted-foreground">
                  覆盖站点和系统代理，留空则使用站点设置。支持 http/https/socks5
                  协议。
                </div>
                {(editingAccount?.site?.platform || "").toLowerCase() ===
                  "sub2api" && (
                  <>
                    <Input
                      placeholder="Sub2API refresh_token（可选）"
                      value={editForm.refreshToken}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          refreshToken: e.target.value,
                        }))
                      }
                      className="font-mono"
                    />
                    <Input
                      placeholder="token_expires_at（可选）"
                      value={editForm.tokenExpiresAt}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          tokenExpiresAt: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                    />
                  </>
                )}
              </ResponsiveFormGrid>
            ) : null}
          </CenteredModal>

          <Card>
            {visibleAccounts.length > 0 ? (
              isMobile ? (
                <div className="grid gap-3">
                  {visibleAccounts.map((a: any) => {
                    const capabilities = resolveAccountCapabilities(a);
                    const connectionMode = resolveAccountCredentialMode(a);
                    const health = resolveRuntimeHealth(a);
                    const isExpanded = expandedAccountIds.includes(a.id);
                    const hintMessage =
                      a.status === "expired" && !capabilities.proxyOnly
                        ? "账号已过期，请重新绑定"
                        : health.reason || "-";
                    return (
                      <MobileCard
                        key={a.id}
                        title={resolveAccountDisplayName(a)}
                        headerActions={
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                             
                              aria-label={`选择账号 ${resolveAccountDisplayName(a)}`}
                              checked={selectedAccountIds.includes(a.id)}
                              onCheckedChange={(checked) => toggleAccountSelection(
                                  a.id,
                                  checked === true,
                                )}                />
                            <ToneBadge tone={connectionMode === "apikey" ? "warning" : "info"}
                             
                             
                            >
                              {connectionMode === "apikey"
                                ? "API Key"
                                : "Session"}
                            </ToneBadge>
                            {parseAccountExtraConfig(a)?.proxyUrl && (
                              <ToneBadge tone="-purple"
                               
                               
                              >
                                代理
                              </ToneBadge>
                            )}
                          </div>
                        }
                        footerActions={
                          <>
                            <Button variant="ghost" size="sm"
                              type="button"
                              onClick={() => toggleAccountDetails(a.id)}
                             
                            >
                              {isExpanded ? "收起" : "详情"}
                            </Button>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => openEditPanel(a)}
                             
                            >
                              编辑
                            </Button>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => openModelModal(a)}
                              disabled={actionLoading[`models-${a.id}`]}
                             
                            >
                              模型
                            </Button>
                          </>
                        }
                      >
                        <MobileField
                          label="运行健康状态"
                          value={
                            <div className="flex flex-col gap-1">
                              <ToneBadge tone={health.cls}
                               
                               
                              >
                                <span
                                  className={`status-dot ${health.dotClass} ${health.pulse ? "animate-pulse-dot" : ""}`}
                                />
                                {health.label}
                              </ToneBadge>
                              <span
                                className="max-w-60 truncate text-[11px] text-muted-foreground"
                                data-tooltip={health.reason}
                              >
                                {health.reason}
                              </span>
                            </div>
                          }
                        />
                        <MobileField
                          label="余额"
                          value={
                            <div>
                              <div className="font-semibold text-foreground">
                                ${(a.balance || 0).toFixed(2)}
                              </div>
                              <div
                                className={(a.todayReward || 0) > 0 ? "text-[11px] font-medium text-emerald-600" : "text-[11px] font-medium text-muted-foreground"}
                              >
                                +{(a.todayReward || 0).toFixed(2)}
                              </div>
                            </div>
                          }
                        />
                        <MobileField
                          label="已用"
                          value={
                            <div>
                              <div>${(a.balanceUsed || 0).toFixed(2)}</div>
                              <div
                                className={(a.todaySpend || 0) > 0 ? "text-[11px] font-medium text-destructive" : "text-[11px] font-medium text-muted-foreground"}
                              >
                                -{(a.todaySpend || 0).toFixed(2)}
                              </div>
                            </div>
                          }
                        />
                        {isExpanded ? (
                          <div className="mt-3 grid gap-2">
                            <MobileField
                              label="站点"
                              value={
                                <SiteBadgeLink
                                  siteId={a.site?.id}
                                  siteName={a.site?.name}
                                  badgeStyle={{ fontSize: 11 }}
                                />
                              }
                            />
                            <MobileField
                              label="签到"
                              value={
                                capabilities.canCheckin ? (
                                  <Button
                                    type="button"
                                    variant={a.checkinEnabled ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => handleToggleCheckin(a)}
                                    disabled={
                                      !!actionLoading[`checkin-toggle-${a.id}`]
                                    }
                                    data-tooltip={
                                      a.checkinEnabled
                                        ? "点击关闭签到，全部签到会忽略此账号"
                                        : "点击开启签到"
                                    }
                                    aria-label={
                                      a.checkinEnabled
                                        ? "点击关闭签到，全部签到会忽略此账号"
                                        : "点击开启签到"
                                    }
                                  >
                                    {actionLoading[`checkin-toggle-${a.id}`] ? (
                                      <LoaderCircle className="size-4 animate-spin" />
                                    ) : a.checkinEnabled ? (
                                      "开启"
                                    ) : (
                                      "关闭"
                                    )}
                                  </Button>
                                ) : (
                                  <ToneBadge tone="-muted"
                                   
                                   
                                  >
                                    不支持
                                  </ToneBadge>
                                )
                              }
                            />
                            <MobileField
                              label="账号状态"
                              value={
                                a.status === "expired"
                                  ? "已过期"
                                  : a.status || "-"
                              }
                            />
                            <MobileField
                              label="提示"
                              stacked
                              value={hintMessage}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" variant="secondary" size="sm"
                                onClick={() => handleTogglePin(a)}
                                disabled={!!actionLoading[`pin-toggle-${a.id}`]}
                               
                              >
                                {actionLoading[`pin-toggle-${a.id}`] ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : a.isPinned ? (
                                  "取消置顶"
                                ) : (
                                  "置顶"
                                )}
                              </Button>
                              {sortMode === "custom" && (
                                <>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() =>
                                      handleMoveCustomOrder(a, "up")
                                    }
                                    disabled={
                                      !!actionLoading[`reorder-${a.id}`]
                                    }
                                   
                                  >
                                    ↑ 上移
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() =>
                                      handleMoveCustomOrder(a, "down")
                                    }
                                    disabled={
                                      !!actionLoading[`reorder-${a.id}`]
                                    }
                                   
                                  >
                                    ↓ 下移
                                  </Button>
                                </>
                              )}
                              {capabilities.canRefreshBalance && (
                                <Button type="button" variant="ghost" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `refresh-${a.id}`,
                                      () => api.refreshBalance(a.id),
                                      "余额已刷新",
                                    )
                                  }
                                  disabled={actionLoading[`refresh-${a.id}`]}
                                 
                                >
                                  {actionLoading[`refresh-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    "刷新"
                                  )}
                                </Button>
                              )}
                              {capabilities.canCheckin && (
                                <Button type="button" variant="secondary" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `checkin-${a.id}`,
                                      () => api.triggerCheckin(a.id),
                                      "签到完成",
                                    )
                                  }
                                  disabled={actionLoading[`checkin-${a.id}`]}
                                 
                                >
                                  {actionLoading[`checkin-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    "签到"
                                  )}
                                </Button>
                              )}
                              {a.status === "expired" &&
                                !capabilities.proxyOnly && (
                                  <Button type="button" variant="secondary" size="sm"
                                    onClick={() => openRebindPanel(a)}
                                   
                                  >
                                    重新绑定
                                  </Button>
                                )}
                              <Button type="button" variant="destructive" size="sm"
                                onClick={() =>
                                  setDeleteConfirm({
                                    mode: "single",
                                    accountId: a.id,
                                    accountName: resolveAccountDisplayName(a),
                                  })
                                }
                                disabled={actionLoading[`delete-${a.id}`]}
                               
                              >
                                {actionLoading[`delete-${a.id}`] ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  "删除"
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </MobileCard>
                    );
                  })}
                </div>
              ) : (
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-11">
                        <Checkbox
                         
                          checked={allVisibleAccountsSelected}
                          onCheckedChange={(checked) => toggleSelectAllVisibleAccounts(checked === true)}            />
                      </TableHead>
                      <TableHead>连接名称</TableHead>
                      <TableHead>站点</TableHead>
                      <TableHead>运行健康状态</TableHead>
                      <TableHead>余额</TableHead>
                      <TableHead>已用</TableHead>
                      <TableHead>签到</TableHead>
                      <TableHead className="text-right">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleAccounts.map((a: any, i: number) => {
                      const capabilities = resolveAccountCapabilities(a);
                      const connectionMode = resolveAccountCredentialMode(a);
                      return (
                        <TableRow
                          key={a.id}
                          data-testid={`account-row-${a.id}`}
                          ref={(node) => {
                            if (node) rowRefs.current.set(a.id, node);
                            else rowRefs.current.delete(a.id);
                          }}
                          onClick={(event) =>
                            handleAccountRowClick(a.id, event)
                          }
                          className={`animate-slide-up stagger-${Math.min(i + 1, 5)} row-selectable ${selectedAccountIds.includes(a.id) ? "row-selected" : ""} ${highlightAccountId === a.id ? "row-focus-highlight" : ""}`.trim()}
                        >
                          <TableCell>
                            <Checkbox
                              data-testid={`account-select-${a.id}`}
                             
                              checked={selectedAccountIds.includes(a.id)}
                              onCheckedChange={(checked) => toggleAccountSelection(a.id, checked === true)}                />
                          </TableCell>
                          <TableCell className="text-foreground">
                            <div className="font-semibold">
                              {resolveAccountDisplayName(a)}
                            </div>
                            <div className="mt-1 flex gap-1">
                              <ToneBadge tone={connectionMode === "apikey" ? "warning" : "info"}
                               
                               
                              >
                                {connectionMode === "apikey"
                                  ? "API Key"
                                  : "Session"}
                              </ToneBadge>
                              {parseAccountExtraConfig(a)?.proxyUrl && (
                                <ToneBadge tone="-purple"
                                 
                                 
                                >
                                  代理
                                </ToneBadge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <SiteBadgeLink
                              siteId={a.site?.id}
                              siteName={a.site?.name}
                              badgeStyle={{ fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const health = resolveRuntimeHealth(a);
                              return (
                                <div className="flex flex-col gap-1">
                                  <ToneBadge tone={health.cls}
                                   
                                   
                                  >
                                    <span
                                      className={`status-dot ${health.dotClass} ${health.pulse ? "animate-pulse-dot" : ""}`}
                                    />
                                    {health.label}
                                  </ToneBadge>
                                  <span
                                    className="max-w-[200px] truncate text-[11px] text-muted-foreground"
                                    data-tooltip={health.reason}
                                  >
                                    {health.reason}
                                  </span>
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <div className="font-semibold text-foreground">
                              ${(a.balance || 0).toFixed(2)}
                            </div>
                            <div
                              className={(a.todayReward || 0) > 0 ? "text-[11px] font-medium text-emerald-600" : "text-[11px] font-medium text-muted-foreground"}
                            >
                              +{(a.todayReward || 0).toFixed(2)}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            <div>${(a.balanceUsed || 0).toFixed(2)}</div>
                            <div
                              className={(a.todaySpend || 0) > 0 ? "text-[11px] font-medium text-destructive" : "text-[11px] font-medium text-muted-foreground"}
                            >
                              -{(a.todaySpend || 0).toFixed(2)}
                            </div>
                          </TableCell>
                          <TableCell>
                            {capabilities.canCheckin ? (
                              <Button
                                type="button"
                                variant={a.checkinEnabled ? "default" : "secondary"}
                                size="sm"
                                onClick={() => handleToggleCheckin(a)}
                                disabled={
                                  !!actionLoading[`checkin-toggle-${a.id}`]
                                }
                                data-tooltip={
                                  a.checkinEnabled
                                    ? "点击关闭签到，全部签到会忽略此账号"
                                    : "点击开启签到"
                                }
                                aria-label={
                                  a.checkinEnabled
                                    ? "点击关闭签到，全部签到会忽略此账号"
                                    : "点击开启签到"
                                }
                              >
                                {actionLoading[`checkin-toggle-${a.id}`] ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : a.checkinEnabled ? (
                                  "开启"
                                ) : (
                                  "关闭"
                                )}
                              </Button>
                            ) : (
                              <ToneBadge tone="-muted"
                               
                               
                              >
                                不支持
                              </ToneBadge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button type="button" variant="secondary" size="sm"
                                onClick={() => handleTogglePin(a)}
                                disabled={!!actionLoading[`pin-toggle-${a.id}`]}
                               
                              >
                                {actionLoading[`pin-toggle-${a.id}`] ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : a.isPinned ? (
                                  "取消置顶"
                                ) : (
                                  "置顶"
                                )}
                              </Button>
                              {sortMode === "custom" && (
                                <>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() =>
                                      handleMoveCustomOrder(a, "up")
                                    }
                                    disabled={
                                      !!actionLoading[`reorder-${a.id}`]
                                    }
                                   
                                  >
                                    ↑
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() =>
                                      handleMoveCustomOrder(a, "down")
                                    }
                                    disabled={
                                      !!actionLoading[`reorder-${a.id}`]
                                    }
                                   
                                  >
                                    ↓
                                  </Button>
                                </>
                              )}
                              {capabilities.canRefreshBalance && (
                                <Button type="button" variant="ghost" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `refresh-${a.id}`,
                                      () => api.refreshBalance(a.id),
                                      "余额已刷新",
                                    )
                                  }
                                  disabled={actionLoading[`refresh-${a.id}`]}
                                 
                                >
                                  {actionLoading[`refresh-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    "刷新"
                                  )}
                                </Button>
                              )}
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => openModelModal(a)}
                                disabled={actionLoading[`models-${a.id}`]}
                               
                              >
                                模型
                              </Button>
                              {capabilities.canCheckin && (
                                <Button type="button" variant="secondary" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `checkin-${a.id}`,
                                      () => api.triggerCheckin(a.id),
                                      "签到完成",
                                    )
                                  }
                                  disabled={actionLoading[`checkin-${a.id}`]}
                                 
                                >
                                  {actionLoading[`checkin-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    "签到"
                                  )}
                                </Button>
                              )}
                              {a.status === "expired" &&
                                !capabilities.proxyOnly && (
                                  <Button type="button" variant="secondary" size="sm"
                                    onClick={() => openRebindPanel(a)}
                                   
                                  >
                                    重新绑定
                                  </Button>
                                )}
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => openEditPanel(a)}
                               
                              >
                                编辑
                              </Button>
                              <Button type="button" variant="destructive" size="sm"
                                onClick={() =>
                                  setDeleteConfirm({
                                    mode: "single",
                                    accountId: a.id,
                                    accountName: resolveAccountDisplayName(a),
                                  })
                                }
                                disabled={actionLoading[`delete-${a.id}`]}
                               
                              >
                                {actionLoading[`delete-${a.id}`] ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  "删除"
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )
            ) : (
              <EmptyStateBlock
                title={activeSegment === "apikey" ? "暂无 API Key 连接" : "暂无 Session 连接"}
                description={activeSegment === "apikey"
                  ? sites.length > 0
                    ? "请为现有站点补充 API Key 连接"
                    : "请先添加站点，然后为站点补充 API Key 连接"
                  : sites.length > 0
                    ? "请为现有站点添加 Session 连接"
                    : "请先添加站点，然后添加 Session 连接"}
              />
            )}
          </Card>
        </>
      )}

      <AccountModelsModal
        modelModal={modelModal}
        onClose={closeModelModal}
        onSave={saveModelDisabled}
        onRefresh={async () => {
          if (!modelModal.account) return;
          await loadModelModalModels(modelModal.account, {
            refreshUpstream: true,
            successMessage: "模型列表已刷新",
            errorMessage: "刷新失败",
          });
        }}
        onReload={async () => {
          if (!modelModal.account) return;
          await loadModelModalModels(modelModal.account, {
            refreshUpstream: false,
            errorMessage: "重新加载模型列表失败",
          });
        }}
        onToggleModelDisabled={toggleModelDisabled}
        onSetPendingDisabled={(pendingDisabled) =>
          setModelModal((state) => ({ ...state, pendingDisabled }))
        }
        onManualInputChange={(value) =>
          setModelModal((state) => ({ ...state, manualModelsInput: value }))
        }
        onAddManualModels={handleAddManualModels}
      />
    </div>
  );
}
