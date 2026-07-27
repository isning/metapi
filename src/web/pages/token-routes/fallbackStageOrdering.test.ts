import { describe, expect, it } from "vitest";
import {
  fallbackStageIdFromDropTarget,
  moveFallbackStageCandidate,
  moveFallbackStageCandidateToNewStage,
} from "./fallbackStageOrdering.js";
import { fallbackStageCollisionDetection } from "./RouteGroupWorkspace.js";

type Candidate = {
  id: string;
  fallbackStageId: string;
  fallbackStageLabel: string | null;
  fallbackStageOrder: number;
  sortOrder: number;
};

type Stage = {
  id: string;
  label: string | null;
  order: number;
  enabled: boolean;
  dispatcherPolicy: {
    kind: "builtin";
    builtin: "weighted" | "round_robin";
  } | null;
  candidates: Candidate[];
};

function stage(
  id: string,
  label: string | null,
  order: number,
  candidateIds: string[],
): Stage {
  return {
    id,
    label,
    order,
    enabled: id !== "stage:2",
    dispatcherPolicy:
      id === "stage:1" ? { kind: "builtin", builtin: "weighted" } : null,
    candidates: candidateIds.map((candidateId, sortOrder) => ({
      id: candidateId,
      fallbackStageId: id,
      fallbackStageLabel: label,
      fallbackStageOrder: order,
      sortOrder,
    })),
  };
}

describe("fallback stage ordering", () => {
  it("does not let the active member mask the member under the pointer", () => {
    const rect = (
      left: number,
      top: number,
      width: number,
      height: number,
    ) => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    });
    const active = { id: "member:11" };
    const collisions = fallbackStageCollisionDetection({
      active,
      collisionRect: rect(0, 0, 40, 40),
      droppableContainers: [
        { id: "member:11" },
        { id: "member:12" },
        { id: "fallback-stage:stage:1" },
      ],
      droppableRects: new Map([
        ["member:11", rect(0, 0, 120, 40)],
        ["member:12", rect(0, 40, 120, 40)],
        ["fallback-stage:stage:1", rect(0, 0, 120, 120)],
      ]),
      pointerCoordinates: { x: 40, y: 60 },
    } as never);

    expect(collisions[0]?.id).toBe("member:12");
  });

  it("identifies only fallback-stage drop targets", () => {
    expect(fallbackStageIdFromDropTarget("fallback-stage:12")).toBe("12");
    expect(fallbackStageIdFromDropTarget("candidate:12")).toBeNull();
    expect(fallbackStageIdFromDropTarget("fallback-stage:0")).toBe("0");
    expect(fallbackStageIdFromDropTarget(12)).toBeNull();
  });

  it("moves a candidate into another ordered fallback stage while preserving stage policy metadata", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12"]),
      stage("stage:2", "Fallback", 1, ["member:21"]),
    ];

    const next = moveFallbackStageCandidate({
      stages,
      activeCandidateId: "member:12",
      overId: "fallback-stage:stage:2",
    });

    expect(next).not.toBeNull();
    expect(
      next?.map((item) => ({
        id: item.id,
        enabled: item.enabled,
        dispatcherPolicy: item.dispatcherPolicy,
        candidates: item.candidates.map((candidate) => ({
          id: candidate.id,
          fallbackStageId: candidate.fallbackStageId,
          fallbackStageOrder: candidate.fallbackStageOrder,
          sortOrder: candidate.sortOrder,
        })),
      })),
    ).toEqual([
      {
        id: "stage:1",
        enabled: true,
        dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
        candidates: [
          {
            id: "member:11",
            fallbackStageId: "stage:1",
            fallbackStageOrder: 0,
            sortOrder: 0,
          },
        ],
      },
      {
        id: "stage:2",
        enabled: false,
        dispatcherPolicy: null,
        candidates: [
          {
            id: "member:21",
            fallbackStageId: "stage:2",
            fallbackStageOrder: 1,
            sortOrder: 0,
          },
          {
            id: "member:12",
            fallbackStageId: "stage:2",
            fallbackStageOrder: 1,
            sortOrder: 1,
          },
        ],
      },
    ]);
  });

  it("inserts an optimistic stage and moves its candidate in one local transaction", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12"]),
      stage("stage:2", "Fallback", 1, ["member:21"]),
    ];
    const optimistic = stage("stage:optimistic", null, 0, []);

    const next = moveFallbackStageCandidateToNewStage({
      stages,
      activeCandidateId: "member:11",
      afterStageId: "stage:1",
      newStage: optimistic,
    });

    expect(
      next?.map((item) => ({
        id: item.id,
        order: item.order,
        candidates: item.candidates.map((candidate) => ({
          id: candidate.id,
          stageId: candidate.fallbackStageId,
          stageOrder: candidate.fallbackStageOrder,
          sortOrder: candidate.sortOrder,
        })),
      })),
    ).toEqual([
      {
        id: "stage:1",
        order: 0,
        candidates: [
          { id: "member:12", stageId: "stage:1", stageOrder: 0, sortOrder: 0 },
        ],
      },
      {
        id: "stage:optimistic",
        order: 1,
        candidates: [
          {
            id: "member:11",
            stageId: "stage:optimistic",
            stageOrder: 1,
            sortOrder: 0,
          },
        ],
      },
      {
        id: "stage:2",
        order: 2,
        candidates: [
          { id: "member:21", stageId: "stage:2", stageOrder: 2, sortOrder: 0 },
        ],
      },
    ]);
  });

  it("inserts before a candidate in the same stage and renumbers only that stage", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12", "member:13"]),
      stage("stage:2", "Fallback", 1, ["member:21"]),
    ];

    const next = moveFallbackStageCandidate({
      stages,
      activeCandidateId: "member:13",
      overId: "member:11",
    });

    expect(
      next?.[0]?.candidates.map((candidate) => [
        candidate.id,
        candidate.sortOrder,
      ]),
    ).toEqual([
      ["member:13", 0],
      ["member:11", 1],
      ["member:12", 2],
    ]);
    expect(next?.[1]).toEqual(stages[1]);
  });

  it("leaves the order untouched when the member is dropped onto itself", () => {
    const stages = [stage("stage:1", "Primary", 0, ["member:11", "member:12"])];

    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:11",
        overId: "member:11",
      }),
    ).toBeNull();
  });

  it("moves a member after the row it is dragged downward onto", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12", "member:13"]),
    ];

    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:12",
        overId: "member:13",
      })?.[0]?.candidates.map((candidate) => candidate.id),
    ).toEqual(["member:11", "member:13", "member:12"]);
  });

  it("moves the first member to the actual end when dropped on the last row", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12", "member:13"]),
    ];

    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:11",
        overId: "member:13",
      })?.[0]?.candidates.map((candidate) => candidate.id),
    ).toEqual(["member:12", "member:13", "member:11"]);
  });

  it("treats dropping the last member on its current stage as a no-op", () => {
    const stages = [
      stage("stage:1", "Primary", 0, ["member:11", "member:12", "member:13"]),
    ];

    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:13",
        overId: "fallback-stage:stage:1",
      }),
    ).toBeNull();
  });

  it("does not derive a stage when the candidate or drop target is unknown", () => {
    const stages = [stage("stage:1", "Primary", 0, ["member:11"])];

    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:99",
        overId: "member:11",
      }),
    ).toBeNull();
    expect(
      moveFallbackStageCandidate({
        stages,
        activeCandidateId: "member:11",
        overId: "unknown",
      }),
    ).toBeNull();
  });
});
