import {
  coreAdminPages,
  expectAdminPageLoaded,
  expectModelsMarketplaceEmptyState,
  expectRouteEditorModes,
} from './adminPages.js';
import { expect, test } from '../e2eHarness.js';

async function seedManualModelRoute(adminApi: {
  getJson: <T = unknown>(url: string) => Promise<T>;
  postJson: <T = unknown>(url: string, options?: { data?: unknown }) => Promise<T>;
}) {
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
      accessToken: `sk-e2e-route-flow-${suffix}`,
      skipModelFetch: true,
    },
  });

  await adminApi.postJson(`/api/accounts/${account.id}/models/manual`, {
    data: { models: [modelName] },
  });

  await expect.poll(async () => {
    const routes = await adminApi.getJson<Array<{ modelPattern?: string; match?: { requestedModelPattern?: string } }>>('/api/routes');
    return routes.some((route) => (
      route.modelPattern === modelName
      || route.match?.requestedModelPattern === modelName
    ));
  }).toBe(true);
  await adminApi.getJson('/api/models/marketplace?refresh=1&includePricing=1');

  return { modelName };
}

test('navigates core admin pages after login without blank views', async ({ adminPage }) => {
  for (const page of coreAdminPages) {
    await adminPage.gotoAdminPage(page.path);
    await expectAdminPageLoaded(adminPage, page);
  }
});

test('opens route editor list, graph, and advanced json modes', async ({ adminPage }) => {
  await adminPage.gotoAdminPage('/routes');
  await expectRouteEditorModes(adminPage);
});

test('creates a model group macro in the graph editor and persists it to advanced json', async ({ adminPage }) => {
  await adminPage.gotoAdminPage('/routes');

  await adminPage.getByRole('tab', { name: /Edit|图编辑/i }).click();
  await expect(adminPage.getByText(/Route Graph/i).first()).toBeVisible();

  await adminPage.getByRole('tab', { name: /Macros/i }).click();
  await adminPage.getByRole('button', { name: /Add Model Group macro/i }).click();

  await expect(adminPage.getByText(/Macro/i).first()).toBeVisible();
  await adminPage.getByLabel(/Public model name/i).fill('e2e-model-group');
  await adminPage.getByRole('button', { name: /Save Draft/i }).click();
  await expect(adminPage.getByText(/草稿已保存|Draft/i).first()).toBeVisible();

  await adminPage.getByRole('tab', { name: /Advanced JSON|高级 JSON|JSON/i }).first().click();
  await expect(adminPage.getByText('e2e-model-group').first()).toBeVisible();
  await expect(adminPage.getByText('candidate_selector').first()).toBeVisible();
});

test('renders seeded route graph data in the route editor and advanced json', async ({ adminApi, adminPage }) => {
  const { modelName } = await seedManualModelRoute(adminApi);

  await adminPage.gotoAdminPage('/routes');
  await expect(adminPage.getByText(modelName).first()).toBeVisible();

  await adminPage.getByRole('tab', { name: /Edit|图编辑/i }).click();
  await expect(adminPage.getByText(/Graph Tools|Primitive|Template|Diagnostics|Problems/i).first()).toBeVisible();
  await expect(adminPage.getByText(modelName).first()).toBeVisible();

  await adminPage.getByRole('tab', { name: /Advanced JSON|高级 JSON|JSON/i }).first().click();
  await expect(adminPage.getByText(modelName).first()).toBeVisible();
  await expect(adminPage.getByText(/route_endpoint|candidate_selector/i).first()).toBeVisible();
});

test('renders seeded compiled route flow in model details', async ({ adminApi, adminPage }) => {
  const { modelName } = await seedManualModelRoute(adminApi);

  await adminPage.gotoAdminPage('/models');
  await adminPage.getByPlaceholder(/Search model|搜索模型/i).fill(modelName);
  const modelButton = adminPage.getByRole('button', { name: new RegExp(modelName) }).first();
  await expect(modelButton).toBeVisible();
  await modelButton.click();
  await adminPage.getByRole('tab', { name: /Routing|路由/i }).click();
  await expect(adminPage.getByText(/Compiled route preview|编译路由|candidate endpoints|候选端点/i).first()).toBeVisible();
  await adminPage.getByRole('tab', { name: /Candidates|候选/i }).click();
  await expect(adminPage.getByText(/candidate|候选|probability|概率/i).first()).toBeVisible();
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
