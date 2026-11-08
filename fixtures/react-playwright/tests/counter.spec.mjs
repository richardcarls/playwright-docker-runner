import { expect, test } from '@playwright/test';

test('React app responds in a real browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Count 0' }).click();
  await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible();
});
