import { expect, test } from '@playwright/test'

test('loads token gate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('JCGO')).toBeVisible()
  await expect(page.getByLabel('Access token')).toBeVisible()
})
