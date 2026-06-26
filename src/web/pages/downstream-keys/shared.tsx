import React from 'react';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';

import { tr } from '../../i18n.js';
export type Range = '24h' | '7d' | 'all';

export type SummaryItem = {
  id: number;
  name: string;
  keyMasked: string;
  enabled: boolean;
  description: string | null;
  groupName: string | null;
  tags: string[];
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  maxRequests: number | null;
  usedRequests: number;
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: Array<
    | { kind: 'account_token'; siteId: number; accountId: number; tokenId: number }
    | { kind: 'default_api_key'; siteId: number; accountId: number }
  >;
  lastUsedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  rangeUsage: {
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number | null;
    totalTokens: number;
    totalCost: number;
  };
};

export type AggregateUsage = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number | null;
  totalTokens: number;
  totalCost: number;
};

export type OverviewResponse = {
  success: boolean;
  item: SummaryItem;
  usage: null | {
    last24h: AggregateUsage | null;
    last7d: AggregateUsage | null;
    all: AggregateUsage | null;
  };
};

export function formatIso(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '--';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(6)}`;
}

export function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.trunc(value));
}

export function TagChips({
  tags,
  accent = false,
  maxVisible = 3,
}: {
  tags: string[];
  accent?: boolean;
  maxVisible?: number;
}) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return <Badge variant="secondary">{tr('pages.downstreamKeys.noTags')}</Badge>;
  }

  const visible = tags.slice(0, maxVisible);
  const hidden = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((tag) => (
        <Badge key={tag} variant={accent ? 'default' : 'secondary'}>
          {tag}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="secondary">{`+${hidden}`}</Badge> : null}
    </div>
  );
}

export function resolveOverviewUsageByRange(
  overview: OverviewResponse | null,
  range: Range,
): AggregateUsage | null {
  if (!overview?.usage) return null;
  if (range === '24h') return overview.usage.last24h;
  if (range === '7d') return overview.usage.last7d;
  return overview.usage.all;
}

export function TrendChartFallback({ height = 260 }: { height?: number }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="w-full" style={{ height }} />
      </CardContent>
    </Card>
  );
}

export function RangeToggle({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <ButtonGroup>
      <Button type="button" size="sm" variant={range === '24h' ? 'default' : 'outline'} onClick={() => onChange('24h')}>
        24h
      </Button>
      <Button type="button" size="sm" variant={range === '7d' ? 'default' : 'outline'} onClick={() => onChange('7d')}>
        7d
      </Button>
      <Button type="button" size="sm" variant={range === 'all' ? 'default' : 'outline'} onClick={() => onChange('all')}>
        {tr('components.notificationPanel.all')}
      </Button>
    </ButtonGroup>
  );
}

export function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? 'default' : 'secondary'}>
      {enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
    </Badge>
  );
}
