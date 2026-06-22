import ModelRouteFlow from '../../components/ModelRouteFlow.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import type { ModelDetailsView } from './modelDetailsView.js';

type RoutingViewMode = 'effective' | 'candidates' | 'compiled' | 'diagnostics';

type ModelRoutingTabProps = {
  details: ModelDetailsView;
  viewMode: RoutingViewMode;
  onViewModeChange: (mode: RoutingViewMode) => void;
};

const modes: Array<{ value: RoutingViewMode; label: string }> = [
  { value: 'effective', label: 'Effective' },
  { value: 'candidates', label: 'Candidates' },
  { value: 'compiled', label: 'Compiled' },
  { value: 'diagnostics', label: 'Diagnostics' },
];

export default function ModelRoutingTab({
  details,
  viewMode,
  onViewModeChange,
}: ModelRoutingTabProps) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Route graph</div>
          <div className="text-xs text-muted-foreground">Compiled graph-native route program and selected endpoint trace.</div>
        </div>
        <ButtonGroup>
          {modes.map((mode) => (
            <Button
              key={mode.value}
              type="button"
              variant={viewMode === mode.value ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => onViewModeChange(mode.value)}
            >
              {mode.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      {details.routeFlow || details.routeFlowLoading || details.routeFlowError ? (
        <ModelRouteFlow
          flow={details.routeFlow}
          loading={details.routeFlowLoading}
          error={details.routeFlowError}
        />
      ) : (
        <EmptyStateBlock title="No route flow" description="This model does not have compiled route-flow data yet." />
      )}
    </div>
  );
}
