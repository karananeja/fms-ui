import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Ports are overridable so parallel worktrees don't share (or reuse) each other's servers.
const vitePort = process.env.VITE_PORT ?? '5173';
const mockPort = process.env.MOCK_PORT ?? '4000';
const baseURL = `http://localhost:${vitePort}`;
/** Headless Chromium has no GPU: MapLibre's WebGL runs on SwiftShader (D-041). */
/** Signed-in super admin, written by the `setup` project (`e2e/auth.setup.ts`, F02). */
const storageState = fileURLToPath(new URL('./e2e/.auth/super-admin.json', import.meta.url));
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  workers: 2,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Reduced motion: no clicks on sliding sheets; the app honours it (src/index.css).
  // DS3 / D-118: a dark OS by default, so the System theme stays dark; theme specs override it.
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  },
  projects: [
    // Signs in once; every other project starts signed in (specs that sign out use a fresh context).
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
        reducedMotion: 'reduce',
        colorScheme: 'dark',
        storageState,
      },
      testIgnore: /\.(perf|clock)\.spec\.ts$/,
      dependencies: ['setup'],
    },
    // Perf budgets run alone, after everything else, so other tests don't skew them.
    {
      name: 'perf',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
        reducedMotion: 'reduce',
        colorScheme: 'dark',
        storageState,
      },
      testMatch: /\.perf\.spec\.ts$/,
      dependencies: ['chromium'],
      workers: 1,
    },
    // Specs that shift the shared mock clock run last, alone.
    {
      name: 'clock',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
        reducedMotion: 'reduce',
        colorScheme: 'dark',
        storageState,
      },
      testMatch: /\.clock\.spec\.ts$/,
      dependencies: ['perf'],
      workers: 1,
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    timeout: 60000,
    reuseExistingServer: true,
    // Offline map style; a reused `pnpm dev` keeps its own style (e2e/fixtures.ts stubs it).
    env: {
      VITE_MAP_STYLE_URL: '/map-styles/blank-dark.json',
      VITE_MAP_STYLE_URL_LIGHT: '/map-styles/blank-light.json',
      VITE_PORT: vitePort,
      MOCK_PORT: mockPort,
      // F18: a fresh in-memory database per e2e run.
      MOCK_DB: ':memory:',
      // F21: always the scripted fake model, whatever provider/key `.env` holds (set vars win
      // over `.env`; an empty provider counts as unset).
      FMS_ASSISTANT_FAKE: '1',
      FMS_ASSISTANT_PROVIDER: '',
      // F25: lets e2e save (fake) user keys; never a real secret.
      FMS_SECRET_KEY: 'e2e-secret-0123456789abcdef',
    },
  },
});
