import type { Page } from '@playwright/test';
import { pagePathUrlPattern } from '../e2ePageMatchers.js';
import { expect } from '../e2eHarness.js';

export type AdminPageSpec = {
  path: string;
  title: RegExp;
};

export const coreAdminPages: AdminPageSpec[] = [
  { path: '/', title: /仪表盘|Dashboard/i },
  { path: '/routes', title: /Routes/i },
  { path: '/models', title: /Model Marketplace|Models/i },
  { path: '/playground', title: /Model Playground|Model/i },
  { path: '/settings', title: /Settings/i },
];

export async function expectAdminShell(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Metapi/i);
  await expect(page.getByRole('navigation', { name: /主导航|Main navigation/i })).toBeVisible();
}

export async function expectAdminPageLoaded(page: Page, spec: AdminPageSpec): Promise<void> {
  await expectAdminShell(page);
  await expect(page).toHaveURL(pagePathUrlPattern(spec.path));
  await expect(page.getByText(spec.title).first()).toBeVisible();
}

export async function expectRouteEditorModes(page: Page): Promise<void> {
  await expect(page.getByRole('tab', { name: /^Route Groups$|^路由组$/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Edit|图编辑/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Advanced JSON|高级 JSON|JSON/i })).toBeVisible();
  await expect(page.getByText(/Route groups|路由组/i).first()).toBeVisible();

  await page.getByRole('tab', { name: /Edit|图编辑/i }).click();
  await expect(page.getByText(/Graph Tools|Primitive|Template|Diagnostics|Problems/i).first()).toBeVisible();

  await page.getByRole('tab', { name: /Advanced JSON|高级 JSON|JSON/i }).click();
  await expect(page.getByText(/JSON|Validate|Publish|Draft|Diagnostics/i).first()).toBeVisible();
}

export async function expectModelsMarketplaceEmptyState(page: Page): Promise<void> {
  await expect(page.getByText(/Model Marketplace|模型广场/i).first()).toBeVisible();
  await expect(page.getByPlaceholder(/Search model|搜索模型/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /All Brands|全部品牌/i })).toBeVisible();
  await expect(page.getByText(/Sort By|排序/i).first()).toBeVisible();
  await expect(page.getByText(/No model yet|暂无模型结果|Total\s*0\s*models|共\s*0\s*个模型|Coverage tier/i).first()).toBeVisible();
}
