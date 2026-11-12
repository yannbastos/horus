import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/editorial-m1');
fs.mkdirSync(artifactDir, { recursive: true });

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

const demoSummary = {
  snapshot_id: 'rad_fixture_01',
  revision: 1,
  origin: 'operator_fixture',
  status: 'complete',
  collected_at: '2026-11-12T10:00:00Z',
  expires_at: '2026-12-10T10:00:00Z',
  records: 5,
  videos: 5,
  eligible_videos: 4,
  issues: 0,
};

const demoDetail = {
  dataset: {
    schema_version: 'radar.youtube.v1',
    snapshot_id: 'rad_fixture_01',
    revision: 1,
    origin: 'operator_fixture',
    collected_at: '2026-11-12T10:00:00Z',
    expires_at: '2026-12-10T10:00:00Z',
    status: 'complete',
    records: [
      {
        source_id: 'video_01',
        kind: 'youtube_video',
        youtube_id: 'yt_01',
        url: 'https://example.org/horus-demo/video1',
        retrieved_at: '2026-11-12T10:00:00Z',
        expires_at: '2026-12-10T10:00:00Z',
        origin: 'operator_fixture',
        endpoint: 'videos.list',
        title: '[DEMONSTRAÇÃO] Produção Audiovisual com IA',
        channel_id: 'canal_01',
        channel_title: 'Estúdio Criativo',
        published_at: '2026-11-01T14:00:00Z',
        duration_seconds: 720,
        views: 15400,
        likes: 1200,
        comments: 85,
      },
      {
        source_id: 'video_02',
        kind: 'youtube_video',
        youtube_id: 'yt_02',
        url: 'https://example.org/horus-demo/video2',
        retrieved_at: '2026-11-12T10:00:00Z',
        expires_at: '2026-12-10T10:00:00Z',
        origin: 'operator_fixture',
        endpoint: 'videos.list',
        title: '[DEMONSTRAÇÃO] Como Roteirizar Curtas',
        channel_id: 'canal_01',
        channel_title: 'Estúdio Criativo',
        published_at: '2026-11-03T18:00:00Z',
        duration_seconds: 480,
        views: 8900,
        likes: 650,
        comments: 42,
      },
      {
        source_id: 'video_03',
        kind: 'youtube_video',
        youtube_id: 'yt_03',
        url: 'https://example.org/horus-demo/video3',
        retrieved_at: '2026-11-12T10:00:00Z',
        expires_at: '2026-12-10T10:00:00Z',
        origin: 'operator_fixture',
        endpoint: 'videos.list',
        title: '[DEMONSTRAÇÃO] Técnicas de Iluminação de Baixo Custo',
        channel_id: 'canal_02',
        channel_title: 'Luz & Cena',
        published_at: '2026-11-05T12:00:00Z',
        duration_seconds: 930,
        views: 24000,
        likes: 2100,
        comments: 190,
      },
      {
        source_id: 'video_04',
        kind: 'youtube_video',
        youtube_id: 'yt_04',
        url: 'https://example.org/horus-demo/video4',
        retrieved_at: '2026-11-12T10:00:00Z',
        expires_at: '2026-12-10T10:00:00Z',
        origin: 'operator_fixture',
        endpoint: 'videos.list',
        title: '[DEMONSTRAÇÃO] Edição Ágil com Tokens',
        channel_id: 'canal_02',
        channel_title: 'Luz & Cena',
        published_at: '2026-11-08T09:00:00Z',
        duration_seconds: 360,
        views: 5400,
        likes: 310,
        comments: 20,
      },
      {
        source_id: 'video_inelegivel',
        kind: 'youtube_video',
        youtube_id: 'yt_bad',
        url: 'https://example.org/horus-demo/videobad',
        retrieved_at: '2026-11-12T10:00:00Z',
        expires_at: '2026-12-10T10:00:00Z',
        origin: 'operator_fixture',
        endpoint: 'videos.list',
        title: '[DEMONSTRAÇÃO] Vídeo Inelegível sem Data',
        channel_id: 'canal_02',
        channel_title: 'Luz & Cena',
        published_at: null,
        duration_seconds: 120,
        views: 100,
        likes: 5,
        comments: 0,
      },
    ],
  },
  eligibility: {
    video_01: { eligible: true, reasons: [] },
    video_02: { eligible: true, reasons: [] },
    video_03: { eligible: true, reasons: [] },
    video_04: { eligible: true, reasons: [] },
    video_inelegivel: { eligible: false, reasons: ['missing_published_at'] },
  },
};

function createMockWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_demo_01',
    status: 'queued',
    revision: 1,
    executor: 'hermes_simulated',
    simulated: true,
    request: {
      objective: 'Análise de formatos e referências para vídeos curtos.',
    },
    radar: {
      snapshot_id: 'rad_fixture_01',
      revision: 1,
      origin: 'operator_fixture',
      expires_at: '2026-12-10T10:00:00Z',
      included: ['video_01', 'video_02', 'video_03', 'video_04'],
      excluded: [{ source_id: 'video_inelegivel', reasons: ['missing_published_at'] }],
    },
    steps: [
      { id: 'job_step_1', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'planning', step_index: 0, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:01Z', depends_on: null, error: null, result: null },
      { id: 'job_step_2', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'research', step_index: 1, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:01Z', updated_at: '2026-11-12T10:00:02Z', depends_on: 'job_step_1', error: null, result: null },
      { id: 'job_step_3', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'analysis', step_index: 2, status: 'awaiting_authorization', attempt: 0, created_at: '2026-11-12T10:00:02Z', updated_at: '2026-11-12T10:00:02Z', depends_on: 'job_step_2', error: null, result: null },
      { id: 'job_step_4', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'proposal', step_index: 3, status: 'waiting', attempt: 0, created_at: '2026-11-12T10:00:02Z', updated_at: '2026-11-12T10:00:02Z', depends_on: 'job_step_3', error: null, result: null },
    ],
    artifacts: [],
    approvals: [],
    cognitive_runs: [],
    authorizations: [],
    pending_authorization: { job_id: 'job_step_3', stage: 'analysis' },
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:02Z',
    ...overrides,
  };
}

const mockProposalContent = {
  schema_version: 2,
  simulated: true,
  stage: 'proposal',
  title: 'Como Criar Vídeos com IA em 5 Minutos',
  result_status: 'complete',
  recommendation: {
    title_options: [
      'Como Criar Vídeos com IA em 5 Minutos',
      'O Guia Rápido de Produção com Tokens',
    ],
    premise: 'Desmistificar ferramentas locais para criadores de vídeo sem exigir nuvem.',
    angle: 'Foco em autonomia, rapidez e privacidade no fluxo audiovisual.',
    format: 'short',
    originality: 'Abordagem prática com exemplos reais sem depender de APIs pagas.',
    differs_from: ['video_01'],
    risks: ['Necessidade de explicar conceitos de IA de forma acessível e direta.'],
    licensing_notes: 'Conteúdo totalmente original; referências citadas apenas como dados públicos.',
  },
  opportunities: [
    {
      id: 'op_01',
      summary: 'Série curta sobre automação audiovisual para criadores independentes.',
      based_on: ['fact_01'],
      br_fit_rationale: 'Forte demanda no ecossistema de criadores de conteúdo do Brasil.',
    },
  ],
  unknowns: ['Impacto exato do algoritmo em postagens matutinas.'],
  evidence: {
    sources: 1,
    facts: 1,
    hypotheses: 1,
  },
  requires_human_review: true,
};

