/**
 * Playtests: the real app, driven like a player in headless Chromium against the running dev server
 * (http://localhost:5173 — start it with `npm run dev`; the tests never start or stop it).
 *
 *   npm run playtest              # everything
 *   npm run playtest -- rooms     # one spec file
 *
 * Each worker plays as its own demo member (tests/e2e/.auth/bot-N.json, created once and reused).
 * Screenshots land in art/review/playtest/; bugs go to docs/playtest.md.
 */
import { defineConfig } from '@playwright/test';
import { TAG } from './tests/e2e/global-setup';

export const WORKERS = 4;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: `art/review/playtest/_results${TAG}`,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // the dev server restarts whenever its code is edited; a run can be caught mid-restart
  retries: 1,
  workers: WORKERS,
  reporter: [['list'], ['json', { outputFile: `art/review/playtest/results${TAG}.json` }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    // PLAYTEST_URL=http://localhost:5190 plays the no-HMR review server (vite.review.config.ts): nobody's save reloads it mid-test
    baseURL: process.env.PLAYTEST_URL ?? 'http://localhost:5173',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
