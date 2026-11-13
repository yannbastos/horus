import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const wid = (n: number) => `${String(n).repeat(8)}${'0'.repeat(24)}`;
const sid = (n: number) => `5c${String(n).repeat(2)}${'0'.repeat(28)}`;
const pid = (n: number) => `9d${String(n).repeat(2)}${'0'.repeat(28)}`;
const SHA = 'a'.repeat(64);

type Json = Record<string, unknown>;

function workflow(n: number, status: string, updated: string): Json {
  return { id: wid(n), status, revision: 1, created_at: '2026-11-10T10:00:00Z', updated_at: updated };
}

function script(n: number, status: string, title: string, created: string, review: Json | null = null): Json {
  return {
    id: sid(n), workflow_id: wid(n), workflow_revision: 1, proposal_artifact_id: 'aaaaaaaabbbbbbbbccccccccdddddddd',
    proposal_content_hash: 'hash', version: 1, status, created_at: created, review,
    document: { schema_version: 1, simulated: true, title, sections: [] },
  };
}

function production(n: number, overrides: Json): Json {
  return {
    id: pid(n), script_id: sid(n), script_version: 1, script_content_hash: 'h', job_id: `job${n}`, mode: 'local_pilot',
    stage: 'quality', status: 'succeeded', created_at: '2026-11-12T11:00:00Z', updated_at: '2026-11-12T11:30:00Z',
    artifacts: [], review: null, error: null, demo_only: true, publishable: false,
    quality_report: null, asset_provenance: null, quality_acknowledgement_required: false, ...overrides,
  };
}

const asset = (status: string) => ({ asset_id: 'scene-1', relative_path: 'scene-1.png', sha256: SHA, kind: 'image', origin: 'original_local', license: { commercial_use: 'allowed', attribution_required: false, verified_by: null, verified_at: null }, status });
const quality = (status: string, blocking: string[]) => ({ schema_version: 1, status, blocking_errors: blocking, warnings: [], checks: [] });

// 1 proposta aguardando aprovação · 2 aprovada sem roteiro · 3 roteiro em revisão · 4 QC reprovado
// 5 licença não verificada · 6 produção cancelada · 7 revisão aprovada · 8 produção em andamento
const WORKFLOWS: Json[] = [
  workflow(1, 'awaiting_approval', '2026-11-12T08:00:00Z'),
  workflow(2, 'approved', '2026-11-12T09:00:00Z'),
  workflow(3, 'approved', '2026-11-12T10:00:00Z'),
  workflow(4, 'approved', '2026-11-12T10:00:00Z'),
  workflow(5, 'approved', '2026-11-12T10:00:00Z'),
  workflow(6, 'approved', '2026-11-12T10:00:00Z'),
  workflow(7, 'approved', '2026-11-12T10:00:00Z'),
  workflow(8, 'approved', '2026-11-12T10:00:00Z'),
];

const SCRIPTS: Record<string, Json[]> = {
  [wid(2)]: [],
  [wid(3)]: [script(3, 'awaiting_review', 'Roteiro em revisão', '2026-11-12T10:30:00Z')],
  [wid(4)]: [script(4, 'approved', 'Vídeo com QC reprovado', '2026-11-12T10:30:00Z')],
  [wid(5)]: [script(5, 'approved', 'Vídeo com licença pendente', '2026-11-12T10:30:00Z')],
  [wid(6)]: [script(6, 'approved', 'Vídeo cancelado', '2026-11-12T10:30:00Z')],
  [wid(7)]: [script(7, 'approved', 'Vídeo revisado', '2026-11-12T10:30:00Z')],
  [wid(8)]: [script(8, 'approved', 'Vídeo em render', '2026-11-12T10:30:00Z')],
};

