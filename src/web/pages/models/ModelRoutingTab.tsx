import ModelRouteFlow, { type ModelRouteFlowViewMode } from '../../components/ModelRouteFlow.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import type { ModelDetailsView } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

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
        <EmptyStateBlock title={tr('pages.models.modelRoutingTab.noRouteFlow')} description={tr('pages.models.modelRoutingTab.noRouteFlowDescription')} />
      )}
    </div>
  );
}
