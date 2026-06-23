import ModelRouteFlow, { type ModelRouteFlowViewMode } from '../../components/ModelRouteFlow.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import type { ModelDetailsView } from './modelDetailsView.js';

type ModelRoutingTabProps = {
  details: ModelDetailsView;
  viewMode: ModelRouteFlowViewMode;
  onViewModeChange: (mode: ModelRouteFlowViewMode) => void;
};

export default function ModelRoutingTab({
  details,
  viewMode,
  onViewModeChange,
}: ModelRoutingTabProps) {
  return (
    <div className="grid gap-3">
      {details.routeFlow || details.routeFlowLoading || details.routeFlowError ? (
        <ModelRouteFlow
          flow={details.routeFlow}
          loading={details.routeFlowLoading}
          error={details.routeFlowError}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      ) : (
        <EmptyStateBlock title="No route flow" description="This model does not have compiled route-flow data yet." />
      )}
    </div>
  );
}
