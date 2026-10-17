import { cpus, freemem } from 'node:os';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.ts', 'accessibility/**/*.spec.ts'],
  fullyParallel: true,
  /*
    Playwright sizes its worker pool at one per two cores, which counts cores
    and ignores memory. Every worker is a whole Chromium, and the `mobile`
    project runs a device-emulated context that composites more than the
    desktop one does, so two of them want more headroom than a 4-core/8GB
    machine with 2GB spare actually has.

    That shortfall is what the candidate-journey "flake" turned out to be.
    Five back-to-back runs at the default two workers failed every time, on
    `check()` giving up after 30s waiting for the discovery checkbox to be
    stable; five identical runs at one worker passed every time. Nothing on
    the page was moving. A thrashing machine simply could not produce two
    consecutive animation frames with an unchanged box, and Playwright cannot
    tell that apart from an element that is still animating.

    So size the pool by free memory instead, budgeting ~1.5GB per worker, and
    never exceed what the core-count default would have picked. A machine with
    room still runs in parallel; this one drops to a worker it can feed. CI
    keeps its retry for the runner variability we cannot measure from here.
  */
  workers: Math.max(1, Math.min(Math.floor(cpus().length / 2), Math.floor(freemem() / 1.5e9))),
  /*
    Per-test wall clock, sized to the machine for the same reason the worker
    pool is.

    Playwright's 30s default assumes a test's own work is what fills it. On a
    4-core box with under 2GB spare, running a static server and a
    device-emulated Chromium, a third of that can go to the machine before the
    page is interactive. Every failure seen here has been an element wait
    timing out, landing on a different test each run, which is starvation
    rather than a defect: a broken app fails these tests immediately and
    identically, not intermittently and somewhere new each time.

    This weakens no assertion. These specs are a functional gate, not a latency
    one — what the product must actually be fast at is measured against the
    deployed environment by docs/SLO.md and its probe, which has its own
    thresholds and its own evidence. A page that never renders still fails
    here, just after long enough to be sure it was the page and not the box.
  */
  timeout: freemem() < 3e9 ? 90_000 : 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
  /**
   * Never reuse a running server, locally or in CI.
   *
   * `reuseExistingServer: !process.env.CI` is the Playwright default and it
   * cost a real result here: a server left over from an earlier run answered
   * on 4173, so the `npm run build` in front of it never ran, and a suite
   * that should have failed on a changed match list passed against a build
   * from twenty minutes earlier. Nothing in the output said which build was
   * being tested.
   *
   * The price is one rebuild of each app per run, about thirty seconds
   * against a ten-minute suite. A green run that might be describing an old
   * artifact is not worth thirty seconds.
   *
   * `npm run demo:tour` deliberately does the opposite and expects a server
   * already up, because it photographs rather than asserts — see
   * scripts/demo-tour.mjs.
   */
  webServer: [
    {
      command: 'npm run build -w apps/web && node scripts/serve-static.mjs apps/web/out 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command:
        'npm run build -w apps/web-safe-shell && node scripts/serve-static.mjs apps/web-safe-shell/out 4174',
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
