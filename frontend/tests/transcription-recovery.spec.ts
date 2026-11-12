import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const payload = { operation: 'transcription.run', path: 'C:/midia/recuperar.wav', model: 'tiny', language: 'pt' };
const headers = { 'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const job = (status = 'running', text = 'Primeira frase.\n') => ({ id: 'original-job', payload, status, attempt: 1,
  created_at: '2026-11-11T12:00:00Z', updated_at: '2026-11-11T12:00:00Z', error: null,
  result: { text, partial: status !== 'succeeded', sequence: 8 } });

async function fixture(page: Page, handler: (route: Route, path: string) => Promise<boolean>) {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (await handler(route, path)) return;
    const body = path === '/health' ? { status: 'ready', database_id: 'test-db' }
      : path === '/v1/hermes' ? { connected: false, features: [], configured: false, cli_available: false }
      : path === '/v1/transcription' ? { engine: true, downloader: true, ffmpeg: false }
      : path === '/v1/transcription/jobs' ? [] : { checks: [], notice: '' };
    await route.fulfill({ headers, json: body });
  });
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
}

async function submit(page: Page) {
  await page.getByLabel('Caminho local do arquivo').fill(payload.path);
  await page.getByRole('button', { name: 'ADICIONAR À FILA', exact: true }).click();
  await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('tiny');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('pt');
  await page.getByRole('button', { name: 'TRANSCREVER', exact: true }).click();
}

test('resposta perdida reutiliza a chave após recarregar sem duplicar a execução', async ({ page }) => {
  const keys: string[] = [];
  let executions = 0;
  await fixture(page, async (route, path) => {
    if (path !== '/v1/jobs' || route.request().method() !== 'POST') return false;
    keys.push(route.request().headers()['idempotency-key']);
    if (!executions) { executions++; await route.abort('failed'); }
    else await route.fulfill({ status: 202, headers, json: job('succeeded', 'Resultado original.\n') });
    return true;
  });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeDisabled();
  await page.reload(); await connect(page);
  expect(keys).toHaveLength(1); // Reabrir não submete automaticamente.
  await page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' }).click();
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Resultado original.\n');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(executions).toBe(1);
});

test('stream interrompido mantém o job original e cursor sem duplicar trechos', async ({ page }) => {
  let posts = 0;
  let done = false;
  const cursors: string[] = [];
  await fixture(page, async (route, path) => {
    if (path === '/v1/jobs' && route.request().method() === 'POST') {
      posts++; await route.fulfill({ status: 202, headers, json: job() }); return true;
    }
    if (path === '/v1/jobs/original-job') {
      await route.fulfill({ headers, json: job(done ? 'succeeded' : 'running', done ? 'Primeira frase.\nSegunda frase.\n' : 'Primeira frase.\n') });
      return true;
    }
    if (path.endsWith('/events')) {
      cursors.push(new URL(route.request().url()).searchParams.get('after') ?? '');
      // A fonte repete uma linha antiga de propósito: não deve duplicar o checkpoint.
      await route.fulfill({ headers, body: cursors.length === 1
        ? JSON.stringify({ sequence: 8, kind: 'segment', message: 'Primeira frase.' }) + '\n' : '' });
      return true;
    }
    return false;
  });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Primeira frase.\n');
  expect(cursors).toEqual(['8', '8', '8']);
  await page.reload(); await connect(page);
  done = true;
  await page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' }).click();
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Primeira frase.\nSegunda frase.\n');
  expect(posts).toBe(1);
});

