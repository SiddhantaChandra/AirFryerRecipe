import { test } from '@playwright/test'
import process from 'node:process'
import { runCookbookFlow } from './cookbooks-flow'

test('Likes and private Cookbooks with actual local accounts and APIs', async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.E2E_COOKBOOKS,
    'Requires the three labeled local Phase 6 catalog fixtures.',
  )
  test.setTimeout(180000)
  await runCookbookFlow(page, {
    baseURL,
    prepareContext: async (context) => {
      // CLI environment may block external fonts; MCP inspections use real fonts.
      await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ contentType: 'text/css', body: '' }),
      )
    },
  })
})
