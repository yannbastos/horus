import { expect, test } from '@playwright/test';

test('mostra recusa do render e só repete após uma ação explícita', async ({ page }) => {
  const reason = 'O comando encerrou com código 1. ERRO: caminho fora da pasta do vídeo';
  let submissions = 0;
  let retries = 0;
  const payload = { operation: 'factory.render.preview', channel_id: 'canal01', video_id: 'fixture' };
  const job = () => ({ id: 'render-refused', payload, attempt: retries + 1,
    status: retries ? 'succeeded' : 'failed', error: retries ? null : reason,
    result: retries ? { message: 'Render de rascunho concluído.' } : null,
    created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z' });
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
      'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (path === '/v1/jobs' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual(payload);
      submissions++;
      await route.fulfill({ status: 202, headers, json: job() }); return;
    }
    if (path.endsWith('/retry')) {
      expect(request.method()).toBe('POST'); retries++;
      await route.fulfill({ headers, json: job() }); return;
    }
    if (path.endsWith('/events')) {
      const events = [
        { sequence: 1, kind: 'stdout', message: retries ? 'Render de rascunho concluído.' : 'ERRO: caminho fora da pasta do vídeo' },
        { kind: 'complete', job: job() },
      ];
      await route.fulfill({ headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
        body: events.map(event => JSON.stringify(event)).join('\n') + '\n' }); return;
    }
    const body = path === '/health' ? { status: 'ready' }
      : path === '/v1/jobs' ? (submissions ? [job()] : [])
      : path === '/v1/hermes' ? { state: 'not_checked', connected: false, cli_available: false, configured: false, message: '', checked_at: null, version: null, features: [] }
      : path === '/v1/diagnostics' ? { checks: [], notice: '' } : null;
    await route.fulfill({ status: body ? 200 : 404, headers, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  await page.getByLabel('Vídeo para rascunho').fill('fixture');
  await page.getByRole('button', { name: 'RENDERIZAR RASCUNHO', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(reason);
  await expect(page.getByLabel('Logs da tarefa')).toContainText('ERRO: caminho fora da pasta do vídeo');
  expect(submissions).toBe(1);
  expect(retries).toBe(0);
  await page.getByRole('button', { name: 'TENTAR NOVAMENTE', exact: true }).click();
  await expect(page.locator('.job-details .tag')).toHaveText('Concluído');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(submissions).toBe(1);
  expect(retries).toBe(1);
});

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
  await expect(page.getByRole('heading', { name: /Áudio e vídeo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/transcription-light-1040.png' });
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

test('transcreve a fila, exige salvar antes de avançar e preserva o estado entre telas', async ({ page }) => {
  const submitted: { path: string; model: string; language: string }[] = [];
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
      'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (path === '/v1/jobs' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      submitted.push(payload);
      await route.fulfill({ status: 202, headers, json: { id: `job${submitted.length}`, status: 'queued', attempt: 0, payload, error: null, result: null } });
      return;
    }
    const events = path.match(/^\/v1\/jobs\/(job\d+)\/events$/);
    if (events) {
      const payload = submitted[Number(events[1].slice(3)) - 1];
      const name = payload.path.split(/[\\/]/).pop();
      const lines = [
        { sequence: 1, kind: 'status', message: 'Transcrevendo...' },
        { sequence: 2, kind: 'segment', message: `Texto de ${name}.` },
        { sequence: 3, kind: 'progress', message: '100' },
        { kind: 'complete', job: { id: events[1], status: 'succeeded', attempt: 1, payload, error: null, result: { text: `Texto de ${name}.\n` } } },
      ];
      await route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/x-ndjson' }, body: lines.map(line => JSON.stringify(line)).join('\n') + '\n' });
      return;
    }
    const body = path === '/health' ? { status: 'ready' }
      : path === '/v1/hermes' ? { state: 'not_checked', connected: false, cli_available: false, configured: false, message: '', checked_at: null, version: null, features: [] }
      : path === '/v1/diagnostics' ? { checks: [], notice: '' }
      : path === '/v1/transcription' ? { engine: true, downloader: true, ffmpeg: false }
      : null;
    await route.fulfill({ status: body ? 200 : 404, headers, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  for (const file of ['C:/midia/primeiro.mp3', 'C:/midia/segundo.mp4']) {
    await page.getByLabel('Caminho local do arquivo').fill(file);
    await page.getByRole('button', { name: 'ADICIONAR À FILA', exact: true }).click();
  }
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('2/20');
  await page.getByLabel('Modelo').selectOption('tiny');
  await page.getByLabel('Idioma').selectOption('pt');
  await page.getByRole('button', { name: 'TRANSCREVER', exact: true }).click();
  const transcript = page.getByRole('textbox', { name: 'Transcrição', exact: true });
  await expect(transcript).toHaveValue('Texto de primeiro.mp3.\n');
  expect(submitted[0]).toEqual({ operation: 'transcription.run', path: 'C:/midia/primeiro.mp3', model: 'tiny', language: 'pt' });
  const next = page.getByRole('button', { name: 'PRÓXIMO VÍDEO', exact: true });
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(transcript).toHaveValue('Texto de primeiro.mp3.\n');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SALVAR .TXT', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('primeiro.txt');
  await expect(next).toBeEnabled();
  await transcript.fill('Texto revisado.');
  await expect(next).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Texto editado' })).toBeVisible();
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SALVAR .TXT', exact: true }).click();
  await second;
  await next.click();
  await expect(page.getByRole('heading', { name: 'segundo.mp4' })).toBeVisible();
  await expect(transcript).toHaveValue('Texto de segundo.mp4.\n');
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('1/20');
  const downloadButton = page.getByRole('button', { name: 'BAIXAR E ADICIONAR À FILA' });
  await expect(downloadButton).toBeDisabled();
  await page.getByLabel('Link do YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(downloadButton).toBeEnabled();
  await page.screenshot({ path: 'test-results/transcription-flow-1320.png' });
});
