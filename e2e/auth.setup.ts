import { test as setup } from '@playwright/test';
import { saveSignedInState } from './fixtures.ts';

// F02: one sign-in for the chromium, perf and clock projects (they load its storageState).
setup('sign in as the seeded super admin', async ({ baseURL }) => {
  await saveSignedInState(baseURL!);
});
