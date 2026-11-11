import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type NativeState = {
  files: string[]; savePath: string | null; pickerFailure: boolean; saveDialogFailure: boolean;
  copyFailure: boolean; copied: string; defaultSave: string; folder: string;
  emitDrop: (paths: string[]) => void; listeners: Record<string, { id: number; handler: number }[]>;
};
type NativeWindow = Window & { parity: NativeState };
type Payload = { operation: string; path?: string; url?: string; directory?: string; model?: string; language?: string };
type MockJob = { id: string; payload: Payload; status: string; attempt: number; created_at: string; updated_at: string;
  result: { text?: string; partial?: boolean; sequence?: number; path?: string } | null; error: string | null };
const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };

async function setup(page: Page, mode: 'success' | 'partial' = 'success') {
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners: NativeState['listeners'] = {};
    const state: NativeState = { files: [], savePath: 'C:/textos/transcrição.txt', pickerFailure: false,
      saveDialogFailure: false, copyFailure: false, copied: '', defaultSave: '', folder: 'C:/videos', listeners,
      emitDrop(paths) { for (const item of [...(listeners['tauri://drag-drop'] ?? [])]) callbacks.get(item.handler)?.({
        event: 'tauri://drag-drop', id: item.id, payload: { paths, position: { x: 10, y: 10 } } }); },
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text: string) {
      if (state.copyFailure) throw new Error('clipboard indisponível'); state.copied = text;
    } } });
    Object.assign(window, { parity: state, isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(event: string, identifier: number) {
        listeners[event] = (listeners[event] ?? []).filter(item => item.id !== identifier);
      } },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++id, callback); return id; },
        unregisterCallback(identifier: number) { callbacks.delete(identifier); },
        async invoke(command: string, args: { options?: { directory?: boolean; defaultPath?: string }; event?: string; handler?: number } = {}) {
          if (command === 'backend_connection') return { baseUrl: 'http://127.0.0.1:8765', token: 'parity-test-session-token-0123456789' };
          if (command === 'plugin:dialog|open') {
            if (state.pickerFailure) throw new Error('seletor indisponível');
            return args.options?.directory ? state.folder : state.files;
          }
          if (command === 'plugin:dialog|save') {
            state.defaultSave = args.options?.defaultPath ?? '';
            if (state.saveDialogFailure) throw new Error('diálogo indisponível');
            return state.savePath;
          }
          if (command === 'plugin:event|listen') {
            const identifier = ++id;
            (listeners[args.event!] ??= []).push({ id: identifier, handler: args.handler! }); return identifier;
          }
          if (command === 'plugin:event|unlisten') return;
          throw new Error(`Comando inesperado: ${command}`);
        },
      },
    });
  });
  const jobs: MockJob[] = [];
  const saves: { path: string; text: string }[] = [];
  const state = { saveFailure: false };
  const streamCalls = new Map<string, number>();
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (path === '/v1/jobs' && request.method() === 'POST') {
      const job: MockJob = { id: `parity-${jobs.length + 1}`, payload: request.postDataJSON(), status: 'queued', attempt: 1,
        created_at: '2026-11-11T12:00:00Z', updated_at: '2026-11-11T12:00:00Z', result: null, error: null };
      jobs.push(job); await route.fulfill({ status: 202, headers, json: job }); return;
    }
    if (path === '/v1/transcriptions/save') {
      saves.push(request.postDataJSON());
      await route.fulfill({ status: state.saveFailure ? 400 : 200, headers,
        json: state.saveFailure ? { detail: 'Permissão negada no destino' } : { path: saves.at(-1)!.path } }); return;
    }
    const match = path.match(/^\/v1\/jobs\/(parity-\d+)(?:\/(events|cancel))?$/);
    if (match) {
      const job = jobs.find(item => item.id === match[1])!;
      if (match[2] === 'cancel') job.status = 'cancelled';
      if (match[2] !== 'events') { await route.fulfill({ headers, json: job }); return; }
      const count = (streamCalls.get(job.id) ?? 0) + 1;
      streamCalls.set(job.id, count);
      const downloading = job.payload.operation === 'youtube.download';
      if (mode === 'partial' && !downloading && job.status !== 'cancelled') {
        job.status = 'running'; job.result = { text: 'Parcial preservado.\n', partial: true, sequence: 2 };
        await route.fulfill({ headers, body: count === 1 ? JSON.stringify({ sequence: 2, kind: 'segment', message: 'Parcial preservado.' }) + '\n' : '' }); return;
      }
      if (job.status !== 'cancelled') {
        job.status = 'succeeded';
        job.result = downloading ? { path: 'C:/videos/baixado.mp4' }
          : { text: job.payload.path!.includes('silent') ? '' : `Texto de ${job.payload.path!.split('/').at(-1)}.\n` };
      }
      const frames = [{ sequence: 3, kind: 'status', message: 'Transcrevendo em CPU (int8).' }, { kind: 'complete', job }];
      await route.fulfill({ headers, body: frames.map(frame => JSON.stringify(frame)).join('\n') + '\n' }); return;
    }
    const body = path === '/health' ? { status: 'ready', database_id: 'parity-db' }
      : path === '/v1/transcription' ? { engine: true, downloader: true, ffmpeg: false }
      : path === '/v1/transcription/jobs' ? jobs
      : path === '/v1/hermes' ? { connected: false, configured: false, cli_available: false, features: [] }
      : { checks: [], notice: '' };
    await route.fulfill({ headers, json: body });
  });
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('Backend local conectado');
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ((window as NativeWindow).parity.listeners['tauri://drag-drop'] ?? []).length)).toBeGreaterThan(0);
  return { jobs, saves, state };
}

