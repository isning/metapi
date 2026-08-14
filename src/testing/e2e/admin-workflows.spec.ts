import {
  coreAdminPages,
  expectAdminPageLoaded,
  expectModelsMarketplaceEmptyState,
  expectRouteEditorModes,
} from './adminPages.js';
import { expect, test, type Page } from '../e2eHarness.js';

type AdminApi = {
  getJson: <T = unknown>(url: string) => Promise<T>;
  postJson: <T = unknown>(url: string, options?: { data?: unknown }) => Promise<T>;
};

async function seedManualModelRoute(adminApi: AdminApi) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const modelName = `e2e-route-flow-${suffix}`;
  const site = await adminApi.postJson<{ id: number }>('/api/sites', {
    data: {
      name: `E2E Route Flow ${suffix}`,
      url: `https://e2e-route-flow-${suffix}.example.com`,
      platform: 'openai',
      status: 'active',
    },
  });
  const account = await adminApi.postJson<{ id: number }>('/api/accounts', {
    data: {
      siteId: site.id,
      username: `e2e-route-flow-${suffix}`,
      credentialMode: 'apikey',
      apiKey: `sk-e2e-route-flow-${suffix}`,
      skipModelFetch: true,
    },
  });

  await adminApi.postJson(`/api/accounts/${account.id}/models/manual`, {
    data: { models: [modelName] },
  });

  await expect.poll(async () => {
    const routes = await adminApi.getJson<{
      items?: Array<{
        model?: { normalizedName?: string | null };
        presentation?: { displayName?: string | null };
      }>;
    }>(`/api/route-groups?paged=1&page=1&pageSize=50&q=${encodeURIComponent(modelName)}`);
    const items = Array.isArray(routes.items) ? routes.items : [];
    return items.some((route) => (
      route.model?.normalizedName === modelName
      && route.presentation?.displayName === modelName
    ));
  }).toBe(true);
  await adminApi.getJson('/api/models/marketplace?refresh=1&includePricing=1');

  return { modelName };
}

async function openExportJson(page: Page): Promise<string> {
  const draftResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/route-graph/draft'
  ));
  await page.getByRole('tab', { name: /^Export JSON$|^导出 JSON$/i }).click();
  const response = await draftResponse;
  expect(response.ok()).toBe(true);
  await expect(page.locator('.json-code-editor')).toBeVisible();
  return JSON.stringify(await response.json());
}

test('navigates core admin pages after login without blank views', async ({ adminPage }) => {
  for (const page of coreAdminPages) {
    await adminPage.gotoAdminPage(page.path);
    await expectAdminPageLoaded(adminPage, page);
  }
});

