import { test, expect } from '@playwright/test'
import process from 'node:process'

const recipe = {
  id: 'browser-mock', slug: 'browser-mock', external_id: 'abcdefghijk', availability: 'UNKNOWN',
  recipe_name: 'Crispy air fryer potatoes आलू আলু with a long manually reviewed recipe title',
  recipe_summary: 'Labeled browser test recipe, not real provider metadata.',
  creator_name: null, diet_label: 'Vegetarian', cook_time_minutes: null,
  thumbnail_url: null, meal_types: ['Snack'], cuisines: ['Indian'],
  canonical_url: 'https://www.youtube.com/watch?v=abcdefghijk',
}

async function mockFeed(page, results = [recipe]) {
  await page.route('**/api/v1/videos/', route => route.fulfill({ json: { count: results.length, results } }))
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
  test(`discovery ${width}px: mixed-script cards, themes, geometry and footer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockFeed(page, Array.from({ length: 6 }, (_, i) => ({ ...recipe, id: `${i}`, slug: `recipe-${i}` })))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.locator('.recipe-card')).toHaveCount(6)
    await noOverflow(page)
    const columns = width < 360 ? 1 : width < 768 ? 2 : width < 1024 ? 3 : width < 1440 ? 4 : 5
    expect(await page.locator('.recipe-grid').evaluate(el => window.getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns)
    for (const theme of ['Dark', 'Light']) {
      await page.getByRole('button', { name: `${theme} theme` }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'System theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('.recipe-card').first()).toHaveCSS('box-shadow', 'none')
    await expect(page.locator('.recipe-card h2').first()).toHaveCSS('-webkit-line-clamp', '2')
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
    await expect(page.getByRole('contentinfo')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`discovery-${width}.png`), fullPage: true })
  })
}

test('discovery keyboard focus, 200% text reflow, error retry and empty state', async ({ page }) => {
  let failed = true
  await page.setViewportSize({ width: 320, height: 900 })
  await page.route('**/api/v1/videos/', route => route.fulfill(failed ? { status: 503, json: {} } : { json: { results: [], count: 0 } }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Recipes could not load')
  failed = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The archive is getting started' })).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await noOverflow(page)
  await page.reload()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#content')).toBeInViewport()
})

test('touch discovery card retains cropped image geometry and opens the real watch route', async ({ browser }) => {
  test.skip(!slug, 'Set E2E_RECIPE_SLUG to a disposable published local recipe.')
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 }, baseURL: process.env.E2E_BASE_URL || 'http://localhost:8090' })
  const page = await context.newPage()
  await mockFeed(page, [{ ...recipe, slug, thumbnail_url: 'https://i.ytimg.com/browser-qa.jpg' }])
  await page.route('https://i.ytimg.com/browser-qa.jpg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="tan"/></svg>' }))
  await page.goto('/')
  await expect(page.locator('.card-media img')).toHaveCSS('object-fit', 'cover')
  await page.locator('.recipe-card').tap()
  await expect(page).toHaveURL(new RegExp(`/shorts/${slug}$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Local browser QA:')
  await context.close()
})

// Optional real Django/Caddy document tests use a disposable local fixture slug.
// Player service and iframe are mocked: no live YouTube playback is claimed.
const slug = process.env.E2E_RECIPE_SLUG

