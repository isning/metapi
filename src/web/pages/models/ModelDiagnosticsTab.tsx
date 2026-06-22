import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import DiagnosticItem from '../../components/details/DiagnosticItem.js';
import JsonBlock from '../../components/details/JsonBlock.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import type { ModelDetailsView } from './modelDetailsView.js';

type ModelDiagnosticsTabProps = {
  details: ModelDetailsView;
  onCopyJson?: (text: string) => void;
};

export default function ModelDiagnosticsTab({
  details,
  onCopyJson,
}: ModelDiagnosticsTabProps) {
  const diagnostics = details.diagnostics;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-2 p-3">
          {diagnostics.length > 0 ? diagnostics.map((diagnostic, index) => (
            <DiagnosticItem
              key={`${diagnostic.level}-${diagnostic.message}-${index}`}
              level={diagnostic.level === 'warn' ? 'warn' : diagnostic.level}
              message={diagnostic.message}
            />
          )) : (
            <EmptyStateBlock title="No diagnostics" description="No diagnostics for this model route." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <JsonBlock value={details.routeFlow ?? { diagnostics }} onCopy={onCopyJson} />
        </CardContent>
      </Card>
    </div>
  );
}
