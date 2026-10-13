import { test, expect } from '@playwright/test'
import process from 'node:process'
import { URL } from 'node:url'

test('opt-in live official-player request identity and playback diagnostic', async ({ page, request }, testInfo) => {
  test.skip(process.env.E2E_LIVE_PLAYER !== '1', 'Live provider playback is a separate opt-in diagnostic, never a mocked CI test.')
  const slug = process.env.E2E_RECIPE_SLUG
  const externalId = process.env.E2E_YOUTUBE_ID
  test.skip(!slug || !externalId, 'Requires a disposable local watch fixture and an API-confirmed embeddable source ID.')
  test.setTimeout(60000)
  const video = await (await request.get(`/api/v1/videos/${slug}/`)).json()
  // Only the detail's source identity changes for this diagnostic; no API payload
  // or recipe/source record is persisted. The YouTube iframe and API are real.
  await page.route(`**/api/v1/videos/${slug}/`, route => route.fulfill({ json: { ...video, external_id: externalId, availability: 'OK', canonical_url: `https://www.youtube.com/watch?v=${externalId}` } }))
  let identity
  const failedRequests = []
  page.on('requestfailed', req => failedRequests.push({ host: new URL(req.url()).host, error: req.failure()?.errorText }))
  page.on('request', req => {
    if (req.url().startsWith(`https://www.youtube-nocookie.com/embed/${externalId}`)) {
      identity = { url: req.url(), referer: req.headers().referer }
    }
  })
  await page.goto(`/shorts/${slug}`)
  await expect(page.locator('iframe')).toHaveCount(1)
  await expect.poll(() => identity, { timeout: 15000 }).toBeTruthy()
  expect(new URL(identity.url).searchParams.get('origin')).toBe(new URL(page.url()).origin)
  expect(identity.referer).toBe(`${new URL(page.url()).origin}/`)
  await testInfo.attach('request-identity', { body: JSON.stringify(identity), contentType: 'application/json' })
  try {
    await expect(page.getByText('Ready. Tap the official play button.')).toBeVisible({ timeout: 25000 })
    await page.frameLocator('iframe').getByRole('button', { name: /^Play( video)?$/ }).click({ timeout: 10000 })
    await expect(page.getByText('Playing the original source.')).toBeVisible({ timeout: 15000 })
  } finally {
    await page.screenshot({ path: testInfo.outputPath('live-player.png'), fullPage: true })
    await testInfo.attach('player-status', { body: await page.locator('.player-column').innerText(), contentType: 'text/plain' })
    await testInfo.attach('failed-request-hosts', { body: JSON.stringify(failedRequests), contentType: 'application/json' })
  }
})
