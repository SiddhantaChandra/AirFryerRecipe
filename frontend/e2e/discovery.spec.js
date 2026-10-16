import { test, expect } from '@playwright/test'
import process from 'node:process'

const marker = process.env.E2E_PHASE4_MARKER
const resultsURL = '/?q=Phase4+QA'
const potato = `phase4-qa-potato-${marker}`
const paneer = `phase4-qa-paneer-${marker}`
test.beforeEach(async () => { test.skip(!marker, 'Set E2E_PHASE4_MARKER for disposable local QA recipes.') })

for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
  test(`Phase 4 ${width}px: real filters, themes, reflow and focus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(resultsURL)
    await expect(page.locator('.recipe-card')).toHaveCount(24)
    await expect(page.getByRole('searchbox', { name: 'Search recipes' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width < 1024) {
      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeFocused()
    } else await expect(page.getByRole('complementary', { name: 'Recipe filters' })).toBeVisible()
    for (const theme of ['Dark', 'Light']) {
      await page.getByRole('button', { name: `${theme} theme` }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'System theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: test.info().outputPath(`phase4-${width}.png`) })
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
    await expect(page.getByRole('contentinfo')).toBeInViewport()
  })
}

test('drawer drafts preview counts, Apply commits, Close cancels and focus stays trapped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(resultsURL)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /Vegetarian/ }).check()
  await expect(dialog.getByText('28 recipes with draft filters')).toBeVisible()
  await expect(page).toHaveURL(/\?q=Phase4\+QA$/)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /Vegetarian/ })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: /Vegetarian/ }).check()
  await dialog.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/diet=VEG/)
  await expect(page.locator('.result-count')).toContainText('of 28 recipes')
})

test('alias options, ingredient AND, selected persistence and custom cooking time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(resultsURL)
  const input = page.getByRole('searchbox', { name: 'Search ingredients' })
  await input.fill(`Aloo ${marker}`)
  await expect(page.getByRole('checkbox', { name: new RegExp(`Potato ${marker}`) })).toBeVisible()
  await page.getByRole('checkbox', { name: new RegExp(`Potato ${marker}`) }).check()
  await expect(page).toHaveURL(new RegExp(`ingredient=${potato}`))
  await input.fill(`Paneer ${marker}`)
  await page.getByRole('checkbox', { name: new RegExp(`Paneer ${marker}`) }).check()
  await expect(page.locator('.result-count')).toContainText('of 27 recipes')
  await input.fill('no-such-ingredient')
  await expect(page.getByRole('checkbox', { name: new RegExp(`Potato ${marker}`) })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: new RegExp(`Paneer ${marker}`) })).toBeChecked()
  await page.getByLabel('Custom minutes or less').fill('2.5')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('positive whole')
  await page.getByLabel('Custom minutes or less').fill('20')
  await page.getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page).toHaveURL(/max_time=20/)
  await expect(page.locator('.result-count')).toContainText('of 11 recipes')
  await expect(page.locator('.recipe-card').first()).toHaveAttribute('href', new RegExp(`ingredient=${paneer}`))
})

test('three pages, refresh, contextual steps and Back restore scroll and source card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(resultsURL)
  for (const count of [48, 55]) {
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(page.locator('.recipe-card')).toHaveCount(count)
  }
  const card = page.locator('.recipe-card').nth(37)
  await card.scrollIntoViewIfNeeded()
  const href = await card.getAttribute('href')
  const scroll = await page.evaluate(() => window.scrollY)
  await page.reload()
  await expect(page.locator('.recipe-card')).toHaveCount(55)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll)
  await card.click()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  for (let index = 0; index < 2; index++) {
    const previous = page.url()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page).not.toHaveURL(previous)
  }
  await page.getByRole('link', { name: 'Back to results', exact: true }).click()
  await expect(page.locator('.recipe-card')).toHaveCount(55)
  await expect(page.locator(`.recipe-card[href="${href}"]`)).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll)
})

test('new-tab context works without origin metadata and clean canonical sharing', async ({ page, context }) => {
  await page.goto(`${resultsURL}&diet=VEG`)
  const href = await page.locator('.recipe-card').first().getAttribute('href')
  const tab = await context.newPage()
  await tab.goto(href)
  await expect(tab.getByRole('link', { name: 'Back to results', exact: true })).toHaveAttribute('href', '/?q=Phase4+QA&diet=VEG')
  expect(await tab.locator('link[rel="canonical"]').getAttribute('href')).not.toContain('?')
  expect(await tab.locator('meta[property="og:url"]').getAttribute('content')).not.toContain('?')
  await tab.getByRole('link', { name: 'Back to results', exact: true }).click()
  await expect(tab).toHaveURL(/q=Phase4\+QA&diet=VEG/)
  await tab.close()
})

test('published outside context, selected zero counts and direct link defaults', async ({ page }) => {
  await page.goto(`${resultsURL}&diet=VEGAN&max_time=1`)
  await expect(page.getByRole('heading', { name: 'No recipes match' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Vegan/ })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: /Vegetarian/ })).toBeDisabled()
  await page.goto(`/shorts/phase4-qa-${marker}-000?diet=NON_VEG`)
  await expect(page.getByText(/no longer matches your search/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Phase4 QA')
  await page.goto(`/shorts/phase4-qa-${marker}-000`)
  await expect(page.getByRole('navigation', { name: 'Newest recipe navigation' })).toBeVisible()
})