const PRODUCTIONS: Record<string, Json[]> = {
  [sid(4)]: [production(4, {
    quality_report: quality('fail', ['sync_drift']), asset_provenance: { schema_version: 1, assets: [asset('verified')] },
    quality_acknowledgement_required: true, updated_at: '2026-11-12T12:00:00Z',
  })],
  [sid(5)]: [production(5, {
    quality_report: quality('pass', []), asset_provenance: { schema_version: 1, assets: [asset('unverified')] },
    updated_at: '2026-11-12T13:00:00Z',
  })],
  [sid(6)]: [production(6, { status: 'cancelled', stage: 'render', updated_at: '2026-11-12T14:00:00Z' })],
  [sid(7)]: [production(7, {
    mode: 'simulated', stage: 'review', updated_at: '2026-11-12T15:00:00Z',
    review: { decision: 'approve', artifact_sha256: SHA, reviewed_at: '2026-11-12T15:00:00Z' },
  })],
  [sid(8)]: [production(8, { mode: 'local_demo', status: 'running', stage: 'render', updated_at: '2026-11-12T16:00:00Z' })],
};

type Options = { workflowsFail?: boolean; scriptsFail?: string[]; workflows?: Json[] };

async function installBackend(page: Page, options: Options = {}) {
  const authHeaders: string[] = [];
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (path.startsWith('/v1/')) authHeaders.push(request.headers()['authorization'] ?? '');
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (path === '/health') return ok({ status: 'ready' });
    if (path === '/v1/hermes') return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    if (path === '/v1/jobs') return ok([]);
    if (path === '/v1/workflows') {
      if (options.workflowsFail) return route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Banco local indisponível.' } });
      return ok(options.workflows ?? WORKFLOWS);
    }
    const scriptsMatch = path.match(/^\/v1\/workflows\/([^/]+)\/scripts$/);
    if (scriptsMatch) {
      if (options.scriptsFail?.includes(scriptsMatch[1])) return route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Falha ao ler roteiros.' } });
      return ok({ items: SCRIPTS[scriptsMatch[1]] ?? [] });
    }
    const productionsMatch = path.match(/^\/v1\/scripts\/([^/]+)\/productions$/);
    if (productionsMatch) return ok({ items: PRODUCTIONS[productionsMatch[1]] ?? [] });
    const licenseMatch = path.match(/^\/v1\/productions\/([^/]+)\/license-reviews$/);
    if (licenseMatch) return ok({ production_id: licenseMatch[1], current: [], history: [], effective_provenance: null, publishable: false });
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: `não mockado: ${path}` } });
  });
  return authHeaders;
}

async function openCenter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-center-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Central de Produção', exact: true }).click();
}

const row = (page: Page, n: number) => page.getByTestId(`center-row-${wid(n)}`);

test('mostra cada vídeo em sua etapa real com o próximo bloqueio e a ação humana', async ({ page }) => {
  const auth = await installBackend(page);
  await openCenter(page);
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Vídeo', 'Etapa', 'Status', 'Próximo bloqueio', 'Licenças', 'Atualização', 'Ação']);
  await expect(page.getByRole('row')).toHaveCount(WORKFLOWS.length + 1);

  await expect(row(page, 1)).toContainText('Proposta (aprovação)');
  await expect(row(page, 1)).toContainText('Aguardando aprovação da proposta.');
  await expect(row(page, 2)).toContainText('Roteiro (a gerar)');
  await expect(row(page, 2)).toContainText('gerar o roteiro');
  await expect(row(page, 3)).toContainText('Roteiro v1');
  await expect(row(page, 3)).toContainText('Aguardando aprovação do roteiro.');
  await expect(row(page, 3)).toContainText('Roteiro em revisão');
  await expect(row(page, 8)).toContainText('Produção (render)');
  await expect(row(page, 8)).toContainText('Produção em andamento; sem ação humana pendente.');
  await expect(row(page, 7)).toContainText('Revisão humana');
  await expect(row(page, 7)).toContainText('Revisão concluída; não existe publicação.');
  expect(auth.length).toBeGreaterThan(0);
  expect(auth.every(value => value === 'Bearer test-session-token-center-0123456789')).toBe(true);
});

