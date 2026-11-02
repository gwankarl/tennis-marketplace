import { expect, test } from '@playwright/test';

test('home page shows its heading and live API connection status', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Tennis Xpress' }),
  ).toBeVisible();
  await expect(page.getByText('API connection: Available')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
