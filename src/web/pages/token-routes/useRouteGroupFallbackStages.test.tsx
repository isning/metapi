import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteGroupManagementFallbackStage } from "../../../shared/routeGroupManagement.js";
import { api } from "../../api.js";
import { useRouteGroupFallbackStages } from "./useRouteGroupFallbackStages.js";

vi.mock("../../api.js", () => ({
  api: {
    getRouteGroupFallbackStages: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function stage(id: string): RouteGroupManagementFallbackStage {
  return {
    id,
    label: id,
    order: 0,
    enabled: true,
    dispatcherPolicy: null,
    candidateManagement: "explicit",
    candidates: [],
  };
}

type HookApi = ReturnType<typeof useRouteGroupFallbackStages>;

function Harness({ onRender }: { onRender: (value: HookApi) => void }) {
  const value = useRouteGroupFallbackStages();
  onRender(value);
  return null;
}

describe("useRouteGroupFallbackStages", () => {
  beforeEach(() => {
    vi.mocked(api.getRouteGroupFallbackStages).mockReset();
  });

  it("lets only the latest request own stage data and loading state", async () => {
    const older = deferred<{ stages: RouteGroupManagementFallbackStage[] }>();
    const newer = deferred<{ stages: RouteGroupManagementFallbackStage[] }>();
    vi.mocked(api.getRouteGroupFallbackStages)
      .mockReturnValueOnce(
        older.promise as ReturnType<typeof api.getRouteGroupFallbackStages>,
      )
      .mockReturnValueOnce(
        newer.promise as ReturnType<typeof api.getRouteGroupFallbackStages>,
      );
    let hook!: HookApi;
    const root = create(<Harness onRender={(value) => (hook = value)} />);
    let olderLoad!: Promise<RouteGroupManagementFallbackStage[]>;
    let newerLoad!: Promise<RouteGroupManagementFallbackStage[]>;

    act(() => {
      olderLoad = hook.loadStages("group-a", true);
      newerLoad = hook.loadStages("group-a", true);
    });
    expect(hook.loadingStagesByRouteGroupId["group-a"]).toBe(true);

    await act(async () => {
      newer.resolve({ stages: [stage("newer")] });
      await newerLoad;
    });
    expect(hook.stagesByRouteGroupId["group-a"]?.[0]?.id).toBe("newer");
    expect(hook.loadingStagesByRouteGroupId["group-a"]).toBe(false);

    await act(async () => {
      older.resolve({ stages: [stage("older")] });
      await olderLoad;
    });
    expect(hook.stagesByRouteGroupId["group-a"]?.[0]?.id).toBe("newer");
    expect(hook.loadingStagesByRouteGroupId["group-a"]).toBe(false);
    root.unmount();
  });

  it("prevents an obsolete request from replacing an optimistic stage update", async () => {
    const pending = deferred<{
      stages: RouteGroupManagementFallbackStage[];
    }>();
    vi.mocked(api.getRouteGroupFallbackStages).mockReturnValue(
      pending.promise as ReturnType<typeof api.getRouteGroupFallbackStages>,
    );
    let hook!: HookApi;
    const root = create(<Harness onRender={(value) => (hook = value)} />);
    let load!: Promise<RouteGroupManagementFallbackStage[]>;

    act(() => {
      load = hook.loadStages("group-a", true);
    });
    act(() => {
      hook.setStages("group-a", [stage("optimistic")]);
    });
    expect(hook.loadingStagesByRouteGroupId["group-a"]).toBe(false);

    await act(async () => {
      pending.resolve({ stages: [stage("obsolete")] });
      await load;
    });
    expect(hook.stagesByRouteGroupId["group-a"]?.[0]?.id).toBe("optimistic");
    root.unmount();
  });
});
