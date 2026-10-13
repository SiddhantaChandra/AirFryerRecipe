import { defineConfig } from '@playwright/test'
import process from 'node:process'

// Uses the already-running local Caddy preview or an explicitly selected Vite origin.
// This suite uses labeled catalog/player mocks; it never proves provider playback.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8090',
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
