import { defineConfig } from '@playwright/test';
import { frontendConfig } from './scripts/worktree-config.mjs';

const environment = frontendConfig();
export default defineConfig({
  testDir: './tests',
  outputDir: `./test-results/${environment.port}`,
  workers: 1,
  use: { baseURL: environment.origin, channel: 'msedge', viewport: { width: 1320, height: 840 } },
  webServer: { command: 'npm run dev', url: environment.origin, reuseExistingServer: false },
});
