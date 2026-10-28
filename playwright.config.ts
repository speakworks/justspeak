import { defineConfig } from '@playwright/test'

/**
 * Electron shell E2E. Run with `pnpm e2e` (builds first).
 *
 * This config is intentionally separate from Vitest: `pnpm test` stays
 * model-, Electron-, and Playwright-free. `JUSTSPEAK_E2E=0 pnpm e2e` skips the
 * suite on machines without a usable Electron/GUI session.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Electron apps contend for the global hotkey and the macOS clipboard; two
  // concurrent launches would make both flaky.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: { trace: 'off' }
})
