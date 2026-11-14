import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
};

const WORKFLOW_ID = '11111111000000000000000000000000';
const SCRIPT_ID = '5c110000000000000000000000000000';
const PRODUCTION_ID = '9d110000000000000000000000000000';
const SHA = 'a'.repeat(64);

type Json = Record<string, unknown>;

type MockScenario = {
  defaultVoice?: { provider: string; voice_id: string } | null;
  voiceFail?: boolean;
  workflows?: Json[];
  workflowsFail?: boolean;
  scripts?: Json[];
  scriptsFail?: boolean;
  productions?: Json[];
  productionsFail?: boolean;
};

function makeWorkflow(status = 'approved'): Json {
  return {
    id: WORKFLOW_ID,
    status,
    revision: 1,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:05:00Z',
  };
}

function makeScript(status: 'awaiting_review' | 'approved'): Json {
  return {
    id: SCRIPT_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: 'aaaaaaaabbbbbbbbccccccccdddddddd',
    proposal_content_hash: 'hash-proposta',
    version: 1,
    status,
    origin: 'human',
    authored_by: 'human',
    created_at: '2026-11-12T10:15:00Z',
    review:
      status === 'approved'
        ? { decision: 'approve', feedback: '', reviewed_at: '2026-11-12T10:20:00Z' }
        : null,
    document: {
      schema_version: 1,
      simulated: false,
      title: 'Meu primeiro vídeo piloto',
      sections: [
        { id: 'inicio', kind: 'hook', heading: 'Gancho', narration: 'Abertura.', source_ids: [] },
        { id: 'meio', kind: 'body', heading: 'Desenvolvimento', narration: 'Corpo.', source_ids: [] },
        { id: 'fim', kind: 'conclusion', heading: 'Conclusão', narration: 'Fechamento.', source_ids: [] },
      ],
    },
  };
}

function makeProduction(overrides: Json): Json {
  return {
    id: PRODUCTION_ID,
    script_id: SCRIPT_ID,
    script_version: 1,
    script_content_hash: 'hash-roteiro',
    job_id: 'job-first-video-1',
    mode: 'local_pilot',
    render_quality: 'final',
    narration: { provider: 'kokoro', voice_id: 'pf_dora' },
    stage: 'render',
    status: 'running',
    created_at: '2026-11-12T11:00:00Z',
    updated_at: '2026-11-12T11:10:00Z',
    artifacts: [],
    review: null,
    error: null,
    demo_only: true,
    publishable: false,
    quality_report: null,
    asset_provenance: null,
    quality_acknowledgement_required: false,
    ...overrides,
  };
}

async function installBackend(page: Page, scenario: MockScenario) {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });

    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') {
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/jobs') return ok([]);
    if (path === '/v1/narration/preference') {
      if (scenario.voiceFail) {
        return route.fulfill({
          status: 500,
          headers: corsHeaders,
          json: { code: 'narration_preference_error', message: 'Falha ao ler preferência de voz.' },
        });
      }
      if (!scenario.defaultVoice) {
        return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Nenhuma voz padrão salva.' } });
      }
      return ok(scenario.defaultVoice);
    }
    if (path === '/v1/workflows') {
      if (scenario.workflowsFail) {
        return route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Banco indisponível.' } });
      }
      return ok(scenario.workflows ?? []);
    }
    if (path === `/v1/workflows/${WORKFLOW_ID}/scripts`) {
      if (scenario.scriptsFail) {
        return route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Falha ao ler roteiros.' } });
      }
      return ok({ items: scenario.scripts ?? [] });
    }
    if (path === `/v1/scripts/${SCRIPT_ID}/productions`) {
      if (scenario.productionsFail) {
        return route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Falha ao ler produções.' } });
      }
      return ok({ items: scenario.productions ?? [] });
    }
    if (path === `/v1/productions/${PRODUCTION_ID}/license-reviews`) {
      return ok({
        production_id: PRODUCTION_ID,
        current: [],
        history: [],
        effective_provenance: null,
        publishable: false,
      });
    }
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: `não mockado: ${path}` } });
  });
}

async function openProductionCenter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-first-video-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Central de Produção', exact: true }).click();
}

