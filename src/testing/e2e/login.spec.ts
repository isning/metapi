import { expectAdminPageLoaded } from './adminPages.js';
import { E2E_ADMIN_TOKEN, test } from '../e2eHarness.js';

test('logs in through the admin token form', async ({ checkedPage }) => {
  await checkedPage.goto('/');
  await checkedPage.getByLabel(/管理员令牌|Admin Token/i).fill(E2E_ADMIN_TOKEN);
  await checkedPage.getByRole('button', { name: /登录|Sign In|Log in/i }).click();

  await expectAdminPageLoaded(checkedPage, { path: '/', title: /仪表盘|Dashboard/i });
});
