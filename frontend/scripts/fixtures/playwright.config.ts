import config from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { localPath } from '../worktree-config.mjs';
export default defineConfig({
  ...config, testDir: '.', reporter: 'line',
  outputDir: localPath(`frontend/test-results/config-${new URL(config.use!.baseURL!).port}`),
});
