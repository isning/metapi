import { expect, test } from '../e2eHarness.js';

test('admin api fixture sends the configured bearer token', async ({ adminApi }) => {
  const payload = await adminApi.getJson<{ masked?: string }>('/api/settings/auth/info');
  expect(payload.masked).toBe('test****oken');
});
