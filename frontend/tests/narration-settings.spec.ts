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

// Formatos do backend real (backend/src/horus_backend/narration/*.py, docs/narracao-provedores.md).
const KOKORO_NOTES = 'Pesos Apache-2.0; treino inclui áudio sintético de TTS proprietários e dados CC BY. Direitos comerciais do áudio não verificados; espeak-ng GPL somente no processo externo.';
const kokoroLicense = { name: 'Apache-2.0', url: 'https://huggingface.co/hexgrad/Kokoro-82M' };
const kokoroVoices = () => ['pf_dora', 'pm_alex', 'pm_santa'].map(id => voice(id, id, 'pt-BR', { license: kokoroLicense, commercial_use: 'unknown', notes: KOKORO_NOTES }));
const kokoro = (status: string, reason: string) => provider('kokoro', 'Kokoro-82M', 'local', status, reason, status === 'available' ? kokoroVoices() : [],
  { engine_license: { ...kokoroLicense, notes: KOKORO_NOTES } });
// Vozes hipotéticas (o backend atual não as entrega); exercitam a defesa da interface contra restrição/ausência de prévia.
const hypothetical = () => [
  ...providers().slice(0, 1),
  provider('piper', 'Piper', 'local', 'available', 'available', [voice('piper-faber', 'Faber', 'pt-BR', { preview: 'unavailable', commercial_use: 'restricted' })]),
  provider('elevenlabs', 'ElevenLabs', 'paid_api', 'not_configured', 'paid_generation_authorization_flow_disabled', [
    voice('el-ana', 'Ana', 'pt-BR', { preview: 'requires_authorization', commercial_use: 'unknown' })], { native_word_timestamps: true }),
];
const providers = (kokoroState: [string, string] = ['not_installed', 'not_installed'], elevenlabsStatus = 'not_configured') => [
  provider('windows_sapi', 'Windows SAPI', 'local', 'available', 'available', [
    voice('sapi-maria', 'Maria', 'pt-BR', { commercial_use: 'unknown' }), voice('sapi-zira', 'Zira', 'en-US', { commercial_use: 'unknown' })]),
  provider('piper', 'Piper', 'local', 'not_installed', 'not_installed', []),
  kokoro(...kokoroState),
  provider('elevenlabs', 'ElevenLabs', 'paid_api', elevenlabsStatus, 'paid_generation_authorization_flow_disabled', [], { native_word_timestamps: true }),
];
type Calls = { path: string; method: string; body: unknown }[];
async function setup(page: Page, options: { priced?: boolean; providers?: unknown[]; expiredPreview?: boolean } = {}) {
  const calls: Calls = []; let configured = false; let defaultVoice: unknown = null; let previews = 0; const pending = new Set<string>();
  await page.route(`http://127.0.0.1:8765/**`, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    const raw = request.postData(); const body = raw ? JSON.parse(raw) : null;
    if (path.startsWith('/v1/narration')) calls.push({ path, method, body });
    if (path === '/health') return route.fulfill({ headers: cors, json: { status: 'ready', database_id: 'test-db' } });
    if (path === '/v1/narration/providers') return route.fulfill({ headers: cors, json: options.providers ?? providers() });
    if (path === '/v1/narration/preview' && method === 'POST') {
      if (body.provider === 'elevenlabs') return route.fulfill({ status: 403, headers: cors, json: { code: 'paid_provider_not_authorized' } });
      const id = `prev${++previews}`; pending.add(id);
      return route.fulfill({ headers: cors, json: { id, url: `/v1/narration/previews/${id}`, expires_in_seconds: 300 } });
    }
    if (path.startsWith('/v1/narration/previews/') && method === 'GET') {
      const id = path.split('/').pop()!;
      if (options.expiredPreview || !pending.delete(id)) return route.fulfill({ status: 404, headers: cors, json: { code: 'preview_not_found' } });
      return route.fulfill({ headers: { ...cors, 'Content-Type': 'audio/wav' }, body: wavFixture() });
    }    if (path === '/v1/narration/estimate') return route.fulfill({ headers: cors, json: body.provider === 'elevenlabs' && options.priced
      ? { characters: 90, cost: { amount: '0.0270', currency: 'USD', basis: 'USD por 1.000 caracteres (preço configurado)', source: 'configured_price' }, credits: { required: 90, available: 1000, source: 'mock' }, requires_authorization: true }
      : { characters: 90, cost: { amount: 1.5, currency: 'USD', basis: 'valor que não deve aparecer', source: 'unknown' }, credits: { required: null, available: null, source: 'not_checked' }, requires_authorization: body.provider === 'elevenlabs' } });
    if (path === '/v1/narration/providers/elevenlabs/credential') {
      if (method === 'GET') return route.fulfill({ status: 405, headers: cors, json: { detail: 'Method Not Allowed' } }); // não existe GET da credencial
      if (method === 'PUT' && typeof body?.key !== 'string') return route.fulfill({ status: 422, headers: cors, json: { detail: [{ type: 'missing', loc: ['body', 'key'] }] } });
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

test('mostra status reais, motivos, licenças e pt-BR primeiro', async ({ page }) => {
  await setup(page);
  const expected: [string, string, string][] = [['Windows SAPI', 'DISPONÍVEL', 'available'], ['Piper', 'NÃO INSTALADO', 'not_installed'],
    ['Kokoro-82M', 'NÃO INSTALADO', 'not_installed'], ['ElevenLabs', 'NÃO CONFIGURADO', 'paid_generation_authorization_flow_disabled']];
  for (const [name, status, reason] of expected) {
    const region = page.getByRole('region', { name: `Provedor ${name}` });
    await expect(region.getByText(status, { exact: true })).toBeVisible();
    await expect(region).toContainText(reason);
    await expect(region).toContainText('Licença do motor:');
    await expect(region.getByRole('link').first()).toBeVisible();
  }
  await expect(page.getByLabel('Idioma')).toHaveValue('pt-BR');
  await expect(page.getByRole('listitem', { name: 'Maria (Windows SAPI)' })).toContainText('USO COMERCIAL: DESCONHECIDO');
  await expect(page.getByRole('listitem', { name: 'Zira (Windows SAPI)' })).toHaveCount(0);
  await page.getByLabel('Idioma').selectOption('en-US');
  await expect(page.getByRole('listitem', { name: 'Zira (Windows SAPI)' })).toContainText('Trate como não permitido');
});

test('Kokoro bloqueado mostra o motivo específico e nenhuma voz', async ({ page }) => {
  await setup(page, { providers: providers(['blocked', 'kokoro_hash_mismatch:voices/pf_dora.pt']) });
  const region = page.getByRole('region', { name: 'Provedor Kokoro-82M' });
  await expect(region.getByText('BLOQUEADO', { exact: true })).toBeVisible();
  await expect(region).toContainText('kokoro_hash_mismatch:voices/pf_dora.pt');
  await expect(region).toContainText('Apache-2.0');
  await expect(page.getByRole('listitem', { name: /Kokoro-82M/ })).toHaveCount(0);
});

test('Kokoro disponível lista pf_dora, pm_alex e pm_santa com uso comercial desconhecido e motivo; prévia local', async ({ page }) => {
  const calls = await setup(page, { providers: providers(['available', 'available']) });
  const region = page.getByRole('region', { name: 'Provedor Kokoro-82M' });
  await expect(region.getByText('DISPONÍVEL', { exact: true })).toBeVisible();
  for (const id of ['pf_dora', 'pm_alex', 'pm_santa']) {
    const item = page.getByRole('listitem', { name: `${id} (Kokoro-82M)` });
    await expect(item).toContainText('USO COMERCIAL: DESCONHECIDO');
    await expect(item).toContainText('Trate como não permitido');
    await expect(item).toContainText('Direitos comerciais do áudio não verificados');
    await expect(item).toContainText('treino inclui áudio sintético de TTS proprietários e dados CC BY');
  }
  await page.getByRole('button', { name: 'Ouvir prévia de pf_dora (Kokoro-82M)' }).click();
  await expect(page.locator('audio[aria-label="Prévia de pf_dora (Kokoro-82M)"]')).toBeVisible();
  expect(calls.filter(c => c.path === '/v1/narration/preview')[0].body).toMatchObject({ provider: 'kokoro', voice_id: 'pf_dora' });
});

test('prévia em duas etapas: POST devolve id/url e o WAV vem de GET autenticado; limite de 300', async ({ page }) => {
  const calls = await setup(page);
  const text = page.getByLabel(/Texto fictício da prévia/);
  await expect(text).toHaveValue(/frase fictícia/);
  await text.fill('x'.repeat(400));
  await expect(text).toHaveValue('x'.repeat(300));
  await text.fill('Texto editado para a prévia.');
  await page.getByRole('button', { name: 'Ouvir prévia de Maria (Windows SAPI)' }).click();
  const audio = page.locator('audio[aria-label="Prévia de Maria (Windows SAPI)"]');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration > 0.5 && el.currentTime > 0)).toBe(true);
  expect(calls.filter(c => c.path.startsWith('/v1/narration/preview'))).toEqual([
    { path: '/v1/narration/preview', method: 'POST', body: { provider: 'windows_sapi', voice_id: 'sapi-maria', text: 'Texto editado para a prévia.' } },
    { path: '/v1/narration/previews/prev1', method: 'GET', body: null },
  ]);
  // Nova prévia: o Blob anterior é revogado e o novo áudio é buscado com outro id.
  const first = await audio.getAttribute('src');
  await page.getByRole('button', { name: 'Ouvir prévia de Maria (Windows SAPI)' }).click();
  await expect(audio).not.toHaveAttribute('src', first!);
  expect(calls.filter(c => c.method === 'GET' && c.path.startsWith('/v1/narration/previews/')).map(c => c.path)).toEqual(['/v1/narration/previews/prev1', '/v1/narration/previews/prev2']);
  expect(await page.evaluate(src => fetch(src).then(() => true, () => false), first)).toBe(false);
});

test('prévia expirada (404 preview_not_found) mostra erro e nenhum áudio', async ({ page }) => {
  await setup(page, { expiredPreview: true });
  await page.getByRole('button', { name: 'Ouvir prévia de Maria (Windows SAPI)' }).click();
  await expect(page.getByRole('listitem', { name: 'Maria (Windows SAPI)' }).getByRole('alert')).toContainText('preview_not_found');
  await expect(page.locator('audio')).toHaveCount(0);
});

test('prévia de voz paga e de voz indisponível não dispara requisição', async ({ page }) => {
  const calls = await setup(page, { providers: hypothetical() });
  const paid = page.getByRole('listitem', { name: 'Ana (ElevenLabs)' });
  await expect(paid).toContainText('exige autorização');
  await expect(paid.getByRole('button', { name: /Ouvir prévia/ })).toHaveCount(0);
  const unavailable = page.getByRole('listitem', { name: 'Faber (Piper)' });
  await expect(unavailable).toContainText('USO COMERCIAL: RESTRITO');
  await expect(unavailable).toContainText('Não use esta voz em conteúdo publicado');
  await expect(unavailable.getByRole('button', { name: /Ouvir prévia/ })).toHaveCount(0);
  await expect(unavailable).toContainText('Prévia indisponível');
  expect(calls.filter(c => c.path === '/v1/narration/preview')).toHaveLength(0);
});

test('estimativa sem preço mostra desconhecido; com preço mostra fonte configurada', async ({ page }) => {
  await setup(page, { providers: hypothetical() });
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
  await setup(page, { priced: true, providers: hypothetical() });
  const paid = page.getByRole('listitem', { name: 'Ana (ElevenLabs)' });
  await paid.getByRole('button', { name: /Estimar custo/ }).click();
  const view = paid.getByRole('status', { name: 'Estimativa de custo' });
  await expect(view).toContainText('0.0270 USD');
  await expect(view).toContainText('fonte: configured_price');
  await expect(view).toContainText('necessários 90 · disponíveis 1000');
  await expect(view).toContainText('fonte: mock');
  await expect(view).toContainText('Nenhuma geração foi feita');
});

test('credencial ElevenLabs: corpo {key}, estado vem do registro e valor nunca volta ao DOM', async ({ page }) => {
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
  expect(calls.find(c => c.method === 'PUT' && c.path.endsWith('/credential'))?.body).toEqual({ key: SECRET });
  await expect(input).toHaveValue('');
  expect(await page.evaluate(secret => document.documentElement.outerHTML.includes(secret) || document.body.innerText.includes(secret)
    || [...document.querySelectorAll('input,textarea')].some(el => (el as HTMLInputElement).value.includes(secret)), SECRET)).toBe(false);
  expect(await page.evaluate(secret => JSON.stringify({ ...localStorage }).includes(secret) || JSON.stringify({ ...sessionStorage }).includes(secret), SECRET)).toBe(false);
  await form.getByRole('button', { name: 'REMOVER CHAVE' }).click();
  await expect(form).toContainText('não configurada');
  expect(calls.some(c => c.method === 'DELETE' && c.path.endsWith('/credential'))).toBe(true);
  // Não existe GET da credencial: nenhuma consulta a essa rota.
  expect(calls.some(c => c.method === 'GET' && c.path.endsWith('/credential'))).toBe(false);
});

test('credencial: status blocked do registro indica chave configurada', async ({ page }) => {
  await setup(page, { providers: providers(undefined, 'blocked') });
  const form = page.getByRole('form', { name: 'Conectar ElevenLabs' });
  await expect(form).toContainText('configurada');
  await expect(form.getByText('não configurada')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'REMOVER CHAVE' })).toBeVisible();
});

test('credencial: provedor desabilitado não afirma se há chave', async ({ page }) => {
  await setup(page, { providers: providers(undefined, 'disabled') });
  const form = page.getByRole('form', { name: 'Conectar ElevenLabs' });
  await expect(form).toContainText('estado indisponível');
  await expect(form.getByText('não configurada')).toHaveCount(0);
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
