import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { frontendConfig } from './scripts/worktree-config.mjs';

const environment = frontendConfig();
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: environment.port, strictPort: true },
  preview: { host: '127.0.0.1', port: environment.port, strictPort: true },
  build: { target: 'es2022' },
});
