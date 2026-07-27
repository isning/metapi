import {
  Cable,
  ChevronDown,
  CircleDot,
  ListFilter,
  OctagonX,
  Plus,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button/index.js';
import * as DropdownMenu from '../../components/ui/dropdown-menu/index.js';
import { tr } from '../../i18n.js';
import {
  getNodeDefinitionDetail,
  getNodeDefinitionTitle,
  NODE_TYPES,
} from './routeGraphRegistry.js';
import type { RouteGraphNodeType } from './routeGraphTypes.js';

const nodeIcons: Record<RouteGraphNodeType, ReactNode> = {
  entry: <CircleDot size={15} />,
  filter: <ListFilter size={15} />,
  dispatcher: <Shuffle size={15} />,
  route_endpoint: <Cable size={15} />,
  synthetic_endpoint: <OctagonX size={15} />,
};

export default function RouteGraphNodeMenu({
  disabled = false,
  onSelect,
  onSelectMacro,
}: {
  disabled?: boolean;
  onSelect: (type: RouteGraphNodeType) => void;
  onSelectMacro?: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid="route-graph-add-node"
        >
          <Plus size={14} />
          {tr('pages.tokenRoutes.routeGraphWorkspace.addNode')}
          <ChevronDown size={13} className="opacity-70" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="w-80">
        {NODE_TYPES.map((type) => (
          <DropdownMenu.Item
            key={type}
            className="items-start gap-2.5 py-2"
            data-testid={`route-graph-add-node-${type}`}
            onSelect={() => onSelect(type)}
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded border bg-muted text-muted-foreground">
              {nodeIcons[type]}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs font-medium text-foreground">{getNodeDefinitionTitle(type)}</span>
              <span className="text-[11px] leading-relaxed text-muted-foreground">{getNodeDefinitionDetail(type)}</span>
            </span>
          </DropdownMenu.Item>
        ))}
        {onSelectMacro && <><DropdownMenu.Separator />
        <DropdownMenu.Item
          className="items-start gap-2.5 py-2"
          data-testid="route-graph-add-macro-candidate-selector"
          onSelect={onSelectMacro}
        >
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded border bg-muted text-muted-foreground">
            <Sparkles size={15} />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="text-xs font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.candidateSelectorMacro')}</span>
            <span className="text-[11px] leading-relaxed text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.candidateSelectorMacroDescription')}</span>
          </span>
        </DropdownMenu.Item></>}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
