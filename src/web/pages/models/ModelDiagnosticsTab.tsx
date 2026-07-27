import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import DiagnosticItem from '../../components/details/DiagnosticItem.js';
import JsonBlock from '../../components/details/JsonBlock.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import type { ModelDetailsView } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

type ModelDiagnosticsTabProps = {
  diagnostics: ModelDetailsView['diagnosticsView'];
  onCopyJson?: (text: string) => void;
};

function DiagnosticsListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label={tr('pages.models.modelOverviewTab.loadingRouteFlow')} className="grid gap-2">
      {[0, 1].map((item) => (
        <div key={item} className="rounded-md border p-3">
          <div className="flex items-start gap-2">
            <Skeleton className="mt-0.5 size-4 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className={item === 0 ? 'h-4 w-56 max-w-full' : 'h-4 w-40 max-w-full'} />
              </div>
              <Skeleton className={item === 0 ? 'mt-2 h-3 w-4/5' : 'mt-2 h-3 w-2/3'} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiagnosticsJsonSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label={tr('pages.models.modelOverviewTab.loadingRouteFlow')} className="grid gap-2">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="rounded-md border bg-muted p-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-3 w-5/6" />
        <Skeleton className="mt-2 h-3 w-3/4" />
        <Skeleton className="mt-2 h-3 w-4/5" />
        <Skeleton className="mt-2 h-3 w-2/3" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
    </div>
  );
}

export default function ModelDiagnosticsTab({
  diagnostics,
  onCopyJson,
}: ModelDiagnosticsTabProps) {
  const items = diagnostics.items;
  const payload = diagnostics.payload;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-2 p-3">
          {items.length > 0 ? items.map((diagnostic, index) => (
            <DiagnosticItem
              key={`${diagnostic.level}-${diagnostic.message}-${index}`}
              level={diagnostic.level === 'warn' ? 'warn' : diagnostic.level}
              message={diagnostic.message}
            />
          )) : diagnostics.error ? (
            <DiagnosticItem level="error" message={diagnostics.error} />
          ) : diagnostics.itemsLoading ? (
            <DiagnosticsListSkeleton />
          ) : (
            <EmptyStateBlock title={tr('pages.models.modelDiagnosticsTab.noDiagnostics')} description={tr('pages.models.modelDiagnosticsTab.noDiagnosticsDescription')} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          {payload ? (
            <JsonBlock value={payload} onCopy={onCopyJson} />
          ) : diagnostics.payloadError ? (
            <DiagnosticItem level="error" message={diagnostics.payloadError} />
          ) : diagnostics.payloadLoading ? (
            <DiagnosticsJsonSkeleton />
          ) : (
            <EmptyStateBlock title={tr('pages.models.modelRoutingTab.noRouteFlow')} description={tr('pages.models.modelRoutingTab.noRouteFlowDescription')} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
