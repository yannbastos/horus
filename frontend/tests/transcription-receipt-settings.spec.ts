import { expect, test } from '@playwright/test';

// Regressão encontrada no Tauri real: ao reabrir com recibo pendente, a tela voltava para Small/Automático.
// Um novo Transcrever usaria outro modelo (possivelmente com download) sem o usuário perceber.
test('recibo pendente restaura modelo e idioma da tarefa original', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('horus.transcription.pending.v1', JSON.stringify({
      id: 'original-job', key: 'receipt-key', version: 2, previous: '', databaseId: 'test-db',
      payload: { operation: 'transcription.run', path: 'C:/midia/longa.wav', model: 'tiny', language: 'en' },
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'longa.wav' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true })).toHaveValue('tiny');
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('en');
});

// Regressão encontrada no Tauri real com banco migrado: abrir um resultado antigo dizia "Concluído em 00:00"
// e o histórico mostrava estados em inglês.
test('histórico mostra estados em português e resultado antigo não parece recém-executado', async ({ page }) => {
  const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
    'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  const done = { id: 'old-job', status: 'succeeded', attempt: 1, created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z',
    error: null, payload: { operation: 'transcription.run', path: 'C:/midia/antigo.mp3', model: 'tiny', language: 'en' },
    result: { text: 'Texto antigo.\n' } };
  const stopped = { ...done, id: 'stopped-job', status: 'interrupted', payload: { ...done.payload, path: 'C:/midia/parado.wav' } };
  let posts = 0;
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (route.request().method() === 'POST' && path === '/v1/jobs') posts++;
    const body = path === '/health' ? { status: 'ready', database_id: 'test-db' }
      : path === '/v1/transcription/jobs' ? [stopped, done]
      : path === '/v1/jobs/old-job' ? done
      : path === '/v1/transcription' ? { engine: true, downloader: true, ffmpeg: false }
      : path === '/v1/hermes' ? { connected: false, features: [], configured: false, cli_available: false }
      : { checks: [], notice: '' };
    await route.fulfill({ headers, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  const history = page.getByRole('region', { name: 'Histórico de transcrições e downloads' });
  await expect(history.getByRole('button', { name: /parado\.wav.*Interrompido/ })).toBeVisible();
  await history.getByRole('button', { name: /antigo\.mp3.*Concluído/ }).click();
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Texto antigo.\n');
  const status = page.locator('.status-bar p');
  await expect(status).toContainText('recuperada do histórico');
  await expect(status).not.toContainText('Concluído em');
  expect(posts).toBe(0);
});

test('sem recibo, os padrões continuam Small e detecção automática', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true })).toHaveValue('small');
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('auto');
});
