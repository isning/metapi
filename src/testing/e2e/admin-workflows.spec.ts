import {
  coreAdminPages,
  expectAdminPageLoaded,
  expectModelsMarketplaceEmptyState,
  expectRouteEditorModes,
} from './adminPages.js';
import { expect, test } from '../e2eHarness.js';

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

  await adminPage.getByRole('tab', { name: /^JSON$/i }).first().click();
  const graphJson = adminPage.locator('.route-graph-json-editor').first();
  await expect.poll(async () => graphJson.inputValue()).toContain('e2e-model-group');
  const parsed = JSON.parse(await graphJson.inputValue()) as { macros?: Array<{ kind?: string }> };
  expect(parsed.macros || []).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'candidate_selector' }),
  ]));
});

test('opens models marketplace controls and empty-state path', async ({ adminPage }) => {
  await adminPage.gotoAdminPage('/models');
  await expectModelsMarketplaceEmptyState(adminPage);
});
