import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/visual-tests');
fs.mkdirSync(artifactDir, { recursive: true });

async function setupMock(page: Page) {
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners: NativeState['listeners'] = {};
    const state: NativeState = { files: [], savePath: 'C:/textos/transcricao.txt', pickerFailure: false,
      saveDialogFailure: false, copyFailure: false, copied: '', defaultSave: '', folder: 'C:/videos', listeners,
      emitDrop(paths) { for (const item of [...(listeners['tauri://drag-drop'] ?? [])]) callbacks.get(item.handler)?.({
        event: 'tauri://drag-drop', id: item.id, payload: { paths, position: { x: 10, y: 10 } } }); },
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text: string) { state.copied = text; } } });
    Object.assign(window, { parity: state, isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(event: string, identifier: number) {
        listeners[event] = (listeners[event] ?? []).filter(item => item.id !== identifier);
      } },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++id, callback); return id; },
        unregisterCallback(identifier: number) { callbacks.delete(identifier); },
        async invoke(command: string, args: { options?: { directory?: boolean; defaultPath?: string }; event?: string; handler?: number } = {}) {
          if (command === 'backend_connection') return { baseUrl: 'http://127.0.0.1:8765', token: 'token-visual' };
          if (command === 'plugin:dialog|open') return state.files;
          if (command === 'plugin:dialog|save') return state.savePath;
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
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const urlPath = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (urlPath === '/v1/jobs' && request.method() === 'POST') {
      const job: MockJob = { id: `visual-${jobs.length + 1}`, payload: request.postDataJSON(), status: 'queued', attempt: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), result: null, error: null };
      jobs.push(job); await route.fulfill({ status: 202, headers, json: job }); return;
    }
    if (urlPath === '/v1/transcriptions/save') {
      await route.fulfill({ status: 200, headers, json: { path: 'C:/textos/entrevista-lucas.txt' } }); return;
    }
    const match = urlPath.match(/^\/v1\/jobs\/(visual-\d+)(?:\/(events|cancel))?$/);
    if (match) {
      const job = jobs.find(item => item.id === match[1])!;
      if (match[2] === 'events') {
        job.status = 'succeeded';
        job.result = { text: 'Olá a todos. Este é o episódio inaugural gravado em estúdio com áudio de alta fidelidade.\nO modelo Whisper local processou este arquivo preservando total privacidade.' };
        const frames = [
          { sequence: 1, kind: 'status', message: 'Transcrevendo em CPU (int8)...' },
          { sequence: 2, kind: 'progress', message: '50' },
          { kind: 'complete', job }
        ];
        await route.fulfill({ headers, body: frames.map(frame => JSON.stringify(frame)).join('\n') + '\n' }); return;
      }
      await route.fulfill({ headers, json: job }); return;
    }
    const body = urlPath === '/health' ? { status: 'ready', database_id: 'visual-db' }
      : urlPath === '/v1/transcription' ? { engine: true, downloader: true, ffmpeg: false }
      : urlPath === '/v1/transcription/jobs' ? jobs
      : urlPath === '/v1/hermes' ? { connected: true, configured: true, cli_available: true, features: ['transcription'] }
      : { checks: [], notice: '' };
    await route.fulfill({ headers, json: body });
  });
}

test('captura telas em alta fidelidade nos temas e resoluções desktop', async ({ page }) => {
  await setupMock(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  // 1. Visão Geral - Escuro 1320x840
  await page.setViewportSize({ width: 1320, height: 840 });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(300);
  const shotDark1320 = path.join(artifactDir, 'overview-dark-1320.png');
  await page.screenshot({ path: shotDark1320, fullPage: true });

  // 2. Visão Geral - Claro 1040x680
  await page.setViewportSize({ width: 1040, height: 680 });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'CLARO', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.waitForTimeout(300);
  const shotLight1040 = path.join(artifactDir, 'overview-light-1040.png');
  await page.screenshot({ path: shotLight1040, fullPage: true });

  // 3. Transcrição - Claro 1040x680 com itens na fila
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await page.evaluate(() => {
    (window as NativeWindow).parity.files = [
      'C:/videos/entrevista-lucas.mp4',
      'C:/audios/podcast-episodio-12.mp3',
      'C:/capturas/b-roll-cidade.mov'
    ];
  });
  await page.getByRole('button', { name: 'SELECIONAR ARQUIVOS', exact: true }).click();
  await expect(page.getByLabel('Arquivos na fila')).toHaveText('3/20');
  await page.waitForTimeout(300);
  const shotTransLight1040 = path.join(artifactDir, 'transcription-light-1040.png');
  await page.screenshot({ path: shotTransLight1040, fullPage: true });

  // 4. Transcrição - Escuro 1320x840 concluída com texto, badges e status
  await page.setViewportSize({ width: 1320, height: 840 });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await page.getByRole('button', { name: 'TRANSCREVER', exact: true }).click();
  await expect(page.getByRole('button', { name: 'SALVAR .TXT', exact: true })).toBeEnabled();
  await page.waitForTimeout(400);
  const shotTransFlow1320 = path.join(artifactDir, 'transcription-flow-1320.png');
  await page.screenshot({ path: shotTransFlow1320, fullPage: true });
});