test('QC reprovado exige reconhecimento e licença não verificada é sinalizada', async ({ page }) => {
  await installBackend(page);
  await openCenter(page);
  await expect(row(page, 4)).toContainText('QC reprovado (1 erro(s) bloqueante(s)): a aprovação exige reconhecimento dos erros.');
  await expect(row(page, 4)).toContainText('Aguardando revisão humana');
  await expect(row(page, 4)).toContainText('Verificadas');
  await expect(row(page, 5)).toContainText('Licenças de assets não verificadas.');
  await expect(row(page, 5)).toContainText('Não verificadas');
  await expect(row(page, 5)).not.toContainText('QC reprovado');
});

test('produção cancelada exige conciliação e o atalho abre a tela de Produção', async ({ page }) => {
  await installBackend(page);
  await openCenter(page);
  await expect(row(page, 6)).toContainText('Produção cancelada');
  await expect(row(page, 6)).toContainText('conciliação é exigida antes de iniciar uma nova produção');
  await row(page, 6).getByRole('button', { name: /Conciliar na Produção/ }).click();
  await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
});

test('estados sem dado real aparecem como não informado, nunca como sucesso', async ({ page }) => {
  await installBackend(page, {
    workflows: [workflow(9, 'estado_novo', '2026-11-12T08:00:00Z'), WORKFLOWS[3]],
  });
  await openCenter(page);
  await expect(row(page, 9)).toContainText('não informado');
  await expect(row(page, 9)).not.toContainText('Aprovada');
  // produção local_pilot sem proveniência: licença desconhecida, nunca "verificada"
  await expect(row(page, 4)).toContainText('Verificadas');
});

test('licença sem proveniência no registro aparece como não informado', async ({ page }) => {
  const noProvenance = [workflow(5, 'approved', '2026-11-12T10:00:00Z')];
  await installBackend(page, { workflows: noProvenance });
  await page.route('http://127.0.0.1:8765/v1/scripts/*/productions', async route => {
    await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [production(5, { quality_report: quality('pass', []), asset_provenance: null })] } });
  });
  await openCenter(page);
  await expect(row(page, 5)).toContainText('Licenças de assets não informado.');
  await expect(row(page, 5)).not.toContainText('Verificadas');
});

test('filtros por etapa e por bloqueio, ordenados por atualização', async ({ page }) => {
  await installBackend(page);
  await openCenter(page);
  await expect(page.getByRole('row')).toHaveCount(WORKFLOWS.length + 1);

  const firstRows = page.locator('tbody tr');
  await expect(firstRows.first()).toContainText('Vídeo em render'); // atualização mais recente (16:00)
  await expect(firstRows.last()).toContainText('Vídeo '); // proposta mais antiga

  await page.getByRole('combobox', { name: 'ETAPA' }).selectOption('production');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(row(page, 6)).toBeVisible();
  await expect(row(page, 8)).toBeVisible();

  await page.getByRole('combobox', { name: 'ETAPA' }).selectOption('all');
  await page.getByLabel('Somente com bloqueio (ação humana)').check();
  await expect(row(page, 8)).toHaveCount(0); // em andamento: não é bloqueio
  await expect(row(page, 7)).toHaveCount(0); // revisão concluída
  await expect(row(page, 4)).toBeVisible();
  await expect(page.getByText(/vídeo\(s\) exibido\(s\)/)).toContainText('6 de 8');
});

test('falha ao carregar mostra alerta e permite tentar novamente', async ({ page }) => {
  await installBackend(page, { workflowsFail: true });
  await openCenter(page);
  await expect(page.getByRole('alert')).toContainText('Banco local indisponível.');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ATUALIZAR' })).toBeEnabled();
});

test('falha parcial em roteiros marca dados incompletos sem inventar etapa', async ({ page }) => {
  await installBackend(page, { scriptsFail: [wid(3)] });
  await openCenter(page);
  await expect(row(page, 3)).toContainText('Roteiros não informado: falha ao consultar.');
  await expect(row(page, 3)).toContainText('Dados incompletos');
  await expect(row(page, 4)).toContainText('QC reprovado');
});

test('a tabela é navegável por teclado', async ({ page }) => {
  await installBackend(page);
  await openCenter(page);
  const button = row(page, 3).getByRole('button', { name: /Revisar roteiro/ });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
});
