import { expect, test, type Page } from "../e2eHarness.js";

type AdminApi = {
  getJson: <T = unknown>(url: string) => Promise<T>;
  postJson: <T = unknown>(
    url: string,
    options?: { data?: unknown },
  ) => Promise<T>;
  deleteJson: <T = unknown>(url: string) => Promise<T>;
};

type FallbackStage = {
  id: string;
  candidates: Array<{
    id: string;
    accountId: number;
    fallbackStageId: string;
    weight: number;
    enabled: boolean;
  }>;
};

type RouteGroupPageItem = {
  id: string;
  candidateCount: number;
  enabledCandidateCount: number;
};

type CandidateCatalogItem = {
  sourceRef: string;
  accountId: number;
  sourceModel: string;
};

async function seedManualRouteGroup(adminApi: AdminApi) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const modelName = `e2e-route-group-${suffix}`;
  const sourceModel = `${modelName}-source`;
  const site = await adminApi.postJson<{ id: number }>("/api/sites", {
    data: {
      name: `E2E Route Group ${suffix}`,
      url: `https://route-group-${suffix}.example.com`,
      platform: "openai",
      status: "active",
    },
  });
  const accounts = await Promise.all(
    ["alpha", "beta", "gamma", "delta"].map(async (name) => {
      return await adminApi.postJson<{ id: number }>("/api/accounts", {
        data: {
          siteId: site.id,
          username: `route-group-${name}-${suffix}`,
          apiKey: `sk-route-group-${name}-${suffix}`,
          skipModelFetch: true,
        },
      });
    }),
  );
  const group = await adminApi.postJson<{ id: string }>("/api/route-groups", {
    data: {
      model: { publicName: modelName, upstreamName: modelName },
      presentation: { displayName: modelName, displayIcon: null },
      dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
      visibility: "internal",
      enabled: true,
    },
  });
  for (const account of accounts) {
    await adminApi.postJson(`/api/accounts/${account.id}/models/manual`, {
      data: { models: [sourceModel] },
    });
  }
  let sourceRefByAccountId = new Map<number, string>();
  await expect.poll(async () => {
    const catalog = await adminApi.getJson<{ items: CandidateCatalogItem[] }>(
      `/api/route-groups/${encodeURIComponent(group.id)}/candidate-catalog?page=1&pageSize=50&q=${encodeURIComponent(sourceModel)}`,
    );
    sourceRefByAccountId = new Map(
      catalog.items
        .filter((item) => item.sourceModel === sourceModel)
        .map((item) => [item.accountId, item.sourceRef]),
    );
    return accounts.filter((account) => sourceRefByAccountId.has(account.id)).length;
  }).toBe(accounts.length);
  const initial = await adminApi.getJson<{ stages: FallbackStage[] }>(
    `/api/route-groups/${encodeURIComponent(group.id)}/stages`,
  );
  const primaryStage = initial.stages[0];
  expect(primaryStage).toBeDefined();
  const secondary = await adminApi.postJson<{ stage: FallbackStage }>(
    `/api/route-groups/${encodeURIComponent(group.id)}/stages`,
    {
      data: { label: "Secondary", enabled: true },
    },
  );
  const candidateIds: string[] = [];
  let spareCandidateId = "";
  for (const [index, account] of accounts.entries()) {
    const sourceRef = sourceRefByAccountId.get(account.id);
    if (!sourceRef) {
      throw new Error(`Candidate catalog did not return a sourceRef for account ${account.id}`);
    }
    const created = await adminApi.postJson<{ id: string }>(
      `/api/route-groups/${encodeURIComponent(group.id)}/candidates`,
      {
        data: {
          sourceRef,
          stageId: index === 2 ? secondary.stage.id : primaryStage!.id,
          weight: 10 + index,
        },
      },
    );
    if (index < 3) candidateIds.push(created.id);
    else spareCandidateId = created.id;
  }
  await adminApi.deleteJson(
    `/api/route-groups/${encodeURIComponent(group.id)}/candidates/${encodeURIComponent(spareCandidateId)}`,
  );
  return {
    groupId: group.id,
    modelName,
    sourceModel,
    accountIds: accounts.map((account) => account.id),
    candidateIds,
    primaryStageId: primaryStage!.id,
    secondaryStageId: secondary.stage.id,
  };
}

