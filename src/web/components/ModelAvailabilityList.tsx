import React from 'react';
import { Coins } from 'lucide-react';
import { Button } from './ui/button/index.js';
import { Checkbox } from './ui/checkbox/index.js';
import ToneBadge from './ToneBadge.js';
import { tr } from '../i18n.js';
import type { UpstreamCostMatchedScope } from '../api.js';

export type ModelAvailabilityRow = {
  name: string;
  available?: boolean;
  latencyMs: number | null;
  disabled: boolean;
  siteDisabled?: boolean;
  tokenDisabled?: boolean;
  isManual?: boolean;
  costPricing?: { status: 'configured' | 'unconfigured' | 'error'; configured: boolean; matchedScope: UpstreamCostMatchedScope | null; totalCost: number | null } | null;
};

export type ModelAvailabilityToken = {
  id: number;
  name: string;
  tokenGroup?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  valueStatus?: string | null;
};

export type TokenModelAvailability = {
  tokenId: number;
  observed: boolean;
  models: ModelAvailabilityRow[];
};

export function ModelAvailabilityList({ models, selectable, onToggleDisabled, onConfigureCost, scopeLabel }: {
  models: ModelAvailabilityRow[];
  selectable: boolean;
  onToggleDisabled?: (modelName: string) => void;
  onConfigureCost?: (modelName: string) => void;
  scopeLabel: (scope: UpstreamCostMatchedScope) => string;
}) {
  const formatCost = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(6).replace(/\.?0+$/, '') : null;
  return <div className="h-72 overflow-y-auto rounded-md border">{models.map((model, idx) => (
    <div key={model.name} className={`flex items-center gap-3 px-3 py-2 transition-opacity ${idx < models.length - 1 ? 'border-b' : ''} ${model.disabled ? 'bg-muted/50 opacity-60' : ''}`.trim()}>
      {selectable ? <Checkbox checked={!model.disabled} onCheckedChange={() => onToggleDisabled?.(model.name)} className="shrink-0" aria-label={`切换 ${model.name}`} /> : null}
      <Button type="button" variant="ghost" className="min-w-0 flex-1 break-all text-left font-mono text-sm" onClick={() => onToggleDisabled?.(model.name)} disabled={!selectable}>{model.name}</Button>
      {model.latencyMs != null ? <span className="shrink-0 text-xs text-muted-foreground">{model.latencyMs}ms</span> : null}
      {model.available === false ? <ToneBadge tone="-error">{tr('pages.accounts.accountModelsModal.tokenUnavailable')}</ToneBadge> : null}
      {model.isManual ? <ToneBadge tone="-info">{tr('pages.accounts.accountModelsModal.manual')}</ToneBadge> : null}
      {model.disabled ? <ToneBadge tone="-error">{tr('pages.downstreamKeys.disabled')}</ToneBadge> : null}
      <div className="flex shrink-0 items-center gap-1">
        {model.costPricing?.status === 'configured' ? <><ToneBadge tone="-success">{scopeLabel(model.costPricing.matchedScope!)}</ToneBadge>{formatCost(model.costPricing.totalCost) ? <span className="font-mono text-xs text-muted-foreground">{formatCost(model.costPricing.totalCost)}</span> : null}</>
          : model.costPricing?.status === 'error' ? <ToneBadge tone="-error">{tr('pages.accounts.accountModelsModal.costPricingError')}</ToneBadge>
            : <ToneBadge tone="-muted">{tr('pages.accounts.accountModelsModal.noCostPricing')}</ToneBadge>}
      </div>
      {onConfigureCost ? <Button type="button" variant="ghost" size="sm" onClick={() => onConfigureCost(model.name)}><Coins className="size-4" />{tr('components.charts.downstreamKeyTrendChart.cost')}</Button> : null}
    </div>
  ))}</div>;
}
