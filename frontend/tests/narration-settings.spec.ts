import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const origin = new URL(config.use!.baseURL!).origin;
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
const SECRET = 'xi-segredo-de-teste-NUNCA-NO-DOM-123456';

function wavFixture(seconds = 0.6, rate = 8000) {
  const samples = Math.floor(seconds * rate); const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
  return buffer;
}

const voice = (id: string, name: string, language: string, extra: Record<string, unknown> = {}) => ({
  id, name, language, license: { name: 'Licença da voz', url: 'https://example.com/licenca' }, commercial_use: 'allowed', preview: 'local', ...extra,
});
const engine = { name: 'Licença do motor', url: 'https://example.com/motor', notes: 'Observação do motor.' };
const provider = (id: string, name: string, kind: string, status: string, reason: string, voices: unknown[], extra: Record<string, unknown> = {}) => (
  { id, name, kind, status, reason, engine_license: engine, voices, native_word_timestamps: false, requires_authorization: kind === 'paid_api', ...extra });

const providers = () => [
  provider('windows_sapi', 'Windows SAPI', 'local', 'available', 'Vozes do Windows detectadas.', [
    voice('sapi-maria', 'Maria', 'pt-BR'), voice('sapi-zira', 'Zira', 'en-US', { commercial_use: 'unknown' })]),
  provider('piper', 'Piper', 'local', 'not_installed', 'Motor não instalado neste computador.', [voice('piper-faber', 'Faber', 'pt-BR', { preview: 'unavailable', commercial_use: 'restricted' })]),
  provider('f5_tts', 'F5-TTS', 'local', 'blocked', 'Licença dos pesos proíbe uso comercial.', []),
  provider('xtts', 'XTTS', 'local', 'disabled', 'Desabilitado nas configurações.', []),
  provider('elevenlabs', 'ElevenLabs', 'paid_api', 'not_configured', 'Nenhuma chave configurada.', [
    voice('el-ana', 'Ana', 'pt-BR', { preview: 'requires_authorization', commercial_use: 'unknown' })], { native_word_timestamps: true }),
];