test('opens route group, graph, and export json modes', async ({ adminApi, adminPage }) => {
  const modelName = `e2e-route-modes-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await adminApi.postJson('/api/route-groups', {
    data: {
      model: { publicName: modelName, upstreamName: modelName },
      presentation: { displayName: modelName, displayIcon: null },
      visibility: 'internal',
      enabled: true,
    },
  });
  await adminPage.gotoAdminPage('/routes');
  await expectRouteEditorModes(adminPage);
});

test('creates a route group and opens its generated macro workspace', async ({ adminPage }) => {
  const modelName = `e2e-workspace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await adminPage.gotoAdminPage('/routes');

  await adminPage.getByRole('tab', { name: /Manual|手动/i }).click();
  await adminPage.getByRole('button', { name: /Create group|创建路由组/i }).click();
  const dialog = adminPage.getByRole('dialog', { name: /Create Group|创建群组/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Model name$|^模型名称$/i).fill(modelName);
  await dialog.getByLabel(/^Upstream model$|^上游模型$/i).fill(modelName);
  await dialog.getByTestId('route-group-form-next').click();
  await dialog.getByRole('button', { name: /^Model pattern$|^按模型规则$/i }).click();
  await dialog.getByLabel(/Source model pattern|来源模型规则/i).fill(modelName);
  await dialog.getByTestId('route-group-form-save').click();
  await expect(dialog).toBeHidden();

  await adminPage.getByRole('tab', { name: /^Route Graph$|^路由图$/i }).click();
  await expect(adminPage.getByText(/Route graph overview|路由图概览/i)).toBeVisible();
  await adminPage.getByPlaceholder(/Search names|搜索名称/i).fill(modelName);
  const workspaceRow = adminPage.getByRole('button', { name: new RegExp(modelName, 'i') }).first();
  await expect(workspaceRow).toBeVisible();
  await workspaceRow.click();
  await adminPage.getByRole('button', { name: /Open Focus|打开 Focus/i }).click();
  await expect(adminPage.getByRole('button', { name: /Back to route graph overview|返回路由图概览/i })).toBeVisible();
  await expect(adminPage.getByText(modelName).first()).toBeVisible();

  const draftJson = await openExportJson(adminPage);
  expect(draftJson).toContain(modelName);
  expect(draftJson).toContain('candidate_selector');
});

test('renders seeded route graph data in the graph and export json modes', async ({ adminApi, adminPage }) => {
  const { modelName } = await seedManualModelRoute(adminApi);

  await adminPage.gotoAdminPage('/routes');
  await expect(adminPage.getByText(modelName).first()).toBeVisible();

  await adminPage.getByRole('tab', { name: /^Route Graph$|^路由图$/i }).click();
  await adminPage.getByPlaceholder(/Search names|搜索名称/i).fill(modelName);
  const workspaceRow = adminPage.getByRole('button', { name: new RegExp(modelName, 'i') }).first();
  await expect(workspaceRow).toBeVisible();
  await workspaceRow.dblclick();
  await expect(adminPage.getByText(modelName).first()).toBeVisible();
  await adminPage.getByRole('tab', { name: /Primitives|基础节点/i }).click();
  await expect(adminPage.getByText(/Resident|当前驻留/i).first()).toBeVisible();

  const draftJson = await openExportJson(adminPage);
  expect(draftJson).toContain(modelName);
  expect(draftJson).toMatch(/route_endpoint|candidate_selector/i);
});

test('renders seeded compiled route flow in model details', async ({ adminApi, adminPage }) => {
  const { modelName } = await seedManualModelRoute(adminApi);

  await adminPage.gotoAdminPage('/models');
  await adminPage.getByPlaceholder(/Search model|搜索模型/i).fill(modelName);
  const modelButton = adminPage.getByRole('button', { name: new RegExp(modelName) }).first();
  await expect(modelButton).toBeVisible();
  await modelButton.click();
  await adminPage.getByRole('tab', { name: /Routing|路由/i }).click();
  const routingPanel = adminPage.getByRole('tabpanel', { name: /Routing|路由/i });
  await expect(routingPanel.getByText(/Route plan|路由方案/i).first()).toBeVisible();
  await expect(routingPanel.getByText(/Matched|已匹配/i).first()).toBeVisible();
  await expect(routingPanel.getByText(/Terminal outcome|终端结果/i).first()).toBeVisible();
  await expect(routingPanel.getByRole('tab', { name: /Execution paths|执行路径/i })).toBeVisible();
  await expect(routingPanel.getByText(/Selection terms|选择项/i).first()).toBeVisible();
  await expect(routingPanel.getByText(/Execution attempts|执行尝试/i).first()).toBeVisible();
  await expect(routingPanel.getByText(/Upstream API fallback order|上游 API 回退顺序/i).first()).toBeVisible();
  await routingPanel.getByRole('tab', { name: /^Cost$|^成本$/i }).click();
  await expect(routingPanel.getByText(/Entry cost|入口成本/i).first()).toBeVisible();
  await routingPanel.getByRole('tab', { name: /^Diagnostics$|^诊断$/i }).click();
  await expect(routingPanel.getByText(/^info$/i).first()).toBeVisible();
  await expect(routingPanel.getByText(
    new RegExp(`No configured upstream cost for ${modelName} on execution attempt`),
  ).first()).toBeVisible();
});

test('creates a reference pricing entry from the cost catalog page', async ({ adminApi, adminPage }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const modelName = `e2e-cost-model-${suffix}`;

  await adminPage.gotoAdminPage('/costs');
  await expect(adminPage.getByText(/Cost Catalog|成本目录/i).first()).toBeVisible();
  await expect(adminPage.getByText(/Reference entries|参考价格条目/i).first()).toBeVisible();

  await adminPage.getByRole('button', { name: /New entry|新增条目/i }).click();
  const dialog = adminPage.getByRole('dialog', { name: /New entry|新增条目/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^Model identity$|^模型身份$/i)).toBeVisible();
  await expect(dialog.getByText(/^Rate card$|^价格表$/i)).toBeVisible();
  await expect(dialog.getByText(/^Advanced pricing plan$|^高级计价方案$/i)).toBeVisible();

  await dialog.getByLabel(/^Model$|^模型$/i).fill(modelName);
  await dialog.getByLabel(/Provider|供应商/i).fill('openai');
  await dialog.getByLabel(/Display name|显示名称/i).fill(`E2E ${modelName}`);
  await dialog.getByLabel(/Input \/ 1M|输入 \/ 1M/i).fill('1.5');
  await dialog.getByLabel(/Output \/ 1M|输出 \/ 1M/i).fill('4.5');
  await dialog.getByRole('button', { name: /^Save$|^保存$/i }).click();

  await expect(dialog).toBeHidden();
  await expect(adminPage.getByText(modelName).first()).toBeVisible();
  const catalog = await adminApi.getJson<{
    entries: Array<{ modelName: string; provider: string | null; sourceType: string }>;
  }>('/api/pricing/reference-catalog');
  expect(catalog.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({
      modelName,
      provider: 'openai',
      sourceType: 'manual',
    }),
  ]));

  await adminPage.getByRole('button', { name: /^Import$|^导入$/i }).click();
  await expect(adminPage.getByRole('dialog', { name: /Import JSON|导入 JSON/i })).toBeVisible();
  await adminPage.getByRole('button', { name: /^Cancel$|^取消$/i }).click();

  await adminPage.getByRole('button', { name: /Remote sync|远程同步/i }).click();
  const syncDialog = adminPage.getByRole('dialog', { name: /Remote sync|远程同步/i });
  await expect(syncDialog).toBeVisible();
  await syncDialog.getByLabel(/Sync URL|同步链接/i).fill(`https://pricing-${suffix}.example.com/catalog.json`);
  await syncDialog.getByRole('button', { name: /^Save$|^保存$/i }).click();
  await expect(syncDialog).toBeHidden();

  const config = await adminApi.getJson<{ sync: { url: string } }>('/api/pricing/reference-config');
  expect(config.sync.url).toBe(`https://pricing-${suffix}.example.com/catalog.json`);
});

test('opens models marketplace controls and empty-state path', async ({ adminPage }) => {
  await adminPage.gotoAdminPage('/models');
  await expectModelsMarketplaceEmptyState(adminPage);
});
