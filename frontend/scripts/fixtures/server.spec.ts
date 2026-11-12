import { test, expect } from '@playwright/test';
test('servidor isolado', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
});