async function searchManualRouteGroups(page: Page, modelName: string) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    const url = new URL(response.url());
    return url.pathname === "/api/route-groups"
      && url.searchParams.get("tab") === "manual"
      && url.searchParams.get("q") === modelName;
  });
  await page.getByPlaceholder(/Search|搜索/i).fill(modelName);
  expect((await responsePromise).ok()).toBe(true);
}

test("operates native Route Groups through the browser and persists each mutation", async ({
  adminApi,
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 1400 });
  const seeded = await seedManualRouteGroup(adminApi);
  await adminPage.gotoAdminPage("/routes");

  await adminPage.getByRole("tab", { name: /Manual|手动/i }).click();
  await searchManualRouteGroups(adminPage, seeded.modelName);
  const summary = adminPage
    .locator(".route-card-collapsed")
    .filter({ hasText: seeded.modelName });
  await expect(summary).toBeVisible();
  await summary.getByTestId("collapsed-route-title-row").click();
  const detail = adminPage.locator(".route-group-detail-card");
  await expect(detail).toBeVisible();
  await expect(
    adminPage.getByTestId("route-group-detail-header"),
  ).toContainText(seeded.modelName);
  await expect(
    adminPage.getByTestId(`route-group-stage-${seeded.secondaryStageId}`),
  ).toBeVisible();
  const projected = await adminApi.getJson<{ items: RouteGroupPageItem[] }>(
    `/api/route-groups?paged=1&page=1&pageSize=20&tab=manual&q=${encodeURIComponent(seeded.modelName)}`,
  );
  const projectedGroup = projected.items.find(
    (item) => item.id === seeded.groupId,
  );
  expect(projectedGroup).toMatchObject({
    candidateCount: seeded.candidateIds.length,
    enabledCandidateCount: seeded.candidateIds.length,
  });

  let noOpStageMutationRequests = 0;
  const trackNoOpStageMutation = (request: {
    method: () => string;
    url: () => string;
  }) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname ===
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/candidates/stages`
    ) {
      noOpStageMutationRequests += 1;
    }
  };
  adminPage.on("request", trackNoOpStageMutation);
  const firstPrimaryHandleForNoOp = adminPage.getByTestId(
    `route-group-candidate-drag-handle-${seeded.candidateIds[1]}`,
  );
  const secondPrimarySurfaceForNoOp = adminPage.getByTestId(
    `route-group-candidate-drag-surface-${seeded.candidateIds[1]}`,
  );
  const noOpSourceBox = await firstPrimaryHandleForNoOp.boundingBox();
  const noOpTargetBox = await secondPrimarySurfaceForNoOp.boundingBox();
  expect(noOpSourceBox).not.toBeNull();
  expect(noOpTargetBox).not.toBeNull();
  await adminPage.mouse.move(
    noOpSourceBox!.x + noOpSourceBox!.width / 2,
    noOpSourceBox!.y + noOpSourceBox!.height / 2,
  );
  await adminPage.mouse.down();
  await adminPage.mouse.move(noOpSourceBox!.x + 8, noOpSourceBox!.y + 8, {
    steps: 2,
  });
  await adminPage.mouse.move(
    noOpTargetBox!.x + noOpTargetBox!.width / 2,
    noOpTargetBox!.y + noOpTargetBox!.height / 2,
    { steps: 20 },
  );
  await adminPage.mouse.up();
  await adminPage.waitForTimeout(100);
  adminPage.off("request", trackNoOpStageMutation);
  expect(noOpStageMutationRequests).toBe(0);

  // Reorder inside one stage before testing the cross-stage path. This ensures
  // the drop target is the candidate row under the pointer, not the active row
  // or the enclosing stage container.
  const reorderResponsePromise = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname ===
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/candidates/stages`,
  );
  const firstPrimaryHandle = adminPage.getByTestId(
    `route-group-candidate-drag-handle-${seeded.candidateIds[0]}`,
  );
  const lastPrimarySurface = adminPage.getByTestId(
    `route-group-candidate-drag-surface-${seeded.candidateIds[1]}`,
  );
  await firstPrimaryHandle.scrollIntoViewIfNeeded();
  await lastPrimarySurface.scrollIntoViewIfNeeded();
  const reorderSourceBox = await firstPrimaryHandle.boundingBox();
  const reorderTargetBox = await lastPrimarySurface.boundingBox();
  expect(reorderSourceBox).not.toBeNull();
  expect(reorderTargetBox).not.toBeNull();
  await adminPage.mouse.move(
    reorderSourceBox!.x + reorderSourceBox!.width / 2,
    reorderSourceBox!.y + reorderSourceBox!.height / 2,
  );
  await adminPage.mouse.down();
  await adminPage.mouse.move(reorderSourceBox!.x + 8, reorderSourceBox!.y + 8, {
    steps: 2,
  });
  await adminPage.mouse.move(
    reorderTargetBox!.x + reorderTargetBox!.width / 2,
    reorderTargetBox!.y + reorderTargetBox!.height / 2,
    { steps: 20 },
  );
  await adminPage.mouse.up();
  expect((await reorderResponsePromise).ok()).toBe(true);
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return current.stages
        .find((stage) => stage.id === seeded.primaryStageId)
        ?.candidates.map((candidate) => candidate.id);
    })
    .toEqual([seeded.candidateIds[1], seeded.candidateIds[0]]);

  let routeGroupListRequestsDuringDrag = 0;
  const trackRouteGroupListRequest = (request: {
    method: () => string;
    url: () => string;
  }) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/route-groups"
    ) {
      routeGroupListRequestsDuringDrag += 1;
    }
  };
  adminPage.on("request", trackRouteGroupListRequest);
  const moveResponsePromise = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname ===
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/candidates/stages`,
  );
  const dragSurface = adminPage.getByTestId(
    `route-group-candidate-drag-handle-${seeded.candidateIds[0]}`,
  );
  const dropZone = adminPage.getByTestId(
    `route-group-stage-${seeded.secondaryStageId}`,
  );
  await dropZone.scrollIntoViewIfNeeded();
  await dragSurface.scrollIntoViewIfNeeded();
  const sourceBox = await dragSurface.boundingBox();
  const targetBox = await dropZone.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await adminPage.evaluate(() => {
    const marker = { pageLoadingMounts: 0 };
    Object.assign(window, { __routeGroupDragStability: marker });
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="route-group-list-loading"]')) {
        marker.pageLoadingMounts += 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await adminPage.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await adminPage.mouse.down();
  await adminPage.mouse.move(
    sourceBox!.x + sourceBox!.width / 2 + 8,
    sourceBox!.y + sourceBox!.height / 2 + 8,
    { steps: 2 },
  );
  await adminPage.mouse.move(
    targetBox!.x + 24,
    targetBox!.y + targetBox!.height / 2,
    { steps: 20 },
  );
  await expect(dropZone).toHaveAttribute("data-drag-over", "true");
  const targetBoxWhileDragging = await dropZone.boundingBox();
  expect(targetBoxWhileDragging).not.toBeNull();
  expect(
    Math.abs(targetBoxWhileDragging!.height - targetBox!.height),
  ).toBeLessThan(1);
  expect(
    Math.abs(targetBoxWhileDragging!.width - targetBox!.width),
  ).toBeLessThan(1);
  await adminPage.mouse.up();
  const moveResponse = await moveResponsePromise;
  expect(moveResponse.ok()).toBe(true);
  expect(moveResponse.request().postDataJSON()).toEqual({
    manuallyAdjustedCandidateIds: [seeded.candidateIds[0]],
    updates: expect.arrayContaining([
      expect.objectContaining({
        id: seeded.candidateIds[0],
        stageId: seeded.secondaryStageId,
      }),
    ]),
  });
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return current.stages
        .flatMap((stage) => stage.candidates)
        .find((candidate) => candidate.id === seeded.candidateIds[0])
        ?.fallbackStageId;
    })
    .toBe(seeded.secondaryStageId);
  expect(
    await adminPage.evaluate(
      () =>
        (
          window as unknown as {
            __routeGroupDragStability: { pageLoadingMounts: number };
          }
        ).__routeGroupDragStability.pageLoadingMounts,
    ),
  ).toBe(0);
  await adminPage.waitForTimeout(100);
  adminPage.off("request", trackRouteGroupListRequest);
  expect(routeGroupListRequestsDuringDrag).toBe(0);

  // Preserve the original priority-rail workflow: dropping on the separator
  // creates a native fallback stage and moves the candidate into it.
  const newStageDropZone = adminPage.getByTestId(
    `route-group-new-stage-drop-zone-${seeded.secondaryStageId}`,
  );
  const stageCollectionPath = `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`;
  const stageCollectionPattern = `**${stageCollectionPath}`;
  let createStageRequests = 0;
  await adminPage.route(stageCollectionPattern, async (route) => {
    if (
      route.request().method() === "POST" &&
      new URL(route.request().url()).pathname === stageCollectionPath
    ) {
      createStageRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });
  const createStageResponsePromise = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === stageCollectionPath,
  );
  await expect(newStageDropZone).toHaveAttribute("data-active", "false");
  await expect(newStageDropZone).toHaveCSS("opacity", "0");
  const newStageSourceBox = await dragSurface.boundingBox();
  expect(newStageSourceBox).not.toBeNull();
  await adminPage.mouse.move(
    newStageSourceBox!.x + newStageSourceBox!.width / 2,
    newStageSourceBox!.y + newStageSourceBox!.height / 2,
  );
  await adminPage.mouse.down();
  await adminPage.mouse.move(
    newStageSourceBox!.x + 8,
    newStageSourceBox!.y + 8,
    { steps: 2 },
  );
  await expect(newStageDropZone).toHaveAttribute("data-active", "true");
  await expect(newStageDropZone).toHaveCSS("opacity", "1");
  const newStageTargetBox = await newStageDropZone.boundingBox();
  expect(newStageTargetBox).not.toBeNull();
  await adminPage.mouse.move(
    newStageTargetBox!.x + newStageTargetBox!.width / 2,
    newStageTargetBox!.y + newStageTargetBox!.height / 2,
    { steps: 20 },
  );
  await expect(newStageDropZone).toHaveAttribute("data-drag-over", "true");
  await expect(newStageDropZone.locator(":scope > div > div")).not.toHaveCSS(
    "box-shadow",
    "none",
  );
  await adminPage.mouse.up();
  await expect(
    adminPage.locator('[data-testid^="route-group-stage-"]'),
  ).toHaveCount(3, { timeout: 250 });
  await expect(newStageDropZone).toHaveAttribute("data-active", "false");
  await expect(newStageDropZone).toHaveCSS("opacity", "0");
  expect((await createStageResponsePromise).ok()).toBe(true);
  expect(createStageRequests).toBe(1);
  await adminPage.unroute(stageCollectionPattern);
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return {
        stageCount: current.stages.length,
        movedStageId: current.stages
          .flatMap((stage) => stage.candidates)
          .find((candidate) => candidate.id === seeded.candidateIds[0])
          ?.fallbackStageId,
      };
    })
    .toEqual({
      stageCount: 3,
      movedStageId: expect.not.stringMatching(
        new RegExp(`^${seeded.secondaryStageId}$`),
      ),
    });

  const alphaRow = adminPage
    .getByTestId(`route-group-candidate-drag-surface-${seeded.candidateIds[0]}`)
    .locator("[data-layer-root]");
  const alphaWeight = alphaRow.getByLabel(/^Weight$|^权重$/i);
  const alphaEdit = adminPage.getByTestId(
    `route-group-candidate-edit-${seeded.candidateIds[0]}`,
  );
  await expect(alphaEdit).toBeVisible();
  await alphaEdit.click();
  await expect(alphaWeight).toBeVisible();
  await alphaWeight.fill("37");
  await alphaWeight.blur();
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return current.stages
        .flatMap((stage) => stage.candidates)
        .find((candidate) => candidate.id === seeded.candidateIds[0])?.weight;
    })
    .toBe(37);

  await expect(alphaRow).toContainText(seeded.sourceModel);

  const secondaryStage = adminPage.getByTestId(
    `route-group-stage-${seeded.secondaryStageId}`,
  );
  const secondaryLabel = secondaryStage.getByRole("textbox", {
    name: /Fallback stage|后备阶段/i,
  });
  await secondaryLabel.fill("Browser secondary");
  await secondaryLabel.blur();
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{
        stages: Array<FallbackStage & { label?: string | null }>;
      }>(`/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`);
      return current.stages.find(
        (stage) => stage.id === seeded.secondaryStageId,
      )?.label;
    })
    .toBe("Browser secondary");

  await detail.getByRole("button", { name: /Add candidate|添加候选/i }).click();
  const candidateDialog = adminPage.getByRole("dialog", {
    name: /Add candidate|添加候选/i,
  });
  await candidateDialog
    .getByRole("button")
    .filter({
      hasText: `route-group-delta-${seeded.modelName.slice("e2e-route-group-".length)}`,
    })
    .click();
  await candidateDialog
    .getByRole("button", { name: /Add 1 candidate|添加 1 个候选/i })
    .click();
  await expect(candidateDialog).toBeHidden();
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return current.stages.flatMap((stage) => stage.candidates).length;
    })
    .toBe(4);

  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return (
        current.stages
          .flatMap((stage) => stage.candidates)
          .find((candidate) => !seeded.candidateIds.includes(candidate.id))
          ?.id || null
      );
    })
    .not.toBeNull();
  const currentAfterCreate = await adminApi.getJson<{
    stages: FallbackStage[];
  }>(`/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`);
  const newlyCreatedCandidate = currentAfterCreate.stages
    .flatMap((stage) => stage.candidates)
    .find((candidate) => !seeded.candidateIds.includes(candidate.id))?.id;
  expect(newlyCreatedCandidate).toBeTruthy();
  const createdRow = adminPage
    .getByTestId(`route-group-candidate-drag-surface-${newlyCreatedCandidate}`)
    .locator("[data-layer-root]");
  const createdEdit = adminPage.getByTestId(
    `route-group-candidate-edit-${newlyCreatedCandidate}`,
  );
  await expect(createdEdit).toBeVisible();
  await createdEdit.click();
  await createdRow
    .getByRole("button", { name: /Delete candidate|删除候选/i })
    .click();
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(seeded.groupId)}/stages`,
      );
      return current.stages
        .flatMap((stage) => stage.candidates)
        .some((candidate) => candidate.id === newlyCreatedCandidate);
    })
    .toBe(false);

  await adminPage
    .getByTestId("route-group-detail-header")
    .getByRole("button", { name: /Edit route group|编辑路由组/i })
    .click();
  const dialog = adminPage.getByRole("dialog", { name: /Edit|编辑/i });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: /Routing options|路由选项/i })
    .click();
  await dialog
    .getByLabel(/Display name|显示名称/i)
    .fill(`${seeded.modelName}-renamed`);
  await dialog.getByTestId("route-group-form-save").click();
  await expect(dialog).toBeHidden();
  await expect(
    adminPage.getByText(`${seeded.modelName}-renamed`).first(),
  ).toBeVisible();

  await adminPage.getByRole("button", { name: /Actions|批量操作/i }).click();
  await adminPage.getByTestId(`route-select-${seeded.groupId}`).check();
  const batchResponse = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/route-groups/batch",
  );
  adminPage.once("dialog", (dialog) => dialog.accept());
  await adminPage.getByTestId("route-group-batch-disable").click();
  expect((await batchResponse).ok()).toBe(true);
  await expect
    .poll(async () => {
      const page = await adminApi.getJson<{
        items: Array<{ id: string; enabled: boolean }>;
      }>(
        `/api/route-groups?paged=1&page=1&pageSize=40&tab=manual&q=${encodeURIComponent(seeded.modelName)}`,
      );
      return page.items.find((item) => item.id === seeded.groupId)?.enabled;
    })
    .toBe(false);

  await adminPage.getByRole("button", { name: /Actions|批量操作/i }).click();
  await adminPage.getByTestId(`route-select-${seeded.groupId}`).check();
  const visibilityResponse = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/route-groups/batch" &&
      response.request().postDataJSON()?.action === "set_public",
  );
  adminPage.once("dialog", (dialog) => dialog.accept());
  await adminPage.getByTestId("route-group-batch-set-public").click();
  expect((await visibilityResponse).ok()).toBe(true);
  await expect
    .poll(async () => {
      const page = await adminApi.getJson<{
        items: Array<{ id: string; visibility: string }>;
      }>(
        `/api/route-groups?paged=1&page=1&pageSize=40&tab=manual&q=${encodeURIComponent(seeded.modelName)}`,
      );
      return page.items.find((item) => item.id === seeded.groupId)?.visibility;
    })
    .toBe("public");

  await adminPage
    .getByRole("button", { name: /Open in Graph|在图中打开/i })
    .click();
  await expect(
    adminPage.getByRole("tab", { name: /Route Graph|路由图/i }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(adminPage).toHaveURL(
    new RegExp(
      `graphFocusKind=macro.*graphFocusId=${encodeURIComponent(seeded.groupId)}`,
    ),
  );
  await expect(
    adminPage.getByText(/Route graph overview|路由图概览/i),
  ).toBeVisible();
});

