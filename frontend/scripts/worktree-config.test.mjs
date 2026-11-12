import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, loadConfigFromFile } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { frontendConfig, port, localPath, root } from './worktree-config.mjs';

const frontendRoot = resolve(root, 'frontend');
async function viteConfig(value) {
  const previous = process.env.HORUS_FRONTEND_PORT;
  process.env.HORUS_FRONTEND_PORT = String(value);
  try {
    return (await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(frontendRoot, 'vite.config.ts'))).config;
  } finally {
    if (previous === undefined) delete process.env.HORUS_FRONTEND_PORT;
    else process.env.HORUS_FRONTEND_PORT = previous;
  }
}
function playwright(value, ci) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'scripts/fixtures/playwright.config.ts'], {
      cwd: frontendRoot, env: { ...process.env, HORUS_FRONTEND_PORT: String(value), CI: ci },
    });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('exit', code => resolveResult({ code, output }));
  });
}

test('padrão e validação estrita de portas', () => {
  assert.equal(frontendConfig({}).port, 1420);
  for (const raw of ['', '0', '-1', '65536', '1.5', ' 1432', '1432x', 'http://localhost:1432']) {
    assert.throws(() => port(raw, 1420, 'PORT'), /porta inteira/);
  }
  assert.equal(port('65535', 1420, 'PORT'), 65535);
  assert.throws(() => localPath('../outro-worktree'), /pertencer/);
});

test('recusa junction compartilhada sem modificar seu destino', () => {
  mkdirSync(resolve(frontendRoot, 'test-results'), { recursive: true });
  const external = mkdtempSync(resolve(tmpdir(), 'horus-external-'));
  const parent = mkdtempSync(resolve(frontendRoot, 'test-results/guard-'));
  const link = resolve(parent, 'shared');
  try {
    symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => localPath(link), /Link compartilhado/);
  } finally {
    rmSync(link, { force: true });
    rmSync(parent, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test('duas instâncias Vite e Playwright recusam servidor existente dentro e fora CI', async () => {
  mkdirSync(resolve(frontendRoot, 'test-results'), { recursive: true });
  const firstConfig = await viteConfig(1432);
  const secondConfig = await viteConfig(1434);
  for (const value of [1432, 1434]) {
    process.env.HORUS_FRONTEND_PORT = String(value);
    try {
      const { default: config } = await import(`../playwright.config.ts?port=${value}`);
      assert.equal(config.use.baseURL, `http://127.0.0.1:${value}`);
      assert.equal(config.webServer.url, config.use.baseURL);
      assert.equal(config.webServer.reuseExistingServer, false);
      assert.equal(config.outputDir, `./test-results/${value}`);
    } finally { delete process.env.HORUS_FRONTEND_PORT; }
  }
  assert.equal(firstConfig.server.port, 1432);
  assert.equal(secondConfig.server.port, 1434);
  assert.equal(firstConfig.server.strictPort, true);
  const servers = [];
  try {
    for (const config of [firstConfig, secondConfig]) {
      const server = await createServer({ ...config, root: frontendRoot, configFile: false });
      servers.push(server);
      await server.listen();
    }
    for (const value of [1432, 1434]) {
      assert.equal((await fetch(`http://127.0.0.1:${value}`)).status, 200);
    }
    const collision = await createServer({ ...firstConfig, root: frontendRoot, configFile: false });
    try { await assert.rejects(collision.listen(), /already in use/); }
    finally { await collision.close(); }
    for (const ci of ['', '1']) {
      const result = await playwright(1432, ci);
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /already used|already in use/);
    }
    assert.equal((await fetch('http://127.0.0.1:1434')).status, 200);
  } finally {
    await Promise.all(servers.map(server => server.close()));
  }
});

test('launcher valida entradas antes de iniciar processos', async () => {
  const { spawnSync } = await import('node:child_process');
  const token = 'isolated-launcher-test-token-123456789';
  for (const [overrides, pattern] of [
    [{ HORUS_BACKEND_PORT: '0' }, /HORUS_BACKEND_PORT/],
    [{ HORUS_FRONTEND_PORT: '1432x' }, /HORUS_FRONTEND_PORT/],
    [{ HORUS_FRONTEND_PORT: '1432', HORUS_BACKEND_PORT: '1432' }, /portas distintas/],
    [{ HORUS_API_TOKEN: '' }, /HORUS_API_TOKEN/],
    [{ HORUS_DATA_DIR: '../outside' }, /pertencer/],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/dev-backend.mjs'], {
      cwd: frontendRoot, encoding: 'utf8',
      env: { ...process.env, HORUS_API_TOKEN: token, HORUS_FRONTEND_PORT: '1432', HORUS_BACKEND_PORT: '8772', ...overrides },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
  }
});
