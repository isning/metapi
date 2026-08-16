import type { RouteFailureBackoffOverride } from '../../../shared/routeGraph.js';
import { Input } from '../../components/ui/input/index.js';
import { tr } from '../../i18n.js';

const DEFAULT_POLICY = { failureThreshold: 3, levelsSec: [0, 600, 3600, 86400], maxSec: 86400 };

export function FailureBackoffEditor({
  value,
  onChange,
  allowInherit = true,
}: {
  value: RouteFailureBackoffOverride | null;
  onChange: (value: RouteFailureBackoffOverride | null) => void;
  allowInherit?: boolean;
}) {
  const mode = value?.mode || 'inherit';
  const policy = value?.mode === 'custom' ? value.policy : DEFAULT_POLICY;
  const updatePolicy = (patch: Partial<typeof DEFAULT_POLICY>) => onChange({
    mode: 'custom',
    policy: { ...policy, ...patch },
  });
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3" data-testid="failure-backoff-editor">
      <div className="grid gap-1.5 text-sm font-medium">
        <span>{tr('pages.tokenRoutes.failureBackoffMode')}</span>
        <select
          value={mode}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
          onChange={(event) => {
            const next = event.target.value;
          if (next === 'inherit') onChange(null);
          else if (next === 'disabled') onChange({ mode: 'disabled' });
          else onChange({ mode: 'custom', policy });
          }}
        >
          {allowInherit ? <option value="inherit">{tr('pages.tokenRoutes.failureBackoffInherit')}</option> : null}
          <option value="custom">{tr('pages.tokenRoutes.failureBackoffCustom')}</option>
          {allowInherit ? <option value="disabled">{tr('pages.tokenRoutes.failureBackoffDisabled')}</option> : null}
        </select>
      </div>
      {mode === 'custom' ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5 text-sm"><span>{tr('pages.tokenRoutes.failureBackoffThreshold')}</span><Input type="number" min={1} max={100} value={policy.failureThreshold} onChange={(event) => updatePolicy({ failureThreshold: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} /></div>
          <div className="grid gap-1.5 text-sm"><span>{tr('pages.tokenRoutes.failureBackoffLevels')}</span><Input value={policy.levelsSec.join(', ')} onChange={(event) => {
            const levelsSec = event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0).map(Math.trunc);
            if (levelsSec.length) updatePolicy({ levelsSec });
          }} /></div>
          <div className="grid gap-1.5 text-sm"><span>{tr('pages.tokenRoutes.failureBackoffMax')}</span><Input type="number" min={1} value={policy.maxSec} onChange={(event) => updatePolicy({ maxSec: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} /></div>
        </div>
      ) : null}
    </div>
  );
}
