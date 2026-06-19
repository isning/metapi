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
    if (scope === 'site_model') return '站点';
    if (scope === 'account_model') return '账号';
    if (scope === 'token_model') return 'Token';
    if (scope === 'token_model_group') return 'Token 组';
    return '未配置';
  };

  return (
    <>
      <CenteredModal
        open={modelModal.open}
        onClose={onClose}
        title={modelModal.siteName ? `模型管理 · ${modelModal.siteName}` : '模型管理'}
        maxWidth={720}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="button"
              onClick={onSave}
              disabled={modelModal.saving || modelModal.loading}
            >
              {modelModal.saving ? <><LoaderCircle className="size-4 animate-spin" />保存中...</> : '保存'}
            </Button>
          </>
        )}
      >
      {modelModal.loading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="text-sm text-muted-foreground">加载模型列表...</span>
        </div>
      ) : (
        <div className="grid gap-3">
          {modelModal.models.length === 0 ? (
            <div className="grid justify-items-center gap-3 py-4">
              <EmptyStateBlock
                title="暂无可用模型"
                description="请先点击账号操作栏中的「刷新」或「模型」按钮获取模型。"
                className="p-0"
              />
              <Button type="button"
                onClick={() => void onRefresh()}
               
              >
                立即获取模型
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
                    已启用 <strong className="text-foreground">{modelModal.models.length - modelModal.pendingDisabled.size}</strong> / {modelModal.models.length} 个模型
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline"
                    onClick={() => void onRefresh()}
                    disabled={modelModal.saving}
                   
                   
                  >
                    刷新模型
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
                    反选
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => onSetPendingDisabled(new Set(modelModal.models.map((model) => model.name)))}
                   
                   
                  >
                    全部禁用
                  </Button>
                  <Button type="button" variant="outline"
                    onClick={() => onSetPendingDisabled(new Set())}
                   
                   
                  >
                    全部启用
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
                      <button
                        type="button"
                        className="min-w-0 flex-1 break-all text-left font-mono text-sm"
                        onClick={() => onToggleModelDisabled(model.name)}
                      >
                        {model.name}
                      </button>
                      {model.latencyMs != null ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {model.latencyMs}ms
                        </span>
                      ) : null}
                      {model.isManual ? (
                        <ToneBadge tone="-info">手动</ToneBadge>
                      ) : null}
                      {isDisabled ? (
                        <ToneBadge tone="-error">禁用</ToneBadge>
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
                          <ToneBadge tone="-muted">未配置成本</ToneBadge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCostModelName(model.name)}
                      >
                        <Coins className="size-4" />
                        成本
                      </Button>
                    </div>
                  );
                })}
              </ScrollArea>
              <div className="text-xs text-muted-foreground">
                禁用的模型将对整个站点生效，该站点下所有连接都不会使用这些模型进行代理。
              </div>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>手动添加可用模型</CardTitle>
              <CardDescription>
                如果您的账号支持某些未在上方列表中显示的模型，可以在此手动添加（多个以英文逗号分隔）。
              </CardDescription>
            </CardHeader>
            <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="例如: gpt-4-custom, claude-3-5-sonnet-20241022"
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
                {modelModal.addingManualModels ? <LoaderCircle className="size-4 animate-spin" /> : '添加'}
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
            <Dialog.Title>上游成本配置</Dialog.Title>
            <Dialog.Description>
              为当前账号模型配置 Metapi 调用上游供应的成本。
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
