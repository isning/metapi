import { expect, test as base, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { withAdminAuthorization } from './e2eApiHeaders.js';

export const E2E_ADMIN_TOKEN = process.env.E2E_AUTH_TOKEN || 'test-admin-token';

type AdminPage = Page & {
  gotoAdminPage: (path: string) => Promise<void>;
};

type AdminApi = {
  get: (url: string, options?: RequestOptions) => Promise<APIResponse>;
  getJson: <T = unknown>(url: string, options?: RequestOptions) => Promise<T>;
  post: (url: string, options?: RequestOptions) => Promise<APIResponse>;
  postJson: <T = unknown>(url: string, options?: RequestOptions) => Promise<T>;
  put: (url: string, options?: RequestOptions) => Promise<APIResponse>;
  putJson: <T = unknown>(url: string, options?: RequestOptions) => Promise<T>;
  patch: (url: string, options?: RequestOptions) => Promise<APIResponse>;
  patchJson: <T = unknown>(url: string, options?: RequestOptions) => Promise<T>;
  delete: (url: string, options?: RequestOptions) => Promise<APIResponse>;
  deleteJson: <T = unknown>(url: string, options?: RequestOptions) => Promise<T>;
};

type RequestOptions = Parameters<APIRequestContext['get']>[1];

type E2EFixtures = {
  adminToken: string;
  adminHeaders: Record<string, string>;
  adminApi: AdminApi;
  checkedPage: Page;
  adminPage: AdminPage;
};

type PageRuntimeIssue = {
  kind: 'console.error' | 'pageerror';
  message: string;
};

export async function loginAsAdmin(page: Page, token = E2E_ADMIN_TOKEN): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/管理员令牌|Admin/i).fill(token);
  await page.getByRole('button', { name: /登录|Sign In|Log in/i }).click();
}

export async function installAdminSession(page: Page, token = E2E_ADMIN_TOKEN): Promise<void> {
  await page.addInitScript((authToken) => {
    window.localStorage.setItem('auth_token', authToken);
    window.localStorage.setItem('auth_token_expires_at', String(Date.now() + 12 * 60 * 60 * 1000));
  }, token);
}

export async function gotoAdminPage(page: Page, path: string, token = E2E_ADMIN_TOKEN): Promise<void> {
  await installAdminSession(page, token);
  await page.goto(path);
}

export function adminRequestHeaders(token = E2E_ADMIN_TOKEN): Record<string, string> {
  return withAdminAuthorization(token);
}

function mergeAdminHeaders(
  token: string,
  headers?: RequestOptions['headers'],
): Record<string, string> {
  return withAdminAuthorization(token, headers);
}

export async function expectAdminApiReady(
  request: APIRequestContext,
  token = E2E_ADMIN_TOKEN,
): Promise<void> {
  const response = await request.get('/api/settings/auth/info', {
    headers: adminRequestHeaders(token),
  });
  expect(response.ok(), [
    `E2E admin API did not respond from the configured base URL.`,
    `The target must be a Metapi server with /api/settings/auth/info available.`,
    await response.text(),
  ].join('\n')).toBe(true);
}

async function expectOkJson<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as T;
}

function installRuntimeIssueCollector(page: Page): PageRuntimeIssue[] {
  const issues: PageRuntimeIssue[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    issues.push({ kind: 'console.error', message: message.text() });
  });
  page.on('pageerror', (error) => {
    issues.push({ kind: 'pageerror', message: error.message });
  });
  return issues;
}

export const test = base.extend<E2EFixtures>({
  adminToken: async ({}, use) => {
    await use(E2E_ADMIN_TOKEN);
  },
  adminHeaders: async ({ adminToken }, use) => {
    await use(adminRequestHeaders(adminToken));
  },
  adminApi: async ({ request, adminToken }, use) => {
    const withAuth = (options: RequestOptions = {}): RequestOptions => ({
      ...options,
      headers: mergeAdminHeaders(adminToken, options?.headers),
    });
    await use({
      get: (url, options) => request.get(url, withAuth(options)),
      getJson: async (url, options) => expectOkJson(await request.get(url, withAuth(options))),
      post: (url, options) => request.post(url, withAuth(options)),
      postJson: async (url, options) => expectOkJson(await request.post(url, withAuth(options))),
      put: (url, options) => request.put(url, withAuth(options)),
      putJson: async (url, options) => expectOkJson(await request.put(url, withAuth(options))),
      patch: (url, options) => request.patch(url, withAuth(options)),
      patchJson: async (url, options) => expectOkJson(await request.patch(url, withAuth(options))),
      delete: (url, options) => request.delete(url, withAuth(options)),
      deleteJson: async (url, options) => expectOkJson(await request.delete(url, withAuth(options))),
    });
  },
  checkedPage: async ({ page }, use) => {
    const runtimeIssues = installRuntimeIssueCollector(page);
    await use(page);
    expect(runtimeIssues).toEqual([]);
  },
  adminPage: async ({ checkedPage, adminToken, request }, use) => {
    await expectAdminApiReady(request, adminToken);
    await installAdminSession(checkedPage, adminToken);
    const target = checkedPage as AdminPage;
    target.gotoAdminPage = async (path: string) => {
      await installAdminSession(target, adminToken);
      await target.goto(path);
    };
    await use(target);
  },
});

export { expect };
