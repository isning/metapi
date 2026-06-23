import type { ReactNode } from 'react';
import { tr } from '../../i18n.js';
import ToneBadge from '../ToneBadge.js';
import * as HoverCard from '../ui/hover-card/index.js';

type EstimateLevel = 'exact' | 'static_estimate' | 'incomplete' | (string & {});

type PricingDiagnostic = {
  level?: string;
  message: string;
};

type PricingCandidate = {
  probability?: number | null;
  weight?: number | null;
  inputPerMillion?: number | null;
  outputPerMillion?: number | null;
  totalCostUsd?: number | null;
};

type EstimateLevelBadgeProps = {
  level: EstimateLevel;
  compact?: boolean;
  className?: string;
  diagnostics?: PricingDiagnostic[];
  candidates?: PricingCandidate[];
  sourceCount?: number;
  strategy?: string | null;
};

export default function EstimateLevelBadge({
  level,
  compact = false,
  className,
  diagnostics = [],
  candidates = [],
  sourceCount,
  strategy,
}: EstimateLevelBadgeProps) {
  const badge = (
    <ToneBadge
      tone={level === 'exact' ? '-success' : '-warning'}
      title={level}
      className={className}
    >
      {level}
    </ToneBadge>
  );

  if (level !== 'incomplete') {
    return badge;
  }

  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <span className="inline-flex min-w-0 cursor-help">{badge}</span>
      </HoverCard.Trigger>
      <HoverCard.Content className={compact ? 'w-72 p-3' : 'w-80 p-3'}>
        <HoverCardCopy
          candidates={candidates}
          diagnostics={diagnostics}
          sourceCount={sourceCount}
          strategy={strategy}
        />
      </HoverCard.Content>
    </HoverCard.Root>
  );
}

function HoverCardCopy({
  candidates,
  diagnostics,
  sourceCount,
  strategy,
}: {
  candidates: PricingCandidate[];
  diagnostics: PricingDiagnostic[];
  sourceCount?: number;
  strategy?: string | null;
}): ReactNode {
  const totalCandidates = candidates.length;
  const unknownProbability = candidates.filter((candidate) => candidate.probability == null).length;
  const missingInput = candidates.filter((candidate) => candidate.inputPerMillion == null).length;
  const missingOutput = candidates.filter((candidate) => candidate.outputPerMillion == null).length;
  const missingTotal = candidates.filter((candidate) => candidate.totalCostUsd == null).length;
  const hasWeights = candidates.some((candidate) => candidate.weight != null);
  const visibleDiagnostics = diagnostics.slice(0, 3);

  return (
    <div className="grid gap-2 text-xs leading-relaxed">
      <div className="font-medium text-foreground">
        {tr('components.pricing.estimateLevelIncompleteTitle')}
      </div>
      <div className="text-muted-foreground">
        {tr('components.pricing.estimateLevelIncompleteDescription')}
      </div>
      <div className="grid gap-1">
        <div className="font-medium text-foreground">{tr('components.pricing.estimateLevelIncompleteMissingData')}</div>
        {totalCandidates > 0 ? (
          <ul className="grid gap-0.5 text-muted-foreground">
            {unknownProbability > 0 ? <li>{tr('components.pricing.estimateLevelIncompleteMissingProbability').replace('{count}', String(unknownProbability)).replace('{total}', String(totalCandidates))}</li> : null}
            {missingInput > 0 ? <li>{tr('components.pricing.estimateLevelIncompleteMissingInput').replace('{count}', String(missingInput)).replace('{total}', String(totalCandidates))}</li> : null}
            {missingOutput > 0 ? <li>{tr('components.pricing.estimateLevelIncompleteMissingOutput').replace('{count}', String(missingOutput)).replace('{total}', String(totalCandidates))}</li> : null}
            {missingTotal > 0 ? <li>{tr('components.pricing.estimateLevelIncompleteMissingTotal').replace('{count}', String(missingTotal)).replace('{total}', String(totalCandidates))}</li> : null}
          </ul>
        ) : (
          <div className="text-muted-foreground">{tr('components.pricing.estimateLevelIncompleteMissingGeneric')}</div>
        )}
      </div>
      <div className="grid gap-1">
        <div className="font-medium text-foreground">{tr('components.pricing.estimateLevelIncompleteFormula')}</div>
        <div className="text-muted-foreground">
          {tr('components.pricing.estimateLevelIncompleteFormulaDescription')
            .replace('{sources}', String(sourceCount ?? 0))
            .replace('{strategy}', strategy || tr('components.modelRouteFlow.none'))}
        </div>
        {hasWeights ? (
          <div className="text-muted-foreground">
            {tr('components.pricing.estimateLevelIncompleteFallbackWeight')}
          </div>
        ) : null}
      </div>
      {visibleDiagnostics.length > 0 ? (
        <div className="grid gap-1">
          <div className="font-medium text-foreground">{tr('components.modelRouteFlow.diagnostics')}</div>
          <ul className="grid gap-0.5 text-muted-foreground">
            {visibleDiagnostics.map((item, index) => (
              <li key={`${item.message}-${index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
