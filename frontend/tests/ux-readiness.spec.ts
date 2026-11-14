import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

type Json = Record<string, unknown>;

function makeProductionChecks(overrides: Record<string, boolean> = {}): Json[] {
  const avail = (id: string, def = true) => overrides[id] ?? def;
  return [
    {
      id: 'factory',
      name: 'Fábrica do piloto',
      available: avail('factory'),
      detail:
        (avail('factory') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Configure FABRICA_HOME (ou HORUS_PILOT_FACTORY) e prepare scripts/.venv, código e dependências Remotion pelos locks.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'browser',
      name: 'Navegador do render',
      available: avail('browser'),
      detail:
        (avail('browser') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Prepare um navegador local e configure HORUS_DEMO_BROWSER quando necessário.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'ffmpeg',
      name: 'FFmpeg do piloto',
      available: avail('ffmpeg'),
      detail:
        (avail('ffmpeg') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Configure HORUS_FFMPEG com o executável local preparado com subtitles/libass; filtros não são executados nesta consulta.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'ffprobe',
      name: 'FFprobe do piloto',
      available: avail('ffprobe'),
      detail:
        (avail('ffprobe') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Prepare ffprobe ao lado do executável indicado em HORUS_FFMPEG; mantenha também as ferramentas acessíveis ao worker pelo PATH ou compositor Remotion.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'alignment_model',
      name: 'Modelo de alinhamento',
      available: avail('alignment_model'),
      detail:
        (avail('alignment_model') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Configure HORUS_ALIGNMENT_MODEL com small/ ou faster-whisper-small/ contendo model.bin, config.json, tokenizer.json e vocabulary.txt.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'alignment_engine',
      name: 'Motor de alinhamento',
      available: avail('alignment_engine'),
      detail:
        (avail('alignment_engine') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Prepare o extra de transcrição do backend; o modelo não é carregado nesta consulta.',
      required_for: ['draft', 'final'],
    },
    {
      id: 'sapi_pt_br',
      name: 'Voz SAPI pt-BR',
      available: avail('sapi_pt_br'),
      detail:
        (avail('sapi_pt_br') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Instale uma voz SAPI pt-BR no Windows e confira Ajustes/Narração.',
      required_for: ['windows_sapi'],
    },
    {
      id: 'kokoro',
      name: 'Kokoro local',
      available: avail('kokoro'),
      detail:
        (avail('kokoro') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Configure HORUS_KOKORO_PYTHON e HORUS_KOKORO_MODEL_DIR com executável e pesos/vozes de hashes oficiais; confira Ajustes/Narração.',
      required_for: ['kokoro'],
    },
    {
      id: 'subtitle_font',
      name: 'Fonte das legendas',
      available: avail('subtitle_font'),
      detail:
        (avail('subtitle_font') ? 'Presença local verificada. ' : 'Indisponível. ') +
        'Configure HORUS_SUBTITLE_FONT com ArchivoExpanded-SemiBold.ttf ou ariblk.ttf existente, ou prepare a fonte padrão do aplicativo.',
      required_for: ['draft', 'final'],
    },
  ];
}

async function connectInSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-readiness-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

test('pronto: exibe estado verificando com aria-live e depois resumo pronto, rótulos pt-BR e detalhes acionáveis', async ({ page }) => {
  let releaseDiagnostics!: () => void;
  const gate = new Promise<void>(resolve => { releaseDiagnostics = resolve; });

  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') {
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/diagnostics') {
      await gate;
      return ok({
        checks: [{ id: 'factory', name: 'CLI fabrica', available: true, detail: 'Comando localizado.' }],
        hermes_connected: false,
        notice: 'Verificação de presença apenas.',
        production: {
          ready: true,
          missing: [],
          checks: makeProductionChecks(),
        },
      });
    }
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'not found' } });
  });

  await connectInSettings(page);

  const envSection = page.getByRole('region', { name: 'Diagnóstico do ambiente' });
  const loadingStatus = envSection.locator('[aria-live="polite"]');
  await expect(loadingStatus).toContainText(/Verificando ferramentas/i);

  releaseDiagnostics();

  const readiness = page.getByTestId('production-readiness');
  await expect(readiness).toBeVisible();
  await expect(readiness.getByRole('heading', { name: 'Pronto para produzir?' })).toBeVisible();
  await expect(readiness).toContainText('PRONTO PARA PRODUZIR');
  await expect(page.getByTestId('production-readiness-summary')).toContainText(
    'Pronto para produzir: todas as ferramentas e vozes locais foram verificadas.'
  );

  await expect(page.getByTestId('production-check-purpose-factory')).toContainText('Para: Rascunho, Final 1080×1920');
  await expect(page.getByTestId('production-check-purpose-sapi_pt_br')).toContainText('Para: Voz Windows SAPI');
  await expect(page.getByTestId('production-check-purpose-kokoro')).toContainText('Para: Voz Kokoro local');
  await expect(page.getByTestId('production-check-ffmpeg')).toContainText('DISPONÍVEL');
  await expect(page.getByTestId('production-check-ffmpeg')).toContainText('Configure HORUS_FFMPEG');
});

test('faltando itens: lista o que falta no resumo, marca INDISPONÍVEL e atualiza ao clicar em Verificar novamente', async ({ page }) => {
  let fixed = false;
  let callsAfterFix = 0;
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') {
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/diagnostics') {
      if (fixed) callsAfterFix += 1;
      const checks = makeProductionChecks(
        fixed ? {} : { ffmpeg: false, alignment_model: false, kokoro: false }
      );
      return ok({
        checks: [],
        hermes_connected: false,
        notice: 'Verificação de presença apenas.',
        production: {
          ready: fixed,
          missing: fixed ? [] : ['ffmpeg', 'alignment_model', 'kokoro'],
          checks,
        },
      });
    }
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'not found' } });
  });

  await connectInSettings(page);

  const readiness = page.getByTestId('production-readiness');
  await expect(readiness).toContainText('FALTA (3)');
  await expect(page.getByTestId('production-readiness-summary')).toContainText(
    'Falta configurar (3): FFmpeg do piloto, Modelo de alinhamento, Kokoro local.'
  );
  await expect(page.getByTestId('production-check-ffmpeg')).toContainText('INDISPONÍVEL');
  await expect(page.getByTestId('production-check-ffmpeg')).toContainText('Indisponível. Configure HORUS_FFMPEG');
  await expect(page.getByTestId('production-check-factory')).toContainText('DISPONÍVEL');

  fixed = true;
  const envSection = page.getByRole('region', { name: 'Diagnóstico do ambiente' });
  await envSection.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();

  await expect(readiness).toContainText('PRONTO PARA PRODUZIR');
  expect(callsAfterFix).toBeGreaterThanOrEqual(1);
});