test('nada feito: exibe os 5 passos pendentes em lista ordenada acessível', async ({ page }) => {
  await installBackend(page, { defaultVoice: null, workflows: [] });
  await openProductionCenter(page);

  const guide = page.getByTestId('first-video-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('0 de 5 passos concluídos.');

  const list = guide.locator('ol');
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveCount(5);

  const steps = ['voice', 'write_script', 'approve_script', 'produce_final', 'review_approve'];
  for (const step of steps) {
    await expect(page.getByTestId(`guide-step-${step}`)).toContainText('Pendente');
  }
  await expect(page.getByTestId('guide-step-voice')).toHaveAttribute('aria-current', 'step');
});

test('voz escolhida: marca passo 1 como feito e navega para Ajustes e Produção', async ({ page }) => {
  await installBackend(page, {
    defaultVoice: { provider: 'kokoro', voice_id: 'pf_dora' },
    workflows: [],
  });
  await openProductionCenter(page);

  const guide = page.getByTestId('first-video-guide');
  await expect(guide).toContainText('1 de 5 passos concluídos.');
  await expect(page.getByTestId('guide-step-voice')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-write_script')).toContainText('Pendente');
  await expect(page.getByTestId('guide-step-write_script')).toHaveAttribute('aria-current', 'step');

  await page.getByTestId('guide-step-voice').getByRole('button', { name: /Abrir Ajustes/i }).click();
  await expect(page.getByRole('heading', { name: 'Aparência' })).toBeVisible();

  await page.getByRole('button', { name: 'Central de Produção', exact: true }).click();
  await page.getByTestId('guide-step-write_script').getByRole('button', { name: /Abrir Produção/i }).click();
  await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
});

test('roteiro aprovado: passos 1 a 3 feitos e passos 4 e 5 pendentes', async ({ page }) => {
  await installBackend(page, {
    defaultVoice: { provider: 'kokoro', voice_id: 'pf_dora' },
    workflows: [makeWorkflow('approved')],
    scripts: [makeScript('approved')],
    productions: [],
  });
  await openProductionCenter(page);

  await expect(page.getByTestId('first-video-guide')).toContainText('3 de 5 passos concluídos.');
  await expect(page.getByTestId('guide-step-voice')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-write_script')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-approve_script')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-produce_final')).toContainText('Pendente');
  await expect(page.getByTestId('guide-step-review_approve')).toContainText('Pendente');
});

test('produção em andamento: passo 4 exibe Em andamento para Final 1080×1920', async ({ page }) => {
  await installBackend(page, {
    defaultVoice: { provider: 'kokoro', voice_id: 'pf_dora' },
    workflows: [makeWorkflow('approved')],
    scripts: [makeScript('approved')],
    productions: [makeProduction({ status: 'running', stage: 'render', render_quality: 'final' })],
  });
  await openProductionCenter(page);

  await expect(page.getByTestId('first-video-guide')).toContainText('3 de 5 passos concluídos.');
  await expect(page.getByTestId('guide-step-produce_final')).toContainText('Em andamento');
  await expect(page.getByTestId('guide-step-produce_final')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('guide-step-review_approve')).toContainText('Pendente');
});

test('vídeo aprovado: painel some sozinho e oferece opção de reabrir', async ({ page }) => {
  await installBackend(page, {
    defaultVoice: { provider: 'kokoro', voice_id: 'pf_dora' },
    workflows: [makeWorkflow('approved')],
    scripts: [makeScript('approved')],
    productions: [
      makeProduction({
        status: 'succeeded',
        stage: 'review',
        render_quality: 'final',
        review: { decision: 'approve', artifact_sha256: SHA, reviewed_at: '2026-11-12T12:00:00Z' },
      }),
    ],
  });
  await openProductionCenter(page);

  await expect(page.getByTestId('first-video-guide')).toHaveCount(0);
  const reopenBar = page.getByTestId('first-video-guide-reopen');
  await expect(reopenBar).toBeVisible();
  await expect(reopenBar).toContainText('Primeiro vídeo aprovado.');

  await reopenBar.getByRole('button', { name: /Reabrir guia/i }).click();
  const guide = page.getByTestId('first-video-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('5 de 5 passos concluídos.');
  await expect(page.getByTestId('guide-step-review_approve')).toContainText('Feito');
});

test('falha de API num passo mostra "não foi possível verificar" sem quebrar os demais', async ({ page }) => {
  await installBackend(page, {
    voiceFail: true,
    workflows: [makeWorkflow('approved')],
    scripts: [makeScript('approved')],
    productions: [],
  });
  await openProductionCenter(page);

  const guide = page.getByTestId('first-video-guide');
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('guide-step-voice')).toContainText('não foi possível verificar');
  await expect(page.getByTestId('guide-step-write_script')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-approve_script')).toContainText('Feito');
  await expect(page.getByTestId('guide-step-produce_final')).toContainText('Pendente');
});

test('recolher lembra preferência no localStorage, funciona sem localStorage e navega por teclado', async ({ page }) => {
  await installBackend(page, {
    defaultVoice: { provider: 'kokoro', voice_id: 'pf_dora' },
    workflows: [],
  });
  await openProductionCenter(page);

  const toggle = page.getByTestId('first-video-guide').getByRole('button', { name: 'RECOLHER' });
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('#first-video-guide-list')).toHaveCount(0);
  await expect(page.getByTestId('first-video-guide').getByRole('button', { name: 'EXPANDIR' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // Recarrega e confirma que permanece recolhido via localStorage.
  await openProductionCenter(page);
  await expect(page.locator('#first-video-guide-list')).toHaveCount(0);
  await page.getByTestId('first-video-guide').getByRole('button', { name: 'EXPANDIR' }).click();
  await expect(page.locator('#first-video-guide-list')).toBeVisible();

  // Simula localStorage bloqueado/indisponível para a chave do guia: o painel continua funcionando sem lançar erro.
  await page.addInitScript(() => {
    const original = window.localStorage;
    const wrapped = {
      getItem: (key: string) => {
        if (key === 'horus.first_video_guide.collapsed') throw new Error('SecurityError');
        return original.getItem(key);
      },
      setItem: (key: string, value: string) => {
        if (key === 'horus.first_video_guide.collapsed') throw new Error('QuotaExceededError');
        original.setItem(key, value);
      },
      removeItem: (key: string) => original.removeItem(key),
      clear: () => original.clear(),
      key: (index: number) => original.key(index),
      get length() { return original.length; },
    };
    Object.defineProperty(window, 'localStorage', { value: wrapped, configurable: true });
  });
  await openProductionCenter(page);
  await expect(page.getByTestId('first-video-guide')).toBeVisible();
  await page.getByTestId('first-video-guide').getByRole('button', { name: 'RECOLHER' }).click();
  await expect(page.locator('#first-video-guide-list')).toHaveCount(0);
});