type Calls = { path: string; method: string; body: unknown }[];
async function setup(page: Page, options: { priced?: boolean; providers?: unknown[] } = {}) {
  const calls: Calls = []; let configured = false; let defaultVoice: unknown = null;
  await page.route(`http://127.0.0.1:8765/**`, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    const raw = request.postData(); const body = raw ? JSON.parse(raw) : null;
    if (path.startsWith('/v1/narration')) calls.push({ path, method, body });
    if (path === '/health') return route.fulfill({ headers: cors, json: { status: 'ready', database_id: 'test-db' } });
    if (path === '/v1/narration/providers') return route.fulfill({ headers: cors, json: options.providers ?? providers() });
    if (path === '/v1/narration/preview') {
      if (body.provider === 'elevenlabs') return route.fulfill({ status: 403, headers: cors, json: { code: 'paid_provider_not_authorized' } });
      return route.fulfill({ headers: { ...cors, 'Content-Type': 'audio/wav' }, body: wavFixture() });
    }
    if (path === '/v1/narration/estimate') return route.fulfill({ headers: cors, json: body.provider === 'elevenlabs' && options.priced
      ? { characters: 90, cost: { amount: '0.0270', currency: 'USD', basis: 'USD por 1.000 caracteres (preço configurado)', source: 'configured_price' }, credits: { required: 90, available: 1000, source: 'mock' }, requires_authorization: true }
      : { characters: 90, cost: { amount: 1.5, currency: 'USD', basis: 'valor que não deve aparecer', source: 'unknown' }, credits: { required: null, available: null, source: 'not_checked' }, requires_authorization: body.provider === 'elevenlabs' } });
    if (path === '/v1/narration/providers/elevenlabs/credential') {
      if (method === 'PUT') configured = true; if (method === 'DELETE') configured = false;
      return route.fulfill({ headers: cors, json: { configured } });
    }
    if (path === '/v1/narration/preference') { if (method === 'PUT') defaultVoice = body; return route.fulfill({ headers: cors, json: defaultVoice }); }
    return route.fulfill({ headers: cors, json: { connected: false, features: [], configured: false, cli_available: false, checks: [], notice: '' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'ABRIR NARRAÇÃO' }).click();
  await expect(page.getByRole('region', { name: 'Provedor Windows SAPI' })).toBeVisible();
  return calls;
}

test('mostra cada status de provedor com motivo, licenças e pt-BR primeiro', async ({ page }) => {
  await setup(page);
  const expected: [string, string, string][] = [['Windows SAPI', 'DISPONÍVEL', 'Vozes do Windows detectadas.'], ['Piper', 'NÃO INSTALADO', 'Motor não instalado'],
    ['F5-TTS', 'BLOQUEADO', 'proíbe uso comercial'], ['XTTS', 'DESABILITADO', 'Desabilitado nas configurações'], ['ElevenLabs', 'NÃO CONFIGURADO', 'Nenhuma chave']];
  for (const [name, status, reason] of expected) {
    const region = page.getByRole('region', { name: `Provedor ${name}` });
    await expect(region.getByText(status, { exact: true })).toBeVisible();
    await expect(region).toContainText(reason);
    await expect(region.getByRole('link', { name: 'Licença do motor' })).toBeVisible();
  }
  await expect(page.getByLabel('Idioma')).toHaveValue('pt-BR');
  await expect(page.getByRole('listitem', { name: 'Maria (Windows SAPI)' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Zira (Windows SAPI)' })).toHaveCount(0);
  await expect(page.getByRole('listitem', { name: 'Faber (Piper)' })).toContainText('USO COMERCIAL: RESTRITO');
  await expect(page.getByRole('listitem', { name: 'Faber (Piper)' })).toContainText('Não use esta voz em conteúdo publicado');
  await expect(page.getByRole('listitem', { name: 'Ana (ElevenLabs)' })).toContainText('Trate como não permitido');
  await expect(page.getByRole('listitem', { name: 'Maria (Windows SAPI)' })).toContainText('USO COMERCIAL: PERMITIDO');
  await page.getByLabel('Idioma').selectOption('en-US');
  await expect(page.getByRole('listitem', { name: 'Zira (Windows SAPI)' })).toContainText('USO COMERCIAL: DESCONHECIDO');
});

test('prévia local toca o WAV e respeita o texto editado e o limite de 300', async ({ page }) => {
  const calls = await setup(page);
  const text = page.getByLabel(/Texto fictício da prévia/);
  await expect(text).toHaveValue(/frase fictícia/);
  await text.fill('x'.repeat(400));
  await expect(text).toHaveValue('x'.repeat(300));
  await text.fill('Texto editado para a prévia.');
  await page.getByRole('button', { name: 'Ouvir prévia de Maria (Windows SAPI)' }).click();
  const audio = page.locator('audio[aria-label="Prévia de Maria (Windows SAPI)"]');
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration > 0.5 && el.currentTime > 0)).toBe(true);
  expect(calls.filter(c => c.path === '/v1/narration/preview')).toEqual([{ path: '/v1/narration/preview', method: 'POST', body: { provider: 'windows_sapi', voice_id: 'sapi-maria', text: 'Texto editado para a prévia.' } }]);
});

test('prévia de voz paga e de voz indisponível não dispara requisição', async ({ page }) => {
  const calls = await setup(page);
  const paid = page.getByRole('listitem', { name: 'Ana (ElevenLabs)' });
  await expect(paid).toContainText('exige autorização');
  await expect(paid.getByRole('button', { name: /Ouvir prévia/ })).toHaveCount(0);
  const unavailable = page.getByRole('listitem', { name: 'Faber (Piper)' });
  await expect(unavailable.getByRole('button', { name: /Ouvir prévia/ })).toHaveCount(0);
  await expect(unavailable).toContainText('Prévia indisponível');
  expect(calls.filter(c => c.path === '/v1/narration/preview')).toHaveLength(0);
});

test('estimativa sem preço mostra desconhecido; com preço mostra fonte configurada', async ({ page }) => {
  await setup(page);
  const paid = page.getByRole('listitem', { name: 'Ana (ElevenLabs)' });
  await paid.getByRole('button', { name: /Estimar custo/ }).click();
  const unknown = paid.getByRole('status', { name: 'Estimativa de custo' });
  await expect(unknown).toContainText('desconhecido');
  await expect(unknown).toContainText('fonte: unknown');
  await expect(unknown).toContainText('fonte: not_checked');
  await expect(unknown).not.toContainText('1.5');
  await expect(unknown).not.toContainText('não deve aparecer');
});

test('estimativa com preço configurado mostra valor, fonte e créditos', async ({ page }) => {
  await setup(page, { priced: true });
  const paid = page.getByRole('listitem', { name: 'Ana (ElevenLabs)' });
  await paid.getByRole('button', { name: /Estimar custo/ }).click();
  const view = paid.getByRole('status', { name: 'Estimativa de custo' });
  await expect(view).toContainText('0.0270 USD');
  await expect(view).toContainText('fonte: configured_price');
  await expect(view).toContainText('necessários 90 · disponíveis 1000');
  await expect(view).toContainText('fonte: mock');
  await expect(view).toContainText('Nenhuma geração foi feita');
});

test('credencial ElevenLabs: valor só vai ao backend e nunca volta ao DOM', async ({ page }) => {
  const calls = await setup(page);
  const form = page.getByRole('form', { name: 'Conectar ElevenLabs' });
  await expect(form).toContainText('não configurada');
  await expect(form).toContainText('não habilita o uso pago nem consome créditos');
  const input = form.getByLabel('Chave da API ElevenLabs');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(SECRET);
  await form.getByRole('button', { name: 'SALVAR CHAVE' }).click();
  await expect(form).toContainText('configurada');
  await expect(form.getByText('não configurada')).toHaveCount(0);
  expect(calls.find(c => c.method === 'PUT' && c.path.endsWith('/credential'))?.body).toEqual({ api_key: SECRET });
  await expect(input).toHaveValue('');
  expect(await page.evaluate(secret => document.documentElement.outerHTML.includes(secret) || document.body.innerText.includes(secret)
    || [...document.querySelectorAll('input,textarea')].some(el => (el as HTMLInputElement).value.includes(secret)), SECRET)).toBe(false);
  expect(await page.evaluate(secret => JSON.stringify({ ...localStorage }).includes(secret) || JSON.stringify({ ...sessionStorage }).includes(secret), SECRET)).toBe(false);
  await form.getByRole('button', { name: 'REMOVER CHAVE' }).click();
  await expect(form).toContainText('não configurada');
  expect(calls.some(c => c.method === 'DELETE' && c.path.endsWith('/credential'))).toBe(true);
});

test('voz padrão é persistida pela API e marcada na lista', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Usar Maria (Windows SAPI) como voz padrão' }).click();
  await expect(page.getByText('Voz padrão salva: Maria (Windows SAPI).')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Maria (Windows SAPI)' })).toContainText('VOZ PADRÃO');
  expect(calls.find(c => c.method === 'PUT' && c.path === '/v1/narration/preference')?.body).toEqual({ provider: 'windows_sapi', voice_id: 'sapi-maria' });
});

test('resposta fora do contrato mostra erro e nenhuma voz', async ({ page }) => {
  await setup(page, { providers: [{ id: 'x', name: 'Quebrado', kind: 'local', status: 'inventado', reason: '', voices: [] }] }).catch(() => undefined);
  await expect(page.getByRole('alert')).toContainText('Resposta de narração inválida');
});