test('sem grupo production (backend antigo): não quebra a tela e exibe os checks tradicionais', async ({ page }) => {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') {
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/diagnostics') {
      return ok({
        checks: [{ id: 'ffmpeg', name: 'ffmpeg', available: true, detail: 'Inspeção técnica.' }],
        notice: 'Diagnóstico sem bloco de produção.',
      });
    }
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'not found' } });
  });

  await connectInSettings(page);

  const envSection = page.getByRole('region', { name: 'Diagnóstico do ambiente' });
  await expect(envSection.getByRole('heading', { name: 'Ferramentas da operação.' })).toBeVisible();
  await expect(envSection).toContainText('Diagnóstico sem bloco de produção.');
  await expect(envSection).toContainText('Inspeção técnica.');
  await expect(page.getByTestId('production-readiness')).toHaveCount(0);
});

test('erro na consulta: exibe alerta e recupera ao clicar em Verificar novamente', async ({ page }) => {
  let fail = true;
  await page.route('http://127.0.0.1:8765/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') {
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/diagnostics') {
      if (fail) {
        return route.fulfill({
          status: 500,
          headers: corsHeaders,
          json: { detail: 'Falha ao inspecionar ferramentas locais.' },
        });
      }
      return ok({
        checks: [],
        notice: 'Verificação de presença apenas.',
        production: {
          ready: true,
          missing: [],
          checks: makeProductionChecks(),
        },
      });
    }
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'not found' } });
  });

  await connectInSettings(page);

  const envSection = page.getByRole('region', { name: 'Diagnóstico do ambiente' });
  await expect(envSection.getByRole('alert')).toContainText('Falha ao inspecionar ferramentas locais.');

  fail = false;
  await envSection.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
  await expect(page.getByTestId('production-readiness')).toContainText('PRONTO PARA PRODUZIR');
});
