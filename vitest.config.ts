import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      environment: 'jsdom',
      testTimeout: 5000,
      hookTimeout: 10000,
      include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'mock-server/**/*.test.ts'],
      setupFiles: ['./src/test-setup.ts'],
      restoreMocks: true,
    },
  }),
);
