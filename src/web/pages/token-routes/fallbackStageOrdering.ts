export type FallbackStageCandidate = {
  id: string;
  fallbackStageId: string;
  fallbackStageLabel?: string | null;
  fallbackStageOrder?: number;
  sortOrder: number;
};

export type FallbackStage<
  TCandidate extends FallbackStageCandidate = FallbackStageCandidate,
> = {
  id: string;
  label: string | null;
  order: number;
  candidates: TCandidate[];
};

export type FallbackStageCandidatePlacementUpdate = {
  id: string;
  stageId: string;
  sortOrder: number;
};

export function changedFallbackStageCandidatePlacements<
  TCandidate extends FallbackStageCandidate,
  TStage extends FallbackStage<TCandidate>,
>(before: TStage[], after: TStage[]): FallbackStageCandidatePlacementUpdate[] {
  const previous = new Map(
    before.flatMap((stage) =>
      stage.candidates.map(
        (candidate, sortOrder) =>
          [candidate.id, { stageId: stage.id, sortOrder }] as const,
      ),
    ),
  );
  return after.flatMap((stage) =>
    stage.candidates.flatMap((candidate, sortOrder) => {
      const current = previous.get(candidate.id);
      return current?.stageId === stage.id && current.sortOrder === sortOrder
        ? []
        : [{ id: candidate.id, stageId: stage.id, sortOrder }];
    }),
  );
}

export function fallbackStageIdFromDropTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("fallback-stage:"))
    return null;
  const id = value.slice("fallback-stage:".length).trim();
  return id || null;
}

export function moveFallbackStageCandidateToNewStage<
  TCandidate extends FallbackStageCandidate,
  TStage extends FallbackStage<TCandidate>,
>(input: {
  stages: TStage[];
  activeCandidateId: string;
  afterStageId: string;
  newStage: TStage;
}): TStage[] | null {
  const afterIndex = input.stages.findIndex(
    (stage) => stage.id === input.afterStageId,
  );
  const activeCandidate = input.stages
    .flatMap((stage) => stage.candidates)
    .find((candidate) => candidate.id === input.activeCandidateId);
  if (afterIndex < 0 || !activeCandidate) return null;

  const stages = input.stages.map((stage) => ({
    ...stage,
    candidates: stage.candidates.filter(
      (candidate) => candidate.id !== activeCandidate.id,
    ),
  })) as TStage[];
  stages.splice(afterIndex + 1, 0, {
    ...input.newStage,
    candidates: [activeCandidate],
  });
  return stages.map((stage, order) => ({
    ...stage,
    order,
    candidates: stage.candidates.map((candidate, sortOrder) => ({
      ...candidate,
      fallbackStageId: stage.id,
      fallbackStageLabel: stage.label,
      fallbackStageOrder: order,
      sortOrder,
    })),
  })) as TStage[];
}

export function moveFallbackStageCandidate<
  TCandidate extends FallbackStageCandidate,
  TStage extends FallbackStage<TCandidate>,
>(input: {
  stages: TStage[];
  activeCandidateId: string;
  overId: unknown;
}): TStage[] | null {
  if (input.activeCandidateId === String(input.overId || "")) return null;

  const activeCandidate = input.stages
    .flatMap((stage) => stage.candidates)
    .find((candidate) => candidate.id === input.activeCandidateId);
  if (!activeCandidate) return null;
  const activeStage = input.stages.find((stage) =>
    stage.candidates.some(
      (candidate) => candidate.id === input.activeCandidateId,
    ),
  );
  if (!activeStage) return null;

  const overCandidateId = typeof input.overId === "string" ? input.overId : "";
  const overCandidateStage = input.stages.find((stage) =>
    stage.candidates.some((candidate) => candidate.id === overCandidateId),
  );
  const overCandidateIndex = overCandidateStage?.candidates.findIndex(
    (candidate) => candidate.id === overCandidateId,
  );

  const targetStageId =
    fallbackStageIdFromDropTarget(input.overId) ?? overCandidateStage?.id;
  if (!targetStageId) return null;

  const nextStages = input.stages.map((stage) => ({
    ...stage,
    candidates: stage.candidates.filter(
      (candidate) => candidate.id !== activeCandidate.id,
    ),
  })) as TStage[];
  const targetStage = nextStages.find((stage) => stage.id === targetStageId);
  if (!targetStage) return null;

  const targetIndex = overCandidateStage
    ? activeStage.id === overCandidateStage.id
      ? Math.min(overCandidateIndex ?? 0, targetStage.candidates.length)
      : targetStage.candidates.findIndex(
          (candidate) => candidate.id === overCandidateId,
        )
    : -1;
  targetStage.candidates.splice(
    targetIndex < 0 ? targetStage.candidates.length : targetIndex,
    0,
    {
      ...activeCandidate,
      fallbackStageId: targetStage.id,
      fallbackStageLabel: targetStage.label,
      fallbackStageOrder: targetStage.order,
    },
  );

  const normalizedStages = nextStages.map((stage) => ({
    ...stage,
    candidates: stage.candidates.map((candidate, sortOrder) => ({
      ...candidate,
      fallbackStageId: stage.id,
      fallbackStageLabel: stage.label,
      fallbackStageOrder: stage.order,
      sortOrder,
    })),
  })) as TStage[];
  return changedFallbackStageCandidatePlacements(input.stages, normalizedStages)
    .length
    ? normalizedStages
    : null;
}
