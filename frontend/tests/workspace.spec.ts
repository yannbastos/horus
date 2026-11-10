import { expect, test } from '@playwright/test';

test('preserva navegação, temas e organização nos tamanhos do desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Um novo olhar para criar.' })).toBeVisible();
  await expect(page.getByText('Integração pendente', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ABRIR PRODUÇÃO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
  await page.getByRole('button', { name: 'Histórico operacional', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cada produção deixa um registro.' })).toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sua mídia, em um lugar.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/overview-dark-1320.png', fullPage: true });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'CLARO', exact: true }).click();
  await page.reload();
  await expect(page.locator('.horus')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 1040, height: 680 });
  await page.screenshot({ path: 'test-results/overview-light-1040.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  await expect(page.getByRole('button', { name: 'CONSULTAR PERFIL' })).toBeDisabled();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ABRIR TRANSCRIÇÃO ATUAL' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('reproduz mídia local sem enviar o arquivo a serviços externos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  // WAV PCM curto e válido; o player também aceita áudio local.
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  await page.getByLabel('Selecionar mídia local').setInputFiles({ name: 'teste-local.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('heading', { name: 'teste-local.wav' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
});

test('verifica Hermes por ação explícita e atualiza o estado sem enviar prompts', async ({ page }) => {
  const requests: string[] = [];
  let authorized = true;
  const initial = { state: 'not_checked', connected: false, cli_available: true, configured: true,
    message: 'Conexão com a API ainda não verificada.', checked_at: null, version: null, features: [] };
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
      'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    requests.push(`${method} ${path}`);
    const body = path === '/health' ? { status: 'ready' }
      : path === '/v1/hermes' ? initial
      : path === '/v1/diagnostics' ? { checks: [], notice: 'Diagnóstico de teste.' }
      : path === '/v1/hermes/probe' ? { ...initial, state: authorized ? 'connected' : 'unauthorized', connected: authorized,
        message: authorized ? 'API autenticada verificada.' : 'O Hermes recusou a credencial local.',
        checked_at: '2026-11-10T12:00:00Z', version: authorized ? '0.23.1' : null, features: authorized ? ['run_submission'] : [] }
      : null;
    await route.fulfill({ status: body ? 200 : 404, headers, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Integração Hermes' });
  await expect(panel.getByText(initial.message)).toBeVisible();
  expect(requests).not.toContain('POST /v1/hermes/probe');
  await panel.getByRole('button', { name: 'VERIFICAR CONEXÃO HERMES', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Conexão autenticada verificada.' })).toBeVisible();
  await expect(page.locator('.integration')).toContainText('API verificada');
  authorized = false;
  await panel.getByRole('button', { name: 'VERIFICAR CONEXÃO HERMES', exact: true }).click();
  await expect(panel.getByText('O Hermes recusou a credencial local.')).toBeVisible();
  await expect(page.locator('.integration')).toContainText('CLI localizado');
  expect(requests.every(request => ['GET /health', 'GET /v1/hermes', 'GET /v1/diagnostics', 'POST /v1/hermes/probe'].includes(request))).toBe(true);
});
