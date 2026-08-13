import React, { useEffect, useMemo, useState } from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { UpstreamCostPricingEditor } from '../../components/UpstreamCostPricingEditor.js';
import { useToast } from '../../components/Toast.js';
import ModernSelect from '../../components/ModernSelect.js';
import {
  ModelAvailabilityList,
  type ModelAvailabilityRow,
  type ModelAvailabilityToken,
  type TokenModelAvailability,
} from '../../components/ModelAvailabilityList.js';

import { tr } from '../../i18n.js';
import type { UpstreamCostMatchedScope } from '../../api.js';
type AccountModelRow = {
  name: string;
  latencyMs: number | null;
  disabled: boolean;
  isManual?: boolean;
  costPricing?: {
    status: 'configured' | 'unconfigured' | 'error';
    configured: boolean;
    matchedScope: UpstreamCostMatchedScope | null;
    pricingId: number | null;
    totalCost: number | null;
    diagnostics?: Array<{ level: string; message: string }>;
  } | null;
};

type AccountModelModalState = {
  open: boolean;
  account: any | null;
  models: AccountModelRow[];
  accountTokens?: ModelAvailabilityToken[];
  tokenModels?: TokenModelAvailability[];
  loading: boolean;
  saving: boolean;
  siteName: string;
};

type AccountModelsModalProps = {
  modelModal: AccountModelModalState;
  onClose: () => void;
  onSave: (tokenId: number | null, disabledModels: Set<string>) => Promise<void> | void;
  onRefresh: (tokenId: number | null) => Promise<void> | void;
  onReload: () => Promise<void> | void;
  onAddManualModels: (tokenId: number | null, models: string[]) => Promise<void> | void;
  initialTokenId?: number | null;
};

function sameModelNames(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const name of left) {
    if (!right.has(name)) return false;
  }
  return true;
}

