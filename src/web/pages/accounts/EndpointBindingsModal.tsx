import React, { useEffect, useMemo, useState } from 'react';
import { Braces, LoaderCircle, Network, RefreshCw, Save, Search } from 'lucide-react';
import {
  api,
  type CredentialEndpointBindingSupport,
  type CredentialEndpointMatrix,
  type CredentialEndpointMatrixBinding,
  type CredentialEndpointMatrixCredential,
  type CredentialEndpointMatrixProfile,
} from '../../api.js';
import { tr } from '../../i18n.js';
import { useToast } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Label } from '../../components/ui/label/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table/index.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle } from '../../components/ui/empty/index.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import ToneBadge from '../../components/ToneBadge.js';
import { cn } from '../../lib/utils.js';

type DraftBinding = {
  apiEndpointProfileId: number;
  enabled: boolean;
  support: CredentialEndpointBindingSupport;
  priority: number;
};

type DraftProfile = {
  id: number;
  label: string;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  defaultHeadersText: string;
  modelCatalogSourceId: string;
  enabled: boolean;
  priority: number;
};

type EndpointBindingsModalProps = {
  open: boolean;
  siteId: number | null;
  initialCredentialKey?: string | null;
  titleContext?: string | null;
  onClose: () => void;
};

const SUPPORT_OPTIONS: Array<{
  value: CredentialEndpointBindingSupport;
  labelKey: string;
  descriptionKey: string;
  tone: string;
}> = [
  {
    value: 'supported',
    labelKey: 'pages.accounts.endpointBindings.support.supported',
    descriptionKey: 'pages.accounts.endpointBindings.support.supportedDescription',
    tone: 'success',
  },
  {
    value: 'unsupported',
    labelKey: 'pages.accounts.endpointBindings.support.unsupported',
    descriptionKey: 'pages.accounts.endpointBindings.support.unsupportedDescription',
    tone: 'danger',
  },
  {
    value: 'unknown',
    labelKey: 'pages.accounts.endpointBindings.support.unknown',
    descriptionKey: 'pages.accounts.endpointBindings.support.unknownDescription',
    tone: '-muted',
  },
  {
    value: 'blocked',
    labelKey: 'pages.accounts.endpointBindings.support.blocked',
    descriptionKey: 'pages.accounts.endpointBindings.support.blockedDescription',
    tone: 'warning',
  },
];

function supportOption(value: CredentialEndpointBindingSupport) {
  return SUPPORT_OPTIONS.find((option) => option.value === value) || SUPPORT_OPTIONS[2]!;
}

function createDraftBindings(
  credential: CredentialEndpointMatrixCredential | null,
  profiles: CredentialEndpointMatrixProfile[],
): DraftBinding[] {
  const bindingByProfileId = new Map<number, CredentialEndpointMatrixBinding>();
  for (const binding of credential?.bindings || []) {
    bindingByProfileId.set(binding.apiEndpointProfileId, binding);
  }
  return profiles.map((profile, index) => {
    const binding = bindingByProfileId.get(profile.rowId);
    return {
      apiEndpointProfileId: profile.rowId,
      enabled: binding?.enabled ?? true,
      support: binding?.support ?? 'supported',
      priority: binding?.priority ?? index,
    };
  });
}

function areDraftBindingsEqual(
  draft: DraftBinding[],
  credential: CredentialEndpointMatrixCredential | null,
  profiles: CredentialEndpointMatrixProfile[],
) {
  const baseline = createDraftBindings(credential, profiles);
  if (draft.length !== baseline.length) return false;
  return draft.every((binding, index) => {
    const other = baseline[index];
    return !!other
      && binding.apiEndpointProfileId === other.apiEndpointProfileId
      && binding.enabled === other.enabled
      && binding.support === other.support
      && binding.priority === other.priority;
  });
}

function formatHeaders(headers: Record<string, string> | null | undefined) {
  if (!headers || Object.keys(headers).length === 0) return '{}';
  return JSON.stringify(headers, null, 2);
}

function createDraftProfiles(profiles: CredentialEndpointMatrixProfile[]): DraftProfile[] {
  return profiles.map((profile, index) => ({
    id: profile.rowId,
    label: profile.label || profile.apiType,
    requestMethod: profile.requestMethod === 'GET' ? 'GET' : 'POST',
    requestUrl: profile.requestUrl || '',
    defaultHeadersText: formatHeaders(profile.defaultHeaders),
    modelCatalogSourceId: profile.modelCatalogSourceId ? String(profile.modelCatalogSourceId) : 'none',
    enabled: profile.enabled !== false,
    priority: profile.priority ?? index,
  }));
}

