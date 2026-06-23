import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import PageHeader from "../components/workspace/PageHeader.js";
import PageShell from "../components/workspace/PageShell.js";
import AccountModelsModal from "./accounts/AccountModelsModal.js";
import EndpointBindingsModal from "./accounts/EndpointBindingsModal.js";
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
  buildCustomReorderToTargetUpdates,
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
import {
  CheckCircle2,
  CircleSlash,
  Ellipsis,
  GripVertical,
  LoaderCircle,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  Wallet,
  Waypoints,
} from 'lucide-react';
import ToneBadge from '../components/ToneBadge.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Card } from '../components/ui/card/index.js';
import EmptyStateBlock from "../components/EmptyStateBlock.js";
import { DataTable, DataTableToolbar } from '../components/ui/data-table/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import { Input } from '../components/ui/input/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import * as DropdownMenu from '../components/ui/dropdown-menu/index.js';

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
    label: tr('pages.accounts.connectionManagement'),
    tooltip: tr('pages.accounts.signBalanceStatus'),
    tooltipSide: "bottom",
    tooltipAlign: "start",
  },
  {
    value: "apikey",
    label: tr('pages.accounts.apiKey2'),
    tooltip: tr('pages.accounts.baseUrlKeyUsageActingcalls'),
    tooltipSide: "bottom",
    tooltipAlign: "center",
  },
  {
    value: "tokens",
    label: tr('pages.accounts.accountsaccountTokens'),
    tooltip: tr('pages.accounts.accountssyncManualRoutesCalls'),
    tooltipSide: "bottom",
    tooltipAlign: "end",
  },
];

const SITE_SELECT_SEARCH_PLACEHOLDER = tr('pages.accounts.filtersitesNamePlatformUrl');

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

type SortableAccountTableRowProps = Omit<React.ComponentPropsWithoutRef<typeof TableRow>, "children" | "ref"> & {
  account: any;
  selected: boolean;
  rowRef?: (node: HTMLTableRowElement | null) => void;
  children: (dragHandle: {
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    attributes: Record<string, any>;
    listeners: Record<string, any> | undefined;
    isDragging: boolean;
  }) => React.ReactNode;
};

