import { expectAdminPageLoaded } from './adminPages.js';
import { test } from '../e2eHarness.js';

test('serves the admin app and reaches the authenticated dashboard', async ({ adminPage }) => {
  await adminPage.gotoAdminPage('/');
  await expectAdminPageLoaded(adminPage, { path: '/', title: /仪表盘|Dashboard/i });
});
