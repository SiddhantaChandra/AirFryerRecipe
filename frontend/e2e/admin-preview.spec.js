import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { URL } from 'node:url'

test('labeled admin failure screens from real Django views', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_MOCKS !== '1', 'Generate rolled-back local admin UI evidence first.')
  await page.setViewportSize({ width: 375, height: 900 })
  for (const [name, text] of [
    ['duplicate', 'This source is already in the archive.'],
    ['missing', 'The source was not returned: it may be private or removed.'],
    ['blocked', 'Embedding is disabled by the creator.'],
    ['unknown', 'Embeddability is unknown. Check the original source manually.'],
    ['invalid', "Host 'example.invalid' is not a recognized YouTube domain."],
    ['temporary', 'Labeled temporary provider failure. Retry later.'],
    ['invalid-editorial', 'Please correct the errors below.'],
  ]) {
    const html = await readFile(new URL(`../../backend/.cache/admin-browser/${name}.html`, import.meta.url), 'utf8')
    await page.route('**/django-admin/catalog/video/preview/', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('/django-admin/catalog/video/preview/')
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible()
    if (name !== 'invalid-editorial') await expect(page.getByLabel('YouTube source URL')).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await page.unroute('**/django-admin/catalog/video/preview/')
  }
})

test('real official playback in the Django Admin preview document', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_MOCKS !== '1' || process.env.E2E_LIVE_PLAYER !== '1', 'Opt-in live provider check with a rolled-back local preview document.')
  const html = await readFile(new URL('../../backend/.cache/admin-browser/live-preview.html', import.meta.url), 'utf8')
  await page.route('**/django-admin/catalog/video/preview/', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto('/django-admin/catalog/video/preview/')
  await page.frameLocator('iframe').getByRole('button', { name: /^Play( video)?$/ }).click()
  await expect(page.locator('#source-player-status')).toContainText('Playing', { timeout: 15000 })
  await page.screenshot({ path: test.info().outputPath('admin-live-playback.png'), fullPage: true })
})
