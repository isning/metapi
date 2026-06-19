import React from 'react';
import { BrandGlyph, InlineBrandIcon, getBrand } from '../../components/BrandIcon.js';
import {
  getRouteRequestedModelPattern,
  resolveRouteBrand,
  resolveRouteIcon,
  resolveRouteTitle,
} from '../token-routes/utils.js';
import type { RouteSummaryRow } from '../token-routes/types.js';
import { Button } from '../../components/ui/button/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { Input } from '../../components/ui/input/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';

type RouteSelectorItem = Pick<RouteSummaryRow, 'id' | 'match' | 'presentation' | 'backend' | 'enabled'>;

type ModalPresence = {
  shouldRender: boolean;
  isVisible: boolean;
};

type DownstreamRouteSelection = {
  selectedModels: string[];
  selectedGroupRouteIds: number[];
};

type RouteSelectorModalProps = {
  presence: ModalPresence;
  loading: boolean;
  exactModelOptions: string[];
  filteredExactModelOptions: string[];
  groupRouteOptions: RouteSelectorItem[];
  filteredGroupRouteOptions: RouteSelectorItem[];
  selectorModelSearch: string;
  selectorGroupSearch: string;
  onSelectorModelSearchChange: (value: string) => void;
  onSelectorGroupSearchChange: (value: string) => void;
  selection: DownstreamRouteSelection;
  onToggleModelSelection: (modelName: string) => void;
  onToggleGroupRouteSelection: (routeId: number) => void;
  onClose: () => void;
};

export default function RouteSelectorModal({
  presence,
  loading,
  exactModelOptions,
  filteredExactModelOptions,
  groupRouteOptions,
  filteredGroupRouteOptions,
  selectorModelSearch,
  selectorGroupSearch,
  onSelectorModelSearchChange,
  onSelectorGroupSearchChange,
  selection,
  onToggleModelSelection,
  onToggleGroupRouteSelection,
  onClose,
}: RouteSelectorModalProps) {
  return (
    <Dialog.Root open={presence.shouldRender} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content className="max-h-[min(88vh,760px)] max-w-[min(92vw,860px)] overflow-hidden p-0">
        <Dialog.Header className="border-b p-4">
          <Dialog.Title>勾选模型和群组</Dialog.Title>
          <Dialog.Description>
            选择结果会保存到当前下游 API Key：精确模型用于模型白名单，群组用于路由范围限制。
          </Dialog.Description>
        </Dialog.Header>
        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <SelectorColumn
                title={`精确模型 (${selectorModelSearch.trim()
                  ? `${filteredExactModelOptions.length}/${exactModelOptions.length}`
                  : exactModelOptions.length})`}
                searchValue={selectorModelSearch}
                searchPlaceholder="搜索精确模型（支持模糊匹配）"
                onSearchChange={onSelectorModelSearchChange}
                empty={exactModelOptions.length === 0 ? '暂无可选精确模型' : '没有匹配的精确模型'}
              >
                {exactModelOptions.length === 0 || filteredExactModelOptions.length === 0 ? null : filteredExactModelOptions.map((modelName) => (
                  <ModelOption
                    key={modelName}
                    modelName={modelName}
                    checked={selection.selectedModels.includes(modelName)}
                    onToggle={() => onToggleModelSelection(modelName)}
                  />
                ))}
              </SelectorColumn>

              <SelectorColumn
                title={`群组 (${selectorGroupSearch.trim()
                  ? `${filteredGroupRouteOptions.length}/${groupRouteOptions.length}`
                  : groupRouteOptions.length})`}
                searchValue={selectorGroupSearch}
                searchPlaceholder="Search groups (name / pattern)"
                onSearchChange={onSelectorGroupSearchChange}
                empty={groupRouteOptions.length === 0 ? '暂无可选群组' : '没有匹配的群组'}
              >
                {groupRouteOptions.length === 0 || filteredGroupRouteOptions.length === 0 ? null : filteredGroupRouteOptions.map((route) => (
                  <GroupRouteOption
                    key={route.id}
                    route={route}
                    checked={selection.selectedGroupRouteIds.includes(route.id)}
                    onToggle={() => onToggleGroupRouteSelection(route.id)}
                  />
                ))}
              </SelectorColumn>
            </div>
          )}
        </div>
        <Dialog.Footer className="border-t p-4">
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SelectorColumn({
  title,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  empty,
  children,
}: {
  title: string;
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
        <ScrollArea className="h-72">
          <div className="space-y-2 pr-3">
            {hasChildren ? children : <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function ModelOption({
  modelName,
  checked,
  onToggle,
}: {
  modelName: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const brand = getBrand(modelName);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {brand ? (
            <InlineBrandIcon model={modelName} size={18} />
          ) : (
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-xs">
              {modelName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <code className="truncate text-xs font-semibold">{modelName}</code>
        </div>
        {brand ? <div className="text-xs text-muted-foreground">{brand.name}</div> : null}
      </div>
    </label>
  );
}

function GroupRouteOption({
  route,
  checked,
  onToggle,
}: {
  route: RouteSelectorItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const routeTitle = resolveRouteTitle(route);
  const routeIcon = resolveRouteIcon(route);
  const routeBrand = resolveRouteBrand(route);
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md border text-xs">
            {routeIcon.kind === 'brand' ? (
              <BrandGlyph icon={routeIcon.value} alt={routeTitle} size={18} fallbackText={routeTitle} />
            ) : routeIcon.kind === 'text' ? (
              routeIcon.value
            ) : routeIcon.kind === 'auto' && routeBrand ? (
              <BrandGlyph brand={routeBrand} alt={routeTitle} size={18} fallbackText={routeTitle} />
            ) : routeIcon.kind === 'auto' ? (
              <InlineBrandIcon model={getRouteRequestedModelPattern(route)} size={18} />
            ) : null}
          </span>
          <code className="truncate text-xs font-semibold">{routeTitle}</code>
          {!route.enabled ? <Badge variant="destructive">已禁用</Badge> : null}
        </div>
        <code className="truncate text-xs text-muted-foreground">{getRouteRequestedModelPattern(route)}</code>
      </div>
    </label>
  );
}
