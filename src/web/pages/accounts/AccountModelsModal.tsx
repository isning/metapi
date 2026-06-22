import React, { useState } from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Button } from '../../components/ui/button/index.js';
import { Coins, LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { UpstreamCostPricingEditor } from '../../components/UpstreamCostPricingEditor.js';
import { useToast } from '../../components/Toast.js';

import { tr } from '../../i18n.js';
type AccountModelRow = {
  name: string;
  latencyMs: number | null;
  disabled: boolean;
  isManual?: boolean;
  costPricing?: {
    configured: boolean;
    matchedScope: string | null;
    pricingId: number | null;
    totalCostUsd: number | null;
  } | null;
};

type AccountModelModalState = {
  open: boolean;
  account: any | null;
  models: AccountModelRow[];
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
};

type AccountModelsModalProps = {
  modelModal: AccountModelModalState;
  onClose: () => void;
  onSave: () => void;
  onRefresh: () => Promise<void> | void;
  onReload: () => Promise<void> | void;
  onToggleModelDisabled: (modelName: string) => void;
  onSetPendingDisabled: (pendingDisabled: Set<string>) => void;
  onManualInputChange: (value: string) => void;
  onAddManualModels: () => Promise<void> | void;
};

export default function AccountModelsModal({
  modelModal,
  onClose,
  onSave,
  onRefresh,
  onReload,
  onToggleModelDisabled,
  onSetPendingDisabled,
  onManualInputChange,
  onAddManualModels,
}: AccountModelsModalProps) {
  const toast = useToast();
  const [costModelName, setCostModelName] = useState<string | null>(null);
  const account = modelModal.account;
  const siteId = Number(account?.siteId || account?.site?.id || 0);
  const accountId = Number(account?.id || 0);
  const accountTokens = modelModal.accountTokens || account?.accountTokens || account?.tokens || [];

  const formatCostSummary = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return `$${value.toFixed(6).replace(/\.?0+$/, '')}`;
  };

  const scopeLabel = (scope: string | null | undefined) => {
    if (scope === 'site_model') return tr('components.searchModal.sites2');
    if (scope === 'account_model') return tr('components.searchModal.accounts2');
    if (scope === 'token_model') return 'Token';
    if (scope === 'token_model_group') return tr('pages.accounts.accountModelsModal.tokenGroup');
    return tr('pages.settings.notConfigured');
  };

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
              onClick={onSave}
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
          {modelModal.models.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-4">
              <EmptyStateBlock
                title={tr('pages.accounts.accountModelsModal.noAvailableModels')}
                description={tr('pages.accounts.accountModelsModal.useRefreshModelAccountActionBarFetch')}
                className="p-0"
              />
              <Button type="button"
                onClick={() => void onRefresh()}
               
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
                      modelModal.pendingDisabled.size > 0 && modelModal.pendingDisabled.size < modelModal.models.length
                        ? 'indeterminate'
                        : modelModal.pendingDisabled.size === 0
                    }
                    onCheckedChange={() => {
                      const allEnabled = modelModal.pendingDisabled.size === 0;
                      onSetPendingDisabled(allEnabled ? new Set(modelModal.models.map((model) => model.name)) : new Set());
                    }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {tr('pages.settings.enabled2')} <strong className="text-foreground">{modelModal.models.length - modelModal.pendingDisabled.size}</strong> / {modelModal.models.length} {tr('pages.models.models2')}
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline"
                    onClick={() => void onRefresh()}
                    disabled={modelModal.saving}
                   
                   
                  >
                    {tr('pages.accounts.accountModelsModal.refreshModels')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => {
                      const next = new Set<string>();
                      for (const model of modelModal.models) {
                        if (!modelModal.pendingDisabled.has(model.name)) next.add(model.name);
                      }
                      onSetPendingDisabled(next);
                    }}
                   
                   
                  >
                    {tr('pages.accounts.accountModelsModal.invert')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => onSetPendingDisabled(new Set(modelModal.models.map((model) => model.name)))}
                   
                   
                  >
                    {tr('pages.accounts.accountModelsModal.disableAll')}
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => onSetPendingDisabled(new Set())}
                   
                   
                  >
                    {tr('pages.accounts.accountModelsModal.enableAll')}
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-72 rounded-md border">
                {modelModal.models.map((model, idx) => {
                  const isDisabled = modelModal.pendingDisabled.has(model.name);
                  return (
                    <div
                      key={model.name}
                      className={`flex items-center gap-3 px-3 py-2 transition-opacity ${idx < modelModal.models.length - 1 ? 'border-b' : ''} ${isDisabled ? 'bg-muted/50 opacity-60' : ''}`.trim()}
                    >
                      <Checkbox
                        checked={!isDisabled}
                        onCheckedChange={() => onToggleModelDisabled(model.name)}
                        className="shrink-0"
                        aria-label={`切换 ${model.name}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-w-0 flex-1 break-all text-left font-mono text-sm"
                        onClick={() => onToggleModelDisabled(model.name)}
                      >
                        {model.name}
                      </Button>
                      {model.latencyMs != null ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {model.latencyMs}ms
                        </span>
                      ) : null}
                      {model.isManual ? (
                        <ToneBadge tone="-info">{tr('pages.accounts.accountModelsModal.manual')}</ToneBadge>
                      ) : null}
                      {isDisabled ? (
                        <ToneBadge tone="-error">{tr('pages.downstreamKeys.disabled')}</ToneBadge>
                      ) : null}
                      <div className="flex shrink-0 items-center gap-1">
                        {model.costPricing?.configured ? (
                          <>
                            <ToneBadge tone="-success">{scopeLabel(model.costPricing.matchedScope)}</ToneBadge>
                            {formatCostSummary(model.costPricing.totalCostUsd) ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {formatCostSummary(model.costPricing.totalCostUsd)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <ToneBadge tone="-muted">{tr('pages.accounts.accountModelsModal.noCostPricing')}</ToneBadge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCostModelName(model.name)}
                      >
                        <Coins className="size-4" />
                        {tr('components.charts.downstreamKeyTrendChart.cost')}
                      </Button>
                    </div>
                  );
                })}
              </ScrollArea>
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
                value={modelModal.manualModelsInput}
                onChange={(e) => onManualInputChange(e.target.value)}
                className="flex-1 font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !modelModal.addingManualModels) {
                    void onAddManualModels();
                  }
                }}
              />
              <Button type="button" size="sm"
                disabled={!modelModal.manualModelsInput.trim() || modelModal.addingManualModels}
                onClick={() => void onAddManualModels()}
               
               
              >
                {modelModal.addingManualModels ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.oAuthManagement.add')}
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
        <Dialog.Content className="w-[min(94vw,980px)]" onClose={() => setCostModelName(null)}>
          <Dialog.Header>
            <Dialog.Title>{tr('pages.accounts.accountModelsModal.upstreamCostPricing')}</Dialog.Title>
            <Dialog.Description>
              {tr('pages.accounts.accountModelsModal.configureCostMetapiPaysWhenAccountModel')}
            </Dialog.Description>
          </Dialog.Header>
          {costModelName && siteId > 0 && accountId > 0 ? (
            <div className="mt-3">
              <UpstreamCostPricingEditor
                open={!!costModelName}
                siteId={siteId}
                accountId={accountId}
                modelName={costModelName}
                siteName={modelModal.siteName || account?.site?.name}
                accountName={account?.username}
                tokens={accountTokens}
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