function areDraftProfilesEqual(draft: DraftProfile[], profiles: CredentialEndpointMatrixProfile[]) {
  const baseline = createDraftProfiles(profiles);
  if (draft.length !== baseline.length) return false;
  return draft.every((profile, index) => {
    const other = baseline[index];
    return !!other
      && profile.id === other.id
      && profile.label === other.label
      && profile.requestMethod === other.requestMethod
      && profile.requestUrl === other.requestUrl
      && profile.defaultHeadersText === other.defaultHeadersText
      && profile.modelCatalogSourceId === other.modelCatalogSourceId
      && profile.enabled === other.enabled
      && profile.priority === other.priority;
  });
}

function parseHeadersDraft(value: string): Record<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '{}') return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tr('pages.accounts.endpointBindings.headersObjectRequired'));
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof headerValue !== 'string') {
      throw new Error(tr('pages.accounts.endpointBindings.headersStringValuesRequired'));
    }
    headers[key] = headerValue;
  }
  return headers;
}

function formatCredentialKind(credential: CredentialEndpointMatrixCredential) {
  return credential.credentialKind === 'account_token'
    ? tr('pages.accounts.endpointBindings.accountToken')
    : tr('pages.accounts.endpointBindings.account');
}

function ProfileLabel({ profile }: { profile: CredentialEndpointMatrixProfile }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-foreground">
        {profile.label || profile.apiType}
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
        {profile.apiType}
      </div>
      {profile.requestUrl ? (
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {profile.requestMethod || 'POST'} {profile.requestUrl}
        </div>
      ) : null}
    </div>
  );
}

