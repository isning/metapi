import type { RouteFailureBackoffOverride } from '../../../shared/routeGraph.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { tr } from '../../i18n.js';

const DEFAULT_POLICY = { failureThreshold: 3, levelsSec: [0, 600, 3600, 86400], maxSec: 86400 };

export function FailureBackoffEditor({
  value,
  onChange,
  allowInherit = true,
  allowDisabled = true,
  disabled = false,
}: {
  value: RouteFailureBackoffOverride | null;
  onChange: (value: RouteFailureBackoffOverride | null) => void;
  allowInherit?: boolean;
  allowDisabled?: boolean;
  disabled?: boolean;
}) {
  const mode = value?.mode || 'inherit';
  const policy = value?.mode === 'custom' ? value.policy : DEFAULT_POLICY;
  const updatePolicy = (patch: Partial<typeof DEFAULT_POLICY>) => onChange({
    mode: 'custom',
    policy: { ...policy, ...patch },
  });
  return (
    <div className={`grid gap-3 rounded-md border bg-muted/20 p-3 ${disabled ? 'pointer-events-none opacity-60' : ''}`} data-testid="failure-backoff-editor">
      <div className="grid gap-1.5 text-sm font-medium">
        <span>{tr('pages.tokenRoutes.failureBackoffMode')}</span>
        <Select value={mode} disabled={disabled} onValueChange={(next) => {
          if (next === 'inherit') onChange(null);
          else if (next === 'disabled') onChange({ mode: 'disabled' });
          else onChange({ mode: 'custom', policy });
        }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {allowInherit ? <SelectItem value="inherit">{tr('pages.tokenRoutes.failureBackoffInherit')}</SelectItem> : null}
            <SelectItem value="custom">{tr('pages.tokenRoutes.failureBackoffCustom')}</SelectItem>
            {allowDisabled ? <SelectItem value="disabled">{tr('pages.tokenRoutes.failureBackoffDisabled')}</SelectItem> : null}
          </SelectContent>
        </Select>
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