export default function AccountModelsModal({
  modelModal,
  onClose,
  onSave,
  onRefresh,
  onReload,
  onAddManualModels,
  initialTokenId = null,
}: AccountModelsModalProps) {
  const toast = useToast();
  const [costModelName, setCostModelName] = useState<string | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [pendingDisabled, setPendingDisabled] = useState<Set<string>>(new Set());
  const [manualModelsInput, setManualModelsInput] = useState('');
  const [addingManualModels, setAddingManualModels] = useState(false);
  const account = modelModal.account;
  const siteId = Number(account?.siteId || account?.site?.id || 0);
  const accountId = Number(account?.id || 0);
  const accountTokens: ModelAvailabilityToken[] = modelModal.accountTokens || account?.accountTokens || account?.tokens || [];
  const tokenModels: TokenModelAvailability[] = modelModal.tokenModels || [];
  const selectedToken = accountTokens.find((token) => token.id === selectedTokenId) || null;
  const selectedTokenModels = useMemo(
    () => tokenModels.find((entry) => entry.tokenId === selectedTokenId) || null,
    [selectedTokenId, tokenModels],
  );
  const isTokenView = selectedToken !== null;
  const displayedModels: ModelAvailabilityRow[] = isTokenView
    ? selectedTokenModels?.models || []
    : modelModal.models;

  useEffect(() => {
    const initialDisabled = new Set(displayedModels.filter((model) => model.disabled).map((model) => model.name));
    setPendingDisabled((current) => sameModelNames(current, initialDisabled) ? current : initialDisabled);
    setManualModelsInput('');
  }, [selectedTokenId, modelModal.open, modelModal.models, tokenModels]);

  const toggleModelDisabled = (modelName: string) => {
    setPendingDisabled((current) => {
      const next = new Set(current);
      if (next.has(modelName)) next.delete(modelName); else next.add(modelName);
      return next;
    });
  };

  const addManualModels = async () => {
    const models = Array.from(new Set(manualModelsInput.split(/[\s,]+/).map((model) => model.trim()).filter(Boolean)));
    if (models.length === 0) return;
    setAddingManualModels(true);
    try {
      await onAddManualModels(selectedTokenId, models);
      setManualModelsInput('');
    } finally {
      setAddingManualModels(false);
    }
  };

  useEffect(() => {
    if (initialTokenId != null && accountTokens.some((token) => token.id === initialTokenId)) {
      setSelectedTokenId(initialTokenId);
    }
  }, [initialTokenId, accountTokens]);

  useEffect(() => {
    if (selectedTokenId != null && !accountTokens.some((token) => token.id === selectedTokenId)) {
      setSelectedTokenId(null);
    }
  }, [accountTokens, selectedTokenId]);

  const scopeLabels: Record<UpstreamCostMatchedScope, string> = {
    site_model: tr('components.searchModal.sites2'),
    account_model: tr('components.searchModal.accounts2'),
    token_model: 'Token',
    provider_catalog: tr('upstreamCostPricing.source.providerCatalog'),
    system_default: tr('upstreamCostPricing.source.systemDefault'),
  };
  const scopeLabel = (scope: UpstreamCostMatchedScope) => scopeLabels[scope];

  return (
    <>
      <CenteredModal
        open={modelModal.open}
        onClose={onClose}
        title={modelModal.siteName ? `模型管理 · ${modelModal.siteName}` : tr('pages.accounts.accountModelsModal.modelManagement')}
        maxWidth={720}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={onClose}>{tr('app.cancel')}</Button>
            <Button type="button"
              onClick={() => void onSave(selectedTokenId, pendingDisabled)}
              disabled={modelModal.saving || modelModal.loading}
            >
              {modelModal.saving ? <><LoaderCircle className="size-4 animate-spin" />{tr('pages.accounts.saving')}</> : tr('app.save')}
            </Button>
          </>
        )}
      >
      {modelModal.loading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="text-sm text-muted-foreground">{tr('pages.accounts.accountModelsModal.loadingModelList')}</span>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-1.5 sm:max-w-sm">
            <div className="text-xs font-medium text-muted-foreground">{tr('pages.accounts.accountModelsModal.modelSource')}</div>
            <ModernSelect
              value={selectedTokenId == null ? 'account' : String(selectedTokenId)}
              onChange={(value) => setSelectedTokenId(value === 'account' ? null : Number(value))}
              options={[
                { value: 'account', label: tr('pages.accounts.accountModelsModal.accountModels') },
                ...accountTokens.map((token) => ({
                  value: String(token.id),
                  label: token.name || `Token ${token.id}`,
                  description: token.tokenGroup || undefined,
                })),
              ]}
            />
          </div>
          {displayedModels.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-4">
              <EmptyStateBlock
                title={tr('pages.accounts.accountModelsModal.noAvailableModels')}
                description={tr('pages.accounts.accountModelsModal.useRefreshModelAccountActionBarFetch')}
                className="p-0"
              />
              <Button type="button"
                onClick={() => void onRefresh(selectedTokenId)}

              >
                {tr('pages.accounts.accountModelsModal.fetchModelsNow')}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <Checkbox

                    checked={
                      pendingDisabled.size > 0 && pendingDisabled.size < displayedModels.length
                        ? 'indeterminate'
                        : pendingDisabled.size === 0
                    }
                    onCheckedChange={() => {
                      const allEnabled = pendingDisabled.size === 0;
                      setPendingDisabled(allEnabled ? new Set(displayedModels.map((model) => model.name)) : new Set());
                    }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {tr('pages.settings.enabled2')} <strong className="text-foreground">{displayedModels.length - pendingDisabled.size}</strong> / {displayedModels.length} {tr('pages.models.models2')}
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline"
                    onClick={() => void onRefresh(selectedTokenId)}
                    disabled={modelModal.saving}


                  >
                    {tr('pages.accounts.accountModelsModal.refreshModels')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => {
                      const next = new Set<string>();
                      for (const model of displayedModels) {
                        if (!pendingDisabled.has(model.name)) next.add(model.name);
                      }
                      setPendingDisabled(next);
                    }}


                  >
                    {tr('pages.accounts.accountModelsModal.invert')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => setPendingDisabled(new Set(displayedModels.map((model) => model.name)))}


                  >
                    {tr('pages.accounts.accountModelsModal.disableAll')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => setPendingDisabled(new Set())}


                  >
                    {tr('pages.accounts.accountModelsModal.enableAll')}
                  </Button>
                </div>
              </div>

              {/* Shared rows keep account and token model views visually identical. */}
              <ModelAvailabilityList
                models={displayedModels.map((model) => ({ ...model, disabled: pendingDisabled.has(model.name) }))}
                selectable
                onToggleDisabled={toggleModelDisabled}
                onConfigureCost={setCostModelName}
                scopeLabel={scopeLabel}
              />
              <div className="text-xs text-muted-foreground">
                {tr('pages.accounts.accountModelsModal.disabledModelsApplyWholeSiteNoConnection')}
              </div>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{tr('pages.accounts.accountModelsModal.addAvailableModelsManually')}</CardTitle>
              <CardDescription>
                {tr('pages.accounts.accountModelsModal.ifAccountSupportsModelsMissingFromList')}
              </CardDescription>
            </CardHeader>
            <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder={tr('pages.accounts.accountModelsModal.exampleGpt4CustomClaude35')}
                value={manualModelsInput}
                onChange={(e) => setManualModelsInput(e.target.value)}
                className="flex-1 font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !addingManualModels) {
                    void addManualModels();
                  }
                }}
              />
              <Button type="button" size="sm"
                disabled={!manualModelsInput.trim() || addingManualModels}
                onClick={() => void addManualModels()}


              >
                {addingManualModels ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.oAuthManagement.add')}
              </Button>
            </div>
            </CardContent>
          </Card>
        </div>
      )}
      </CenteredModal>

      <Dialog.Root open={!!costModelName} onOpenChange={(open) => {
        if (!open) setCostModelName(null);
      }}>
        <Dialog.Content className="w-[min(94vw,980px)] overflow-hidden p-0" onClose={() => setCostModelName(null)}>
          <Dialog.Header className="shrink-0 border-b px-5 py-4">
            <Dialog.Title>{tr('pages.accounts.accountModelsModal.upstreamCostPricing')}</Dialog.Title>
            <Dialog.Description>
              {tr('pages.accounts.accountModelsModal.configureCostMetapiPaysWhenAccountModel')}
            </Dialog.Description>
          </Dialog.Header>
          {costModelName && siteId > 0 && accountId > 0 ? (
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <UpstreamCostPricingEditor
                open={!!costModelName}
                siteId={siteId}
                ownerScope="account"
                accountId={accountId}
                fixedTokenId={selectedTokenId ?? undefined}
                modelName={costModelName}
                siteName={modelModal.siteName || account?.site?.name}
                accountName={account?.username}
                tokens={selectedToken ? [selectedToken] : accountTokens}
                onOpenChange={(open) => {
                  if (!open) setCostModelName(null);
                }}
                onSaved={() => {
                  void onReload();
                }}
                toast={toast}
              />
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
