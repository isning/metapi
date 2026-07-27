import ModelRouteFlow, { type ModelRouteFlowViewMode } from '../../components/ModelRouteFlow.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import type { ModelDetailsView } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

type ModelRoutingTabProps = {
  routing: ModelDetailsView['routing'];
  viewMode: ModelRouteFlowViewMode;
  onViewModeChange: (mode: ModelRouteFlowViewMode) => void;
};

export default function ModelRoutingTab({
  routing,
  viewMode,
  onViewModeChange,
}: ModelRoutingTabProps) {
  return (
    <div className="grid gap-3">
      {routing.hasContent || routing.loading || routing.error ? (
        <ModelRouteFlow
          flow={routing.flow}
          loading={routing.loading}
          error={routing.error}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      ) : (
        <EmptyStateBlock title={tr('pages.models.modelRoutingTab.noRouteFlow')} description={tr('pages.models.modelRoutingTab.noRouteFlowDescription')} />
      )}
    </div>
  );
}
