import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/script-review-m3');
fs.mkdirSync(artifactDir, { recursive: true });

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const WORKFLOW_ID = '11111111222233334444555566667777';
const WORKFLOW_ID_2 = '22222222333344445555666677778888';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_V1_ID = '99999999888877776666555544443331';
const SCRIPT_V2_ID = '99999999888877776666555544443332';

async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-m3-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

const mockProposalContent = {
  schema_version: 2,
  simulated: true,
  stage: 'proposal',
  title: 'Automação Local de Roteiros com Supervisão Humana',
  result_status: 'complete',
  recommendation: {
    title_options: [
      'Automação Local de Roteiros com Supervisão Humana',
      'Como Estruturar Roteiros Curtos com Evidências',
    ],
    premise: 'Demonstrar o fluxo de roteirização local auditável a partir de propostas aprovadas.',
    angle: 'Controle editorial humano em cada etapa sem acionar nuvem ou renderização automática.',
    format: 'short',
    originality: 'Vinculação estrita às fontes do snapshot aprovado.',
    differs_from: ['video_01'],
    risks: ['Manter ritmo conciso na seção de desenvolvimento.'],
    licensing_notes: 'Dados derivados exclusivamente do dataset local.',
  },
  evidence: {
    sources: 2,
    facts: 2,
    hypotheses: 1,
  },
  requires_human_review: true,
};

function createWorkflowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKFLOW_ID,
    status: 'approved',
    revision: 1,
    executor: 'hermes_simulated',
    simulated: true,
    request: {
      objective: 'Derivar roteiro curto fundamentado nas evidências aprovadas do Radar.',
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
        content: mockProposalContent,
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
    ...overrides,
  };
}

function createScriptRecordFixture(version: 1 | 2, status = 'awaiting_review', review: unknown = null) {
  return {
    id: version === 1 ? SCRIPT_V1_ID : SCRIPT_V2_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
    proposal_content_hash: PROPOSAL_HASH,
    version,
    status,
    document: {
      schema_version: 1 as const,
      simulated: true as const,
      title:
        version === 1
          ? 'Roteiro Editorial v1: Automação Local com Supervisão'
          : 'Roteiro Editorial v2: Comparativo Prático e Gancho Direto',
      sections: [
        {
          id: 'sec_hook',
          kind: 'hook' as const,
          heading: version === 1 ? 'Gancho inicial sobre autonomia local' : 'Gancho enxuto: controle total em 60 segundos',
          narration:
            version === 1
              ? 'Você sabia que é possível validar propostas e roteiros inteiros sem enviar nada para a nuvem?'
              : 'Em menos de um minuto, veja como transformar uma proposta aprovada em roteiro auditável na sua máquina.',
          source_ids: ['video_01'],
        },
        {
          id: 'sec_body_1',
          kind: 'body' as const,
          heading:
            version === 1
              ? 'Estrutura em etapas com revisão humana'
              : 'Comparação prática: evidências do Radar e revisão por seção',
          narration:
            version === 1
              ? 'Cada seção do roteiro referencia somente as fontes permitidas pela proposta editorial aprovada.'
              : 'Na prática, o operador confere gancho, desenvolvimento e conclusão com rastreabilidade das fontes video_01 e video_02.',
          source_ids: version === 1 ? ['video_01'] : ['video_01', 'video_02'],
        },
        {
          id: 'sec_conclusion',
          kind: 'conclusion' as const,
          heading: 'Fechamento e chamada para próxima decisão',
          narration:
            'A aprovação encerra a etapa de revisão documental sem disparar renderização automática ou custos externos.',
          source_ids: [],
        },
      ],
    },
    created_at: version === 1 ? '2026-11-12T10:10:00Z' : '2026-11-12T10:20:00Z',
    review,
  };
}

