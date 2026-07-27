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
  },
}));

vi.mock("../api.js", () => ({ api: apiMock }));
vi.mock("react-dom", async () => ({
  ...(await vi.importActual<typeof import("react-dom")>("react-dom")),
  createPortal: (node: unknown) => node,
}));
vi.mock("../components/useIsMobile.js", () => ({ useIsMobile: () => true }));

function collectText(node: ReactTestInstance): string {
  return (node.children || [])
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join("");
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const group = {
  id: "route-group:manual:gpt-4o-mini:8e59e1ce",
  kind: "manual" as const,
  sourceMode: "manual" as const,
  model: {
    publicName: "gpt-4o-mini",
    upstreamName: "gpt-4o-mini",
    normalizedName: "gpt-4o-mini",
  },
  presentation: { displayName: "gpt-4o-mini", displayIcon: null },
  filters: null,
  dispatcherPolicy: { kind: "builtin" as const, builtin: "weighted" as const },
  visibility: "public" as const,
  enabled: true,
  sourceSelection: {
    kind: "explicit" as const,
    sources: [
      {
        source: {
          kind: "execution_target" as const,
          sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
        },
        label: "site-a · user-a",
        modelName: "gpt-4o-mini",
        siteName: "site-a",
        enabled: true,
      },
    ],
  },
  candidateCount: 1,
  enabledCandidateCount: 1,
  siteNames: ["site-a"],
};

describe("TokenRoutes mobile layout", () => {
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
      tabs: { public: 1, internal: 0, manual: 1 },
      enabled: { enabled: 1, disabled: 0 },
    });
    apiMock.getRouteGroupSourceCatalog.mockResolvedValue([]);
    apiMock.getRuntimeSettings.mockResolvedValue({
      dispatchPolicyRegistry: {
        defaultPolicyId: "platform-default",
        policies: [],
      },
    });
    apiMock.getAccountTokens.mockResolvedValue([]);
    apiMock.getRouteGroupFallbackStages.mockResolvedValue({
      stages: [
        {
          id: "stage:primary",
          label: null,
          order: 0,
          enabled: true,
          candidates: [
            {
              kind: "execution_endpoint",
              id: "candidate:site-a:user-a",
              routeGroupId: group.id,
              routeGroupKey: group.id,
              modelName: "gpt-4o-mini",
              targetSelection: { kind: "builtin", builtin: "stable_first" },
              targets: [{
                id: 1,
                sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
                accountId: 1,
                tokenId: 1,
                sourceModel: "gpt-4o-mini",
                enabled: true,
                successCount: 0,
                failCount: 0,
                cooldownUntil: null,
                site: { id: 1, name: "site-a", platform: "openai" },
                account: { username: "user-a" },
                token: {
                  id: 1,
                  name: "token-a",
                  accountId: 1,
                  enabled: true,
                  isDefault: true,
                },
              }],
              fallbackStageId: "stage:primary",
              fallbackStageLabel: null,
              fallbackStageOrder: 0,
              sortOrder: 0,
              enabled: true,
              weight: 1,
              manualOverride: false,
              successCount: 0,
              failCount: 0,
              cooldownUntil: null,
            },
          ],
        },
      ],
    });
    apiMock.updateRouteGroup.mockResolvedValue({});
    apiMock.deleteRouteGroup.mockResolvedValue({});
  });

  afterEach(() => vi.clearAllMocks());

  it("opens the management-native fallback stage detail from the list item", async () => {
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
      });
      await flushMicrotasks();
      expect(collectText(root!.root)).toContain("gpt-4o-mini");
      const details = root!.root.find(
        (node) => node.type === "button" && collectText(node) === "详情",
      );
      await act(async () => {
        await details.props.onClick();
      });
      await flushMicrotasks();
      const text = collectText(root!.root);
      expect(text).toContain("回退阶段");
      expect(text).toContain("site-a");
      expect(text).toContain("token-a");
      expect(
        root!.root.find(
          (node) =>
            node.props["data-testid"] ===
            "route-group-candidate-drag-handle-candidate:site-a:user-a",
        ),
      ).toBeTruthy();
    } finally {
      root?.unmount();
    }
  });

  it("updates enabled state through the text route-group key", async () => {
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
      });
      await flushMicrotasks();
      const details = root!.root.find(
        (node) => node.type === "button" && collectText(node) === "详情",
      );
      await act(async () => {
        await details.props.onClick();
      });
      const toggle = root!.root.findAll(
        (node) => node.type === "button" && collectText(node) === "禁用",
      )[0]!;
      await act(async () => {
        await toggle.props.onClick();
      });
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(group.id, {
        enabled: false,
      });
    } finally {
      root?.unmount();
    }
  });

  it("keeps native source references when saving an existing manual group", async () => {
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
      });
      await flushMicrotasks();
      const details = root!.root.find(
        (node) => node.type === "button" && collectText(node) === "详情",
      );
      await act(async () => {
        await details.props.onClick();
      });
      const edit = root!.root.findAll(
        (node) => node.type === "button" && collectText(node) === "编辑",
      )[0]!;
      await act(async () => {
        await edit.props.onClick();
      });
      await flushMicrotasks();
      const save = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-form-save",
      );
      await act(async () => {
        await save.props.onClick();
      });
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(
        group.id,
        expect.objectContaining({
          sourceSelection: {
            kind: "explicit",
            sources: [{ kind: "execution_target", sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7" }],
          },
          filters: { operations: [] },
        }),
      );
    } finally {
      root?.unmount();
    }
  });

  it("keeps the restored editor step navigation while preserving native sources", async () => {
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
      });
      await flushMicrotasks();
      const details = root!.root.find(
        (node) => node.type === "button" && collectText(node) === "详情",
      );
      await act(async () => {
        await details.props.onClick();
      });
      const edit = root!.root.findAll(
        (node) => node.type === "button" && collectText(node) === "编辑",
      )[0]!;
      await act(async () => {
        await edit.props.onClick();
      });
      const next = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-form-next",
      );
      await act(async () => {
        await next.props.onClick();
      });
      expect(
        root!.root.find(
          (node) => node.props["data-testid"] === "route-group-form-previous",
        ),
      ).toBeTruthy();
      await act(async () => {
        await root!.root
          .find(
            (node) => node.props["data-testid"] === "route-group-form-previous",
          )
          .props.onClick();
      });
      await act(async () => {
        await root!.root
          .find((node) => node.props["data-testid"] === "route-group-form-save")
          .props.onClick();
      });
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(
        group.id,
        expect.objectContaining({
          sourceSelection: {
            kind: "explicit",
            sources: [{ kind: "execution_target", sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7" }],
          },
        }),
      );
    } finally {
      root?.unmount();
    }
  });

  it("does not expose or persist generated presentation fields for automatic groups", async () => {
    const automaticGroup = {
      ...group,
      id: "route-group:automatic:gpt-4o-mini",
      kind: "automatic" as const,
      presentation: { displayName: "Generated name", displayIcon: "sparkles" },
    };
    apiMock.getRouteGroupPage.mockResolvedValue({
      items: [automaticGroup],
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
      });
      await flushMicrotasks();
      const details = root!.root.find(
        (node) => node.type === "button" && collectText(node) === "详情",
      );
      await act(async () => {
        await details.props.onClick();
      });
      const edit = root!.root.findAll(
        (node) => node.type === "button" && collectText(node) === "编辑",
      )[0]!;
      await act(async () => {
        await edit.props.onClick();
      });
      await flushMicrotasks();
      expect(collectText(root!.root)).not.toContain("显示名称");
      const save = root!.root.find(
        (node) => node.props["data-testid"] === "route-group-form-save",
      );
      await act(async () => {
        await save.props.onClick();
      });
      expect(apiMock.updateRouteGroup).toHaveBeenCalledWith(
        automaticGroup.id,
        expect.not.objectContaining({
          presentation: expect.anything(),
          sources: expect.anything(),
          model: expect.anything(),
        }),
      );
    } finally {
      root?.unmount();
    }
  });
});
