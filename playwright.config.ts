import { defineConfig } from '@playwright/test';

// The suite calls the mern-records API of an app that is already up. It
// starts no server of its own and opens no browser.
export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://127.0.0.1:5050',
  },
});
