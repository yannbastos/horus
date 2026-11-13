import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const WORKFLOW_ID = '11111111222233334444555566667777';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_V1_ID = '99999999888877776666555544443331';
const SCRIPT_V2_ID = '99999999888877776666555544443332';

const approvedWorkflowFixture = {
  id: WORKFLOW_ID,
  status: 'approved',
  revision: 1,
  executor: 'hermes_simulated',
  simulated: true,
  request: {
    objective: 'Escrever roteiro curto com supervisão humana.',
  },
  current_artifact_id: PROPOSAL_ARTIFACT_ID,
  pending_authorization: null,
  steps: [
    { id: 'job_step_1', workflow_id: WORKFLOW_ID, workflow_revision: 1, step_key: 'planning', step_index: 0, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:01Z', depends_on: null, error: null, result: null },
    { id: 'job_step_2', workflow_id: WORKFLOW_ID, workflow_revision: 1, step_key: 'research', step_index: 1, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:01Z', updated_at: '2026-11-12T10:00:02Z', depends_on: 'job_step_1', error: null, result: null },
    { id: 'job_step_3', workflow_id: WORKFLOW_ID, workflow_revision: 1, step_key: 'analysis', step_index: 2, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:02Z', updated_at: '2026-11-12T10:00:03Z', depends_on: 'job_step_2', error: null, result: null },
    { id: 'job_step_4', workflow_id: WORKFLOW_ID, workflow_revision: 1, step_key: 'proposal', step_index: 3, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:03Z', updated_at: '2026-11-12T10:00:04Z', depends_on: 'job_step_3', error: null, result: null },
  ],
  artifacts: [
    {
      id: PROPOSAL_ARTIFACT_ID,
      workflow_id: WORKFLOW_ID,
      revision: 1,
      stage: 'proposal',
      job_id: 'job_step_4',
      attempt_id: 'att_prop_1',
      schema_version: 2,
      content: {
        schema_version: 2,
        simulated: true,
        stage: 'proposal',
        title: 'Roteiro Escrito pelo Usuário (HOR-133)',
        result_status: 'complete',
        recommendation: {
          title_options: ['Roteiro Escrito pelo Usuário'],
          premise: 'Permitir criação e edição direta do roteiro pelo usuário.',
          angle: 'Autoria humana explícita sem IA.',
          format: 'short',
          originality: 'Texto do operador.',
          differs_from: ['video_01'],
          risks: [],
          licensing_notes: 'Uso local.',
        },
        evidence: { sources: 1, facts: 1, hypotheses: 0 },
        requires_human_review: true,
      },
      content_hash: PROPOSAL_HASH,
      created_at: '2026-11-12T10:00:04Z',
    },
  ],
  approvals: [
    {
      id: 'app_prop_1',
      workflow_id: WORKFLOW_ID,
      revision: 1,
      artifact_id: PROPOSAL_ARTIFACT_ID,
      decision: 'approve',
      feedback: '',
      created_at: '2026-11-12T10:05:00Z',
    },
  ],
  cognitive_runs: [],
  authorizations: [],
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:05:00Z',
};

function simulatedV1Record() {
  return {
    id: SCRIPT_V1_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
    proposal_content_hash: PROPOSAL_HASH,
    version: 1,
    status: 'awaiting_review',
    origin: 'simulated' as const,
    authored_by: 'simulated' as const,
    changes: null,
    document: {
      schema_version: 1 as const,
      simulated: true,
      title: 'Roteiro Simulado Inicial',
      sections: [
        {
          id: 'hook',
          kind: 'hook' as const,
          heading: 'Abertura simulada',
          narration: 'Roteiro simulado inicial para revisão.',
          source_ids: [],
        },
        {
          id: 'body',
          kind: 'body' as const,
          heading: 'Desenvolvimento simulado',
          narration: 'Corpo gerado localmente pela simulação.',
          source_ids: ['video_01'],
        },
        {
          id: 'conclusion',
          kind: 'conclusion' as const,
          heading: 'Conclusão simulada',
          narration: 'Encerramento simulado da proposta.',
          source_ids: [],
        },
      ],
    },
    created_at: '2026-11-13T10:00:00Z',
    review: null,
  };
}

async function connectAndOpenProduction(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-hor133');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await expect(page.getByText('Backend local conectado.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Roteiro e revisão humana' })).toBeVisible();
}

async function handleBaseRoutes(route: Route) {
  const request = route.request();
  const pathUrl = new URL(request.url()).pathname;
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return true;
  }
  if (pathUrl === '/health') {
    await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
    return true;
  }
  if (pathUrl === '/v1/hermes') {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
    });
    return true;
  }
  if (pathUrl === '/v1/jobs') {
    await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
    return true;
  }
  if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      json: [
        {
          id: approvedWorkflowFixture.id,
          status: approvedWorkflowFixture.status,
          revision: approvedWorkflowFixture.revision,
          created_at: approvedWorkflowFixture.created_at,
          updated_at: approvedWorkflowFixture.updated_at,
        },
      ],
    });
    return true;
  }
  if (pathUrl === `/v1/workflows/${WORKFLOW_ID}` && request.method() === 'GET') {
    await route.fulfill({ status: 200, headers: corsHeaders, json: approvedWorkflowFixture });
    return true;
  }
  if (pathUrl.endsWith('/productions')) {
    await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
    return true;
  }
  return false;
}

