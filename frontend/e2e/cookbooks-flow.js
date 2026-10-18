// Real local account/activity APIs. Provider imagery and the synthetic fixture's
// player are mocked. This does not establish provider playback or deployed CSP.
import { expect } from '@playwright/test'

export async function prepareCookbookContext(context) {
  await context.route('https://i.ytimg.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#c9754d"/><text x="40" y="180" fill="white" font-size="30">Synthetic QA image</text></svg>',
    }),
  )
  await context.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.YT={Player:function(el,o){let f=document.createElement("iframe");f.title="Mock official player";el.replaceWith(f);this.destroy=()=>f.remove();this.pauseVideo=()=>{};this.playVideo=()=>{};this.getPlayerState=()=>2;setTimeout(()=>o.events.onReady({target:this}),0)}};window.onYouTubeIframeAPIReady?.();',
    }),
  )
}

export async function activityRequest(page, path, method = 'GET', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = await fetch('/api/v1/auth/bootstrap/', {
        cache: 'no-store',
      }).then((r) => r.json())
      const response = await fetch(path, {
        method,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrf.csrf_token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
        cache: response.headers.get('cache-control'),
      }
    },
    { path, method, body },
  )
}

export async function runCookbookFlow(
  page,
  { baseURL, screenshotDir, prepareContext } = {},
) {
  const base = baseURL || new globalThis.URL(page.url()).origin
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const password = `Crisp!915-Mango-${marker}`
  const email = `phase6-${marker}@example.invalid`
  const otherEmail = `phase6-other-${marker}@example.invalid`
  const context = page.context()
  const sameContext = await context.browser().newContext()
  const foreignContext = await context.browser().newContext()
  const touchContext = await context.browser().newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const contexts = [context, sameContext, foreignContext, touchContext]
  for (const current of contexts) {
    await prepareCookbookContext(current)
    if (prepareContext) await prepareContext(current)
  }
  const same = await sameContext.newPage(),
    foreign = await foreignContext.newPage(),
    touch = await touchContext.newPage()
  const errors = [],
    failures = [],
    results = []
  for (const current of [page, same, foreign, touch]) {
    current.on('pageerror', (error) => errors.push(error.message))
    current.on('requestfailed', (request) => {
      if (!request.failure()?.errorText.includes('ERR_ABORTED'))
        failures.push(request.url().split('?')[0])
    })
  }
  async function login(current, identity = email, next = '/cookbooks') {
    await current.goto(`${base}/login?next=${encodeURIComponent(next)}`)
    await current.getByLabel('Email', { exact: true }).fill(identity)
    await current.getByLabel('Password', { exact: true }).fill(password)
    await current.getByRole('button', { name: 'Login', exact: true }).click()
    await current.waitForURL((url) => url.pathname === next.split('#')[0])
  }
  async function signup(current, identity) {
    await current.goto(`${base}/signup?next=%2Fcookbooks`)
    await current.getByLabel('Email', { exact: true }).fill(identity)
    await current.getByLabel('Password', { exact: true }).fill(password)
    await current.getByLabel('Confirm password', { exact: true }).fill(password)
    await current
      .getByRole('button', { name: 'Create account', exact: true })
      .click()
    await current
      .getByRole('heading', { name: 'My Cookbooks', exact: true })
      .waitFor()
  }
  async function widths(current, name) {
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      await current.setViewportSize({ width, height: 900 })
      for (const theme of ['Light', 'Dark', 'System']) {
        await current
          .getByRole('button', { name: `${theme} theme`, exact: true })
          .click()
        expect(
          await current.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      }
      await current.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      expect(
        await current.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await current.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      if (screenshotDir && [390, 1440].includes(width))
        await current.screenshot({
          path: `${screenshotDir}/${name}-${width}.png`,
          fullPage: true,
        })
    }
    results.push(`${name}: seven widths, three themes and 200% reflow`)
  }
  let mainCreated = false,
    otherCreated = false
  try {
    // Begin anonymous even if the interactive MCP page already has a session.
    await page.goto(`${base}/login`)
    await activityRequest(
      page,
      '/_allauth/browser/v1/auth/session',
      'DELETE',
      {},
    )
    await page.goto(`${base}/shorts/phase6-qa-recipe-1`)
    const recipe = await activityRequest(
      page,
      '/api/v1/videos/phase6-qa-recipe-1/',
    )
    expect(recipe.status).toBe(200)
    const video = recipe.body
    await page.getByRole('button', { name: /Like in this application/ }).click()
    await expect(page.getByRole('dialog')).toContainText('After login')
    await page.getByRole('link', { name: 'Continue to login' }).click()
    await page.getByRole('link', { name: 'Create an account' }).click()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: 'Confirm application like' })
      .waitFor()
    mainCreated = true
    expect(
      (await activityRequest(page, `/api/v1/me/video-state/?ids=${video.id}`))
        .body.results[video.id].liked,
    ).toBe(false)
    await page
      .getByRole('button', { name: 'Confirm Like', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: /Unlike in this application/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    results.push(
      'anonymous Like returns through signup, fetches state and waits for explicit confirmation',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await widths(page, 'watch')
    expect(await page.locator('iframe').count()).toBe(1)
    const actions = await page
      .locator('.watch-actions > button, .watch-actions > details > summary')
      .allTextContents()
    expect(actions.slice(0, 4).join('|')).toMatch(
      /Liked.*Add to Cookbook.*Share.*More/,
    )
    await page
      .getByRole('button', { name: 'Add to Cookbook', exact: true })
      .click()
    await page
      .getByLabel('New Cookbook name')
      .fill('Weeknight आलू আলু · A long private recipe collection')
    await page
      .getByRole('button', { name: 'Create Cookbook', exact: true })
      .click()
    await page.getByRole('checkbox', { name: /Weeknight/ }).waitFor()
    await expect(
      page.getByRole('checkbox', { name: /Weeknight/ }),
    ).not.toBeChecked()
    await page.getByRole('checkbox', { name: /Weeknight/ }).check()
    await page.getByLabel('New Cookbook name').fill('Snacks')
    await page
      .getByRole('button', { name: 'Create Cookbook', exact: true })
      .click()
    await page.getByRole('checkbox', { name: /Snacks/ }).check()
    if (screenshotDir)
      await page.screenshot({
        path: `${screenshotDir}/save-dialog.png`,
        fullPage: true,
      })
    await page
      .getByRole('button', { name: 'Apply memberships', exact: true })
      .click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page
      .getByRole('button', { name: 'Add to Cookbook', exact: true })
      .click()
    await expect(
      page.getByRole('checkbox', { name: /Weeknight/ }),
    ).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /Snacks/ })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Add to Cookbook', exact: true }),
    ).toBeFocused()
    results.push(
      'save dialog creates explicitly, persists multiple memberships and restores focus on Escape',
    )
    const library = await activityRequest(page, '/api/v1/cookbooks/')
    const first = library.body.results.find((book) =>
      book.name.startsWith('Weeknight'),
    )
    const path = `/api/v1/cookbooks/${first.id}/`
    // A labeled 503 on one membership must not undo a successful removal.
    await page
      .getByRole('button', { name: 'Add to Cookbook', exact: true })
      .click()
    await page.getByRole('checkbox', { name: /Weeknight/ }).uncheck()
    await page.getByRole('checkbox', { name: /Snacks/ }).uncheck()
    const second = library.body.results.find((book) => book.name === 'Snacks')
    const failureURL = `${base}/api/v1/cookbooks/${second.id}/items/${video.id}/`
    await page.route(
      failureURL,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Labeled QA failure' }),
        }),
      { times: 1 },
    )
    await page
      .getByRole('button', { name: 'Apply memberships', exact: true })
      .click()
    await expect(page.getByRole('alert')).toContainText('1 changes saved.')
    await expect(
      page.getByRole('checkbox', { name: /Weeknight/ }),
    ).not.toBeChecked()
    await page
      .getByRole('button', { name: 'Apply memberships', exact: true })
      .click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page
      .getByRole('button', { name: 'Add to Cookbook', exact: true })
      .click()
    await page.getByRole('checkbox', { name: /Weeknight/ }).check()
    await page.getByRole('checkbox', { name: /Snacks/ }).check()
    await page
      .getByRole('button', { name: 'Apply memberships', exact: true })
      .click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    results.push(
      'labeled partial membership failure preserves successful writes and retry reconciles server truth',
    )
    for (const theme of ['Light', 'Dark', 'System']) {
      await page
        .getByRole('button', { name: `${theme} theme`, exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Add to Cookbook', exact: true })
        .click()
      await page.getByRole('checkbox', { name: /Weeknight/ }).waitFor()
      for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%'
        })
        expect(
          await page
            .getByRole('dialog')
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true)
        await page.evaluate(() => {
          document.documentElement.style.fontSize = ''
        })
        if (screenshotDir && width === 320)
          await page.screenshot({
            path: `${screenshotDir}/save-${theme.toLowerCase()}-320.png`,
            fullPage: true,
          })
      }
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        expect(
          await page
            .getByRole('dialog')
            .evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true)
      }
      await page.keyboard.press('Escape')
    }
    results.push(
      'save dialog: seven widths, all themes, 200% reflow and trapped keyboard focus',
    )
    for (const suffix of [2, 3]) {
      const v = (
        await activityRequest(
          page,
          `/api/v1/videos/phase6-qa-recipe-${suffix}/`,
        )
      ).body
      expect(
        (
          await activityRequest(page, path + 'items/', 'POST', {
            video_id: v.id,
          })
        ).status,
      ).toBe(200)
    }
    await page.goto(`${base}/cookbooks`)
    await widths(page, 'library')
    await page.getByRole('link', { name: /Weeknight/ }).click()
    await expect(
      page.getByText('3 saved recipes', { exact: true }),
    ).toBeVisible()
    await widths(page, 'detail')
    await page
      .getByRole('button', {
        name: 'Move down recipe at position 1',
        exact: true,
      })
      .click()
    await expect(
      page.getByText('Recipe moved to position 2 of 3.', { exact: true }),
    ).toBeVisible()
    let current = (await activityRequest(page, path)).body
    expect(current.items[1].video_id).toBe(video.id)
    const start = page.getByRole('button', {
      name: 'Reorder recipe at position 1',
      exact: true,
    })
    const end = page.locator('[data-saved-video]').nth(2)
    await start.dragTo(end)
    await expect(
      page.getByText('Recipe moved to position 3 of 3.', { exact: true }),
    ).toBeVisible()
    results.push(
      'button and pointer drag reorder persist with position announcements',
    )
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page
      .getByLabel('Name', { exact: true })
      .fill('Renamed आलू আলু collection')
    await page
      .getByRole('button', { name: 'Save Cookbook', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Renamed आलू আলু collection', exact: true })
      .waitFor()
    await page.reload()
    await expect(
      page.getByRole('heading', {
        name: 'Renamed आलू আলু collection',
        exact: true,
      }),
    ).toBeVisible()
    const documentResponse = await page.request.get(
      `${base}/cookbooks/${first.id}`,
    )
    expect(documentResponse.headers()['cache-control']).toContain('no-store')
    expect(documentResponse.headers()['x-robots-tag']).toContain('noindex')
    results.push(
      'rename, refresh, direct detail routing and private non-indexable HTML',
    )
    await login(same)
    expect((await activityRequest(same, path)).body.count).toBe(3)
    await signup(foreign, otherEmail)
    otherCreated = true
    const foreignList = await activityRequest(foreign, '/api/v1/cookbooks/')
    expect(foreignList.body.results).toHaveLength(0)
    for (const [method, endpoint, body] of [
      ['GET', path],
      ['PATCH', path, { name: 'Intruder' }],
      ['DELETE', path, {}],
      ['POST', path + 'items/', { video_id: video.id }],
      ['DELETE', path + `items/${video.id}/`, {}],
      ['PATCH', path + 'reorder/', { video_ids: [] }],
    ]) {
      const denied = await activityRequest(foreign, endpoint, method, body)
      expect(denied.status).toBe(404)
      expect(denied.cache).toContain('private')
    }
    expect(
      (
        await activityRequest(
          foreign,
          `/api/v1/me/video-state/?ids=${video.id}`,
        )
      ).body.results[video.id].cookbook_ids,
    ).toEqual([])
    results.push(
      'isolated second user denied every foreign detail/nested mutation; second same-user session sees persistence',
    )
    await login(touch)
    await touch.goto(`${base}/shorts/phase6-qa-recipe-1`)
    await expect(
      touch.getByRole('button', { name: 'Add to Cookbook', exact: true }),
    ).toBeEnabled()
    await touch
      .getByRole('button', { name: 'Add to Cookbook', exact: true })
      .tap()
    await expect(touch.getByRole('checkbox', { name: /Renamed/ })).toBeChecked()
    await touch.getByRole('button', { name: 'Close', exact: true }).tap()
    results.push('390px touch session loads and taps current membership dialog')
    await touch.goto(`${base}/cookbooks/${first.id}`)
    const touchHandle = touch.getByRole('button', { name: 'Reorder recipe at position 1', exact: true })
    await touchHandle.waitFor()
    await touchHandle.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 100))
    const touchStart = await touchHandle.boundingBox()
    const touchEnd = await touch.locator('[data-saved-video]').nth(1).boundingBox()
    const cdp = await touchContext.newCDPSession(touch)
    const startPoint = { x: touchStart.x + touchStart.width / 2, y: touchStart.y + touchStart.height / 2 }
    const endPoint = { x: touchEnd.x + touchEnd.width / 2, y: Math.min(800, touchEnd.y + 30) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [startPoint] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [endPoint] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(touch.getByText('Recipe moved to position 2 of 3.', { exact: true })).toBeVisible()
    await cdp.detach()
    results.push('real touch events on the drag handle persist reorder at 390px')
    // A second same-user session removes one reference; focus return revalidates.
    current = (await activityRequest(same, path)).body
    await activityRequest(
      same,
      path + `items/${current.items[0].video_id}/`,
      'DELETE',
      {},
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(
      page.getByText('2 saved recipes', { exact: true }),
    ).toBeVisible()
    results.push('same-user second-session removal revalidates on focus')
    // Hold a real private read while the same SPA logs out and switches owner.
    let releaseRead, readStarted
    const held = new Promise((resolve) => {
      releaseRead = resolve
    })
    const started = new Promise((resolve) => {
      readStarted = resolve
    })
    const privateURL = `${base}${path}`
    const delay = async (route) => {
      const response = await route.fetch()
      readStarted()
      await held
      await route.fulfill({ response }).catch(() => {})
    }
    await page.route(privateURL, delay)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await started
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Welcome back', exact: true })
      .waitFor()
    await login(page, otherEmail)
    releaseRead()
    await page.unroute(privateURL, delay)
    await page
      .getByText('Keep recipes you want to cook', { exact: true })
      .waitFor()
    expect(await page.locator('main').innerText()).not.toContain(
      'Renamed आलू আলু collection',
    )
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await login(page, email, `/cookbooks/${first.id}`)
    await page
      .getByRole('heading', { name: 'Renamed आलू আলু collection', exact: true })
      .waitFor()
    results.push(
      'held real private response is discarded across logout and account switch in the SPA',
    )
    await page
      .getByRole('button', { name: 'Delete Cookbook', exact: true })
      .click()
    await page.keyboard.press('Escape')
    expect((await activityRequest(page, path)).status).toBe(200)
    await page
      .getByRole('button', { name: 'Delete Cookbook', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Confirm Delete Cookbook', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'My Cookbooks', exact: true })
      .waitFor()
    expect((await activityRequest(page, path)).status).toBe(404)
    expect(
      (await activityRequest(page, `/api/v1/me/video-state/?ids=${video.id}`))
        .body.results[video.id].liked,
    ).toBe(true)
    results.push(
      'delete cancellation preserves collection; confirmed deletion preserves likes and other membership',
    )
    await page.goto(`${base}/settings`)
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
    mainCreated = false
    expect((await activityRequest(same, '/api/v1/cookbooks/')).status).toBe(401)
    await page.goBack()
    await expect(
      page.getByRole('heading', { name: 'Welcome back', exact: true }),
    ).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain(
      'Renamed आलू আলু collection',
    )
    results.push(
      'confirmed account deletion revokes second session and Back cannot restore private collections',
    )
    expect(errors).toEqual([])
    expect(failures).toEqual([])
    return {
      results,
      pageErrors: errors,
      unexpectedFailedRequests: failures,
      mocked:
        'provider imagery and synthetic player; one labeled membership 503; actual account/activity APIs',
    }
  } finally {
    if (mainCreated)
      await activityRequest(page, '/api/v1/me/', 'DELETE', { password }).catch(
        () => {},
      )
    if (otherCreated)
      await activityRequest(foreign, '/api/v1/me/', 'DELETE', {
        password,
      }).catch(() => {})
    await sameContext.close()
    await foreignContext.close()
    await touchContext.close()
  }
}