test("keeps native Route Group detail operations usable on mobile", async ({
  adminApi,
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedManualRouteGroup(adminApi);
  await adminPage.gotoAdminPage("/routes");

  await adminPage
    .getByRole("button", { name: /Filter routes|筛选路由/i })
    .click();
  await expect(
    adminPage.getByRole("heading", { name: /Filter routes|筛选路由/i }),
  ).toBeVisible();
  await adminPage.getByRole("button", { name: /Close|关闭/i }).click();

  await adminPage.getByRole("tab", { name: /Manual|手动/i }).click();
  await searchManualRouteGroups(adminPage, seeded.modelName);
  const mobileSummary = adminPage
    .locator('[data-mobile-list-item="true"]')
    .filter({ hasText: seeded.modelName });
  await expect(mobileSummary).toBeVisible();
  await mobileSummary.getByRole("button", { name: /Details|详情/i }).click();
  await expect(
    adminPage.getByTestId(`route-group-stage-${seeded.secondaryStageId}`),
  ).toBeVisible();
  await expect(
    adminPage.getByTestId(
      `route-group-candidate-drag-handle-${seeded.candidateIds[0]}`,
    ),
  ).toBeVisible();
  await mobileSummary.getByRole("button", { name: /Collapse|收起/i }).click();
  await expect(
    adminPage.getByTestId(`route-group-stage-${seeded.secondaryStageId}`),
  ).toBeHidden();
});

test("renders Route Group references as movable fallback-stage members", async ({
  adminApi,
  adminPage,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const childModel = `e2e-route-group-reference-child-${suffix}`;
  const parentModel = `e2e-route-group-reference-parent-${suffix}`;
  const child = await adminApi.postJson<{ id: string }>("/api/route-groups", {
    data: {
      model: { publicName: childModel, upstreamName: childModel },
      presentation: { displayName: childModel, displayIcon: null },
      visibility: "internal",
      enabled: true,
    },
  });
  const parent = await adminApi.postJson<{ id: string }>("/api/route-groups", {
    data: {
      model: { publicName: parentModel, upstreamName: parentModel },
      presentation: { displayName: parentModel, displayIcon: null },
      visibility: "internal",
      enabled: true,
      sourceSelection: {
        kind: "explicit",
        sources: [{ kind: "route_group", id: child.id }],
      },
    },
  });
  const initial = await adminApi.getJson<{ stages: FallbackStage[] }>(
    `/api/route-groups/${encodeURIComponent(parent.id)}/stages`,
  );
  const primaryStage = initial.stages[0];
  expect(primaryStage?.candidates).toHaveLength(1);
  const referenceCandidateId = primaryStage!.candidates[0]!.id;
  const secondary = await adminApi.postJson<{ stage: FallbackStage }>(
    `/api/route-groups/${encodeURIComponent(parent.id)}/stages`,
    {
      data: { label: "Reference fallback", enabled: true },
    },
  );

  await adminPage.setViewportSize({ width: 1440, height: 1200 });
  await adminPage.gotoAdminPage("/routes");
  await adminPage.getByRole("tab", { name: /Manual|手动/i }).click();
  await adminPage.getByPlaceholder(/Search|搜索/i).fill(parentModel);
  const summary = adminPage
    .locator(".route-card-collapsed")
    .filter({ hasText: parentModel });
  await expect(summary).toBeVisible();
  await summary.getByTestId("collapsed-route-title-row").click();
  const referenceHandle = adminPage.getByTestId(
    `route-group-candidate-drag-handle-${referenceCandidateId}`,
  );
  const targetStage = adminPage.getByTestId(
    `route-group-stage-${secondary.stage.id}`,
  );
  await expect(referenceHandle).toBeVisible();
  await expect(
    adminPage.getByTestId("route-group-detail-header"),
  ).toContainText(parentModel);
  await expect(adminPage.locator(".route-group-detail-card")).toContainText(
    childModel,
  );

  const moveResponsePromise = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname ===
        `/api/route-groups/${encodeURIComponent(parent.id)}/candidates/stages`,
  );
  const sourceBox = await referenceHandle.boundingBox();
  const targetBox = await targetStage.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await adminPage.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await adminPage.mouse.down();
  await adminPage.mouse.move(sourceBox!.x + 8, sourceBox!.y + 8, { steps: 2 });
  await adminPage.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 20 },
  );
  await adminPage.mouse.up();
  expect((await moveResponsePromise).ok()).toBe(true);
  await expect
    .poll(async () => {
      const current = await adminApi.getJson<{ stages: FallbackStage[] }>(
        `/api/route-groups/${encodeURIComponent(parent.id)}/stages`,
      );
      return current.stages
        .flatMap((stage) => stage.candidates)
        .find((candidate) => candidate.id === referenceCandidateId)
        ?.fallbackStageId;
    })
    .toBe(secondary.stage.id);
});