const mockAnalysisContent = {
  schema_version: 2,
  simulated: true,
  stage: 'analysis',
  title: 'Análise editorial validada',
  result: {
    contract_version: '1.0',
    task_id: 'job_step_3',
    status: 'complete',
    plan: [{ step: 'Pesquisa', done: true }, { step: 'Análise', done: true }],
    sources: [
      {
        id: 'video_01',
        kind: 'dataset',
        url: 'https://example.org/horus-demo/video1',
        title: '[DEMONSTRAÇÃO] Produção Audiovisual com IA',
        retrieved_at: '2026-11-12T10:00:00Z',
      },
    ],
    facts: [
      {
        id: 'fact_01',
        text: 'Vídeos com foco prático obtiveram mais de 15.000 visualizações orgânicas.',
        source_ids: ['video_01'],
        metric_refs: [{ source_id: 'video_01', field: 'views', value: 15400 }],
      },
    ],
    hypotheses: [
      {
        id: 'hyp_01',
        text: 'A audiência brasileira prefere tutoriais dinâmicos sem jargão excessivo.',
        based_on: ['fact_01'],
        confidence: 'high',
        how_to_test: 'Produzir piloto de 60 segundos com chamada para comentários.',
      },
    ],
    opportunities: [
      {
        id: 'op_01',
        summary: 'Série curta sobre automação audiovisual para criadores independentes.',
        based_on: ['fact_01'],
        br_fit_rationale: 'Forte demanda no ecossistema de criadores de conteúdo do Brasil.',
      },
    ],
    recommendation: mockProposalContent.recommendation,
    unknowns: ['Impacto exato do algoritmo em postagens matutinas.'],
    memory_proposals: [],
  },
};