export default function EndpointBindingsModal({
  open,
  siteId,
  initialCredentialKey,
  titleContext,
  onClose,
}: EndpointBindingsModalProps) {
  const toast = useToast();
  const [matrix, setMatrix] = useState<CredentialEndpointMatrix | null>(null);
  const [selectedCredentialKey, setSelectedCredentialKey] = useState('');
  const [draftBindings, setDraftBindings] = useState<DraftBinding[]>([]);
  const [draftProfiles, setDraftProfiles] = useState<DraftProfile[]>([]);
  const [activeTab, setActiveTab] = useState('profiles');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetToDefaults, setResetToDefaults] = useState(false);

  const profiles = matrix?.profiles || [];
  const catalogSources = matrix?.catalogSources || [];
  const credentials = matrix?.credentials || [];
  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.credentialKey === selectedCredentialKey) || null,
    [credentials, selectedCredentialKey],
  );
  const draftByProfileId = useMemo(() => {
    const map = new Map<number, DraftBinding>();
    for (const binding of draftBindings) map.set(binding.apiEndpointProfileId, binding);
    return map;
  }, [draftBindings]);
  const visibleCredentials = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return credentials;
    return credentials.filter((credential) => (
      `${credential.label} ${credential.detail || ''} ${credential.credentialKey}`.toLowerCase().includes(query)
    ));
  }, [credentials, search]);
  const dirty = useMemo(
    () => (
      !areDraftBindingsEqual(draftBindings, selectedCredential, profiles)
      || (
        resetToDefaults
        && (selectedCredential?.bindings || []).some((binding) => binding.persisted)
      )
    ),
    [draftBindings, profiles, resetToDefaults, selectedCredential],
  );
  const profilesDirty = useMemo(() => !areDraftProfilesEqual(draftProfiles, profiles), [draftProfiles, profiles]);
  const anyDirty = dirty || profilesDirty;
  const enabledSupportedCount = draftBindings.filter((binding) => (
    binding.enabled && binding.support === 'supported'
  )).length;

  const loadMatrix = async (preferredCredentialKey?: string | null) => {
    if (!siteId) return;
    setLoading(true);
    try {
      const next = await api.getSiteEndpointBindings(siteId);
      setMatrix(next);
      const preferred = preferredCredentialKey || selectedCredentialKey || initialCredentialKey || '';
      const nextSelected = next.credentials.find((credential) => credential.credentialKey === preferred)
        || next.credentials[0]
        || null;
      setSelectedCredentialKey(nextSelected?.credentialKey || '');
      setDraftBindings(createDraftBindings(nextSelected, next.profiles));
      setDraftProfiles(createDraftProfiles(next.profiles));
      setResetToDefaults(false);
    } catch (error: any) {
      toast.error(error?.message || tr('pages.accounts.endpointBindings.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setMatrix(null);
      setSelectedCredentialKey('');
      setDraftBindings([]);
      setDraftProfiles([]);
      setActiveTab('profiles');
      setSearch('');
      setLoading(false);
      setSaving(false);
      setResetToDefaults(false);
      return;
    }
    void loadMatrix(initialCredentialKey);
  }, [open, siteId, initialCredentialKey]);

  const selectCredential = (credential: CredentialEndpointMatrixCredential) => {
    setSelectedCredentialKey(credential.credentialKey);
    setDraftBindings(createDraftBindings(credential, profiles));
    setResetToDefaults(false);
  };

  const updateDraftBinding = (
    profileId: number,
    patch: Partial<Omit<DraftBinding, 'apiEndpointProfileId'>>,
  ) => {
    setResetToDefaults(false);
    setDraftBindings((current) => current.map((binding) => (
      binding.apiEndpointProfileId === profileId
        ? { ...binding, ...patch }
        : binding
    )));
  };

  const updateDraftProfile = (
    profileId: number,
    patch: Partial<Omit<DraftProfile, 'id'>>,
  ) => {
    setDraftProfiles((current) => current.map((profile) => (
      profile.id === profileId ? { ...profile, ...patch } : profile
    )));
  };

  const resetToSupportedDefaults = () => {
    setResetToDefaults(true);
    setDraftBindings(profiles.map((profile, index) => ({
      apiEndpointProfileId: profile.rowId,
      enabled: true,
      support: 'supported',
      priority: index,
    })));
  };

  const save = async () => {
    if (!siteId) return;
    setSaving(true);
    try {
      let next = matrix;
      if (profilesDirty) {
        next = await api.updateSiteEndpointProfiles(siteId, draftProfiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          requestMethod: profile.requestMethod,
          requestUrl: profile.requestUrl || null,
          defaultHeaders: parseHeadersDraft(profile.defaultHeadersText),
          modelCatalogSourceId: profile.modelCatalogSourceId === 'none' ? null : Number(profile.modelCatalogSourceId),
          enabled: profile.enabled,
          priority: profile.priority,
        })));
      }
      if (selectedCredential && dirty) {
        next = await api.updateSiteEndpointBindings(
          siteId,
          selectedCredential.credentialKey,
          resetToDefaults ? [] : draftBindings,
        );
      }
      if (!next) return;
      setMatrix(next);
      const preferredCredentialKey = selectedCredential?.credentialKey || selectedCredentialKey;
      const nextSelected = next.credentials.find((credential) => credential.credentialKey === preferredCredentialKey)
        || next.credentials[0]
        || null;
      setSelectedCredentialKey(nextSelected?.credentialKey || '');
      setDraftBindings(createDraftBindings(nextSelected, next.profiles));
      setDraftProfiles(createDraftProfiles(next.profiles));
      setResetToDefaults(false);
      toast.success(tr('pages.accounts.endpointBindings.saved'));
    } catch (error: any) {
      toast.error(error?.message || tr('pages.accounts.endpointBindings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose();
    }}>
      <Dialog.Content className="max-h-[min(88vh,820px)] w-[min(96vw,1120px)] overflow-hidden p-0" onClose={onClose}>
        <Dialog.Header className="border-b px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <Dialog.Title>{tr('pages.accounts.endpointBindings.title')}</Dialog.Title>
              <Dialog.Description className="mt-1">
                {titleContext || tr('pages.accounts.endpointBindings.description')}
              </Dialog.Description>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadMatrix(selectedCredentialKey)}
              disabled={loading || saving || !siteId}
            >
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {tr('pages.accounts.endpointBindings.refresh')}
            </Button>
          </div>
        </Dialog.Header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b bg-muted/20 p-4 lg:border-b-0 lg:border-r">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tr('pages.accounts.endpointBindings.searchCredential')}
              />
            </div>
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1 lg:max-h-[560px]">
              {loading && !matrix ? (
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  {tr('pages.accounts.endpointBindings.loading')}
                </div>
              ) : visibleCredentials.length > 0 ? visibleCredentials.map((credential) => (
                <Button
                  key={credential.credentialKey}
                  type="button"
                  variant="ghost"
                  className={cn(
                    'flex h-auto w-full min-w-0 justify-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                    credential.credentialKey === selectedCredentialKey
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-transparent bg-background/80 text-foreground hover:border-border hover:bg-background',
                  )}
                  onClick={() => selectCredential(credential)}
                >
                  <Network className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{credential.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {formatCredentialKind(credential)}
                      {credential.detail ? ` · ${credential.detail}` : ''}
                    </span>
                  </span>
                </Button>
              )) : (
                <Empty className="min-h-40 p-4">
                  <EmptyHeader>
                    <EmptyIcon><Network className="size-5" /></EmptyIcon>
                    <EmptyTitle>{tr('pages.accounts.endpointBindings.noCredentials')}</EmptyTitle>
                    <EmptyDescription>{tr('pages.accounts.endpointBindings.noCredentialsDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
              <TabsList>
                <TabsTrigger value="profiles">{tr('pages.accounts.endpointBindings.profileTab')}</TabsTrigger>
                <TabsTrigger value="credentials">{tr('pages.accounts.endpointBindings.credentialTab')}</TabsTrigger>
              </TabsList>

              <TabsContent value="profiles" className="mt-3">
                {profiles.length === 0 ? (
                  <Empty className="min-h-72">
                    <EmptyHeader>
                      <EmptyIcon><Network className="size-6" /></EmptyIcon>
                      <EmptyTitle>{tr('pages.accounts.endpointBindings.noProfiles')}</EmptyTitle>
                      <EmptyDescription>{tr('pages.accounts.endpointBindings.noProfilesDescription')}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="space-y-3">
                    {profilesDirty ? <ToneBadge tone="warning">{tr('pages.accounts.endpointBindings.unsaved')}</ToneBadge> : null}
                    <div className="space-y-2">
                      {draftProfiles.map((draftProfile) => {
                        const profile = profiles.find((item) => item.rowId === draftProfile.id);
                        return (
                          <div key={draftProfile.id} className="rounded-md border bg-background p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <h3 className="truncate text-sm font-semibold text-foreground">{profile?.apiType || draftProfile.label}</h3>
                                  <ToneBadge tone={draftProfile.enabled ? 'success' : '-muted'}>
                                    {draftProfile.enabled ? tr('pages.accounts.endpointBindings.enabled') : tr('app.disabled')}
                                  </ToneBadge>
                                </div>
                                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                  {profile?.profileKey}
                                </div>
                              </div>
                              <Switch
                                checked={draftProfile.enabled}
                                onCheckedChange={(enabled) => updateDraftProfile(draftProfile.id, { enabled })}
                                aria-label={tr('pages.accounts.endpointBindings.enabled')}
                              />
                            </div>

                            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px_220px]">
                              <div className="space-y-1.5">
                                <Label>{tr('pages.accounts.endpointBindings.profileLabel')}</Label>
                                <Input
                                  value={draftProfile.label}
                                  onChange={(event) => updateDraftProfile(draftProfile.id, { label: event.target.value })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>{tr('pages.accounts.endpointBindings.method')}</Label>
                                <Select
                                  value={draftProfile.requestMethod}
                                  onValueChange={(value) => updateDraftProfile(draftProfile.id, { requestMethod: value === 'GET' ? 'GET' : 'POST' })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="POST">POST</SelectItem>
                                    <SelectItem value="GET">GET</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label>{tr('pages.accounts.endpointBindings.catalogSource')}</Label>
                                <Select
                                  value={draftProfile.modelCatalogSourceId}
                                  onValueChange={(modelCatalogSourceId) => updateDraftProfile(draftProfile.id, { modelCatalogSourceId })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{tr('pages.accounts.endpointBindings.noCatalogSource')}</SelectItem>
                                    {catalogSources.map((source) => (
                                      <SelectItem key={source.id} value={String(source.id)}>
                                        {source.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className="mt-3 space-y-1.5">
                              <Label>{tr('pages.accounts.endpointBindings.requestUrl')}</Label>
                              <Input
                                className="font-mono"
                                value={draftProfile.requestUrl}
                                onChange={(event) => updateDraftProfile(draftProfile.id, { requestUrl: event.target.value })}
                                placeholder="https://api.example.com/v1/chat/completions"
                              />
                            </div>

                            <div className="mt-3 space-y-1.5">
                              <Label className="flex items-center gap-2">
                                <Braces className="size-3.5" />
                                {tr('pages.accounts.endpointBindings.defaultHeaders')}
                              </Label>
                              <JsonCodeEditor
                                value={draftProfile.defaultHeadersText}
                                onChange={(defaultHeadersText) => updateDraftProfile(draftProfile.id, { defaultHeadersText })}
                                minHeight={96}
                                maxHeight={180}
                                ariaLabel={tr('pages.accounts.endpointBindings.defaultHeaders')}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="credentials" className="mt-3">
                {!selectedCredential ? (
              <Empty className="min-h-72">
                <EmptyHeader>
                  <EmptyIcon><Network className="size-6" /></EmptyIcon>
                  <EmptyTitle>{tr('pages.accounts.endpointBindings.selectCredential')}</EmptyTitle>
                  <EmptyDescription>{tr('pages.accounts.endpointBindings.selectCredentialDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
                ) : profiles.length === 0 ? (
              <Empty className="min-h-72">
                <EmptyHeader>
                  <EmptyIcon><Network className="size-6" /></EmptyIcon>
                  <EmptyTitle>{tr('pages.accounts.endpointBindings.noProfiles')}</EmptyTitle>
                  <EmptyDescription>{tr('pages.accounts.endpointBindings.noProfilesDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
                ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">{selectedCredential.label}</h3>
                      <ToneBadge tone="-info">{formatCredentialKind(selectedCredential)}</ToneBadge>
                      {dirty ? <ToneBadge tone="warning">{tr('pages.accounts.endpointBindings.unsaved')}</ToneBadge> : null}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {selectedCredential.credentialKey}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">
                      {enabledSupportedCount} / {profiles.length}
                    </div>
                    <div>{tr('pages.accounts.endpointBindings.enabledSupported')}</div>
                  </div>
                </div>

                <div className="rounded-md border">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-64">{tr('pages.accounts.endpointBindings.endpoint')}</TableHead>
                        <TableHead className="w-28">{tr('pages.accounts.endpointBindings.enabled')}</TableHead>
                        <TableHead className="w-48">{tr('pages.accounts.endpointBindings.support')}</TableHead>
                        <TableHead className="w-28">{tr('pages.accounts.endpointBindings.source')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map((profile, index) => {
                        const draft = draftByProfileId.get(profile.rowId) || {
                          apiEndpointProfileId: profile.rowId,
                          enabled: true,
                          support: 'supported' as const,
                          priority: index,
                        };
                        const persisted = resetToDefaults
                          ? null
                          : selectedCredential.bindings.find((binding) => binding.apiEndpointProfileId === profile.rowId);
                        const option = supportOption(draft.support);
                        return (
                          <TableRow key={profile.rowId}>
                            <TableCell>
                              <ProfileLabel profile={profile} />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={draft.enabled}
                                onCheckedChange={(enabled) => updateDraftBinding(profile.rowId, { enabled })}
                                aria-label={tr('pages.accounts.endpointBindings.enabled')}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={draft.support}
                                onValueChange={(support) => updateDraftBinding(profile.rowId, {
                                  support: support as CredentialEndpointBindingSupport,
                                })}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue>
                                    <span className="flex min-w-0 items-center gap-2">
                                      <ToneBadge tone={option.tone}>{tr(option.labelKey)}</ToneBadge>
                                    </span>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent className="min-w-64">
                                  {SUPPORT_OPTIONS.map((supportOptionItem) => (
                                    <SelectItem key={supportOptionItem.value} value={supportOptionItem.value}>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <ToneBadge tone={supportOptionItem.tone}>{tr(supportOptionItem.labelKey)}</ToneBadge>
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {tr(supportOptionItem.descriptionKey)}
                                        </div>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <ToneBadge tone={persisted?.persisted ? '-info' : '-muted'}>
                                {persisted?.persisted
                                  ? tr('pages.accounts.endpointBindings.manual')
                                  : tr('pages.accounts.endpointBindings.default')}
                              </ToneBadge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <Dialog.Footer className="border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={resetToSupportedDefaults} disabled={!selectedCredential || loading || saving}>
            {tr('pages.accounts.endpointBindings.resetDefaults')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {tr('app.cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={!anyDirty || loading || saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tr('app.save')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
