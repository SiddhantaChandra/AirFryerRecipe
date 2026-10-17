import { test, expect } from '@playwright/test'
import process from 'node:process'
import { runAccountFlow } from './accounts-flow'

test('real local Accounts lifecycle with external font/thumbnail fixtures', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ACCOUNTS !== '1',
    'Opt in to disposable local account creation with E2E_ACCOUNTS=1.',
  )
  test.setTimeout(180000)
  // CLI environments may deny outbound font/image requests. Account/session APIs
  // remain real; font rendering and source imagery are inspected separately in MCP.
  const prepareContext = async (context) => {
    await context.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: '' }),
    )
    await context.route('https://i.ytimg.com/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />',
      }),
    )
  }
  await prepareContext(page.context())
  const result = await runAccountFlow(page, { baseURL, prepareContext })
  expect(result.results.length).toBeGreaterThan(15)
})
