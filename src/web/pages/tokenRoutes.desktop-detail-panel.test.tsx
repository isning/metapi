import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/Toast.js";
import TokenRoutes from "./TokenRoutes.js";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getRouteGroupPage: vi.fn(),
    getRouteGroupOverview: vi.fn(),
    getRouteGroupFallbackStages: vi.fn(),
    getRouteGroupSourceCatalog: vi.fn(),
    getRuntimeSettings: vi.fn(),
    getAccountTokens: vi.fn(),
    updateRouteGroup: vi.fn(),
    deleteRouteGroup: vi.fn(),
    restoreAutomaticRouteGroupCandidate: vi.fn(),
    restoreAutomaticRouteGroupCandidates: vi.fn(),
  },
}));

vi.mock("../api.js", () => ({ api: apiMock }));
vi.mock("react-dom", async () => ({
  ...(await vi.importActual<typeof import("react-dom")>("react-dom")),
  createPortal: (node: unknown) => node,
}));
vi.mock("../components/useIsMobile.js", () => ({ useIsMobile: () => false }));

function text(node: ReactTestInstance): string {
  return (node.children || [])
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const group = {
  id: "route-group:manual:desktop-detail",
  kind: "manual" as const,
  sourceMode: "manual" as const,
  model: {
    publicName: "desktop-detail-model",
    upstreamName: "desktop-detail-model",
    normalizedName: "desktop-detail-model",
  },
  presentation: { displayName: "Desktop detail model", displayIcon: null },
  filters: null,
  dispatcherPolicy: { kind: "builtin" as const, builtin: "weighted" as const },
  visibility: "internal" as const,
  enabled: true,
  sourceSelection: { kind: "explicit" as const, sources: [] },
  candidateCount: 1,
  enabledCandidateCount: 1,
  siteNames: ["site-a"],
};

const automaticGroup = {
  ...group,
  id: "route-group:auto:desktop-detail",
  kind: "automatic" as const,
  sourceMode: "auto" as const,
  visibility: "public" as const,
  model: {
    publicName: "automatic-detail-model",
    upstreamName: "automatic-detail-model",
    normalizedName: "automatic-detail-model",
  },
  presentation: { displayName: "Automatic detail model", displayIcon: null },
};

const automaticStages = [
  {
    id: "stage:auto:primary",
    label: "Primary",
    order: 0,
    enabled: true,
    candidateManagement: "explicit" as const,
    dispatcherPolicy: {
      kind: "builtin" as const,
      builtin: "weighted" as const,
    },
    candidates: [
      {
        id: "member:auto:primary",
        routeGroupId: automaticGroup.id,
        routeGroupKey: automaticGroup.id,
        kind: "execution_endpoint" as const,
        fallbackStageId: "stage:auto:primary",
        fallbackStageLabel: "Primary",
        fallbackStageOrder: 0,
        sortOrder: 0,
        weight: 10,
        enabled: true,
        manualOverride: true,
        successCount: 0,
        failCount: 0,
        cooldownUntil: null,
        modelName: "automatic-detail-model",
        targetSelection: { kind: "builtin" as const, builtin: "stable_first" as const },
        targets: [{
          id: 1,
          sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
          accountId: 1,
          tokenId: null,
          sourceModel: "automatic-detail-model",
          account: { username: "automatic-account" },
          site: { id: 1, name: "automatic-site", platform: "openai" },
          token: null,
          enabled: true,
          successCount: 0,
          failCount: 0,
          cooldownUntil: null,
        }],
      },
    ],
  },
];

describe("TokenRoutes desktop detail panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getRouteGroupPage.mockResolvedValue({
      items: [group],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });
    apiMock.getRouteGroupOverview.mockResolvedValue({
      brands: [],
      sites: [],
      endpointTypes: [],
      tabs: { public: 1, internal: 1, manual: 1 },
      enabled: { enabled: 1, disabled: 0 },
    });
    apiMock.getRouteGroupSourceCatalog.mockResolvedValue([]);
    apiMock.getRuntimeSettings.mockResolvedValue({
      dispatchPolicyRegistry: {
        defaultPolicyId: "platform-default",
        policies: [
          {
            id: "platform-default",
            name: "Platform default",
            kind: "cel",
            selectionMode: "weighted",
            contributionExpression: "1.0",
          },
          {
            id: "cost-first",
            name: "Cost first",
            kind: "cel",
            selectionMode: "weighted",
            contributionExpression:
              "runtime.routingSignals.normalizedCostScore",
          },
        ],
      },
    });
    apiMock.getAccountTokens.mockResolvedValue([]);
    apiMock.getRouteGroupFallbackStages.mockResolvedValue({ stages: [] });
    apiMock.updateRouteGroup.mockResolvedValue({});
    apiMock.restoreAutomaticRouteGroupCandidate.mockResolvedValue({
      success: true,
      restoredCount: 1,
      stages: automaticStages.map((stage) => ({
        ...stage,
        candidates: stage.candidates.map((candidate) => ({
          ...candidate,
          manualOverride: false,
        })),
      })),
    });
    apiMock.restoreAutomaticRouteGroupCandidates.mockResolvedValue({
      success: true,
      restoredCount: 1,
      stages: [],
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("uses one native fallback-stage detail card for the selected Route Group", async () => {
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flush();

      const summary = root!.root.find((node) =>
        String(node.props.className || "").includes("route-card-collapsed"),
      );
      expect(summary.props["aria-expanded"]).toBe(false);
      await act(async () => {
        summary.props.onClick();
      });
      await flush();

      expect(summary.props["aria-expanded"]).toBe(true);
      expect(text(root!.root)).toContain("在图中打开");
      expect(text(root!.root)).toContain("回退阶段");
      const detailCards = root!.root.findAll(
        (node) =>
          node.type === "div" &&
          String(node.props.className || "").includes(
            "route-group-detail-card",
          ),
      );
      expect(detailCards).toHaveLength(1);
      expect(String(detailCards[0]!.props.className)).toContain(
        "route--expanded",
      );
      expect(String(detailCards[0]!.props.className)).toContain(
        "route--detail-panel",
      );
      expect(
        root!.root.findAll(
          (node) =>
            String(node.props.className || "").includes("route-workbench") &&
            String(node.props.className || "").includes(
              "rounded-lg border bg-card p-3",
            ),
        ),
      ).toHaveLength(0);
      expect(apiMock.updateRouteGroup).not.toHaveBeenCalled();

      const policySelect = root!.root.find(
        (node) =>
          node.props.value === "builtin:weighted" &&
          typeof node.props.onValueChange === "function",
      );
      await act(async () => {
        await policySelect.props.onValueChange("registry:cost-first");
      });
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(group.id, {
        dispatcherPolicy: { kind: "registry", policyId: "cost-first" },
      });

      const edit = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-detail-edit",
      );
      await act(async () => {
        await edit.props.onClick();
      });
      expect(
        root!.root.find(
          (node) => node.props["data-testid"] === "route-group-form-save",
        ),
      ).toBeTruthy();
    } finally {
      root?.unmount();
    }
  });

  it("keeps candidate sources immutable while exposing dispatcher-member controls", async () => {
    apiMock.getRouteGroupPage.mockResolvedValue({
      items: [automaticGroup],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });
    apiMock.getRouteGroupFallbackStages.mockResolvedValue({
      stages: automaticStages,
    });
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flush();
      const summary = root!.root.find((node) =>
        String(node.props.className || "").includes("route-card-collapsed"),
      );
      await act(async () => {
        summary.props.onClick();
      });
      await flush();

      const edit = root!.root.find(
        (node) =>
          node.props["data-testid"] ===
          "route-group-candidate-edit-member:auto:primary",
      );
      await act(async () => {
        edit.props.onClick();
      });

      const sourceInputs = root!.root.findAll(
        (node) => node.props["aria-label"] === "上游模型",
      );
      expect(sourceInputs).toHaveLength(0);
      const weightInput = root!.root.find(
        (node) => node.props["aria-label"] === "权重",
      );
      expect(weightInput.props.disabled).toBe(false);
      const stageSelect = root!.root.find(
        (node) => node.props["aria-label"] === "回退阶段",
      );
      expect(stageSelect.props.disabled).not.toBe(true);
    } finally {
      root?.unmount();
    }
  });

  it("edits a regex source selection through the Route Group form", async () => {
    const patternGroup = {
      ...group,
      id: "route-group:manual:pattern",
      dispatcherPolicy: {
        kind: "registry" as const,
        policyId: "cost-first",
      },
      sourceSelection: {
        kind: "model_pattern" as const,
        pattern: "re:^deepseek-v4",
      },
    };
    apiMock.getRouteGroupPage.mockResolvedValue({
      items: [patternGroup],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flush();
      const summary = root!.root.find((node) =>
        String(node.props.className || "").includes("route-card-collapsed"),
      );
      await act(async () => summary.props.onClick());
      await flush();
      const edit = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-detail-edit",
      );
      await act(async () => edit.props.onClick());
      const sourceStep = root!.root.find(
        (node) =>
          node.type === "button" &&
          String(node.props.className || "").includes("min-w-36") &&
          text(node).includes("来源"),
      );
      await act(async () => sourceStep.props.onClick());
      const patternInput = root!.root.find(
        (node) =>
          node.type === "input" && node.props.value === "re:^deepseek-v4",
      );
      await act(async () =>
        patternInput.props.onChange({
          currentTarget: { value: "re:^deepseek-v[34]-flash$" },
        }),
      );
      const save = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-form-save",
      );
      await act(async () => save.props.onClick());
      await flush();
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(
        patternGroup.id,
        expect.objectContaining({
          sourceSelection: {
            kind: "model_pattern",
            pattern: "re:^deepseek-v[34]-flash$",
          },
          dispatcherPolicy: { kind: "registry", policyId: "cost-first" },
        }),
      );
    } finally {
      root?.unmount();
    }
  });

  it("restores one adjusted automatic candidate through the native command", async () => {
    apiMock.getRouteGroupPage.mockResolvedValue({
      items: [automaticGroup],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });
    apiMock.getRouteGroupFallbackStages.mockResolvedValue({
      stages: automaticStages,
    });
    let root: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flush();
      const summary = root!.root.find((node) =>
        String(node.props.className || "").includes("route-card-collapsed"),
      );
      await act(async () => summary.props.onClick());
      await flush();

      expect(
        root!.root.find(
          (node) =>
            node.props["data-testid"] === "route-group-restore-all-automatic",
        ),
      ).toBeTruthy();
      const restore = root!.root.find(
        (node) =>
          node.props["data-testid"] ===
          "route-group-candidate-restore-member:auto:primary",
      );
      await act(async () => restore.props.onClick());
      await flush();

      expect(apiMock.restoreAutomaticRouteGroupCandidate).toHaveBeenCalledWith(
        automaticGroup.id,
        "member:auto:primary",
      );
      expect(
        root!.root.findAll(
          (node) =>
            node.props["data-testid"] ===
            "route-group-candidate-restore-member:auto:primary",
        ),
      ).toHaveLength(0);
    } finally {
      root?.unmount();
    }
  });
});
