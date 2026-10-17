// Real local auth/API checks shared by Playwright MCP inspection and the opt-in CLI suite.
// Uses disposable example.invalid accounts, no provider downloads or real personal data.
import { expect } from '@playwright/test'

export async function runAccountFlow(
  page,
  { baseURL, screenshotDir, prepareContext } = {},
) {
  const base = baseURL || new globalThis.URL(page.url()).origin
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const email = `phase5-${marker}@example.invalid`
  let password = `Mango!804-Crisp-${Math.random().toString(36).slice(2, 12)}`
  const passwords = [password]
  const browser = page.context().browser()
  const secondContext = await browser.newContext()
  if (prepareContext) await prepareContext(secondContext)
  const other = await secondContext.newPage()
  const errors = [],
    failedRequests = []
  for (const current of [page, other]) {
    current.on('pageerror', (error) => errors.push(error.message))
    current.on('requestfailed', (request) => {
      if (!request.failure()?.errorText.includes('ERR_ABORTED'))
        failedRequests.push(
          request.url().split('/').slice(3).join('/').split('?')[0],
        )
    })
  }
  const results = []
  async function login(current) {
    await current.goto(`${base}/login?next=%2Fsettings`)
    await current.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await current.getByLabel('Email', { exact: true }).fill(email)
    await current.getByLabel('Password', { exact: true }).fill(password)
    await current.getByRole('button', { name: 'Login', exact: true }).click()
    await current
      .getByRole('heading', { name: 'Settings', exact: true })
      .waitFor()
  }
  try {
    for (const route of ['login', 'signup']) {
      await page.goto(`${base}/${route}`)
      await page
        .getByRole('heading', {
          name: route === 'login' ? 'Welcome back' : 'Create your account',
        })
        .waitFor()
      for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        for (const theme of ['Light', 'Dark']) {
          await page
            .getByRole('button', { name: `${theme} theme`, exact: true })
            .click()
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            theme.toLowerCase(),
          )
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true)
        }
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%'
        })
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
        await page.evaluate(() => {
          document.documentElement.style.fontSize = ''
        })
        if (screenshotDir && [390, 1440].includes(width))
          await page.screenshot({
            path: `${screenshotDir}/${route}-${width}.png`,
            fullPage: true,
          })
      }
      results.push(`${route}: seven widths, Light/Dark and 200% reflow`)
    }
    await page.goto(`${base}/signup?next=%2Fsettings`)
    await page.getByRole('heading', { name: 'Create your account' }).waitFor()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click()
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
    results.push('signup establishes session and preserves safe return')
    await page
      .getByLabel('Name (optional)')
      .fill('रसोइया রাঁধুনি — A long recipe curator name')
    await page
      .getByRole('button', { name: 'Save profile', exact: true })
      .click()
    await page.getByText('Profile saved.', { exact: true }).waitFor()
    await page.reload()
    await expect(page.getByLabel('Name (optional)')).toHaveValue(
      'रसोइया রাঁধুনি — A long recipe curator name',
    )
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
      'readonly',
      '',
    )
    results.push('profile persistence, read-only email and refresh')

    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['Light', 'Dark']) {
        await page
          .getByRole('button', { name: `${theme} theme`, exact: true })
          .first()
          .click()
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          theme.toLowerCase(),
        )
        await expect
          .poll(async () =>
            (await page.request.get(`${base}/api/v1/me/`))
              .json()
              .then((user) => user.theme_preference),
          )
          .toBe(theme.toLowerCase())
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      }
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
      await page
        .getByRole('button', { name: 'System theme', exact: true })
        .first()
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect
        .poll(async () =>
          (await page.request.get(`${base}/api/v1/me/`))
            .json()
            .then((user) => user.theme_preference),
        )
        .toBe('system')
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      if (screenshotDir && [320, 390, 1440].includes(width))
        await page.screenshot({
          path: `${screenshotDir}/settings-${width}.png`,
          fullPage: true,
        })
      results.push(`${width}px: themes, reduced motion and 200% reflow`)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: 'Delete account', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
    expect(
      await page.evaluate(
        () => document.activeElement.closest('dialog') !== null,
      ),
    ).toBe(true)
    if (screenshotDir)
      await page.screenshot({
        path: `${screenshotDir}/delete-confirmation-390.png`,
      })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Delete account', exact: true }),
    ).toBeFocused()
    results.push('deletion dialog traps/restores focus and Escape cancels')

    await login(other)
    await page
      .getByRole('button', { name: 'Light theme', exact: true })
      .first()
      .click()
    await expect
      .poll(async () =>
        (await page.request.get(`${base}/api/v1/me/`))
          .json()
          .then((user) => user.theme_preference),
      )
      .toBe('light')
    await other.reload()
    await expect(
      other.getByRole('button', { name: 'Light theme', exact: true }).first(),
    ).toHaveAttribute('aria-pressed', 'true')
    results.push('theme persists across isolated browser sessions')

    await page.route('**/api/v1/me/', async (route) => {
      if (route.request().method() === 'PATCH')
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{}',
        })
      return route.continue()
    })
    await page
      .getByRole('button', { name: 'Dark theme', exact: true })
      .first()
      .click()
    await page
      .getByRole('button', { name: 'Retry theme save' })
      .first()
      .waitFor()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.unroute('**/api/v1/me/')
    await page.getByRole('button', { name: 'Retry theme save' }).first().click()
    await expect(
      page.getByRole('button', { name: 'Retry theme save' }),
    ).toHaveCount(0)
    results.push(
      'labeled 503 theme-save failure retains local theme and retries',
    )

    await page.getByLabel('Current password', { exact: true }).fill(password)
    const changed = `${password}-changed`
    passwords.push(changed)
    await page.getByLabel('New password', { exact: true }).fill(changed)
    await page.getByLabel('Confirm new password', { exact: true }).fill(changed)
    await page
      .getByRole('button', { name: 'Change password', exact: true })
      .click()
    await page
      .getByText('Password changed. Other sessions have been logged out.', {
        exact: true,
      })
      .waitFor()
    password = changed
    await other.reload()
    await other.getByRole('heading', { name: 'Welcome back' }).waitFor()
    results.push(
      'password change preserves current session and expires the other session',
    )
    await login(other)

    const publicResponse = await page.request.get(`${base}/api/v1/videos/`)
    expect(publicResponse.headers()['set-cookie']).toBeUndefined()
    expect(publicResponse.headers()['cache-control']).toBe(
      'public, max-age=0, must-revalidate',
    )
    for (const route of [
      '/settings',
      '/login',
      '/signup',
      '/_allauth/browser/v1/config',
      '/api/v1/auth/bootstrap/',
    ]) {
      const response = await page.request.get(`${base}${route}`)
      expect(response.headers()['cache-control']).toContain('no-store')
      expect(response.headers()['x-robots-tag']).toContain('noindex')
    }
    for (const route of [
      '/_allauth/browser/v1/account/email',
      '/_allauth/browser/v1/auth/password/request',
      '/_allauth/app/v1/auth/signup',
      '/accounts/login/',
    ]) {
      const response = await page.request.get(`${base}${route}`)
      expect(response.status()).toBe(404)
      expect(response.headers()['cache-control']).toContain('private')
    }
    results.push(
      'private headers, disabled routes and authenticated cookie-free public response',
    )

    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await page.waitForURL(`${base}/`)
    await page.getByRole('link', { name: 'Login', exact: true }).waitFor()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.goto(`${base}/settings`)
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await login(page)
    results.push('logout keeps browser theme and settings requires login')
    await page
      .getByRole('button', { name: 'Delete account', exact: true })
      .click()
    await page.getByLabel('Confirm with current password').fill(password)
    await page
      .getByRole('button', { name: 'Permanently delete account', exact: true })
      .click()
    await page
      .getByText('Your account has been deleted.', { exact: true })
      .waitFor()
    await other.reload()
    await other.getByRole('heading', { name: 'Welcome back' }).waitFor()
    results.push(
      'confirmed deletion announces success and revokes all sessions',
    )
    expect(errors).toEqual([])
    expect(failedRequests).toEqual([])
    return {
      results,
      pageErrors: errors,
      unexpectedFailedRequests: failedRequests,
    }
  } catch (error) {
    throw new Error(
      `Accounts check failed after: ${results.join('; ')}. ${error.message}`,
      { cause: error },
    )
  } finally {
    // Cleanup can log in with the current password if a check failed before deletion.
    const bootstrap = await other.request.get(`${base}/api/v1/auth/bootstrap/`)
    const token = (await bootstrap.json()).csrf_token
    for (const candidate of passwords) {
      const response = await other.request.post(
        `${base}/_allauth/browser/v1/auth/login`,
        {
          data: { email, password: candidate },
          headers: { 'X-CSRFToken': token },
        },
      )
      if (response.ok()) {
        password = candidate
        break
      }
    }
    const fresh = (
      await (await other.request.get(`${base}/api/v1/auth/bootstrap/`)).json()
    ).csrf_token
    await other.request.delete(`${base}/api/v1/me/`, {
      data: { password },
      headers: { 'X-CSRFToken': fresh },
    })
    await secondContext.close()
  }
}
