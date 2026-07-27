type RoutingSignalSelectionTerm = {
  termId?: string | null;
  mode?: string | null;
};

type RoutingSignalSelectionAlternative = {
  selectionTerms?: readonly RoutingSignalSelectionTerm[] | null;
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function selectionTermsFor(
  alternative: RoutingSignalSelectionAlternative | null | undefined,
): readonly RoutingSignalSelectionTerm[] {
  return alternative?.selectionTerms || [];
}

export function collectCompiledRuntimeRoutingSignalSharedTermIds(
  alternatives: readonly RoutingSignalSelectionAlternative[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const alternative of alternatives) {
    const seenInAlternative = new Set<string>();
    for (const term of selectionTermsFor(alternative)) {
      const termId = asTrimmedString(term.termId);
      if (!termId || seenInAlternative.has(termId)) continue;
      seenInAlternative.add(termId);
      counts.set(termId, (counts.get(termId) || 0) + 1);
    }
  }
  return new Set(Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([termId]) => termId));
}

function routingSignalSelectionTerm(input: {
  selectionTerms?: readonly RoutingSignalSelectionTerm[] | null;
  sharedTermIds?: ReadonlySet<string> | null;
}): RoutingSignalSelectionTerm | null {
  const terms = input.selectionTerms || [];
  if (input.sharedTermIds && input.sharedTermIds.size > 0) {
    const shared = [...terms].reverse()
      .find((term) => input.sharedTermIds?.has(asTrimmedString(term.termId)));
    if (shared) return shared;
  }
  return [...terms].reverse().find((term) => term.mode === 'execution_attempt')
    || terms.at(-1)
    || null;
}

export function compiledRuntimeRoutingSignalScopeId(input: {
  planId: unknown;
  selectionTerms?: readonly RoutingSignalSelectionTerm[] | null;
  sharedTermIds?: ReadonlySet<string> | null;
}): string | null {
  const planId = asTrimmedString(input.planId);
  if (!planId) return null;
  const term = routingSignalSelectionTerm(input);
  return `${planId}:${asTrimmedString(term?.termId) || 'execution_attempt'}`;
}