test.describe('Editor de roteiro na interface (HOR-133)', () => {
  test('Escrever roteiro do zero: adicionar/reordenar/remover seções, estimativa, salvar manual e aprovar', async ({ page }) => {
    let scripts: ReturnType<typeof simulatedV1Record>[] = [];
    let capturedManualBody: Record<string, unknown> | null = null;
    let capturedIdempotencyKey: string | null = null;

    await page.route('http://127.0.0.1:8765/**', async route => {
      if (await handleBaseRoutes(route)) return;
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: scripts } });
        return;
      }

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'POST') {
        capturedManualBody = request.postDataJSON() as Record<string, unknown>;
        capturedIdempotencyKey = request.headers()['idempotency-key'] ?? null;
        const doc = capturedManualBody.document as ReturnType<typeof simulatedV1Record>['document'];
        const created = {
          id: SCRIPT_V1_ID,
          workflow_id: WORKFLOW_ID,
          workflow_revision: 1,
          proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
          proposal_content_hash: PROPOSAL_HASH,
          version: 1,
          status: 'awaiting_review',
          origin: 'human' as const,
          authored_by: 'human' as const,
          changes: null,
          document: { ...doc, simulated: false },
          created_at: '2026-11-13T10:15:00Z',
          review: null,
        };
        scripts = [created as unknown as ReturnType<typeof simulatedV1Record>];
        await route.fulfill({ status: 201, headers: corsHeaders, json: created });
        return;
      }

      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}/review` && request.method() === 'POST') {
        const approved = {
          ...scripts[0],
          status: 'approved',
          review: { decision: 'approve', feedback: '', reviewed_at: '2026-11-13T10:20:00Z' },
        };
        scripts = [approved];
        await route.fulfill({ status: 200, headers: corsHeaders, json: approved });
        return;
      }

      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Not found' } });
    });

    await connectAndOpenProduction(page);

    const writeBtn = page.getByRole('button', { name: 'Escrever roteiro do zero' });
    await expect(writeBtn).toBeVisible();
    await writeBtn.click();

    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });
    await expect(editor).toBeVisible();

    await editor.getByLabel(/Título do roteiro/).fill('Meu Roteiro Manual');
    await editor.getByLabel(/Título da seção #1/).fill('Gancho Direto');
    await editor.getByLabel(/Narração da seção #1/).fill('Primeira frase do gancho humano com dez palavras exatas aqui.');
    await editor.getByLabel(/Título da seção #2/).fill('Corpo A');
    await editor.getByLabel(/Narração da seção #2/).fill('Texto do primeiro desenvolvimento.');
    await editor.getByLabel(/Título da seção #3/).fill('Fechamento');
    await editor.getByLabel(/Narração da seção #3/).fill('Conclusão clara sem simulação.');

    // Adicionar seção body, preencher, reordenar e remover uma
    await editor.getByRole('button', { name: 'Adicionar seção' }).click();
    await expect(editor.getByText('SEÇÕES DO ROTEIRO (4)')).toBeVisible();
    await editor.getByLabel(/Título da seção #3/).fill('Corpo B');
    await editor.getByLabel(/Narração da seção #3/).fill('Segundo bloco de desenvolvimento.');

    // Move Corpo B para cima (vira #2)
    await editor.getByRole('button', { name: 'Mover seção 3 para cima' }).click();
    await expect(editor.getByLabel(/Título da seção #2/)).toHaveValue('Corpo B');

    // Remove Corpo A (agora #3)
    await editor.getByRole('button', { name: 'Remover seção 3' }).click();
    await expect(editor.getByText('SEÇÕES DO ROTEIRO (3)')).toBeVisible();

    // Verifica contador de palavras e rótulo ESTIMATIVA
    await expect(editor.getByText(/\d+ palavras/).first()).toBeVisible();
    await expect(editor.getByText(/Duração total \(ESTIMATIVA\): ~\d+ s/)).toBeVisible();

    await editor.getByRole('button', { name: 'Salvar roteiro' }).click();

    expect(capturedIdempotencyKey).toBeTruthy();
    expect(capturedManualBody).toMatchObject({
      source: 'manual',
      expected_revision: 1,
      proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
      document: {
        schema_version: 1,
        simulated: false,
        title: 'Meu Roteiro Manual',
      },
    });

    // Após salvar: entra em awaiting_review sem aprovação automática e sem texto "roteiro simulado"
    const region = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    await expect(region.getByText('DOCUMENTO DO ROTEIRO · VERSÃO 1')).toBeVisible();
    await expect(region.getByText('ESCRITO POR VOCÊ').first()).toBeVisible();
    await expect(region.getByText('SIMULADO', { exact: true })).toHaveCount(0);
    await expect(region.getByText(/roteiro simulado/i)).toHaveCount(0);
    await expect(region.getByText('VERSÃO 1 AGUARDANDO REVISÃO')).toBeVisible();

    // Fluxo de aprovação existente continua funcionando
    await region.getByRole('button', { name: 'Aprovar roteiro' }).click();
    await expect(region.getByText('Aprovado', { exact: true }).first()).toBeVisible();
  });

  test('Editar roteiro simulado -> salva v2 humana + histórico exibe origem e diff de campos', async ({ page }) => {
    const v1 = simulatedV1Record();
    let scripts: unknown[] = [v1];
    let capturedVersionBody: Record<string, unknown> | null = null;

    await page.route('http://127.0.0.1:8765/**', async route => {
      if (await handleBaseRoutes(route)) return;
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: scripts } });
        return;
      }

      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}/versions` && request.method() === 'POST') {
        capturedVersionBody = request.postDataJSON() as Record<string, unknown>;
        const doc = capturedVersionBody.document as ReturnType<typeof simulatedV1Record>['document'];
        const v2 = {
          id: SCRIPT_V2_ID,
          workflow_id: WORKFLOW_ID,
          workflow_revision: 1,
          proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
          proposal_content_hash: PROPOSAL_HASH,
          version: 2,
          status: 'awaiting_review',
          origin: 'human',
          authored_by: 'human',
          changes: {
            previous_version: 1,
            title_changed: true,
            sections_added: [],
            sections_removed: [],
            sections_changed: [{ id: 'hook', fields: ['narration'] }],
            order_changed: false,
          },
          document: { ...doc, simulated: false },
          created_at: '2026-11-13T10:30:00Z',
          review: null,
        };
        scripts = [v2, v1];
        await route.fulfill({ status: 201, headers: corsHeaders, json: v2 });
        return;
      }

      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Not found' } });
    });

    await connectAndOpenProduction(page);

    await page.getByRole('button', { name: 'Editar roteiro' }).click();
    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });
    await expect(editor).toBeVisible();

    await editor.getByLabel(/Título do roteiro/).fill('Roteiro Editado pelo Usuário');
    await editor.getByLabel(/Narração da seção #1/).fill('Nova abertura escrita diretamente pelo usuário.');
    await editor.getByRole('button', { name: 'Salvar como nova versão' }).click();

    expect(capturedVersionBody).toMatchObject({
      expected_version: 1,
      document: {
        schema_version: 1,
        simulated: false,
        title: 'Roteiro Editado pelo Usuário',
      },
    });

    await expect(page.getByText('DOCUMENTO DO ROTEIRO · VERSÃO 2')).toBeVisible();
    await expect(page.getByText('ESCRITO POR VOCÊ').first()).toBeVisible();

    const history = page.getByRole('region', { name: 'Histórico de versões do roteiro' });
    await expect(history.getByText('Escrito por você')).toBeVisible();
    await expect(history.getByText('Gerado pela simulação')).toBeVisible();
    await expect(
      history.getByText('Alterações em relação à v1: título alterado · seções alteradas: hook (narração).')
    ).toBeVisible();
  });

  test('Validação no cliente bloqueia envio inválido sem chamar a API', async ({ page }) => {
    let postCalls = 0;

    await page.route('http://127.0.0.1:8765/**', async route => {
      if (await handleBaseRoutes(route)) return;
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (request.method() === 'POST') {
        postCalls += 1;
      }
      await route.fulfill({ status: 500, headers: corsHeaders, json: { detail: 'Should not be called' } });
    });

    await connectAndOpenProduction(page);
    await page.getByRole('button', { name: 'Escrever roteiro do zero' }).click();

    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });
    await editor.getByRole('button', { name: 'Salvar roteiro' }).click();

    await expect(editor.getByText('CORRIJA OS CAMPOS ANTES DE SALVAR')).toBeVisible();
    await expect(editor.getByText('O título do roteiro é obrigatório.')).toBeVisible();
    await expect(editor.getByText('O título da seção é obrigatório.').first()).toBeVisible();
    await expect(editor.getByText('A narração da seção é obrigatória.').first()).toBeVisible();
    expect(postCalls).toBe(0);
  });

  test('Conflito 409 oferece recarregar versão atual e retentativa de rede preserva Idempotency-Key', async ({ page }) => {
    const v1 = simulatedV1Record();
    const v2Server = {
      ...v1,
      id: SCRIPT_V2_ID,
      version: 2,
      origin: 'human' as const,
      authored_by: 'human' as const,
      document: { ...v1.document, simulated: false, title: 'Versão v2 já salva no servidor' },
    };

    let versionPostAttempts = 0;
    const seenKeys: string[] = [];
    let currentScripts = [v1];

    await page.route('http://127.0.0.1:8765/**', async route => {
      if (await handleBaseRoutes(route)) return;
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: currentScripts } });
        return;
      }

      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}/versions` && request.method() === 'POST') {
        versionPostAttempts += 1;
        seenKeys.push(request.headers()['idempotency-key'] ?? '');
        if (versionPostAttempts === 1) {
          await route.abort('failed');
          return;
        }
        currentScripts = [v2Server as unknown as ReturnType<typeof simulatedV1Record>, v1];
        await route.fulfill({
          status: 409,
          headers: corsHeaders,
          json: { detail: 'Versão obsoleta: edite a versão mais recente do roteiro.' },
        });
        return;
      }

      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Not found' } });
    });

    await connectAndOpenProduction(page);
    await page.getByRole('button', { name: 'Editar roteiro' }).click();
    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });
    await editor.getByLabel(/Título do roteiro/).fill('Edição concorrente');

    // 1a tentativa: falha de rede
    await editor.getByRole('button', { name: 'Salvar como nova versão' }).click();
    await expect(editor.getByText(/Falha de rede/)).toBeVisible();

    // 2a tentativa: mesma Idempotency-Key -> backend retorna 409
    await editor.getByRole('button', { name: 'Salvar como nova versão' }).click();
    expect(seenKeys.length).toBe(2);
    expect(seenKeys[0]).toBeTruthy();
    expect(seenKeys[0]).toBe(seenKeys[1]);

    await expect(editor.getByText(/Conflito de revisão ou estado \(409\)/)).toBeVisible();
    await editor.getByRole('button', { name: 'Recarregar versão atual' }).click();

    await expect(page.getByText('DOCUMENTO DO ROTEIRO · VERSÃO 2')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Versão v2 já salva no servidor' })).toBeVisible();
  });

  test('Aviso de alterações não salvas ao cancelar edição', async ({ page }) => {
    const v1 = simulatedV1Record();

    await page.route('http://127.0.0.1:8765/**', async route => {
      if (await handleBaseRoutes(route)) return;
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;

      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [v1] } });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Not found' } });
    });

    await connectAndOpenProduction(page);
    await page.getByRole('button', { name: 'Editar roteiro' }).click();
    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });

    await editor.getByLabel(/Título do roteiro/).fill('Alteração não salva');
    await expect(editor.getByText('ALTERAÇÕES NÃO SALVAS')).toBeVisible();

    await editor.getByRole('button', { name: 'Cancelar' }).click();
    const alertDialog = editor.getByRole('alertdialog', { name: 'Confirmar descarte de alterações não salvas' });
    await expect(alertDialog).toBeVisible();

    await alertDialog.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(editor.getByLabel(/Título do roteiro/)).toHaveValue('Alteração não salva');

    await editor.getByRole('button', { name: 'Cancelar' }).click();
    await editor.getByRole('button', { name: 'Descartar alterações' }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Roteiro Simulado Inicial' })).toBeVisible();
  });
});