function SortableAccountTableRow({
  account,
  selected,
  rowRef,
  className,
  children,
  style,
  ...props
}: SortableAccountTableRowProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: account.id,
  });

  return (
    <TableRow
      ref={(node) => {
        setNodeRef(node);
        rowRef?.(node);
      }}
      data-state={selected ? "selected" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      className={`${className || ""} ${isDragging ? "relative z-10 bg-muted shadow-sm" : ""}`.trim()}
      style={{
        ...style,
        visibility: isDragging ? "hidden" : undefined,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...props}
    >
      {children({
        setActivatorNodeRef,
        attributes: attributes as Record<string, any>,
        listeners: listeners as Record<string, any> | undefined,
        isDragging,
      })}
    </TableRow>
  );
}

function AccountDragOverlayCard({
  account,
  accountName,
}: {
  account: any;
  accountName: string;
}) {
  const connectionMode = resolveAccountCredentialMode(account);
  return (
    <div className="pointer-events-none flex min-w-[360px] max-w-[560px] items-center gap-3 rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <GripVertical className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{accountName}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={connectionMode === "apikey" ? "warning" : "info"}>
            {connectionMode === "apikey" ? "API Key" : "Session"}
          </ToneBadge>
          <ToneBadge tone="-muted">
            {account.site?.name || tr('components.searchModal.unlinkedSite')}
          </ToneBadge>
        </div>
      </div>
    </div>
  );
}

function AccountsLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((index) => (
          <MobileCard
            key={index}
            title={<Skeleton className="h-5 w-40" />}
            subtitle={<Skeleton className="h-4 w-56 max-w-full" />}
          >
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </MobileCard>
        ))}
      </div>
    );
  }

  return (
    <DataTable minWidth={1040} density="compact" aria-busy="true">
      <DataTableToolbar className="border-b bg-muted/30 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-4" />
          <div className="grid gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </DataTableToolbar>
      <Table className="w-full text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-11" />
            <TableHead className="w-11" />
            <TableHead className="min-w-56">{tr('pages.accounts.name2')}</TableHead>
            <TableHead className="min-w-36">{tr('components.searchModal.sites2')}</TableHead>
            <TableHead className="min-w-56">{tr('pages.accounts.healthystatus')}</TableHead>
            <TableHead className="min-w-28 text-right">{tr('components.notificationPanel.balance')}</TableHead>
            <TableHead className="min-w-28 text-right">{tr('pages.accounts.used')}</TableHead>
            <TableHead className="min-w-28">{tr('components.notificationPanel.sign')}</TableHead>
            <TableHead className="min-w-44 text-right">{tr('pages.accounts.actions2')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2, 3, 4].map((index) => (
            <TableRow key={index}>
              <TableCell><Skeleton className="size-8" /></TableCell>
              <TableCell><Skeleton className="size-4" /></TableCell>
              <TableCell>
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-44" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-5 w-28 rounded-full" /></TableCell>
              <TableCell>
                <div className="grid gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="h-7 w-16 rounded-full" /></TableCell>
              <TableCell>
                <div className="flex justify-end gap-1.5">
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="size-8" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
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
  const [endpointBindingsTarget, setEndpointBindingsTarget] = useState<{
    siteId: number;
    credentialKey: string;
    titleContext: string;
  } | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRebindTargetRef = useRef<any | null>(null);
  const modelModalRequestSeqRef = useRef(0);
  const [draggingAccountId, setDraggingAccountId] = useState<number | null>(null);
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
      toast.error(error?.message || tr('pages.accounts.failedLoadAccountList'));
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
      { value: "0", label: tr('pages.accounts.selectSite') },
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
      ? tr('components.searchModal.apiKey')
      : tr('components.searchModal.unnamed');
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
  const accountReorderSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );
  const draggingAccount = draggingAccountId == null
    ? null
    : sortedAccounts.find((account) => account.id === draggingAccountId) || null;
  const allVisibleAccountsSelected =
    visibleAccounts.length > 0 &&
    visibleAccounts.every((account) => selectedAccountIds.includes(account.id));
  const someVisibleAccountsSelected =
    !allVisibleAccountsSelected &&
    visibleAccounts.some((account) => selectedAccountIds.includes(account.id));
  const selectedAccountCountText = tr('pages.accounts.selectedCount').replace(
    '{count}',
    String(selectedAccountIds.length),
  );
  const visibleAccountCountText = tr('pages.accounts.visibleCount').replace(
    '{count}',
    String(visibleAccounts.length),
  );
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
        toast.error(result.message || tr('pages.accounts.loginFailed'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.loginRequestFailed'));
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
            `Session 验证成功: ${result.userInfo?.username || tr('pages.accounts.unknown')}`,
          );
        }
      } else {
        toast.error(
          normalizeVerifyFailureMessage(result.message || tr('pages.accounts.tokenInvalid')),
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
      toast.error(tr('pages.accounts.verifyTokenSuccessAddAccount'));
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
          const firstMessage = failedItems[0]?.message || tr('pages.accounts.failed');
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
          toast.error(seedErr?.message || tr('pages.accounts.addRecommendedmodelFailed'));
        }
      }
      closeAddPanel();
      if (result.queued) {
        toast.info(result.message || tr('pages.accounts.accountsAddSyncInfo'));
      } else if (result.tokenType === "apikey") {
        toast.success(tr('pages.accounts.addedApiKeyAccountCanUsedProxy'));
      } else {
        const parts: string[] = [];
        if (result.usernameDetected) parts.push(tr('pages.accounts.usernameHasBeenAutomaticallyRecognized'));
        if (result.apiTokenFound) parts.push(tr('pages.accounts.apiKeyHasBeenObtainedAutomatically'));
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
      toast.error(e.message || tr('pages.accounts.addFailed'));
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
      toast.error(e.message || tr('pages.accounts.operationFailed2'));
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
    if (code === "timeout") return tr('pages.accounts.modelFailedRequestTimeout');
    if (code === "unauthorized") return tr('pages.accounts.modelFailedApiKeyInvalid');
    if (code === "empty_models") return tr('pages.accounts.modelFailedAvailablemodel');
    return messageFallback || refresh?.errorMessage || tr('pages.accounts.modelFailed2');
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
      toast.error(e.message || tr('pages.accounts.modelFailed2'));
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
      toast.error(e.message || options.errorMessage || tr('pages.accounts.modelFailed3'));
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
      errorMessage: tr('pages.accounts.modelFailed3'),
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
        toast.success(tr('pages.accounts.modeldisabledsettingsSaveRoutes'));
      } catch {
        toast.error(tr('pages.accounts.modeldisabledsettingsSaveRoutesFailedManualrefreshroutes'));
      }
      closeModelModal();
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.saveFailed'));
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
        toast.success(tr('pages.accounts.modelManualadd'));
        setModelModal((s) => ({ ...s, manualModelsInput: "" }));
        await loadModelModalModels(modelModal.account, {
          refreshUpstream: false,
        });
      } else {
        toast.error(res.message || tr('pages.accounts.manualaddmodelfailed'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.manualaddmodelfailed'));
    } finally {
      setModelModal((s) => ({ ...s, addingManualModels: false }));
    }
  };

  const openEndpointBindingsForAccount = (account: any) => {
    const siteId = Number(account?.siteId ?? account?.site?.id);
    if (!Number.isFinite(siteId) || siteId <= 0) {
      toast.error(tr('pages.accounts.endpointBindings.noCredentialsDescription'));
      return;
    }
    setEndpointBindingsTarget({
      siteId,
      credentialKey: `account:${account.id}`,
      titleContext: `${resolveAccountDisplayName(account)} @ ${account.site?.name || '-'}`,
    });
  };

  const openEndpointBindingsForToken = (token: any) => {
    const siteId = Number(token?.siteId ?? token?.site?.id);
    if (!Number.isFinite(siteId) || siteId <= 0) {
      toast.error(tr('pages.accounts.endpointBindings.noCredentialsDescription'));
      return;
    }
    setEndpointBindingsTarget({
      siteId,
      credentialKey: `account-token:${token.id}`,
      titleContext: `${token.name || `#${token.id}`} @ ${token.site?.name || '-'}`,
    });
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
      label: tr('pages.accounts.healthy'),
      cls: "success",
      dotClass: "status-dot-success",
      pulse: true,
    },
    unhealthy: {
      label: tr('pages.accounts.error'),
      cls: "error",
      dotClass: "status-dot-error",
      pulse: true,
    },
    degraded: {
      label: tr('pages.accounts.downgrade'),
      cls: "warning",
      dotClass: "status-dot-pending",
      pulse: true,
    },
    disabled: {
      label: tr('pages.accounts.disabled2'),
      cls: "muted",
      dotClass: "status-dot-muted",
      pulse: false,
    },
    unknown: {
      label: tr('pages.accounts.unknown2'),
      cls: "muted",
      dotClass: "status-dot-pending",
      pulse: false,
    },
  };

  const resolveRuntimeHealth = (account: any) => {
    if (account.status === "expired") {
      return {
        ...runtimeHealthMap.unhealthy,
        label: tr('pages.accounts.expired'),
        reason: account.runtimeHealth?.reason || tr('pages.accounts.expired2'),
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
        ? tr('pages.accounts.accountSiteHasBeenDisabled')
        : state === "unhealthy"
          ? tr('pages.accounts.recentHealthCheckFailed')
          : tr('pages.accounts.runningHealthInformationHasNotBeenObtained'));
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
        toast.info(res.message || tr('pages.accounts.accountStatusRefreshTaskHasBeenSubmitted'));
      } else {
        toast.success(res?.message || tr('pages.accounts.accountStatusHasBeenRefreshed'));
      }
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.failedRefreshAccountStatus'));
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
        nextEnabled ? tr('pages.accounts.signEnabled') : tr('pages.accounts.signClosedAllSignInsWillIgnore'),
      );
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.failedSwitchSignStatus'));
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
      toast.success(nextPinned ? tr('pages.accounts.accountsPinTop') : tr('pages.accounts.accountsCancelpinTop'));
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.accountspinTopfailed'));
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
      toast.error(e.message || tr('pages.accounts.accountsFailed'));
    } finally {
      setActionLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const handleAccountDragStart = (event: DragStartEvent) => {
    const activeId = Number(event.active.id);
    setDraggingAccountId(Number.isFinite(activeId) ? activeId : null);
  };

  const clearAccountDragState = () => {
    setDraggingAccountId(null);
  };

  const handleAccountDragEnd = async (event: DragEndEvent) => {
    clearAccountDragState();
    const activeId = Number(event.active.id);
    const overId = event.over ? Number(event.over.id) : NaN;
    if (!Number.isFinite(activeId) || !Number.isFinite(overId) || activeId === overId) return;

    const updates = buildCustomReorderToTargetUpdates(accounts, activeId, overId);
    if (updates.length === 0) return;

    const key = `reorder-${activeId}`;
    setActionLoading((s) => ({ ...s, [key]: true }));
    try {
      await Promise.all(
        updates.map((update) =>
          api.updateAccount(update.id, { sortOrder: update.sortOrder }),
        ),
      );
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.accountsFailed'));
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
      toast.success(tr('pages.accounts.accounts'));
      closeEditPanel();
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.accountsfailed'));
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
      toast.error(e.message || tr('pages.accounts.operationFailed'));
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
        tr('pages.accounts.deleted'),
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
        toast.success(tr('pages.accounts.sessionTokenVerifysuccessRebind'));
      } else if (result.success && result.tokenType !== "session") {
        toast.error(tr('pages.accounts.apiKeySessionToken'));
      } else {
        toast.error(
          normalizeVerifyFailureMessage(result.message || tr('pages.accounts.tokenInvalid')),
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
      toast.error(tr('pages.accounts.verifySessionTokenSuccess'));
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
      toast.success(tr('pages.accounts.accountsrebindsuccessStatus'));
      closeRebindPanel();
      load(true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.rebindfailed'));
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
    <PageShell>
      <PageHeader
        title={tr('app.connectionManagement')}
        description={tr('pages.accounts.connectionManagementSubtitle')}
        actions={activeSegment !== "tokens" ? (
          <>
            {isMobile ? (
              <>
                <Button variant="outline"
                  type="button"
                  onClick={() => setShowMobileTools(true)}
                 
                 
                >
                  {tr('pages.accounts.actions3')}
                </Button>
                <Button variant="outline"
                  type="button"
                  data-testid="accounts-mobile-select-all"
                  onClick={() =>
                    toggleSelectAllVisibleAccounts(!allVisibleAccountsSelected)
                  }
                 
                 
                >
                  {allVisibleAccountsSelected ? tr('pages.accounts.cancelselectAll') : tr('pages.accounts.selectVisibleItems')}
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
                      { value: "custom", label: tr('pages.accounts.customOrder') },
                      { value: "balance-desc", label: tr('pages.accounts.balancehighLow') },
                      { value: "balance-asc", label: tr('pages.accounts.balancelowHigh') },
                    ]}
                    placeholder={tr('pages.accounts.customOrder')}
                  />
                </div>
                {activeSegment === "session" && (
                  <Button type="button"
                    onClick={() =>
                      withLoading(
                        "checkin-all",
                        () => api.triggerCheckinAll(),
                        tr('pages.accounts.allSignInsHaveBeenTriggered'),
                      )
                    }
                    disabled={actionLoading["checkin-all"]}
                   
                  >
                    {actionLoading["checkin-all"] ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        {tr('pages.accounts.checking')}
                      </>
                    ) : (
                      tr('pages.accounts.checkAll')
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
                      {tr('pages.accounts.refreshing')}
                    </>
                  ) : (
                    tr('pages.accounts.refreshAccountStatus')
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
              {showAdd ? tr('app.cancel') : tr('pages.accounts.add2')}
            </Button>
          </>
        ) : embeddedTokenActions}
      />

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileTools}
        onMobileClose={() => setShowMobileTools(false)}
        mobileTitle={tr('pages.accounts.actions')}
        mobileContent={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                {tr('pages.accounts.sort')}
              </div>
              <ModernSelect
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: "custom", label: tr('pages.accounts.customOrder') },
                  { value: "balance-desc", label: tr('pages.accounts.balancehighLow') },
                  { value: "balance-asc", label: tr('pages.accounts.balancelowHigh') },
                ]}
                placeholder={tr('pages.accounts.customOrder')}
              />
            </div>
            {activeSegment === "session" && (
              <Button type="button" variant="outline"
                onClick={async () => {
                  setShowMobileTools(false);
                  await withLoading(
                    "checkin-all",
                    () => api.triggerCheckinAll(),
                    tr('pages.accounts.allSignInsHaveBeenTriggered'),
                  );
                }}
                disabled={actionLoading["checkin-all"]}
               
               
              >
                {actionLoading["checkin-all"] ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    {tr('pages.accounts.checking')}
                  </>
                ) : (
                  tr('pages.accounts.checkAll')
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
                  {tr('pages.accounts.refreshing')}
                </>
              ) : (
                tr('pages.accounts.refreshAccountStatus')
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
        title={tr('pages.accounts.delete')}
        confirmText={tr('components.deleteConfirmModal.delete')}
        loading={
          batchActionLoading ||
          (deleteConfirm?.mode === "single" &&
            !!actionLoading[`delete-${deleteConfirm?.accountId}`])
        }
        description={
          deleteConfirm?.mode === "single" ? (
            <>
              {tr('pages.accounts.delete4')}{" "}
              <strong>
                {deleteConfirm.accountName || `#${deleteConfirm.accountId}`}
              </strong>{" "}
              {tr('pages.accounts.textqcmnqj')}
            </>
          ) : (
            <>
              {tr('pages.accounts.deleteZh')} <strong>{deleteConfirm?.count || 0}</strong>{" "}
              {tr('pages.accounts.connections')}
            </>
          )
        }
      />

      <EndpointBindingsModal
        open={Boolean(endpointBindingsTarget)}
        siteId={endpointBindingsTarget?.siteId ?? null}
        initialCredentialKey={endpointBindingsTarget?.credentialKey ?? null}
        titleContext={endpointBindingsTarget?.titleContext ?? null}
        onClose={() => setEndpointBindingsTarget(null)}
      />

      {activeSegment !== "tokens" && isMobile && selectedAccountIds.length > 0 && (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={selectedAccountCountText}
        >
          <Button type="button" variant="outline"
            data-testid="accounts-batch-refresh-balance"
            onClick={() => runBatchAccountAction("refreshBalance")}
            disabled={batchActionLoading}
           
           
          >
            {tr('pages.accounts.refreshbalance')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAccountAction("enable")}
            disabled={batchActionLoading}
           
           
          >
            {tr('pages.accounts.enabled')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAccountAction("disable")}
            disabled={batchActionLoading}
           
           
          >
            {tr('pages.accounts.disabled')}
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={() => runBatchAccountAction("delete")}
            disabled={batchActionLoading}
           
          >
            {tr('pages.accounts.delete2')}
          </Button>
        </ResponsiveBatchActionBar>
      )}

      {activeSegment === "tokens" ? (
        <TokensPanel
          embedded
          onEmbeddedActionsChange={setEmbeddedTokenActions}
          onConfigureEndpointBindings={openEndpointBindingsForToken}
        />
      ) : (
        <>
          <CenteredModal
            open={showAdd}
            onClose={closeAddPanel}
            title={
              activeSegment === "apikey"
                ? tr('pages.accounts.addApiKey')
                : addMode === "login"
                  ? tr('pages.accounts.accountspasswordsign')
                  : tr('pages.accounts.addSession')
            }
            maxWidth={860}
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
            footer={
              <Button type="button" variant="outline" onClick={closeAddPanel}>
                {tr('app.cancel')}
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
                    {tr('pages.accounts.accountspasswordsign')}
                  </Button>
                </div>

                {addMode === "token" ? (
                  <div className="flex flex-col gap-3">
                    <InfoNote>
                      <div>
                        <div className="mb-1 font-semibold">
                          {tr('pages.accounts.session')}
                        </div>
                        <div>
                          <strong>{tr('pages.accounts.recommended')}</strong> {tr('pages.accounts.usagesystemaccessTokenAccessTokenCookie')}
                        </div>
                        <div className="mt-0.5">
                          {tr('pages.accounts.newapiConsoleSettingsSettingsSystemaccessToken')}
                        </div>
                        <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">
                          {tr('pages.accounts.cookie')}{" "}
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
                            {tr('pages.accounts.viewingSites')}
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
                      placeholder={tr('pages.accounts.selectSite')}
                      searchable
                      searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                    />
                    <Input
                      placeholder={tr('pages.accounts.name')}
                      value={tokenForm.username}
                      onChange={(e) =>
                        setTokenForm((f) => ({
                          ...f,
                          username: e.target.value,
                        }))
                      }
                    />
                    <Textarea
                      placeholder={tr('pages.accounts.sessionAccessTokenCookie2')}
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
                        placeholder={tr('pages.accounts.id')}
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
                        {tr('pages.accounts.sitesNewApiUserUserId')}
                      </div>
                    </div>
                    {isSub2ApiSelected && (
                      <>
                        <div className="grid gap-1">
                          <Input
                            placeholder={tr('pages.accounts.sub2apiRefreshTokenAutomatic')}
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
                            {tr('pages.accounts.console')}{" "}
                            <code className="font-mono">
                              localStorage.getItem('refresh_token')
                            </code>{" "}
                            {tr('pages.accounts.fetch')}
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <Input
                            placeholder={tr('pages.accounts.tokenExpiresSecondstime')}
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
                            {tr('pages.accounts.configurationRefreshTokenMetapiJwtExpired401')}
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
                            {tr('pages.accounts.sessionAccessTokenCookie')}
                          </AlertTitle>
                          <AlertDescription className="leading-relaxed">
                            <div>
                              {tr('pages.accounts.username')}{" "}
                              <strong>
                                {verifyResult.userInfo?.username || tr('pages.accounts.unknown2')}
                              </strong>
                            </div>
                            {verifyResult.balance && (
                              <div>
                                {tr('pages.accounts.balance')}{" "}
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
                                  : tr('pages.accounts.notFound')}
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
                            {tr('pages.accounts.sessionApiKey')}
                          </AlertTitle>
                        </Alert>
                      )}
                    {verifyResult &&
                      !verifyResult.success &&
                      verifyResult.needsUserId && (
                        <Alert className="animate-scale-in">
                          <AlertTitle>
                            {tr('pages.accounts.sitesIdVerify')}
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
                            ) || tr('pages.accounts.tokenInvalidExpired')}
                          </AlertTitle>
                          <AlertDescription>
                            {verifyFailureHint || tr('pages.accounts.checkToken')}
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
                            {tr('app.verifying')}
                          </>
                        ) : (
                          tr('pages.accounts.verifyToken')
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
                            {tr('pages.accounts.adding')}
                          </>
                        ) : (
                          tr('pages.accounts.add3')
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
                      {tr('pages.accounts.inputtargetsitesAccountspasswordAutomaticsignAccessTokenApiKey')}
                    </InfoNote>
                    <ModernSelect
                      value={String(loginForm.siteId || 0)}
                      onChange={(nextValue) => {
                        const nextSiteId = Number.parseInt(nextValue, 10) || 0;
                        setLoginForm((f) => ({ ...f, siteId: nextSiteId }));
                      }}
                      options={siteSelectOptions}
                      placeholder={tr('pages.accounts.selectSite')}
                      searchable
                      searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                    />
                <Input
                  placeholder={tr('app.username')}
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
                      placeholder={tr('pages.accounts.password')}
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
                          {tr('pages.accounts.loggingAdding')}
                        </>
                      ) : (
                        tr('pages.accounts.logAdd')
                      )}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <InfoNote>
                  {tr('pages.accounts.apiKeyActingAutomaticAccountstokenSystemSitesplatformcapabilitiesautomatic')}
                </InfoNote>
                {createIntentPreset && (
                  <Alert className="animate-scale-in">
                    <AlertTitle>
                      {createIntentPreset.label}
                    </AlertTitle>
                    <AlertDescription className="leading-relaxed">
                      <div>{createIntentPreset.description}</div>
                      <div>
                        {tr('pages.accounts.recommendedmodel')}
                        {createIntentPreset.recommendedModels.join(" / ")}
                      </div>
                      {createIntentPreset.recommendedSkipModelFetch && (
                        <div>
                          {tr('pages.accounts.suggestionJumpOvermodelverifySaveBaseUrlKey')}
                        </div>
                      )}
                    </AlertDescription>
                    {createIntentPreset.recommendedModels.length > 0 && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                         
                          checked={applyCreatePresetModels}
                          onCheckedChange={(checked) => setApplyCreatePresetModels(checked === true)}
                        />
                        <span>{tr('pages.accounts.addAutomaticRecommendedmodelRoutes')}</span>
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
                  placeholder={tr('pages.accounts.selectSite')}
                  searchable
                  searchPlaceholder={SITE_SELECT_SEARCH_PLACEHOLDER}
                />
                <Input
                  placeholder={tr('pages.accounts.name')}
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
                  placeholder={tr('pages.accounts.apiKey3')}
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
                    {tr('pages.accounts.recognized')} {parsedApiKeys.length} {tr('pages.accounts.apiKey')}
                    {isBatchApiKeyInput
                      ? tr('pages.accounts.addItemsSitesRoundRobin')
                      : ""}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {tr('pages.accounts.supportedApiKey')}
                </div>
                <div className="grid gap-1">
                  <Input
                    placeholder={tr('pages.accounts.id')}
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
                    {tr('pages.accounts.sitesNewApiUserUserId')}
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
                  <span>{tr('pages.accounts.jumpOvermodelverifyAddApiKey')}</span>
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
                        {tr('pages.accounts.apiKeyVerifysuccess')}
                      </AlertTitle>
                      <AlertDescription className="leading-relaxed">
                        <div>
                          {tr('pages.accounts.availablemodel')}{" "}
                          <strong>{verifyResult.modelCount} {tr('pages.accounts.model')}</strong>
                        </div>
                        {verifyResult.models && (
                          <div className="text-muted-foreground">
                            {tr('pages.accounts.includes')} {verifyResult.models.join(", ")}
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
                        {tr('pages.accounts.apiKeySession')}
                      </AlertTitle>
                    </Alert>
                  )}
                {verifyResult &&
                  !verifyResult.success &&
                  verifyResult.needsUserId && (
                    <Alert className="animate-scale-in">
                      <AlertTitle>
                        {tr('pages.accounts.sitesIdVerify')}
                      </AlertTitle>
                    </Alert>
                  )}
                {verifyResult &&
                  !verifyResult.success &&
                  !verifyResult.needsUserId && (
                    <Alert variant="destructive" className="animate-scale-in">
                      <AlertTitle>
                        {normalizeVerifyFailureMessage(verifyResult.message) ||
                          tr('pages.accounts.tokenInvalidExpired')}
                      </AlertTitle>
                      <AlertDescription>
                        {verifyFailureHint || tr('pages.accounts.checkToken')}
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
                        {tr('app.verifying')}
                      </>
                    ) : isBatchApiKeyInput ? (
                      tr('pages.accounts.addCheck')
                    ) : (
                      tr('pages.accounts.verifyApiKey')
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
                        {tr('pages.accounts.adding')}
                      </>
                    ) : isBatchApiKeyInput ? (
                      tr('pages.accounts.add')
                    ) : (
                      tr('pages.accounts.add3')
                    )}
                  </Button>
                </div>
                {!verifyResult?.success && (
                  <div className="text-xs text-muted-foreground">
                    {isBatchApiKeyInput
                      ? tr('pages.accounts.modeNoneVerifyItemscheck')
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
              title={tr('pages.accounts.rebindSessionToken')}
              maxWidth={820}
              bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
              footer={
                <Button type="button" variant="outline" onClick={closeRebindPanel}>
                  {tr('app.cancel')}
                </Button>
              }
            >
              {activeRebindTarget ? (
                <>
                  <div className="mb-3 text-xs text-muted-foreground">
                    {tr('pages.accounts.connection')} {resolveAccountDisplayName(activeRebindTarget)} @{" "}
                    {activeRebindTarget.site?.name || "-"}{tr('pages.accounts.sessionTokenVerifysuccess')}
                  </div>

                  <div className="mb-2.5 grid grid-cols-[minmax(0,1fr)_220px] gap-2.5">
                    <Textarea
                      placeholder={tr('pages.accounts.sessionToken2')}
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
                      placeholder={tr('pages.accounts.id')}
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
                          placeholder={tr('pages.accounts.sub2apiRefreshToken')}
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
                          placeholder={tr('pages.accounts.tokenExpires')}
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
                        {tr('pages.accounts.refreshTokenConfigurationAvailableAutomatic')}
                      </div>
                    </>
                  )}

                  {rebindVerifyResult &&
                    rebindVerifyResult.success &&
                    rebindVerifyResult.tokenType === "session" && (
                      <Alert className="mb-2.5 animate-scale-in">
                        <AlertTitle>{tr('pages.accounts.sessionToken')}</AlertTitle>
                        <AlertDescription>
                          {tr('pages.accounts.user')}{" "}
                          {rebindVerifyResult.userInfo?.username || tr('pages.accounts.unknown2')}
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
                            tr('pages.accounts.tokenInvalidType')}
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
                          {tr('app.verifying')}
                        </>
                      ) : (
                        tr('pages.accounts.verifyToken')
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
                          {tr('pages.accounts.zh')}
                        </>
                      ) : (
                        tr('pages.accounts.confirmRebinding')
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
            title={tr('pages.accounts.editaccounts')}
            maxWidth={860}
            bodyStyle={{ display: "flex", flexDirection: "column", gap: 12 }}
            footer={
              <>
                <Button type="button" variant="outline" onClick={closeEditPanel}>
                  {tr('app.cancel')}
                </Button>
                <Button type="button"
                  onClick={saveEditPanel}
                  disabled={savingEdit}
                 
                >
                  {savingEdit ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />{" "}
                      {tr('pages.accounts.saving')}
                    </>
                  ) : (
                    tr('pages.accounts.saveChanges')
                  )}
                </Button>
              </>
            }
          >
            {editingAccount ? (
              <ResponsiveFormGrid>
                <Input
                  placeholder={tr('pages.accounts.accountsname')}
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
                  placeholder={tr('components.notificationPanel.status')}
                />
                <Input
                  placeholder={tr('pages.accounts.cost')}
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
                  {tr('pages.accounts.enabledsign')}
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
                  placeholder={tr('pages.accounts.apiToken')}
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
                  placeholder={tr('pages.accounts.actingHttp1270017890')}
                  value={editForm.proxyUrl}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      proxyUrl: e.target.value,
                    }))
                  }
                />
                <div className="-mt-1 text-xs text-muted-foreground">
                  {tr('pages.accounts.sitesSystemactingUsagesitessettingsSupportedHttpHttpsSocks5')}
                </div>
                {(editingAccount?.site?.platform || "").toLowerCase() ===
                  "sub2api" && (
                  <>
                    <Input
                      placeholder={tr('pages.accounts.sub2apiRefreshToken')}
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
                      placeholder={tr('pages.accounts.tokenExpires')}
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

          <>
        {!loaded ? (
          <AccountsLoadingSkeleton isMobile={isMobile} />
        ) : visibleAccounts.length > 0 ? (
          isMobile ? (
            <div className="grid gap-3">
                  {visibleAccounts.map((a: any) => {
                    const capabilities = resolveAccountCapabilities(a);
                    const connectionMode = resolveAccountCredentialMode(a);
                    const health = resolveRuntimeHealth(a);
                    const isExpanded = expandedAccountIds.includes(a.id);
                    const hintMessage =
                      a.status === "expired" && !capabilities.proxyOnly
                        ? tr('pages.accounts.accountsExpiredRebind')
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
                                {tr('components.notificationPanel.acting')}
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
                              {isExpanded ? tr('pages.accounts.collapse') : tr('pages.accounts.details')}
                            </Button>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => openEditPanel(a)}
                             
                            >
                              {tr('pages.accounts.edit')}
                            </Button>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => openModelModal(a)}
                              disabled={actionLoading[`models-${a.id}`]}
                             
                            >
                              {tr('components.modelAnalysisPanel.model')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openEndpointBindingsForAccount(a)}
                            >
                              <Waypoints className="size-4" />
                              {tr('pages.accounts.endpointBindings.action')}
                            </Button>
                          </>
                        }
                      >
                        <MobileField
                          label={tr('pages.accounts.healthystatus')}
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
                          label={tr('components.notificationPanel.balance')}
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
                          label={tr('pages.accounts.used')}
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
                              label={tr('components.searchModal.sites2')}
                              value={
                                <SiteBadgeLink
                                  siteId={a.site?.id}
                                  siteName={a.site?.name}
                                  badgeStyle={{ fontSize: 11 }}
                                />
                              }
                            />
                            <MobileField
                              label={tr('components.notificationPanel.sign')}
                              value={
                                capabilities.canCheckin ? (
                                  <Button
                                    type="button"
                                    variant={a.checkinEnabled ? "softSuccess" : "softDestructive"}
                                    size="sm"
                                    className="rounded-full px-3"
                                    onClick={() => handleToggleCheckin(a)}
                                    disabled={
                                      !!actionLoading[`checkin-toggle-${a.id}`]
                                    }
                                    data-tooltip={
                                      a.checkinEnabled
                                        ? tr('pages.accounts.clickCloseSignAllSignInsWill')
                                        : tr('pages.accounts.clickOpenSign')
                                    }
                                    aria-label={
                                      a.checkinEnabled
                                        ? tr('pages.accounts.clickCloseSignAllSignInsWill')
                                        : tr('pages.accounts.clickOpenSign')
                                    }
                                  >
                                    {actionLoading[`checkin-toggle-${a.id}`] ? (
                                      <LoaderCircle className="size-4 animate-spin" />
                                    ) : a.checkinEnabled ? (
                                      tr('pages.accounts.turn')
                                    ) : (
                                      tr('pages.accounts.close')
                                    )}
                                  </Button>
                                ) : (
                                  <ToneBadge tone="-muted"
                                   
                                   
                                  >
                                    {tr('pages.accounts.unsupported')}
                                  </ToneBadge>
                                )
                              }
                            />
                            <MobileField
                              label={tr('pages.accounts.accountsstatus')}
                              value={
                                a.status === "expired"
                                  ? tr('pages.accounts.expired')
                                  : a.status || "-"
                              }
                            />
                            <MobileField
                              label={tr('pages.accounts.tip')}
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
                                  tr('pages.accounts.cancelpinTop')
                                ) : (
                                  tr('pages.accounts.pinTop')
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
                                    {tr('pages.accounts.moveUp')}
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() =>
                                      handleMoveCustomOrder(a, "down")
                                    }
                                    disabled={
                                      !!actionLoading[`reorder-${a.id}`]
                                    }
                                   
                                  >
                                    {tr('pages.accounts.moveDown')}
                                  </Button>
                                </>
                              )}
                              {capabilities.canRefreshBalance && (
                                <Button type="button" variant="ghost" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `refresh-${a.id}`,
                                      () => api.refreshBalance(a.id),
                                      tr('pages.accounts.balanceHasBeenRefreshed'),
                                    )
                                  }
                                  disabled={actionLoading[`refresh-${a.id}`]}
                                 
                                >
                                  {actionLoading[`refresh-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    tr('pages.accounts.refresh')
                                  )}
                                </Button>
                              )}
                              {capabilities.canCheckin && (
                                <Button type="button" variant="secondary" size="sm"
                                  onClick={() =>
                                    withLoading(
                                      `checkin-${a.id}`,
                                      () => api.triggerCheckin(a.id),
                                      tr('pages.accounts.signCompleted'),
                                    )
                                  }
                                  disabled={actionLoading[`checkin-${a.id}`]}
                                 
                                >
                                  {actionLoading[`checkin-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    tr('components.notificationPanel.sign')
                                  )}
                                </Button>
                              )}
                              {a.status === "expired" &&
                                !capabilities.proxyOnly && (
                                  <Button type="button" variant="secondary" size="sm"
                                    onClick={() => openRebindPanel(a)}
                                   
                                  >
                                    {tr('pages.accounts.rebind')}
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
                                  tr('pages.accounts.delete3')
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
                <DataTable minWidth={1040} density="compact">
                  <DataTableToolbar className="border-b bg-muted/30 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={allVisibleAccountsSelected || (someVisibleAccountsSelected && "indeterminate")}
                        aria-label={tr('pages.accounts.selectVisibleItems')}
                        onCheckedChange={(checked) => toggleSelectAllVisibleAccounts(checked === true)}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {selectedAccountIds.length > 0 ? selectedAccountCountText : visibleAccountCountText}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tr('pages.accounts.selectionActions')}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="accounts-batch-refresh-balance"
                        onClick={() => runBatchAccountAction("refreshBalance")}
                        disabled={batchActionLoading || selectedAccountIds.length === 0}
                      >
                        {batchActionLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                        {tr('pages.accounts.refreshbalance')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => runBatchAccountAction("enable")}
                        disabled={batchActionLoading || selectedAccountIds.length === 0}
                      >
                        <CheckCircle2 className="size-4" />
                        {tr('pages.accounts.enabled')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => runBatchAccountAction("disable")}
                        disabled={batchActionLoading || selectedAccountIds.length === 0}
                      >
                        <CircleSlash className="size-4" />
                        {tr('pages.accounts.disabled')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghostMuted"
                        size="sm"
                        onClick={() => setSelectedAccountIds([])}
                        disabled={batchActionLoading || selectedAccountIds.length === 0}
                      >
                        {tr('pages.accounts.clearSelection')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghostDestructive"
                        size="sm"
                        onClick={() => runBatchAccountAction("delete")}
                        disabled={batchActionLoading || selectedAccountIds.length === 0}
                      >
                        <Trash2 className="size-4" />
                        {tr('pages.accounts.delete2')}
                      </Button>
                    </div>
                  </DataTableToolbar>
                  <DndContext
                    sensors={accountReorderSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleAccountDragStart}
                    onDragCancel={clearAccountDragState}
                    onDragEnd={handleAccountDragEnd}
                  >
                    <SortableContext
                      items={visibleAccounts.map((account) => account.id)}
                      strategy={verticalListSortingStrategy}
                    >
                  <Table className="w-full text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-11" />
                        <TableHead className="w-11" />
                        <TableHead className="min-w-56">{tr('pages.accounts.name2')}</TableHead>
                        <TableHead className="min-w-36">{tr('components.searchModal.sites2')}</TableHead>
                        <TableHead className="min-w-56">{tr('pages.accounts.healthystatus')}</TableHead>
                        <TableHead className="min-w-28 text-right">{tr('components.notificationPanel.balance')}</TableHead>
                        <TableHead className="min-w-28 text-right">{tr('pages.accounts.used')}</TableHead>
                        <TableHead className="min-w-28">{tr('components.notificationPanel.sign')}</TableHead>
                        <TableHead className="min-w-44 text-right">{tr('pages.accounts.actions2')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleAccounts.map((a: any, i: number) => {
                        const capabilities = resolveAccountCapabilities(a);
                        const connectionMode = resolveAccountCredentialMode(a);
                        const selected = selectedAccountIds.includes(a.id);
                        const health = resolveRuntimeHealth(a);
                        return (
                          <SortableAccountTableRow
                            key={a.id}
                            account={a}
                            selected={selected}
                            data-testid={`account-row-${a.id}`}
                            rowRef={(node) => {
                              if (node) rowRefs.current.set(a.id, node);
                              else rowRefs.current.delete(a.id);
                            }}
                            onClick={(event) => handleAccountRowClick(a.id, event)}
                            className={`animate-slide-up stagger-${Math.min(i + 1, 5)} row-selectable ${highlightAccountId === a.id ? "row-focus-highlight" : ""}`.trim()}
                          >
                            {(dragHandle) => (
                              <>
                            <TableCell>
                              {sortMode === "custom" && (
                                <Button
                                  ref={dragHandle.setActivatorNodeRef}
                                  type="button"
                                  variant="ghostMuted"
                                  size="icon"
                                  aria-label={tr('pages.accounts.reorder')}
                                  className={dragHandle.isDragging ? "cursor-grabbing" : "cursor-grab"}
                                  disabled={!!actionLoading[`reorder-${a.id}`]}
                                  onClick={(event) => event.stopPropagation()}
                                  {...dragHandle.attributes}
                                  {...dragHandle.listeners}
                                >
                                  {actionLoading[`reorder-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    <GripVertical className="size-4" />
                                  )}
                                </Button>
                              )}
                            </TableCell>
                            <TableCell>
                              <Checkbox
                                data-testid={`account-select-${a.id}`}
                                checked={selected}
                                aria-label={`${tr('pages.accounts.selectConnection')} ${resolveAccountDisplayName(a)}`}
                                onCheckedChange={(checked) => toggleAccountSelection(a.id, checked === true)}
                              />
                            </TableCell>
                            <TableCell className="text-foreground">
                              <div className="flex min-w-0 flex-col gap-1">
                                <div className="truncate font-semibold">
                                  {resolveAccountDisplayName(a)}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  <ToneBadge tone={connectionMode === "apikey" ? "warning" : "info"}>
                                    {connectionMode === "apikey" ? "API Key" : "Session"}
                                  </ToneBadge>
                                  {parseAccountExtraConfig(a)?.proxyUrl && (
                                    <ToneBadge tone="-purple">
                                      {tr('components.notificationPanel.acting')}
                                    </ToneBadge>
                                  )}
                                  {a.isPinned ? <ToneBadge tone="-info">{tr('pages.accounts.pinTop')}</ToneBadge> : null}
                                </div>
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
                              <div className="flex min-w-0 flex-col gap-1">
                                <ToneBadge tone={health.cls}>
                                  <span className={`status-dot ${health.dotClass} ${health.pulse ? "animate-pulse-dot" : ""}`} />
                                  {health.label}
                                </ToneBadge>
                                <span
                                  className="max-w-[240px] truncate text-[11px] text-muted-foreground"
                                  data-tooltip={health.reason}
                                >
                                  {health.reason}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div className="font-semibold text-foreground">
                                ${(a.balance || 0).toFixed(2)}
                              </div>
                              <div className={(a.todayReward || 0) > 0 ? "text-[11px] font-medium text-success" : "text-[11px] font-medium text-muted-foreground"}>
                                +{(a.todayReward || 0).toFixed(2)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div>${(a.balanceUsed || 0).toFixed(2)}</div>
                              <div className={(a.todaySpend || 0) > 0 ? "text-[11px] font-medium text-destructive" : "text-[11px] font-medium text-muted-foreground"}>
                                -{(a.todaySpend || 0).toFixed(2)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {capabilities.canCheckin ? (
                                <Button
                                  type="button"
                                  variant={a.checkinEnabled ? "softSuccess" : "softDestructive"}
                                  size="sm"
                                  className="rounded-full px-3"
                                  onClick={() => handleToggleCheckin(a)}
                                  disabled={!!actionLoading[`checkin-toggle-${a.id}`]}
                                  data-tooltip={
                                    a.checkinEnabled
                                      ? tr('pages.accounts.clickCloseSignAllSignInsWill')
                                      : tr('pages.accounts.clickOpenSign')
                                  }
                                  aria-label={
                                    a.checkinEnabled
                                      ? tr('pages.accounts.clickCloseSignAllSignInsWill')
                                      : tr('pages.accounts.clickOpenSign')
                                  }
                                >
                                  {actionLoading[`checkin-toggle-${a.id}`] ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : a.checkinEnabled ? (
                                    tr('pages.accounts.turn')
                                  ) : (
                                    tr('pages.accounts.close')
                                  )}
                                </Button>
                              ) : (
                                <ToneBadge tone="-muted">
                                  {tr('pages.accounts.unsupported')}
                                </ToneBadge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditPanel(a)}
                                >
                                  {tr('pages.accounts.edit')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghostPrimary"
                                  size="sm"
                                  onClick={() => openModelModal(a)}
                                  disabled={actionLoading[`models-${a.id}`]}
                                >
                                  {tr('components.modelAnalysisPanel.model')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEndpointBindingsForAccount(a)}
                                >
                                  <Waypoints className="size-4" />
                                  {tr('pages.accounts.endpointBindings.action')}
                                </Button>
                                <DropdownMenu.Root>
                                  <DropdownMenu.Trigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghostMuted"
                                      size="icon"
                                      aria-label={tr('pages.accounts.moreActions')}
                                    >
                                      <Ellipsis className="size-4" />
                                    </Button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Content align="end" className="min-w-44">
                                    <DropdownMenu.Item
                                      disabled={!!actionLoading[`pin-toggle-${a.id}`]}
                                      onSelect={() => handleTogglePin(a)}
                                    >
                                      {actionLoading[`pin-toggle-${a.id}`] ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : a.isPinned ? (
                                        <PinOff className="size-4" />
                                      ) : (
                                        <Pin className="size-4" />
                                      )}
                                      {a.isPinned ? tr('pages.accounts.cancelpinTop') : tr('pages.accounts.pinTop')}
                                    </DropdownMenu.Item>
                                    {capabilities.canRefreshBalance && (
                                      <DropdownMenu.Item
                                        disabled={!!actionLoading[`refresh-${a.id}`]}
                                        onSelect={() =>
                                          withLoading(
                                            `refresh-${a.id}`,
                                            () => api.refreshBalance(a.id),
                                            tr('pages.accounts.balanceHasBeenRefreshed'),
                                          )
                                        }
                                      >
                                        {actionLoading[`refresh-${a.id}`] ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : (
                                          <RefreshCw className="size-4" />
                                        )}
                                        {tr('pages.accounts.refresh')}
                                      </DropdownMenu.Item>
                                    )}
                                    {capabilities.canCheckin && (
                                      <DropdownMenu.Item
                                        disabled={!!actionLoading[`checkin-${a.id}`]}
                                        onSelect={() =>
                                          withLoading(
                                            `checkin-${a.id}`,
                                            () => api.triggerCheckin(a.id),
                                            tr('pages.accounts.signCompleted'),
                                          )
                                        }
                                      >
                                        {actionLoading[`checkin-${a.id}`] ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : (
                                          <CheckCircle2 className="size-4" />
                                        )}
                                        {tr('components.notificationPanel.sign')}
                                      </DropdownMenu.Item>
                                    )}
                                    {a.status === "expired" && !capabilities.proxyOnly && (
                                      <DropdownMenu.Item onSelect={() => openRebindPanel(a)}>
                                        <RefreshCw className="size-4" />
                                        {tr('pages.accounts.rebind')}
                                      </DropdownMenu.Item>
                                    )}
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item
                                      variant="destructive"
                                      disabled={!!actionLoading[`delete-${a.id}`]}
                                      onSelect={() =>
                                        setDeleteConfirm({
                                          mode: "single",
                                          accountId: a.id,
                                          accountName: resolveAccountDisplayName(a),
                                        })
                                      }
                                    >
                                      {actionLoading[`delete-${a.id}`] ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="size-4" />
                                      )}
                                      {tr('pages.accounts.delete3')}
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Root>
                              </div>
                            </TableCell>
                              </>
                            )}
                          </SortableAccountTableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                    </SortableContext>
                    <DragOverlay dropAnimation={null}>
                      {draggingAccount ? (
                        <AccountDragOverlayCard
                          account={draggingAccount}
                          accountName={resolveAccountDisplayName(draggingAccount)}
                        />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </DataTable>
              )
            ) : (
              <EmptyStateBlock
                title={activeSegment === "apikey" ? tr('pages.accounts.noneApiKey') : tr('pages.accounts.noneSession')}
                description={activeSegment === "apikey"
                  ? sites.length > 0
                    ? tr('pages.accounts.sitesApiKey')
                    : tr('pages.accounts.addSiteSitesApiKey')
                  : sites.length > 0
                    ? tr('pages.accounts.sitesaddSession')
                    : tr('pages.accounts.addSiteAddSession')}
              />
            )}
          </>
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
            successMessage: tr('pages.accounts.modelRefresh'),
            errorMessage: tr('pages.accounts.refreshfailed'),
          });
        }}
        onReload={async () => {
          if (!modelModal.account) return;
          await loadModelModalModels(modelModal.account, {
            refreshUpstream: false,
            errorMessage: tr('pages.accounts.modelFailed'),
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
    </PageShell>
  );
}