test('real local route headers and no-JavaScript watch document', async ({ browser, request }) => {
  test.skip(!slug, 'Set E2E_RECIPE_SLUG to a disposable published local recipe.')
  for (const path of [`/shorts/${slug}`, `/shorts/${slug}/`, '/api/v1/videos/', '/healthz']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(response.headers()['set-cookie']).toBeUndefined()
    if (path.startsWith('/shorts/')) {
      const html = await response.text()
      expect(html.includes('/@vite/client')).toBe(process.env.E2E_MODE === 'development')
      expect(html.includes('/@react-refresh')).toBe(process.env.E2E_MODE === 'development')
      expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
      const conditional = await request.get(path, { headers: { 'If-None-Match': response.headers().etag } })
      expect(conditional.status()).toBe(304)
      expect(conditional.headers()['set-cookie']).toBeUndefined()
    }
  }
  const missingPaths = ['/api/v1/missing/', '/shorts/missing']
  if (process.env.E2E_MODE !== 'development') missingPaths.push('/assets/missing.js')
  for (const path of missingPaths) {
    const response = await request.get(path)
    expect(response.status()).toBe(404)
    expect(response.headers()['cache-control']).toContain('no-store')
  }
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_BASE_URL || 'http://localhost:8090' })
  const page = await context.newPage()
  await page.goto(`/shorts/${slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Local browser QA:')
  await expect(page.getByRole('link', { name: 'View original on YouTube' })).toBeVisible()
  await expect(page.locator('noscript')).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/shorts\/phase3-qa-/)
  await context.close()
})

test('watch blocked, unavailable and error 153 states are distinct (provider mocks)', async ({ page, request }) => {
  test.skip(!slug, 'Set E2E_RECIPE_SLUG to a disposable published local recipe.')
  const response = await request.get(`/api/v1/videos/${slug}/`)
  const video = await response.json()
  let availability = 'EMBED_BLOCKED'
  await page.route('**/api/v1/videos/*/', route => route.fulfill({ json: { ...video, availability } }))
  await page.goto(`/shorts/${slug}`)
  await expect(page.locator('.player-fallback')).toContainText('Embedding is disabled')
  await expect(page.locator('iframe')).toHaveCount(0)
  availability = 'UNAVAILABLE'
  await page.reload()
  await expect(page.locator('.player-fallback')).toContainText('private or removed')
  availability = 'UNKNOWN'
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Labeled error mock</title>' }))
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: `window.YT = { Player: function(frame, config) { this.destroy = () => frame.remove(); setTimeout(() => config.events.onError({ data: 153 }), 0); } }; window.onYouTubeIframeAPIReady();` }))
  await page.reload()
  await expect(page.getByText(/Player identity\/configuration failure/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry player' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(1)
})

for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
  test(`watch ${width}px: real HTML, mocked player, menu and accessible boundaries`, async ({ page }) => {
    test.skip(!slug, 'Set E2E_RECIPE_SLUG to a disposable published local recipe.')
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/v1/videos/*/neighbors/', route => route.fulfill({ json: { previous: null, next: null } }))
    await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Labeled player mock</title><button>Official controls mock</button>' }))
    await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: `window.YT = { Player: function(frame, config) { this.destroy = () => frame.remove(); this.pauseVideo = () => {}; setTimeout(() => config.events.onReady(), 0); } }; window.onYouTubeIframeAPIReady();` }))
    await page.goto(`/shorts/${slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText('Ready. Tap the official play button.')).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(1)
    await expect(page.locator('iframe')).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    const frame = await page.locator('iframe').boundingBox()
    const actions = await page.locator('.watch-actions').boundingBox()
    expect(frame.width).toBeGreaterThanOrEqual(200)
    expect(frame.height).toBeGreaterThanOrEqual(200)
    expect(actions.y >= frame.y + frame.height || actions.x >= frame.x + frame.width).toBe(true)
    await expect(page.getByRole('button', { name: 'Previous' })).toHaveAccessibleDescription('Newest recipe')
    await page.locator('summary').scrollIntoViewIfNeeded()
    await expect(page.locator('summary')).toBeInViewport()
    await page.locator('summary').click()
    await expect(page.getByRole('link', { name: 'Original link' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('details')).toHaveAttribute('open', '')
    await page.keyboard.press('Escape')
    await expect(page.locator('summary')).toBeFocused()
    await expect(page.locator('details')).not.toHaveAttribute('open', '')
    const darkTheme = page.getByRole('button', { name: 'Dark theme' })
    await darkTheme.scrollIntoViewIfNeeded()
    await expect(darkTheme).toBeInViewport()
    await darkTheme.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Light theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'System theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await noOverflow(page)
    await page.screenshot({ path: test.info().outputPath(`watch-${width}.png`), fullPage: true })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await noOverflow(page)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.locator('iframe')).toHaveCount(1)
  })
}