test.describe('M3 — Roteiro Estruturado Simulado e Revisão Humana (HOR-050)', () => {
  test('Bloqueia geração enquanto proposta não estiver aprovada e libera após aprovação da proposta', async ({
    page,
  }) => {
    let scriptPostCalls = 0;
    let currentWf = createWorkflowFixture({
      status: 'awaiting_approval',
      approvals: [],
    });

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [
            {
              id: currentWf.id,
              status: currentWf.status,
              revision: currentWf.revision,
              created_at: currentWf.created_at,
              updated_at: currentWf.updated_at,
            },
          ],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/review` && request.method() === 'POST') {
        const approval = {
          id: 'app_prop_1',
          workflow_id: WORKFLOW_ID,
          revision: 1,
          artifact_id: PROPOSAL_ARTIFACT_ID,
          decision: 'approve',
          feedback: '',
          created_at: '2026-11-12T10:05:00Z',
        };
        currentWf = {
          ...currentWf,
          status: 'approved',
          approvals: [approval],
        };
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { approval, workflow: currentWf },
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'POST') {
        scriptPostCalls += 1;
        await route.fulfill({ status: 201, headers: corsHeaders, json: createScriptRecordFixture(1) });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    await expect(scriptRegion).toBeVisible();
    await expect(scriptRegion.getByText('PROPOSTA AINDA NÃO APROVADA')).toBeVisible();

    const disabledGenerateBtn = scriptRegion.getByRole('button', { name: /Gerar roteiro/i });
    await expect(disabledGenerateBtn).toBeDisabled();
    expect(scriptPostCalls).toBe(0);

    // Approve the editorial proposal first
    await page.getByRole('region', { name: 'Decisão editorial' }).getByRole('button', { name: 'Aprovar', exact: true }).click();

    // Now script generation becomes available
    const enabledGenerateBtn = scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true });
    await expect(enabledGenerateBtn).toBeEnabled();
  });

  test('Fluxo completo M3: gerar v1 -> solicitar alterações -> gerar v2 preservando histórico -> aprovar v2 -> manter após recarregar', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    let scriptsStore: ReturnType<typeof createScriptRecordFixture>[] = [];
    const receivedIdempotencyKeys: string[] = [];

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [
            {
              id: currentWf.id,
              status: currentWf.status,
              revision: currentWf.revision,
              created_at: currentWf.created_at,
              updated_at: currentWf.updated_at,
            },
          ],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        const sorted = [...scriptsStore].sort((a, b) => b.version - a.version);
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: sorted } });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'POST') {
        const idemKey = request.headers()['idempotency-key'];
        expect(idemKey).toBeTruthy();
        receivedIdempotencyKeys.push(idemKey);

        const body = request.postDataJSON();
        expect(body).toEqual({
          expected_revision: 1,
          proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
        });

        const nextVersion = scriptsStore.length === 0 ? 1 : 2;
        const created = createScriptRecordFixture(nextVersion as 1 | 2, 'awaiting_review', null);
        scriptsStore = [created, ...scriptsStore];
        await route.fulfill({ status: 201, headers: corsHeaders, json: created });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}` && request.method() === 'GET') {
        const found = scriptsStore.find(s => s.id === SCRIPT_V1_ID);
        await route.fulfill({ status: found ? 200 : 404, headers: corsHeaders, json: found ?? { detail: 'Não encontrado' } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}` && request.method() === 'GET') {
        const found = scriptsStore.find(s => s.id === SCRIPT_V2_ID);
        await route.fulfill({ status: found ? 200 : 404, headers: corsHeaders, json: found ?? { detail: 'Não encontrado' } });
        return;
      }
      if (pathUrl.startsWith('/v1/scripts/') && pathUrl.endsWith('/review') && request.method() === 'POST') {
        const idemKey = request.headers()['idempotency-key'];
        expect(idemKey).toBeTruthy();
        receivedIdempotencyKeys.push(idemKey);

        const scriptId = pathUrl.split('/')[3];
        const body = request.postDataJSON();
        const target = scriptsStore.find(s => s.id === scriptId);
        if (!target || target.version !== body.expected_version || target.status !== 'awaiting_review') {
          await route.fulfill({
            status: 409,
            headers: corsHeaders,
            json: { detail: 'Versão ou estado do roteiro conflitante para revisão.' },
          });
          return;
        }

        const nextStatus =
          body.decision === 'approve'
            ? 'approved'
            : body.decision === 'reject'
            ? 'rejected'
            : 'changes_requested';

        const updated = {
          ...target,
          status: nextStatus,
          review: {
            decision: body.decision,
            feedback: body.feedback ?? '',
            reviewed_at: '2026-11-12T10:15:00Z',
          },
        };
        scriptsStore = scriptsStore.map(s => (s.id === scriptId ? updated : s));
        await route.fulfill({ status: 200, headers: corsHeaders, json: updated });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    await expect(scriptRegion).toBeVisible();
    await expect(scriptRegion.getByText('PRONTO PARA GERAR')).toBeVisible();

    // 1. Generate v1
    await scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true }).click();

    // Verify v1 sections, SIMULADO badge, proposal & revision metadata
    const docV1Region = scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' });
    await expect(docV1Region).toBeVisible();
    await expect(docV1Region.getByText('SIMULADO', { exact: true })).toBeVisible();
    await expect(docV1Region.getByRole('heading', { name: 'Roteiro Editorial v1: Automação Local com Supervisão' })).toBeVisible();
    await expect(docV1Region.getByText(`${PROPOSAL_ARTIFACT_ID} (Rev. 1)`)).toBeVisible();
    await expect(docV1Region.getByText(PROPOSAL_HASH)).toBeVisible();

    // Verify all 3 sections (hook, body, conclusion) and source references
    await expect(docV1Region.getByText('GANCHO · HOOK')).toBeVisible();
    await expect(docV1Region.getByText('DESENVOLVIMENTO · BODY')).toBeVisible();
    await expect(docV1Region.getByText('CONCLUSÃO · CONCLUSION')).toBeVisible();
    await expect(docV1Region.getByText('Fontes: video_01').first()).toBeVisible();
    await expect(docV1Region.getByText('Sem fontes vinculadas')).toBeVisible();

    // Generation button must be disabled while awaiting_review
    await expect(scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true })).toBeDisabled();

    await scriptRegion.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'script-v1-awaiting-review-dark.png') });

    // 2. Human review of v1: request_changes requires non-empty feedback
    const reviewBox = scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' });
    const requestChangesBtn = reviewBox.getByRole('button', { name: 'Solicitar alterações no roteiro', exact: true });
    await expect(requestChangesBtn).toBeDisabled();

    const feedbackText = 'Incluir comparação prática com video_02 no desenvolvimento e tornar o gancho mais direto.';
    await reviewBox.getByLabel('Feedback do roteiro').fill(feedbackText);
    await expect(requestChangesBtn).toBeEnabled();
    await requestChangesBtn.click();

    // Verify v1 status updated to changes_requested and feedback is visible
    await expect(scriptRegion.getByText('ALTERAÇÕES SOLICITADAS NA VERSÃO 1')).toBeVisible();
    await expect(scriptRegion.getByText(feedbackText).first()).toBeVisible();

    // 3. Generate v2 after changes_requested
    const generateV2Btn = scriptRegion.getByRole('button', { name: 'Gerar nova versão do roteiro', exact: true });
    await expect(generateV2Btn).toBeEnabled();
    await generateV2Btn.click();

    // Verify v2 is displayed and v1 is preserved in history
    const docV2Region = scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 2' });
    await expect(docV2Region).toBeVisible();
    await expect(docV2Region.getByRole('heading', { name: 'Roteiro Editorial v2: Comparativo Prático e Gancho Direto' })).toBeVisible();
    await expect(docV2Region.getByText('Fontes: video_01, video_02')).toBeVisible();

    const historyRegion = scriptRegion.getByRole('region', { name: 'Histórico de versões do roteiro' });
    await expect(historyRegion).toBeVisible();
    await expect(historyRegion.getByText('HISTÓRICO DE VERSÕES DO ROTEIRO (2)')).toBeVisible();
    await expect(historyRegion.getByText('Versão 2')).toBeVisible();
    await expect(historyRegion.getByText('Versão 1')).toBeVisible();
    await expect(historyRegion.getByText( new RegExp(feedbackText) )).toBeVisible();

    // Inspect v1 in history and return to v2
    await historyRegion.getByRole('button', { name: 'Ver v1', exact: true }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();
    await historyRegion.getByRole('button', { name: 'Ver v2', exact: true }).click();
    await expect(docV2Region).toBeVisible();

    // 4. Approve v2
    const reviewV2Box = scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' });
    await reviewV2Box.getByRole('button', { name: 'Aprovar roteiro', exact: true }).click();

    // Verify v2 is approved, review box is gone, and generation is disabled
    await expect(scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' })).toHaveCount(0);
    await expect(docV2Region.getByText('Aprovado').first()).toBeVisible();
    await expect(scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true })).toBeDisabled();

    await historyRegion.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'script-v2-approved-history-dark.png') });

    // 5. Switch to Light theme and check 1040x680 responsiveness + persistence across navigation
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'CLARO', exact: true }).click();
    await page.setViewportSize({ width: 1040, height: 680 });
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 2' })).toBeVisible();
    await expect(historyRegion.getByText('HISTÓRICO DE VERSÕES DO ROTEIRO (2)')).toBeVisible();
    await scriptRegion.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifactDir, 'script-v2-approved-light-1040.png') });

    expect(receivedIdempotencyKeys.length).toBe(4);
  });

  test('Rejeição de roteiro encerra o fluxo de revisão sem habilitar nova geração', async ({ page }) => {
    const currentWf = createWorkflowFixture();
    let scriptRecord = createScriptRecordFixture(1, 'awaiting_review', null);

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [currentWf] });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptRecord] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}/review` && request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body.decision).toBe('reject');
        scriptRecord = {
          ...scriptRecord,
          status: 'rejected',
          review: {
            decision: 'reject',
            feedback: body.feedback ?? '',
            reviewed_at: '2026-11-12T10:18:00Z',
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: scriptRecord });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    const reviewBox = scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' });
    await reviewBox.getByLabel('Feedback do roteiro').fill('Premissa desalinhada com o canal.');
    await reviewBox.getByRole('button', { name: 'Rejeitar roteiro', exact: true }).click();

    await expect(scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' })).toHaveCount(0);
    await expect(scriptRegion.getByText('Rejeitado').first()).toBeVisible();
    await expect(scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true })).toBeDisabled();
  });

  test('Clique duplo não duplica submissão e retentativa após falha de rede preserva Idempotency-Key', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    let postAttempts = 0;
    const keysUsed: string[] = [];
    let releaseFirstPost!: () => void;
    const firstPostGate = new Promise<void>(resolve => {
      releaseFirstPost = resolve;
    });
    let simulateNetworkFailureOnce = true;

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [currentWf] });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'POST') {
        postAttempts += 1;
        keysUsed.push(request.headers()['idempotency-key']);
        if (simulateNetworkFailureOnce) {
          simulateNetworkFailureOnce = false;
          await route.abort('failed');
          return;
        }
        await firstPostGate;
        await route.fulfill({ status: 201, headers: corsHeaders, json: createScriptRecordFixture(1) });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    const genBtn = scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true });
    await expect(genBtn).toBeEnabled();

    // 1. First click hits transient network failure
    await genBtn.click();
    await expect(scriptRegion.getByRole('alert')).toContainText('Falha de rede ao comunicar com o backend local');
    expect(postAttempts).toBe(1);

    // 2. Retry with rapid double-click via DOM dispatch while request is in-flight
    await genBtn.evaluate((btn: HTMLButtonElement) => {
      btn.click();
      btn.click();
    });

    await expect(scriptRegion.getByRole('button', { name: 'Processando…', exact: true })).toBeDisabled();
    // Only one additional POST was fired despite two synchronous clicks
    expect(postAttempts).toBe(2);
    // And it reused the exact same Idempotency-Key after the network failure!
    expect(keysUsed[1]).toBe(keysUsed[0]);

    releaseFirstPost();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();
  });

  test('Exibe erros 401, 409, 422 explicitamente sem esconder e troca de workflow não alega cancelamento inexistente', async ({
    page,
  }) => {
    const wf1 = createWorkflowFixture();
    const wf2 = createWorkflowFixture({
      id: WORKFLOW_ID_2,
      request: { objective: 'Segundo workflow aprovado para verificar isolamento na troca.' },
    });

    let nextPostError: { status: number; detail: string } | null = {
      status: 401,
      detail: 'Token de sessão inválido ou expirado.',
    };
    let scriptsWf1: ReturnType<typeof createScriptRecordFixture>[] = [];

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [wf1, wf2] });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: wf1 });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID_2}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: wf2 });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: scriptsWf1 } });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID_2}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'POST') {
        if (nextPostError) {
          await route.fulfill({
            status: nextPostError.status,
            headers: corsHeaders,
            json: { detail: nextPostError.detail },
          });
          return;
        }
        const created = createScriptRecordFixture(1);
        scriptsWf1 = [created];
        await route.fulfill({ status: 201, headers: corsHeaders, json: created });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    const genBtn = scriptRegion.getByRole('button', { name: 'Gerar roteiro simulado', exact: true });

    // 1. 401 Unauthorized
    await genBtn.click();
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Sessão não autorizada (401): Token de sessão inválido ou expirado.'
    );

    // 2. 409 Conflict (e.g. divergent payload / stale revision / already exists)
    nextPostError = {
      status: 409,
      detail: 'Chave de idempotência reutilizada com payload divergente ou revisão desatualizada.',
    };
    await genBtn.click();
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Conflito de revisão ou estado (409): Chave de idempotência reutilizada com payload divergente ou revisão desatualizada.'
    );

    // 3. 422 Unprocessable Entity (contract / source_id validation failure)
    nextPostError = {
      status: 422,
      detail: 'Fonte referenciada na seção sec_body_1 não pertence ao snapshot aprovado.',
    };
    await genBtn.click();
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Contrato ou payload inválido (422): Fonte referenciada na seção sec_body_1 não pertence ao snapshot aprovado.'
    );

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'script-error-422-dark.png') });

    // 4. Switching workflows clears local alert, does not claim backend cancellation, and syncs cleanly
    nextPostError = null;
    await genBtn.click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();

    const listAside = page.getByRole('complementary', { name: 'Lista de análises editoriais' });
    await listAside.getByRole('button', { name: new RegExp(WORKFLOW_ID_2.slice(0, 12)) }).click();
    await expect(scriptRegion.getByText('PRONTO PARA GERAR')).toBeVisible();

    // Switch back to WF1: script v1 is loaded from GET /v1/workflows/{id}/scripts
    await listAside.getByRole('button', { name: new RegExp(WORKFLOW_ID.slice(0, 12)) }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();
  });

  test('Retenção M2/M3: request_changes recusado com 409 após redação do Radar preserva visualização/histórico e permite approve', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    let scriptRecord = createScriptRecordFixture(1, 'awaiting_review', null);

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [currentWf] });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptRecord] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}/review` && request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.decision === 'request_changes') {
          await route.fulfill({
            status: 409,
            headers: corsHeaders,
            json: {
              detail:
                'Snapshot do Radar já redigido: novas revisões com alterações não são permitidas; aprove ou rejeite a versão atual.',
            },
          });
          return;
        }
        scriptRecord = {
          ...scriptRecord,
          status: body.decision === 'approve' ? 'approved' : 'rejected',
          review: {
            decision: body.decision,
            feedback: body.feedback ?? '',
            reviewed_at: '2026-11-12T10:30:00Z',
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: scriptRecord });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    const docV1Region = scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' });
    const reviewBox = scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' });

    await expect(docV1Region).toBeVisible();
    await reviewBox.getByLabel('Feedback do roteiro').fill('Tentar pedir nova revisão após redação do Radar.');
    await reviewBox.getByRole('button', { name: 'Solicitar alterações no roteiro', exact: true }).click();

    // 1. 409 error is shown explicitly without claiming changes were saved
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Conflito de revisão ou estado (409): Snapshot do Radar já redigido'
    );
    await expect(scriptRegion.getByText('ALTERAÇÕES SOLICITADAS NA VERSÃO 1')).toHaveCount(0);

    // 2. Visualization, history, and typed feedback are preserved
    await expect(docV1Region.getByRole('heading', { name: 'Roteiro Editorial v1: Automação Local com Supervisão' })).toBeVisible();
    await expect(reviewBox.getByLabel('Feedback do roteiro')).toHaveValue(
      'Tentar pedir nova revisão após redação do Radar.'
    );

    // 3. Approving the existing version still succeeds
    await reviewBox.getByRole('button', { name: 'Aprovar roteiro', exact: true }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Revisão humana do roteiro' })).toHaveCount(0);
    await expect(docV1Region.getByText('Aprovado').first()).toBeVisible();
  });

  test('Inspeção de histórico: não oculta falhas 401/rede no GET individual, preserva versão em tela, permite recuperação e evita seleção fora de ordem', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const v1Record = createScriptRecordFixture(1, 'changes_requested', {
      decision: 'request_changes',
      feedback: 'Encurtar gancho.',
      reviewed_at: '2026-11-12T10:15:00Z',
    });
    const v2Record = createScriptRecordFixture(2, 'awaiting_review', null);

    let v1GetBehavior: '401' | 'network' | 'delayed' | 'ok' = '401';
    let releaseDelayedV1!: () => void;
    const delayedV1Gate = new Promise<void>(resolve => {
      releaseDelayedV1 = resolve;
    });

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/workflows') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [currentWf] });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [v2Record, v1Record] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V1_ID}` && request.method() === 'GET') {
        if (v1GetBehavior === '401') {
          await route.fulfill({
            status: 401,
            headers: corsHeaders,
            json: { detail: 'Sessão expirada ao consultar roteiro v1.' },
          });
          return;
        }
        if (v1GetBehavior === 'network') {
          await route.abort('failed');
          return;
        }
        if (v1GetBehavior === 'delayed') {
          await delayedV1Gate;
          await route.fulfill({ status: 200, headers: corsHeaders, json: v1Record });
          return;
        }
        await route.fulfill({ status: 200, headers: corsHeaders, json: v1Record });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: v2Record });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    const historyRegion = scriptRegion.getByRole('region', { name: 'Histórico de versões do roteiro' });

    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 2' })).toBeVisible();

    // 1. Selecting v1 when GET /v1/scripts/{v1.id} returns 401: shows alert and preserves v1 content
    v1GetBehavior = '401';
    await historyRegion.getByRole('button', { name: 'Ver v1', exact: true }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();
    await expect(
      scriptRegion.getByRole('heading', { name: 'Roteiro Editorial v1: Automação Local com Supervisão' })
    ).toBeVisible();
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Sessão não autorizada (401): Sessão expirada ao consultar roteiro v1.'
    );

    // 2. Recovery button when GET /v1/scripts/{v1.id} fails with network error: shows network alert and preserves v1 content
    v1GetBehavior = 'network';
    await scriptRegion.getByRole('button', { name: 'Recarregar versão v1', exact: true }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();
    await expect(scriptRegion.getByRole('alert')).toContainText(
      'Falha de rede ao comunicar com o backend local'
    );

    // 3. Recovery succeeds when endpoint returns 200 OK and clears alert
    v1GetBehavior = 'ok';
    await scriptRegion.getByRole('button', { name: 'Recarregar versão v1', exact: true }).click();
    await expect(scriptRegion.getByRole('alert')).toHaveCount(0);
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 1' })).toBeVisible();

    // 4. Rapid version switching (v1 delayed, then v2 immediately): out-of-order response from v1 cannot override v2
    await historyRegion.getByRole('button', { name: 'Ver v2', exact: true }).click();
    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 2' })).toBeVisible();

    v1GetBehavior = 'delayed';
    await historyRegion.getByRole('button', { name: 'Ver v1', exact: true }).click();
    await historyRegion.getByRole('button', { name: 'Ver v2', exact: true }).click();
    releaseDelayedV1();

    await expect(scriptRegion.getByRole('region', { name: 'Documento do roteiro versão 2' })).toBeVisible();
    await expect(
      scriptRegion.getByRole('heading', { name: 'Roteiro Editorial v2: Comparativo Prático e Gancho Direto' })
    ).toBeVisible();
  });
});