test.describe('M1 — Radar, Análise Editorial e Aprovação Humana', () => {
  test('Radar: estado vazio, carrega dados demo com selo visível e inicia análise', async ({ page }) => {
    let demoRequested = false;
    let radarWorkflowCreated = false;
    let datasetsList: typeof demoSummary[] = [];

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
      if (pathUrl === '/v1/radar/datasets' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: datasetsList });
        return;
      }
      if (pathUrl === '/v1/radar/datasets/demo' && request.method() === 'POST') {
        expect(request.headers()['idempotency-key']).toBeTruthy();
        demoRequested = true;
        datasetsList = [demoSummary];
        await route.fulfill({ status: 201, headers: corsHeaders, json: demoSummary });
        return;
      }
      if (pathUrl === '/v1/radar/datasets/rad_fixture_01/1' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: demoDetail });
        return;
      }
      if (pathUrl === '/v1/workflows/radar' && request.method() === 'POST') {
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const postData = request.postDataJSON();
        expect(postData.snapshot_id).toBe('rad_fixture_01');
        expect(postData.revision).toBe(1);
        expect(postData.source_ids.length).toBe(4);
        expect(postData.source_ids).not.toContain('video_inelegivel');
        radarWorkflowCreated = true;
        const createdWf = createMockWorkflow();
        await route.fulfill({ status: 202, headers: corsHeaders, json: createdWf });
        return;
      }
      if (pathUrl === '/v1/workflows') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Radar', exact: true }).click();

    // 1. Estado vazio
    await expect(page.getByRole('heading', { name: 'Nenhum snapshot de pesquisa disponível' })).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, 'radar-demo-empty.png') });

    // 2. Carregar dados de demonstração
    await page.getByRole('button', { name: /Carregar dados de demonstração/i }).click();
    expect(demoRequested).toBe(true);

    // 3. Selo DEMONSTRAÇÃO · DADOS FICTÍCIOS visível
    await expect(page.getByText('DEMONSTRAÇÃO · DADOS FICTÍCIOS').first()).toBeVisible();

    // 4. Detalhes do dataset e tabela de vídeos
    await expect(page.getByText('4 de 4 elegíveis selecionados (máx. 50)')).toBeVisible();
    await expect(page.getByText('[DEMONSTRAÇÃO] Produção Audiovisual com IA')).toBeVisible();

    // 5. Motivo legível em português para inelegível
    await expect(page.getByText(/Inelegível: Data de publicação ausente/i)).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'radar-dataset-detail.png') });

    // 6. Iniciar análise
    await page.getByRole('button', { name: /Iniciar análise/i }).click();

    // 7. Confirmação com incluídos/excluídos retornados
    await expect(page.getByText('ANÁLISE INICIADA COM SUCESSO')).toBeVisible();
    expect(radarWorkflowCreated).toBe(true);
    await expect(page.getByText(/4 incluídos/i)).toBeVisible();
    await expect(page.getByText(/1 excluídos/i)).toBeVisible();
  });

  test('Produção: fluxo editorial com pending_authorization, autorização e selo SIMULADO', async ({ page }) => {
    let authorized = false;
    let currentWf = createMockWorkflow();

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
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [{ id: currentWf.id, status: currentWf.status, revision: currentWf.revision, created_at: currentWf.created_at, updated_at: currentWf.updated_at }],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}/authorize` && request.method() === 'POST') {
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const postData = request.postDataJSON();
        expect(postData.expected_revision).toBe(1);
        expect(postData.job_id).toBe('job_step_3');
        authorized = true;
        currentWf = {
          ...currentWf,
          status: 'running',
          pending_authorization: null,
          steps: currentWf.steps.map(s => s.id === 'job_step_3' ? { ...s, status: 'running', attempt: 1 } : s),
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    // 1. Selo SIMULADO visível
    await expect(page.getByText('SIMULADO')).toBeVisible();

    // 2. Banner de autorização explícita com mensagem de que é simulada e não gera custo
    await expect(page.getByText(/Esta execução é simulada e não gera custo/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Autorizar uma execução/i })).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'editorial-awaiting-authorization.png') });

    // 3. Clicar em autorizar
    await page.getByRole('button', { name: /Autorizar uma execução/i }).click();
    expect(authorized).toBe(true);

    // 4. Confirma que a autorização foi processada e o banner de autorização sumiu
    await expect(page.getByRole('button', { name: /Autorizar uma execução/i })).toHaveCount(0);
  });

  test('Produção: proposta exibida com evidências de análise e aprovação', async ({ page }) => {
    let reviewed = false;
    let reviewDecision = '';
    const awaitingWf = createMockWorkflow({
      status: 'awaiting_approval',
      current_artifact_id: 'art_prop_01',
      pending_authorization: null,
      steps: [
        { id: 'job_step_1', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'planning', step_index: 0, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:01Z', depends_on: null, error: null, result: null },
        { id: 'job_step_2', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'research', step_index: 1, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:01Z', updated_at: '2026-11-12T10:00:02Z', depends_on: 'job_step_1', error: null, result: null },
        { id: 'job_step_3', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'analysis', step_index: 2, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:02Z', updated_at: '2026-11-12T10:00:03Z', depends_on: 'job_step_2', error: null, result: null },
        { id: 'job_step_4', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'proposal', step_index: 3, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:03Z', updated_at: '2026-11-12T10:00:04Z', depends_on: 'job_step_3', error: null, result: null },
      ],
      artifacts: [
        {
          id: 'art_analysis_01',
          workflow_id: 'wf_demo_01',
          revision: 1,
          stage: 'analysis',
          job_id: 'job_step_3',
          attempt_id: 'att-3',
          schema_version: 2,
          content: mockAnalysisContent,
          content_hash: 'hash_analysis',
          created_at: '2026-11-12T10:00:03Z',
        },
        {
          id: 'art_prop_01',
          workflow_id: 'wf_demo_01',
          revision: 1,
          stage: 'proposal',
          job_id: 'job_step_4',
          attempt_id: 'att-4',
          schema_version: 2,
          content: mockProposalContent,
          content_hash: 'hash_prop',
          created_at: '2026-11-12T10:00:04Z',
        },
      ],
    });

    let currentWf = awaitingWf;

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
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [{ id: currentWf.id, status: currentWf.status, revision: currentWf.revision, created_at: currentWf.created_at, updated_at: currentWf.updated_at }],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}/review` && request.method() === 'POST') {
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const postData = request.postDataJSON();
        expect(postData.expected_revision).toBe(1);
        expect(postData.artifact_id).toBe('art_prop_01');
        reviewed = true;
        reviewDecision = postData.decision;
        currentWf = {
          ...currentWf,
          status: 'approved',
          approvals: [
            {
              id: 'app_01',
              workflow_id: currentWf.id,
              revision: 1,
              artifact_id: 'art_prop_01',
              decision: 'approve',
              feedback: '',
              created_at: new Date().toISOString(),
            },
          ],
        };
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { approval: currentWf.approvals[0], workflow: currentWf },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    // 1. Proposta exibida
    await expect(page.getByRole('heading', { name: 'Como Criar Vídeos com IA em 5 Minutos' })).toBeVisible();
    await expect(page.getByText('Desmistificar ferramentas locais para criadores de vídeo sem exigir nuvem.')).toBeVisible();
    await expect(page.getByText('Foco em autonomia, rapidez e privacidade no fluxo audiovisual.')).toBeVisible();
    await expect(page.getByText('Vídeo Curto (Shorts)')).toBeVisible();
    await expect(page.getByText('1 fontes')).toBeVisible();
    await expect(page.getByText('1 fatos')).toBeVisible();
    await expect(page.getByText('1 hipóteses')).toBeVisible();

    // 2. Análise exibida (fontes, fatos com métricas, hipóteses)
    await expect(page.getByRole('link', { name: /Produção Audiovisual com IA/i })).toBeVisible();
    await expect(page.getByText(/15.400/i)).toBeVisible();
    await expect(page.getByText(/A audiência brasileira prefere tutoriais dinâmicos/i)).toBeVisible();

    await page.screenshot({ path: path.join(artifactDir, 'editorial-proposal-approval.png') });

    // 3. Aprovar proposta
    await page.getByRole('button', { name: /Aprovar/i, exact: true }).click();
    expect(reviewed).toBe(true);
    expect(reviewDecision).toBe('approve');

    // 4. Estado final exibido como retornado pelo backend
    await expect(page.getByText('Aprovado').first()).toBeVisible();
  });

  test('Produção: rejeitar proposta e solicitar alterações com feedback obrigatório', async ({ page }) => {
    let lastDecision = '';
    let lastFeedback = '';

    const baseAwaiting = createMockWorkflow({
      status: 'awaiting_approval',
      current_artifact_id: 'art_prop_01',
      pending_authorization: null,
      steps: [
        { id: 'job_step_4', workflow_id: 'wf_demo_01', workflow_revision: 1, step_key: 'proposal', step_index: 3, status: 'succeeded', attempt: 1, created_at: '2026-11-12T10:00:03Z', updated_at: '2026-11-12T10:00:04Z', depends_on: 'job_step_3', error: null, result: null },
      ],
      artifacts: [
        {
          id: 'art_prop_01',
          workflow_id: 'wf_demo_01',
          revision: 1,
          stage: 'proposal',
          job_id: 'job_step_4',
          attempt_id: 'att-4',
          schema_version: 2,
          content: mockProposalContent,
          content_hash: 'hash_prop',
          created_at: '2026-11-12T10:00:04Z',
        },
      ],
    });

    let currentWf = baseAwaiting;

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
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [{ id: currentWf.id, status: currentWf.status, revision: currentWf.revision, created_at: currentWf.created_at, updated_at: currentWf.updated_at }],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}/review` && request.method() === 'POST') {
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const postData = request.postDataJSON();
        lastDecision = postData.decision;
        lastFeedback = postData.feedback || '';

        if (postData.decision === 'reject') {
          currentWf = { ...currentWf, status: 'rejected' };
        } else if (postData.decision === 'request_changes') {
          currentWf = {
            ...currentWf,
            revision: 2,
            status: 'queued',
            current_artifact_id: null,
            feedback: postData.feedback,
          };
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: {
            approval: { id: 'app_test', workflow_id: currentWf.id, revision: 1, artifact_id: 'art_prop_01', decision: postData.decision, feedback: postData.feedback || '', created_at: new Date().toISOString() },
            workflow: currentWf,
          },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    // 1. Solicitar alterações desabilitado sem feedback
    const requestChangesBtn = page.getByRole('button', { name: /Solicitar alterações/i });
    await expect(requestChangesBtn).toBeDisabled();

    // 2. Preencher feedback e enviar alterações
    await page.getByLabel(/Feedback \/ Alterações solicitadas/i).fill('Ajustar o foco para iniciantes absolutos.');
    await expect(requestChangesBtn).toBeEnabled();
    await requestChangesBtn.click();

    expect(lastDecision).toBe('request_changes');
    expect(lastFeedback).toBe('Ajustar o foco para iniciantes absolutos.');
    await expect(page.getByText('Revisão: 2')).toBeVisible();
  });

  test('Produção: cancelamento e tratamento de erro 409', async ({ page }) => {
    let cancelled = false;
    let currentWf = createMockWorkflow({ status: 'running', pending_authorization: null });

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
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: [{ id: currentWf.id, status: currentWf.status, revision: currentWf.revision, created_at: currentWf.created_at, updated_at: currentWf.updated_at }],
        });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}/cancel` && request.method() === 'POST') {
        cancelled = true;
        currentWf = { ...currentWf, status: 'cancelled' };
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}/retry` && request.method() === 'POST') {
        // Return 409 conflict
        await route.fulfill({
          status: 409,
          headers: corsHeaders,
          json: { detail: 'A execução cognitiva anterior tem desfecho desconhecido. Concilie antes de tentar novamente.' },
        });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    // 1. Cancelamento
    const cancelBtn = page.getByRole('button', { name: 'Cancelar', exact: true });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    expect(cancelled).toBe(true);
    await expect(page.getByText('Cancelado').first()).toBeVisible();

    // 2. Erro 409: configurar workflow como failed e tentar retry
    currentWf = { ...currentWf, status: 'failed' };
    await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const retryBtn = page.getByRole('button', { name: 'Tentar novamente', exact: true });
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // 3. Mensagem 409 exibida em alert sem travar a interface
    await expect(page.getByRole('alert')).toContainText('desfecho desconhecido. Concilie antes de tentar novamente.');
  });

  test('Responsividade em 1040x680: Radar e Produção sem transbordamento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 680 });
    const currentWf = createMockWorkflow({
      status: 'awaiting_approval',
      current_artifact_id: 'art_prop_01',
      artifacts: [
        {
          id: 'art_prop_01',
          workflow_id: 'wf_demo_01',
          revision: 1,
          stage: 'proposal',
          job_id: 'job_step_4',
          attempt_id: 'att-4',
          schema_version: 2,
          content: mockProposalContent,
          content_hash: 'hash_prop',
          created_at: '2026-11-12T10:00:04Z',
        },
      ],
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
      if (pathUrl === '/v1/radar/datasets' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [demoSummary] });
        return;
      }
      if (pathUrl === '/v1/radar/datasets/rad_fixture_01/1' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: demoDetail });
        return;
      }
      if (pathUrl === '/v1/workflows' && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [currentWf] });
        return;
      }
      if (pathUrl === `/v1/workflows/${currentWf.id}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: currentWf });
        return;
      }
      if (pathUrl === '/v1/jobs') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: [] });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);

    // 1. Radar em 1040x680
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await expect(page.getByText('DEMONSTRAÇÃO · DADOS FICTÍCIOS').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifactDir, 'radar-light-1040.png') });

    // 2. Produção em 1040x680
    await page.getByRole('button', { name: 'Produção', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Como Criar Vídeos com IA em 5 Minutos' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifactDir, 'editorial-light-1040.png') });
  });
});