async function pick(page: Page, files: string[]) {
  await page.evaluate(files => { (window as NativeWindow).parity.files = files; }, files);
  await page.getByRole('button', { name: 'SELECIONAR ARQUIVOS', exact: true }).click();
  await expect(page.getByRole('button', { name: 'SELECIONAR ARQUIVOS', exact: true })).toBeEnabled();
}
const textBox = (page: Page) => page.getByRole('textbox', { name: 'Transcrição', exact: true });
const transcribe = (page: Page) => page.getByRole('button', { name: 'TRANSCREVER', exact: true }).click();

test('seleção múltipla e drops consecutivos preservam FIFO, limite e texto', async ({ page }) => {
  await setup(page);
  await textBox(page).fill('Texto ainda não salvo');
  await pick(page, ['C:/áudio/primeiro.mp3', 'C:/áudio/segundo.mp4']);
  await page.evaluate(() => {
    (window as NativeWindow).parity.emitDrop(['C:/áudio/terceiro.wav']);
    (window as NativeWindow).parity.emitDrop(Array.from({ length: 20 }, (_, i) => `C:/áudio/drop-${i}.wav`));
  });
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('20/20');
  const items = page.getByLabel('Fila de transcrição').locator('li');
  await expect(items.nth(0)).toContainText('primeiro.mp3');
  await expect(items.nth(1)).toContainText('segundo.mp4');
  await expect(items.nth(2)).toContainText('terceiro.wav');
  await expect(textBox(page)).toHaveValue('Texto ainda não salvo');
  await page.getByLabel('Link do YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(page.getByRole('button', { name: 'BAIXAR E ADICIONAR À FILA' })).toBeDisabled();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.evaluate(() => (window as NativeWindow).parity.emitDrop(['C:/oculto.wav']));
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('20/20');
});

test('salvamento cancelado, erro de diálogo e erro de disco preservam texto e bloqueiam Próximo', async ({ page }) => {
  const { saves, state, jobs } = await setup(page);
  await pick(page, ['C:/um.mp3', 'C:/dois.mp4']); await transcribe(page);
  await expect(textBox(page)).toHaveValue('Texto de um.mp3.\n');
  const save = page.getByRole('button', { name: 'SALVAR .TXT', exact: true });
  const next = page.getByRole('button', { name: 'PRÓXIMO VÍDEO', exact: true });
  await page.evaluate(() => { (window as NativeWindow).parity.savePath = null; });
  await save.click(); await expect(next).toBeDisabled(); expect(saves).toHaveLength(0);
  await page.evaluate(() => { (window as NativeWindow).parity.saveDialogFailure = true; });
  await save.click(); await expect(page.getByRole('status')).toContainText('diálogo indisponível');
  await expect(textBox(page)).toHaveValue('Texto de um.mp3.\n');
  await page.evaluate(() => Object.assign((window as NativeWindow).parity, { saveDialogFailure: false, savePath: 'C:/texto.txt' }));
  state.saveFailure = true; await save.click();
  await expect(page.getByRole('status')).toContainText('Permissão negada'); await expect(next).toBeDisabled();
  state.saveFailure = false; await save.click(); await expect(next).toBeEnabled();
  await textBox(page).fill('Texto revisado'); await expect(next).toBeDisabled();
  await textBox(page).fill('Texto de um.mp3.\n'); await expect(next).toBeDisabled();
  await save.click(); await next.click();
  await expect(textBox(page)).toHaveValue('Texto de dois.mp4.\n');
  expect(jobs.map(job => job.payload.path)).toEqual(['C:/um.mp3', 'C:/dois.mp4']);
  expect(saves.at(-1)!.text).toBe('Texto de um.mp3.\n');
});

test('silêncio permite salvar texto vazio e avançar só após salvar', async ({ page }) => {
  const { saves } = await setup(page);
  await pick(page, ['C:/silent.wav']); await transcribe(page);
  await expect(page.getByRole('status')).toContainText('usando CPU (int8)');
  await expect(textBox(page)).toHaveValue('');
  await page.getByRole('button', { name: 'SALVAR .TXT', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Salvo em');
  expect(saves.at(-1)!.text).toBe('');
  await pick(page, ['C:/depois.wav']);
  await expect(page.getByRole('button', { name: 'PRÓXIMO VÍDEO', exact: true })).toBeEnabled();
});

test('clipboard e falha de seleção têm mensagens claras e mantêm texto', async ({ page }) => {
  await setup(page); await pick(page, ['C:/um.wav']);
  await textBox(page).fill('Texto com acentos: ação');
  await page.getByRole('button', { name: 'COPIAR', exact: true }).click();
  expect(await page.evaluate(() => (window as NativeWindow).parity.copied)).toBe('Texto com acentos: ação');
  await page.evaluate(() => Object.assign((window as NativeWindow).parity, { copyFailure: true, pickerFailure: true }));
  await page.getByRole('button', { name: 'COPIAR', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Não foi possível copiar');
  await page.getByRole('button', { name: 'SELECIONAR ARQUIVOS', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('seletor indisponível');
  await expect(textBox(page)).toHaveValue('Texto com acentos: ação');
});

test('download entra no final da fila sem alterar texto não salvo ou arquivo atual', async ({ page }) => {
  const { jobs } = await setup(page);
  await pick(page, ['C:/primeiro.wav', 'C:/segundo.wav']);
  await textBox(page).fill('Não sobrescrever');
  await page.getByLabel('Link do YouTube').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'BAIXAR E ADICIONAR À FILA' }).click();
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('3/20');
  await expect(page.getByLabel('Fila de transcrição').locator('li').nth(2)).toContainText('baixado.mp4');
  await expect(page.getByRole('heading', { name: 'primeiro.wav', exact: true })).toBeVisible();
  await expect(textBox(page)).toHaveValue('Não sobrescrever');
  await expect(page.getByRole('button', { name: 'PRÓXIMO VÍDEO', exact: true })).toBeDisabled();
  expect(jobs[0].payload.operation).toBe('youtube.download');
});

test('cancelamento preserva parcial e ignora drop durante execução', async ({ page }) => {
  const { jobs } = await setup(page, 'partial');
  await pick(page, ['C:/atual.wav', 'C:/proximo.wav']);
  await textBox(page).fill('Anterior.\n'); await transcribe(page);
  await expect(textBox(page)).toHaveValue('Anterior.\nParcial preservado.\n');
  await expect(textBox(page)).toHaveAttribute('readonly', '');
  await page.evaluate(() => (window as NativeWindow).parity.emitDrop(['C:/nao-adicionar.wav']));
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('2/20');
  await page.getByRole('button', { name: 'CANCELAR', exact: true }).click();
  await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeEnabled();
  await expect(textBox(page)).toHaveValue('Anterior.\nParcial preservado.\n');
  await expect(page.getByRole('heading', { name: 'atual.wav', exact: true })).toBeVisible();
  expect(jobs).toHaveLength(1);
});

test('remoção individual de arquivos da fila preserva a ordem e não afeta o processamento atual', async ({ page }) => {
  await setup(page);
  await pick(page, ['C:/audio/primeiro.mp3', 'C:/audio/segundo.wav', 'C:/audio/terceiro.m4a']);
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('3/20');

  const items = page.getByLabel('Fila de transcrição').locator('li');
  await expect(items.nth(0)).toContainText('primeiro.mp3');
  await expect(items.nth(1)).toContainText('segundo.wav');
  await expect(items.nth(2)).toContainText('terceiro.m4a');

  // Remover o segundo arquivo ('segundo.wav')
  const removeBtn = items.nth(1).getByRole('button', { name: 'Remover segundo.wav da fila' });
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();

  // Fila agora tem 2 itens: primeiro.mp3 e terceiro.m4a preservando a ordem
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('2/20');
  await expect(items.nth(0)).toContainText('primeiro.mp3');
  await expect(items.nth(1)).toContainText('terceiro.m4a');
  await expect(page.getByRole('heading', { name: 'primeiro.mp3', exact: true })).toBeVisible();
});

test('remoção da fila protege arquivo em processamento, texto não salvo e respeita limite de 20', async ({ page }) => {
  const { jobs } = await setup(page, 'partial');
  await pick(page, ['C:/audio/executando.mp3', 'C:/audio/pendente.mp3']);
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('2/20');

  const items = page.getByLabel('Fila de transcrição').locator('li');

  // Item 0 com texto não salvo não pode ser removido
  await textBox(page).fill('Texto digitado manualmente');
  await expect(items.nth(0).getByRole('button', { name: /Remover/ })).toHaveCount(0);
  // Mas item 1 (pendente) pode ser removido
  await expect(items.nth(1).getByRole('button', { name: /Remover/ })).toHaveCount(1);

  // Limpa o texto
  await textBox(page).fill('');
  // Item 0 sem texto e ocioso pode ser removido
  await expect(items.nth(0).getByRole('button', { name: /Remover/ })).toHaveCount(1);

  // Inicia transcrição: modo 'partial' mantém status 'running' (busy)
  await transcribe(page);
  await expect(textBox(page)).toHaveValue('Parcial preservado.\n');
  // Durante processamento, item 0 NUNCA pode ser removido
  await expect(items.nth(0).getByRole('button', { name: /Remover/ })).toHaveCount(0);
  // Item 1 ainda pode ser removido da fila enquanto o atual processa
  const removePendente = items.nth(1).getByRole('button', { name: 'Remover pendente.mp3 da fila' });
  await expect(removePendente).toBeVisible();
  await removePendente.click();
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('1/20');
  await expect(items.nth(0)).toContainText('executando.mp3');

  // Cancela para liberar busy
  await page.getByRole('button', { name: 'CANCELAR', exact: true }).click();
  await expect(page.getByRole('button', { name: 'TRANSCREVER', exact: true })).toBeEnabled();

  // Preenche fila até o limite de 20
  const novos = Array.from({ length: 19 }, (_, i) => `C:/audio/extra-${i + 1}.mp3`);
  await pick(page, novos);
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('20/20');

  // Tenta adicionar mais 1: deve rejeitar por estar no limite de 20
  await pick(page, ['C:/audio/excedente.mp3']);
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('20/20');

  // Remove um item do meio da fila
  await items.nth(5).getByRole('button', { name: /Remover/ }).click();
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('19/20');

  // Agora permite adicionar mais 1 item, retornando para 20/20
  await pick(page, ['C:/audio/novo-aceito.mp3']);
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('20/20');
  expect(jobs).toHaveLength(1);
});
