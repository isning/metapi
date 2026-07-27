import type {
  CompiledExecutionAlternative,
  CompiledExecutionSelectionTerm,
  CompiledFallbackStage,
} from '../../shared/compiledRuntime.js';

export type CompiledRuntimeControl =
  | {
      kind: 'selection';
      key: string;
      controlOrder: number;
      termId: string;
    }
  | {
      kind: 'fallback';
      key: string;
      controlOrder: number;
      fallbackId: string;
    };

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function selectionControl(term: CompiledExecutionSelectionTerm, index: number): CompiledRuntimeControl | null {
  const termId = asTrimmedString(term.termId);
  if (!termId) return null;
  return {
    kind: 'selection',
    key: `selection:${termId}`,
    controlOrder: numberOrFallback(term.controlOrder, index),
    termId,
  };
}

function fallbackControl(stage: CompiledFallbackStage, index: number): CompiledRuntimeControl | null {
  const fallbackId = asTrimmedString(stage.fallbackId);
  if (!fallbackId) return null;
  return {
    kind: 'fallback',
    key: `fallback:${fallbackId}`,
    controlOrder: numberOrFallback(stage.controlOrder, index),
    fallbackId,
  };
}

export function compiledRuntimeControlsForAlternative(
  alternative: CompiledExecutionAlternative,
): CompiledRuntimeControl[] {
  const controls = [
    ...(alternative.selectionTerms || [])
      .map((term, index) => selectionControl(term, index))
      .filter((control): control is CompiledRuntimeControl => !!control),
    ...(alternative.fallbackStages || [])
      .map((stage, index) => fallbackControl(stage, index))
      .filter((control): control is CompiledRuntimeControl => !!control),
  ];
  return Array.from(new Map(controls.map((control) => [control.key, control])).values())
    .sort((left, right) => {
      const orderDiff = left.controlOrder - right.controlOrder;
      if (orderDiff !== 0) return orderDiff;
      if (left.kind !== right.kind) return left.kind === 'fallback' ? -1 : 1;
      return left.key.localeCompare(right.key);
    });
}

export function nextCommonCompiledRuntimeControl(input: {
  alternatives: CompiledExecutionAlternative[];
  processedControlKeys?: ReadonlySet<string>;
}): CompiledRuntimeControl | null {
  const [first] = input.alternatives;
  if (!first) return null;
  const processed = input.processedControlKeys || new Set<string>();
  const controlsByAlternative = input.alternatives.map((alternative) => new Map(
    compiledRuntimeControlsForAlternative(alternative).map((control) => [control.key, control]),
  ));
  for (const control of compiledRuntimeControlsForAlternative(first)) {
    if (processed.has(control.key)) continue;
    if (!controlsByAlternative.every((controls) => controls.has(control.key))) continue;
    return control;
  }
  return null;
}

export function fallbackStageForCompiledAlternative(input: {
  alternative: CompiledExecutionAlternative;
  fallbackId: string;
}): CompiledFallbackStage | null {
  const fallbackId = asTrimmedString(input.fallbackId);
  if (!fallbackId) return null;
  return (input.alternative.fallbackStages || []).find((stage) => stage.fallbackId === fallbackId) || null;
}

export function selectLowestAvailableCompiledFallbackStage(input: {
  alternatives: CompiledExecutionAlternative[];
  fallbackId: string;
}): {
  stage: CompiledFallbackStage;
  alternatives: CompiledExecutionAlternative[];
} | null {
  const alternativesByStageId = new Map<string, {
    stage: CompiledFallbackStage;
    alternatives: CompiledExecutionAlternative[];
  }>();
  for (const alternative of input.alternatives) {
    const stage = fallbackStageForCompiledAlternative({ alternative, fallbackId: input.fallbackId });
    if (!stage) continue;
    const existing = alternativesByStageId.get(stage.stageId);
    if (existing) {
      existing.alternatives.push(alternative);
      continue;
    }
    alternativesByStageId.set(stage.stageId, { stage, alternatives: [alternative] });
  }
  return Array.from(alternativesByStageId.values())
    .sort((left, right) => {
      const orderDiff = left.stage.stageIndex - right.stage.stageIndex;
      if (orderDiff !== 0) return orderDiff;
      return left.stage.stageId.localeCompare(right.stage.stageId);
    })[0] || null;
}