test("creates a manual Route Group from the native source catalog", async ({
  adminApi,
  adminPage,
}) => {
  await adminPage.setViewportSize({ width: 1440, height: 1100 });
  const seeded = await seedManualRouteGroup(adminApi);
  const createdModel = `${seeded.modelName}-ui`;
  await adminPage.gotoAdminPage("/routes");
  await adminPage.getByRole("tab", { name: /Manual|手动/i }).click();
  await adminPage
    .getByRole("button", { name: /Create group|创建路由组/i })
    .click();
  const dialog = adminPage.getByRole("dialog", {
    name: /Create group|创建路由组/i,
  });
  await dialog.getByLabel(/Model name|模型名称/i).fill(createdModel);
  await dialog.getByLabel(/Upstream model|上游模型/i).fill(createdModel);
  await dialog.getByTestId("route-group-form-next").click();
  await dialog
    .getByRole("button", { name: /Sources|来源/i })
    .last()
    .click();
  const sourcePicker = adminPage.getByRole("dialog", {
    name: /Select Route Group sources|选择路由组来源/i,
  });
  const source = sourcePicker
    .getByRole("button")
    .filter({ hasText: seeded.modelName })
    .first();
  await expect(source).toBeVisible();
  await source.click();
  // Source selection is a picker draft. Closing it must not silently mutate
  // the Route Group form, because this is how the original editor behaved.
  await sourcePicker.getByRole("button", { name: /Cancel|取消/i }).click();
  await expect(sourcePicker).toBeHidden();
  await dialog
    .getByRole("button", { name: /Sources|来源/i })
    .last()
    .click();
  await expect(sourcePicker).toBeVisible();
  await sourcePicker
    .getByRole("button")
    .filter({ hasText: seeded.modelName })
    .first()
    .click();
  await sourcePicker.getByRole("button", { name: /Save|保存/i }).click();
  await expect(dialog).toContainText(seeded.modelName);
  const createResponse = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/route-groups",
  );
  await dialog.getByTestId("route-group-form-save").click();
  const response = await createResponse;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    model: { publicName: createdModel, upstreamName: createdModel },
    sourceSelection: {
      kind: "explicit",
      sources: [expect.objectContaining({ kind: expect.any(String) })],
    },
  });
  await expect(dialog).toBeHidden();
  await adminPage.getByPlaceholder(/Search|搜索/i).fill(createdModel);
  await expect(
    adminPage
      .locator(".route-card-collapsed")
      .filter({ hasText: createdModel }),
  ).toBeVisible();
});

test("renders Route Group management in Chinese without untranslated resource keys", async ({
  adminApi,
  adminPage,
}) => {
  const seeded = await seedManualRouteGroup(adminApi);
  await adminPage.gotoAdminPage("/routes");
  await adminPage.evaluate(() =>
    window.localStorage.setItem("app_language", "zh"),
  );
  await adminPage.reload();
  await adminPage.getByRole("tab", { name: /手动/i }).click();
  await adminPage.getByPlaceholder(/Search|搜索/i).fill(seeded.modelName);
  await expect(
    adminPage
      .locator(".route-card-collapsed")
      .filter({ hasText: seeded.modelName }),
  ).toBeVisible();
  await expect(adminPage.locator("body")).not.toContainText(
    /pages\.tokenRoutes\.|components\.[a-zA-Z]+\./,
  );
});