test('histórico recupera parcial interrompido e download sem executar novamente', async ({ page }) => {
  let posts = 0;
  const download = { ...job('succeeded'), id: 'download-job', payload: { operation: 'youtube.download',
    url: 'https://youtu.be/dQw4w9WgXcQ', directory: 'C:/midia' }, result: { path: 'C:/midia/baixado.mp4' } };
  await fixture(page, async (route, path) => {
    if (path === '/v1/jobs' && route.request().method() === 'POST') { posts++; return false; }
    if (path === '/v1/transcription/jobs') {
      await route.fulfill({ headers, json: [job('interrupted'), download] }); return true;
    }
    if (path === '/v1/jobs/original-job' || path === '/v1/jobs/download-job') {
      await route.fulfill({ headers, json: path.endsWith('download-job') ? download : job('interrupted') }); return true;
    }
    return false;
  });
  await page.goto('/'); await connect(page);
  await page.getByLabel('Caminho local do arquivo').fill('C:/midia/ainda-nao-submetido.mp3');
  await page.getByRole('button', { name: 'ADICIONAR À FILA', exact: true }).click();
  await page.getByRole('button', { name: /recuperar.wav.*Interrompido/ }).click();
  const text = page.getByRole('textbox', { name: 'Transcrição', exact: true });
  await expect(text).toHaveValue('Primeira frase.\n');
  await expect(page.getByLabel('Fila de transcrição')).toContainText('ainda-nao-submetido.mp3');
  await expect(page.getByRole('button', { name: 'PRÓXIMO VÍDEO', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Download YouTube.*Concluído/ }).click();
  await expect(text).toHaveValue('Primeira frase.\n');
  await expect(page.getByRole('status').filter({ hasText: 'Salve o texto atual' })).toBeVisible();
  await page.getByRole('button', { name: 'SALVAR .TXT', exact: true }).click();
  await page.getByRole('button', { name: /Download YouTube.*Concluído/ }).click();
  await expect(page.getByLabel('Fila de transcrição')).toContainText('baixado.mp4');
  expect(posts).toBe(0);
});

test('pedido recusado por validação libera correção sem deixar execução desconhecida', async ({ page }) => {
  await fixture(page, async (route, path) => {
    if (path !== '/v1/jobs' || route.request().method() !== 'POST') return false;
    await route.fulfill({ status: 422, headers, json: { detail: 'Pedido inválido' } });
    return true;
  });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('status').filter({ hasText: 'Pedido recusado' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('horus.transcription.pending.v1'))).toBeNull();
});

test('desktop oferece reconexão nativa e limpa o erro inicial sem pedir token manual', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { recoveryTestReady: false });
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        if (command !== 'backend_connection') throw new Error('Comando inesperado');
        if (!(window as unknown as { recoveryTestReady: boolean }).recoveryTestReady) throw new Error('falha inicial simulada');
        return { baseUrl: 'http://127.0.0.1:8765', token: 'browser-test-session-token-0123456789' };
      },
    } });
  });
  await fixture(page, async () => false);
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('falha inicial simulada');
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'RECONECTAR BACKEND' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByLabel('Token da sessão')).toHaveCount(0);
  await page.evaluate(() => Object.assign(window, { recoveryTestReady: true }));
  await page.getByRole('button', { name: 'RECONECTAR BACKEND', exact: true }).click();
  await expect(page.locator('footer')).toContainText('Backend local conectado');
  await expect(page.locator('footer')).not.toContainText('falha inicial simulada');
});

for (const problem of ['404', '409', 'payload', 'identity', 'database', 'corrupt', 'missing-text', 'unbound']) {
  test(`recibo inválido (${problem}) só é descartado após confirmação`, async ({ page }) => {
    const receipt = { id: 'original-job', key: 'receipt-key', payload, previous: 'Texto anterior.',
      databaseId: problem === 'unbound' ? undefined : problem === 'database' ? 'other-db' : 'test-db' };
    await page.addInitScript(raw => localStorage.setItem('horus.transcription.pending.v1', raw),
      problem === 'corrupt' ? '{invalid-json' : problem === 'missing-text'
        ? JSON.stringify({ ...receipt, previous: undefined, previousRef: 'horus.transcription.previous.receipt-key' }) : JSON.stringify(receipt));
    let posts = 0;
    await fixture(page, async (route, path) => {
      if (route.request().method() === 'POST') posts++;
      if (path !== '/v1/jobs/original-job') return false;
      if (problem === '404' || problem === '409') await route.fulfill({ status: Number(problem), headers, json: { detail: 'Job indisponível' } });
      else await route.fulfill({ headers, json: { ...job(), ...(problem === 'identity' ? { id: 'another-job' } : {}),
        payload: problem === 'payload' ? { ...payload, model: 'base' } : payload } });
      return true;
    });
    await page.goto('/'); await connect(page);
    if (!['corrupt', 'missing-text'].includes(problem)) await page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /recibo/i })).toBeVisible();
    const discard = page.getByRole('button', { name: 'DESCARTAR RECIBO INVÁLIDO' });
    page.once('dialog', dialog => dialog.dismiss());
    await discard.click();
    expect(await page.evaluate(() => localStorage.getItem('horus.transcription.pending.v1'))).not.toBeNull();
    await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeDisabled();
    page.once('dialog', dialog => dialog.accept());
    await discard.click();
    expect(await page.evaluate(() => localStorage.getItem('horus.transcription.pending.v1'))).toBeNull();
    await expect(discard).toHaveCount(0);
    if (['corrupt', 'missing-text'].includes(problem)) {
      await page.getByLabel('Caminho local do arquivo').fill(payload.path);
      await page.getByRole('button', { name: 'ADICIONAR À FILA', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeEnabled();
    expect(posts).toBe(0);
  });
}

test('cota local esgotada impede POST e informa armazenamento sem erro de conexão', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('horus.transcription.')) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let posts = 0;
  await fixture(page, async route => { if (route.request().method() === 'POST') posts++; return false; });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('alert').filter({ hasText: /armazenamento local/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Falha no armazenamento' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Acompanhamento interrompido' })).toHaveCount(0);
  expect(posts).toBe(0);
});

test('dados válidos restauram o orçamento de reconexão e preservam o cursor', async ({ page }) => {
  let requests = 0, posts = 0;
  const cursors: string[] = [];
  await fixture(page, async (route, path) => {
    if (path === '/v1/jobs' && route.request().method() === 'POST') {
      posts++; await route.fulfill({ status: 202, headers, json: job() }); return true;
    }
    if (!path.endsWith('/events')) return false;
    requests++;
    cursors.push(new URL(route.request().url()).searchParams.get('after') ?? '');
    const frame = requests === 3 ? { sequence: 9, kind: 'segment', message: 'Segunda frase.' }
      : requests === 5 ? { kind: 'complete', job: job('succeeded', 'Primeira frase.\nSegunda frase.\n') } : null;
    await route.fulfill({ headers, body: frame ? JSON.stringify(frame) + '\n' : '' }); return true;
  });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Primeira frase.\nSegunda frase.\n');
  await expect(page.getByRole('button', { name: 'SALVAR .TXT', exact: true })).toBeEnabled();
  expect(cursors).toEqual(['8', '8', '8', '9', '9']);
  expect(posts).toBe(1);
});

test('45 segundos virtuais de tarefa silenciosa mantêm o stream com keepalive', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(async () => {
    const modulePath = '/src/services/api.ts';
    const { observeJob } = await import(modulePath);
    const state = { done: false, error: '', callbacks: [] as string[], requests: 0, posts: 0 };
    Object.assign(window, { streamTest: state });
    const original = window.fetch;
    window.fetch = async (input, options) => {
      if (!String(input).includes('/v1/jobs/original-job/events')) {
        if (options?.method === 'POST') state.posts++;
        return original(input, options);
      }
      state.requests++;
      const encoder = new TextEncoder();
      let timer: number;
      const stream = new ReadableStream({ start(controller) {
        timer = window.setInterval(() => controller.enqueue(encoder.encode('{"kind":"keepalive"}\n')), 10000);
        window.setTimeout(() => {
          clearInterval(timer);
          controller.enqueue(encoder.encode('{"kind":"complete","job":{"id":"original-job","status":"succeeded"}}\n'));
          controller.close();
        }, 45000);
      }, cancel() { clearInterval(timer); } });
      return new Response(stream);
    };
    void observeJob({ baseUrl: 'http://127.0.0.1:8765', token: 'test' }, 'original-job', new AbortController().signal,
      (event: { kind: string }) => state.callbacks.push(event.kind), 8)
      .then(() => { state.done = true; }).catch((error: Error) => { state.error = error.message; });
  });
  await page.clock.runFor(46000);
  const state = await page.evaluate(() => (window as unknown as { streamTest: unknown }).streamTest);
  expect(state).toEqual({ done: true, error: '', callbacks: ['complete'], requests: 1, posts: 0 });
});

test('texto anterior longo é armazenado uma vez e pode ser recuperado', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/services/transcriptionRecovery.ts';
    const { saveAttachment, inspectAttachment } = await import(modulePath);
    const original = Storage.prototype.setItem;
    let textWrites = 0;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('horus.transcription.previous.')) textWrites++;
      return original.call(this, key, value);
    };
    const previous = 'texto anterior\n'.repeat(10000);
    const receipt = { id: null, key: 'long-text', payload: { operation: 'transcription.run', path: 'a.wav', model: 'tiny', language: 'pt' }, previous };
    saveAttachment(receipt);
    saveAttachment({ ...receipt, id: 'known-job', databaseId: 'test-db' });
    saveAttachment({ ...receipt, id: 'known-job', databaseId: 'test-db' });
    const recovered = inspectAttachment().attachment.previous === previous;
    const metadataBytes = localStorage.getItem('horus.transcription.pending.v1')!.length;
    saveAttachment(null);
    Storage.prototype.setItem = original;
    return { textWrites, recovered, metadataBytes, textRemoved: localStorage.getItem('horus.transcription.previous.long-text') === null };
  });
  expect(result.textWrites).toBe(1);
  expect(result.recovered).toBe(true);
  expect(result.metadataBytes).toBeLessThan(500);
  expect(result.textRemoved).toBe(true);
});

test('falha ao gravar ID aceito mantém o recibo e retoma com GET sem repetir POST', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { storageFault: true });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'horus.transcription.pending.v1' && JSON.parse(value).id
        && (window as unknown as { storageFault: boolean }).storageFault) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let posts = 0;
  await fixture(page, async (route, path) => {
    if (path === '/v1/jobs' && route.request().method() === 'POST') { posts++; await route.fulfill({ status: 202, headers, json: job() }); return true; }
    if (path === '/v1/jobs/original-job') { await route.fulfill({ headers, json: job('succeeded') }); return true; }
    return false;
  });
  await page.goto('/'); await connect(page); await submit(page);
  await expect(page.getByRole('alert').filter({ hasText: /armazenamento local/ })).toBeVisible();
  await page.evaluate(() => Object.assign(window, { storageFault: false }));
  await page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO' }).click();
  await expect(page.getByRole('textbox', { name: 'Transcrição', exact: true })).toHaveValue('Primeira frase.\n');
  expect(posts).toBe(1);
});
