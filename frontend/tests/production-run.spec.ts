import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/production-run-m4');
fs.mkdirSync(artifactDir, { recursive: true });

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const SESSION_TOKEN = 'test-session-token-m4-0123456789';
const WORKFLOW_ID = '11111111222233334444555566667777';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_V1_ID = '99999999888877776666555544443331';
const SCRIPT_V2_ID = '99999999888877776666555544443332';
const SCRIPT_V2_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const PROD_SIM_ID = '11112222333344445555666677778888';
const JOB_SIM_ID = 'job_sim_111122223333444455556666';

const PROD_DEMO_ID = 'aaaabbbbccccddddeeeeffff00001111';
const JOB_DEMO_ID = 'job_demo_aaaabbbbccccddddeeeeffff';

const VIDEO_ARTIFACT_ID = '00001111222233334444555566667777';
const VIDEO_SHA256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill(SESSION_TOKEN);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

const mockProposalContent = {
  schema_version: 2,
  simulated: true,
  stage: 'proposal',
  title: 'Automação Local de Produção com Supervisão Humana',
  result_status: 'complete',
  recommendation: {
    title_options: [
      'Automação Local de Produção com Supervisão Humana',
      'Pipeline Curto Verificável por Hash SHA-256',
    ],
    premise: 'Demonstrar a transição de roteiro M3 aprovado para produção técnica local M4.',
    angle: 'Preservação da fábrica independente, revisão por hash e zero chamadas pagas.',
    format: 'short',
    originality: 'Vinculação estrita às fontes do snapshot aprovado.',
    differs_from: ['video_01'],
    risks: ['Dependências locais de vídeo podem não estar preparadas.'],
    licensing_notes: 'Dados de demonstração (teste: true), não publicáveis.',
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
      objective: 'Produzir artefatos verificáveis a partir do roteiro M3 aprovado.',
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

function createScriptRecordFixture(version: 1 | 2, status = 'approved') {
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
      title: `Roteiro Editorial v${version}: Produção Técnica Verificável`,
      sections: [
        {
          id: 'sec_hook',
          kind: 'hook' as const,
          heading: 'Gancho inicial sobre verificação por hash',
          narration: 'Como garantir que cada artefato da produção local corresponde ao roteiro aprovado?',
          source_ids: ['video_01'],
        },
        {
          id: 'sec_body_1',
          kind: 'body' as const,
          heading: 'Desenvolvimento em etapas e isolamento de dados',
          narration: 'O plano gera cenas determinísticas, áudio de fixture sem voz real e legendas SRT sintéticas.',
          source_ids: ['video_01', 'video_02'],
        },
        {
          id: 'sec_conclusion',
          kind: 'conclusion' as const,
          heading: 'Fechamento com revisão humana obrigatória',
          narration: 'O render técnico concluído exige revisão final explícita vinculada ao SHA-256 do vídeo.',
          source_ids: [],
        },
      ],
    },
    created_at: '2026-11-12T10:20:00Z',
    review:
      status === 'approved'
        ? {
            decision: 'approve' as const,
            feedback: 'Roteiro aprovado para ensaio de produção local.',
            reviewed_at: '2026-11-12T10:25:00Z',
          }
        : status === 'changes_requested'
        ? {
            decision: 'request_changes' as const,
            feedback: 'Ajustar gancho.',
            reviewed_at: '2026-11-12T10:15:00Z',
          }
        : null,
  };
}

// Faithful to Sonnet's ProductionPlan (3aa18be)
const mockPlanJson = {
  schema_version: 1,
  mode: 'simulated',
  demo_only: true,
  script_id: SCRIPT_V2_ID,
  script_version: 2,
  script_content_hash: SCRIPT_V2_HASH,
  title: 'Roteiro Editorial v2: Produção Técnica Verificável',
  roteiro: {
    titulo: 'Roteiro Editorial v2: Produção Técnica Verificável',
    formato: 'short',
    teste: true,
    linhas: [
      {
        n: 1,
        narracao: 'Como garantir que cada artefato da produção local corresponde ao roteiro aprovado?',
        visual: 'Cena 1 (hook): Gancho inicial sobre verificação por hash',
        duracao_estimada: 5.2,
      },
      {
        n: 2,
        narracao: 'O plano gera cenas determinísticas, áudio de fixture sem voz real e legendas SRT sintéticas.',
        visual: 'Cena 2 (body): Desenvolvimento em etapas e isolamento de dados',
        duracao_estimada: 5.6,
      },
      {
        n: 3,
        narracao: 'O render técnico concluído exige revisão final explícita vinculada ao SHA-256 do vídeo.',
        visual: 'Cena 3 (conclusion): Fechamento com revisão humana obrigatória',
        duracao_estimada: 5.2,
      },
    ],
  },
  scenes: [
    {
      id: 'sec_hook',
      n: 1,
      kind: 'hook',
      heading: 'Gancho inicial sobre verificação por hash',
      start: 0.0,
      end: 5.2,
      duration: 5.2,
      source_ids: ['video_01'],
      visual_origin: 'original_local',
    },
    {
      id: 'sec_body_1',
      n: 2,
      kind: 'body',
      heading: 'Desenvolvimento em etapas e isolamento de dados',
      start: 5.2,
      end: 10.8,
      duration: 5.6,
      source_ids: ['video_01', 'video_02'],
      visual_origin: 'original_local',
    },
    {
      id: 'sec_conclusion',
      n: 3,
      kind: 'conclusion',
      heading: 'Fechamento com revisão humana obrigatória',
      start: 10.8,
      end: 16.0,
      duration: 5.2,
      source_ids: [],
      visual_origin: 'original_local',
    },
  ],
  total_duration: 16.0,
  sources: ['video_01', 'video_02'],
  audio: {
    kind: 'fixture_tone',
    real_voice: false,
    disclosure: 'Áudio de fixture local (tom): sem narração de voz real.',
  },
  subtitles: {
    kind: 'synthetic_srt',
    speech_aligned: false,
    disclosure: 'Legenda sintética por cena: não é alinhamento real de fala.',
  },
  license: {
    publishable: false,
    external_assets: [],
    basis: 'Somente cenas originais locais e fixtures; licença/publicação nunca inferidas do render.',
  },
};

const mockSrtContent = `1
00:00:00,000 --> 00:00:05,200
Como garantir que cada artefato da produção local corresponde ao roteiro aprovado?

2
00:00:05,200 --> 00:00:10,800
O plano gera cenas determinísticas, áudio de fixture sem voz real e legendas SRT sintéticas.

3
00:00:10,800 --> 00:00:16,000
O render técnico concluído exige revisão final explícita vinculada ao SHA-256 do vídeo.
`;

// Faithful to Codex's production_worker.py artifact relative paths
function createSimulatedArtifacts() {
  return [
    {
      id: 'art_plan_01',
      kind: 'plan' as const,
      relative_path: 'plan.json',
      size_bytes: 1420,
      sha256: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    },
    {
      id: 'art_audio_01',
      kind: 'audio' as const,
      relative_path: 'canais/demo/videos/fixture/fixture.wav',
      size_bytes: 16044,
      sha256: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    },
    {
      id: 'art_scene_01',
      kind: 'scene' as const,
      relative_path: 'canais/demo/videos/fixture/scene-1.png',
      size_bytes: 680,
      sha256: 'bbbb1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    },
    {
      id: 'art_manifest_01',
      kind: 'manifest' as const,
      relative_path: 'canais/demo/videos/fixture/manifesto_assets.json',
      size_bytes: 512,
      sha256: 'dddd1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    },
    {
      id: 'art_align_01',
      kind: 'manifest' as const,
      relative_path: 'canais/demo/videos/fixture/alinhamento.json',
      size_bytes: 256,
      sha256: 'eeee1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    },
    {
      id: 'art_subs_01',
      kind: 'subtitles' as const,
      relative_path: 'canais/demo/videos/fixture/fixture.srt',
      size_bytes: 312,
      sha256: 'cccc1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    },
  ];
}

function createDemoArtifactsWithVideo() {
  return [
    ...createSimulatedArtifacts(),
    {
      id: VIDEO_ARTIFACT_ID,
      kind: 'video' as const,
      relative_path: 'canais/demo/videos/fixture/render/short-rascunho.mp4',
      size_bytes: 96902,
      sha256: VIDEO_SHA256,
    },
    {
      id: 'a4b05cde3f472a576b0dcd3f853109b4',
      kind: 'manifest' as const,
      relative_path: 'canais/demo/videos/fixture/render/short-rascunho.insumos.json',
      size_bytes: 1159,
      sha256: '198210195a1a00ba5af24f91bf6575c03ba4cfdcf6d2dc32e3d1f68c80b6235e',
    },
    {
      id: 'c6a3486feec88aa321487db852237487',
      kind: 'manifest' as const,
      relative_path: 'canais/demo/videos/fixture/render/validation.json',
      size_bytes: 319,
      sha256: 'ef2e63efe0b3652c212e07b70025dfb6f41ab98b8e2fc94c025732ed719ecdca',
    },
    {
      id: 'b67e221d93a8482188ee7d99dd599fa4',
      kind: 'scene' as const,
      relative_path: 'canais/demo/videos/fixture/render/frame.png',
      size_bytes: 3858,
      sha256: 'fee0795b97e7cbf42693757f1741d00e0f91e004e837e073bc0fa27a12c0b4ee',
    },
  ];
}

function getDemoVideoBuffer(): Buffer {
  const realPilotMp4 =
    'C:/Users/yannf/AppData/Local/Temp/hp3/test_real_local_pilot_render_r0/data/productions/7b718dedaf5740508d13a3b967b0d678/canais/demo/videos/fixture/render/short-rascunho.mp4';
  const realDemoMp4 =
    'C:/Users/yannf/AppData/Local/Temp/horus-m4/backend-demo-evidence/data/productions/80ac60c169bd47949399c6bba97438d5/canais/demo/videos/fixture/render/short-rascunho.mp4';
  try {
    if (fs.existsSync(realPilotMp4)) {
      return fs.readFileSync(realPilotMp4);
    }
    if (fs.existsSync(realDemoMp4)) {
      return fs.readFileSync(realDemoMp4);
    }
  } catch {
    // Fallback to synthetic media buffer when isolated temp evidence is absent
  }
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(8000, 40);
  return wav;
}

test.describe('M4 — Interface de Produção Técnica Local e Revisão Final (HOR-052 / HOR-056)', () => {
  test('Bloqueia início de produção enquanto roteiro mais recente não estiver aprovado e libera após aprovação M3', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    let scriptV2 = createScriptRecordFixture(2, 'awaiting_review');
    let productionPostCalls = 0;

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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/review` && request.method() === 'POST') {
        scriptV2 = createScriptRecordFixture(2, 'approved');
        await route.fulfill({ status: 200, headers: corsHeaders, json: scriptV2 });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'POST') {
        productionPostCalls += 1;
        await route.fulfill({ status: 409, headers: corsHeaders, json: { detail: 'Não deveria chamar' } });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    await expect(prodRegion).toBeVisible();
    await expect(prodRegion.getByText('ROTEIRO M3 AINDA NÃO APROVADO')).toBeVisible();
    await expect(prodRegion.getByRole('button', { name: 'Iniciar produção técnica', exact: true })).toBeDisabled();
    expect(productionPostCalls).toBe(0);

    // Approve script v2 in M3
    const scriptRegion = page.getByRole('region', { name: 'Roteiro e revisão humana' });
    await scriptRegion
      .getByRole('region', { name: 'Revisão humana do roteiro' })
      .getByRole('button', { name: 'Aprovar roteiro', exact: true })
      .click();

    // Now M4 production controls become enabled
    const startSimBtn = prodRegion.getByRole('button', { name: 'Iniciar produção simulada', exact: true });
    await expect(startSimBtn).toBeEnabled();
  });

  test('Modo Simulado: executa etapas, lista artefatos de fixture, inspeciona plano/SRT, mantém aviso explícito de simulação e impede aprovação final como vídeo real', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture(2, 'approved');
    let productionsStore: Record<string, unknown>[] = [];
    const idempotencyKeys: string[] = [];

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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: productionsStore } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'POST') {
        const idemKey = request.headers()['idempotency-key'];
        expect(idemKey).toBeTruthy();
        idempotencyKeys.push(idemKey);

        const body = request.postDataJSON();
        expect(body).toEqual({
          expected_version: 2,
          mode: 'simulated',
        });

        const record = {
          id: PROD_SIM_ID,
          script_id: SCRIPT_V2_ID,
          script_version: 2,
          script_content_hash: SCRIPT_V2_HASH,
          job_id: JOB_SIM_ID,
          mode: 'simulated',
          stage: 'review',
          status: 'succeeded',
          created_at: '2026-11-12T11:00:00Z',
          updated_at: '2026-11-12T11:00:02Z',
          artifacts: createSimulatedArtifacts(),
          review: null,
          error: null,
          demo_only: true,
          real_voice: false,
          speech_aligned: false,
        };
        productionsStore = [record];
        await route.fulfill({ status: 201, headers: corsHeaders, json: record });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_SIM_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: productionsStore[0] });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_SIM_ID}/events`) {
        const events = [
          { sequence: 1, kind: 'stage', message: 'narration' },
          { sequence: 2, kind: 'stage', message: 'scenes' },
          { sequence: 3, kind: 'stage', message: 'subtitles' },
          { sequence: 4, kind: 'stage', message: 'review' },
          {
            kind: 'complete',
            job: {
              id: JOB_SIM_ID,
              status: 'succeeded',
              attempt: 1,
              payload: { operation: 'production.run', production_id: PROD_SIM_ID },
              error: null,
              result: { stage: 'review', demo_only: true },
              created_at: '2026-11-12T11:00:00Z',
              updated_at: '2026-11-12T11:00:02Z',
            },
          },
        ];
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: events.map(e => JSON.stringify(e)).join('\n') + '\n',
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_SIM_ID}/artifacts/art_plan_01` && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(mockPlanJson),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_SIM_ID}/artifacts/art_subs_01` && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
          body: mockSrtContent,
        });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    await expect(prodRegion).toBeVisible();

    // Start simulated production
    await prodRegion.getByRole('button', { name: 'Iniciar produção simulada', exact: true }).click();

    const detailRegion = prodRegion.getByRole('region', { name: `Detalhes da produção ${PROD_SIM_ID}` });
    await expect(detailRegion).toBeVisible();
    await expect(detailRegion.getByText('SIMULADO (FIXTURE)', { exact: true })).toBeVisible();
    await expect(detailRegion.getByText('Execução técnica concluída', { exact: true })).toBeVisible();
    await expect(detailRegion.getByText(SCRIPT_V2_HASH)).toBeVisible();

    // Verify provenance flags (demo_only, real_voice, speech_aligned)
    await expect(detailRegion.getByText('Somente demonstração / teste (publishable: false)')).toBeVisible();
    await expect(detailRegion.getByText('Sem voz real (tom de fixture: fixture_tone)')).toBeVisible();
    await expect(detailRegion.getByText('Sem alinhamento de fala (SRT sintético: synthetic_srt)')).toBeVisible();

    // Verify job logs
    await expect(detailRegion.getByLabel('Logs da produção')).toContainText('stage: narration');

    // Verify notice that technical 'succeeded' is NOT final approval and simulated mode has no real video review
    await expect(detailRegion.getByText('EXECUÇÃO TÉCNICA CONCLUÍDA · NÃO É APROVAÇÃO FINAL')).toBeVisible();
    await expect(detailRegion.getByText('MODO SIMULADO · SEM VÍDEO REAL')).toBeVisible();
    await expect(detailRegion.getByRole('region', { name: 'Revisão humana final da produção' })).toHaveCount(0);

    // Verify artifacts table has no fake mp4 and shows plan, scene, audio, subtitles, manifest
    const artifactsTable = detailRegion.getByRole('table', { name: 'Tabela de artefatos da produção' });
    await expect(artifactsTable).toBeVisible();
    await expect(artifactsTable.getByText('plan.json')).toBeVisible();
    await expect(artifactsTable.getByText('canais/demo/videos/fixture/fixture.srt')).toBeVisible();
    await expect(artifactsTable.getByText('.mp4')).toHaveCount(0);

    // Inspect plan artifact via authenticated GET
    const planRow = artifactsTable.locator('tr', { hasText: 'plan.json' });
    await planRow.getByRole('button', { name: 'Inspecionar', exact: true }).click();

    const previewRegion = detailRegion.getByRole('region', {
      name: 'Prévia do artefato plan.json',
    });
    await expect(previewRegion).toBeVisible();
    await expect(previewRegion.getByText('DEMO / TESTE (teste: true)')).toBeVisible();
    await expect(previewRegion.getByLabel('Conteúdo de plan.json')).toContainText(
      '"disclosure": "Áudio de fixture local (tom): sem narração de voz real."'
    );

    await detailRegion.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'production-simulated-artifacts-dark.png') });
  });

  test('Modo Demo Local: exibe estado Bloqueado acionável quando dependências faltam; permite cancelar respeitando cancel_requested antes de cancelled; e revisa vídeo real por hash SHA-256 com blob URL revogado ao fechar/desmontar', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture(2, 'approved');

    let prodState: Record<string, unknown> | null = null;
    let previousProduction: Record<string, unknown> | null = null;
    let startCount = 0;
    let retryCalls = 0;
    let trackingFailure: 'none' | '401' | 'network' = 'none';
    let jobStatus: 'running' | 'cancel_requested' | 'cancelled' | 'blocked' | 'succeeded' = 'blocked';
    let rejectReviewOnceWithHashConflict = true;
    const revokedUrls: string[] = [];

    await page.addInitScript(() => {
      const origRevoke = URL.revokeObjectURL.bind(URL);
      (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls = [];
      URL.revokeObjectURL = (url: string) => {
        (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls.push(url);
        return origRevoke(url);
      };
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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { items: prodState ? [prodState, ...(previousProduction ? [previousProduction] : [])] : [] },
        });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body).toEqual({ expected_version: 2, mode: 'local_demo' });
        startCount += 1;
        jobStatus = 'blocked';
        prodState = {
          id: PROD_DEMO_ID,
          script_id: SCRIPT_V2_ID,
          script_version: 2,
          script_content_hash: SCRIPT_V2_HASH,
          job_id: JOB_DEMO_ID,
          mode: 'local_demo',
          stage: 'render',
          status: 'blocked',
          error:
            'Prepare separadamente, sem downloads no job: Python da fábrica em scripts/.venv; Remotion instalado pelos locks em sandbox',
          created_at: '2026-11-12T11:10:00Z',
          updated_at: '2026-11-12T11:10:01Z',
          artifacts: createSimulatedArtifacts(),
          review: null,
          demo_only: true,
          real_voice: false,
          speech_aligned: false,
        };
        if (startCount > 1) {
          previousProduction = { ...prodState, id: PROD_DEMO_ID, status: 'blocked' };
          jobStatus = 'running';
          prodState = { ...prodState, id: 'bbbbccccddddeeeeffff000011112222', job_id: 'new-production-job', status: 'running', error: null };
        }
        await route.fulfill({ status: 201, headers: corsHeaders, json: prodState });
        return;
      }
      if ((pathUrl === `/v1/productions/${PROD_DEMO_ID}` || pathUrl === '/v1/productions/bbbbccccddddeeeeffff000011112222') && request.method() === 'GET') {
        if (trackingFailure === '401') { await route.fulfill({ status: 401, headers: corsHeaders, json: { detail: 'Token recusado.' } }); return; }
        if (trackingFailure === 'network') { await route.abort('failed'); return; }
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_DEMO_ID}/retry` && request.method() === 'POST') {
        retryCalls += 1;
        await route.fulfill({ status: 409, headers: corsHeaders, json: { detail: 'Concilie a tentativa antes de criar nova produção.' } });
        return;
      }
      if ((pathUrl === `/v1/jobs/${JOB_DEMO_ID}/cancel` || pathUrl === '/v1/jobs/new-production-job/cancel') && request.method() === 'POST') {
        jobStatus = 'cancel_requested';
        prodState = {
          ...prodState!,
          status: 'cancel_requested',
          stage: 'render',
          updated_at: '2026-11-12T11:12:05Z',
        };
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { id: JOB_DEMO_ID, status: 'cancel_requested' },
        });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_DEMO_ID}/events` || pathUrl === '/v1/jobs/new-production-job/events') {
        const isTerm = ['blocked', 'cancelled', 'succeeded', 'failed', 'interrupted'].includes(jobStatus);
        const events: Record<string, unknown>[] = [
          { sequence: 1, kind: 'stdout', message: `Estado do executor para ${JOB_DEMO_ID}: ${jobStatus}` },
        ];
        if (isTerm) {
          events.push({
            kind: 'complete',
            job: {
              id: JOB_DEMO_ID,
              status: jobStatus,
              attempt: 1,
              payload: { operation: 'production.run', production_id: PROD_DEMO_ID },
              error: prodState?.error ?? null,
              result: null,
              created_at: '2026-11-12T11:10:00Z',
              updated_at: '2026-11-12T11:12:10Z',
            },
          });
        }
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: events.map(e => JSON.stringify(e)).join('\n') + '\n',
        });
        return;
      }
      if (pathUrl.endsWith(`/artifacts/${VIDEO_ARTIFACT_ID}`) && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'video/mp4' },
          body: getDemoVideoBuffer(),
        });
        return;
      }
      if (pathUrl.endsWith('/review') && pathUrl.startsWith('/v1/productions/') && request.method() === 'POST') {
        const idemKey = request.headers()['idempotency-key'];
        expect(idemKey).toBeTruthy();
        const body = request.postDataJSON();
        expect(body).toEqual({
          decision: 'approve',
          artifact_sha256: VIDEO_SHA256,
        });
        if (rejectReviewOnceWithHashConflict) {
          rejectReviewOnceWithHashConflict = false;
          await route.fulfill({
            status: 409,
            headers: corsHeaders,
            json: { detail: 'Hash não corresponde ao vídeo registrado.' },
          });
          return;
        }
        prodState = {
          ...prodState!,
          stage: 'review',
          review: {
            decision: 'approve',
            artifact_sha256: VIDEO_SHA256,
            reviewed_at: '2026-11-12T11:15:00Z',
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    await prodRegion.getByLabel('Modo de execução da produção').selectOption('local_demo');
    await prodRegion.getByRole('button', { name: 'Iniciar demo local', exact: true }).click();

    const detailRegion = prodRegion.getByRole('region', { name: /^Detalhes da produção / });
    await expect(detailRegion).toBeVisible();

    // 1. Blocked state is displayed with actionable message and no fake video
    const blockedAlert = detailRegion.getByRole('alert', { name: 'Produção bloqueada' });
    await expect(blockedAlert).toBeVisible();
    await expect(blockedAlert).toContainText(
      'Prepare separadamente, sem downloads no job: Python da fábrica em scripts/.venv; Remotion instalado pelos locks em sandbox'
    );
    await expect(detailRegion.getByRole('region', { name: 'Revisão humana final da produção' })).toHaveCount(0);

    await detailRegion.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'production-demo-blocked-dark.png') });

    // Recovery creates a distinct production only after explicit reconciliation, never job retry.
    const recover = detailRegion.getByRole('button', { name: 'Criar nova produção após conciliação', exact: true });
    await expect(recover).toBeDisabled();
    await expect(detailRegion.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
    await detailRegion.getByLabel('Conferi os artefatos e os efeitos da tentativa anterior').check();
    await recover.click();
    await expect(detailRegion.getByText('Em execução').first()).toBeVisible();
    expect(startCount).toBe(2);
    expect(retryCalls).toBe(0);
    expect(previousProduction?.id).toBe(PROD_DEMO_ID);
    await expect(detailRegion).toHaveAttribute('aria-label', 'Detalhes da produção bbbbccccddddeeeeffff000011112222');

    trackingFailure = '401';
    const trackingAlert = detailRegion.getByRole('alert', { name: 'Acompanhamento desatualizado' });
    await expect(trackingAlert).toContainText('401', { timeout: 10000 });
    await expect(trackingAlert).toContainText('Último estado conhecido');
    await expect(detailRegion.getByText('Em execução').first()).toBeVisible();
    trackingFailure = 'network';
    await expect(trackingAlert).toContainText('Falha de rede', { timeout: 10000 });
    trackingFailure = 'none';
    await trackingAlert.getByRole('button', { name: 'Verificar acompanhamento agora' }).click();
    await expect(trackingAlert).toHaveCount(0);

    await detailRegion.getByRole('button', { name: 'Cancelar produção', exact: true }).click();
    await expect(detailRegion.getByText('CANCELAMENTO EM ANDAMENTO')).toBeVisible();
    await expect(detailRegion.getByText('Cancelamento solicitado').first()).toBeVisible();
    await expect(detailRegion.getByRole('button', { name: 'Cancelando processo…', exact: true })).toBeDisabled();
    // Must NOT claim 'Cancelado' while still in 'cancel_requested'
    await expect(detailRegion.locator('.tag', { hasText: /^Cancelado$/ })).toHaveCount(0);

    // Now backend finishes killing the process tree and reports 'cancelled'
    jobStatus = 'cancelled';
    prodState = {
      ...prodState!,
      status: 'cancelled',
      updated_at: '2026-11-12T11:12:10Z',
    };
    await prodRegion.getByRole('button', { name: 'Recarregar produção atual', exact: true }).click();
    await expect(detailRegion.locator('.tag', { hasText: /^Cancelado$/ }).first()).toBeVisible();

    // 3. Simulate succeeded local_demo with real verified video artifact
    jobStatus = 'succeeded';
    prodState = {
      ...prodState!,
      status: 'succeeded',
      stage: 'review',
      error: null,
      artifacts: createDemoArtifactsWithVideo(),
      updated_at: '2026-11-12T11:14:00Z',
    };
    await prodRegion.getByRole('button', { name: 'Recarregar produção atual', exact: true }).click();

    // Open video preview -> uses authenticated fetch and creates blob: URL
    const artifactsTable = detailRegion.getByRole('table', { name: 'Tabela de artefatos da produção' });
    const videoRow = artifactsTable.locator('tr', {
      hasText: 'canais/demo/videos/fixture/render/short-rascunho.mp4',
    });
    await expect(videoRow).toBeVisible();
    await videoRow.getByRole('button', { name: 'Abrir vídeo', exact: true }).click();

    const videoPlayer = detailRegion.getByLabel(
      'Player de vídeo canais/demo/videos/fixture/render/short-rascunho.mp4'
    );
    await expect(videoPlayer).toBeVisible();
    const videoSrc = await videoPlayer.getAttribute('src');
    expect(videoSrc).toMatch(/^blob:/);

    await expect
      .poll(() => videoPlayer.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    await videoPlayer.evaluate(async (v: HTMLVideoElement) => {
      v.currentTime = 0.2;
      await new Promise<void>(resolve => {
        const done = () => resolve();
        v.addEventListener('seeked', done, { once: true });
        setTimeout(done, 300);
      });
    });
    const previewCard = detailRegion.getByRole('region', {
      name: 'Prévia do artefato canais/demo/videos/fixture/render/short-rascunho.mp4',
    });
    await previewCard.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'production-demo-video-preview-dark.png') });

    // Close preview -> revokes the blob URL immediately
    await detailRegion.getByRole('button', { name: 'Fechar prévia', exact: true }).click();
    const revokedAfterClose = await page.evaluate(
      () => (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls
    );
    expect(revokedAfterClose).toContain(videoSrc);
    revokedUrls.push(...revokedAfterClose);

    // 4. Final human review bound to VIDEO_SHA256 (first attempt rejected with 409 hash conflict, then approved)
    const reviewRegion = detailRegion.getByRole('region', { name: 'Revisão humana final da produção' });
    await expect(reviewRegion).toBeVisible();
    await expect(reviewRegion.getByText('APENAS DEMO / TESTE · NÃO PUBLICÁVEL')).toBeVisible();
    await expect(reviewRegion.getByText(VIDEO_SHA256)).toBeVisible();

    const approveBtn = reviewRegion.getByRole('button', { name: 'Aprovar produção (hash verificado)', exact: true });
    await expect(approveBtn).toBeDisabled();
    await reviewRegion
      .getByLabel('Confirmo ciência das pendências de QC e/ou licenças não verificadas (publishable: false)')
      .check();
    await expect(approveBtn).toBeEnabled();

    await approveBtn.click();
    await expect(prodRegion.getByRole('alert')).toContainText(
      'Conflito de versão, hash ou estado (409): Hash não corresponde ao vídeo registrado.'
    );
    await expect(detailRegion.getByRole('region', { name: 'Decisão de revisão final registrada' })).toHaveCount(0);

    await approveBtn.click();

    const recordedReview = detailRegion.getByRole('region', { name: 'Decisão de revisão final registrada' });
    await expect(recordedReview).toBeVisible();
    await expect(recordedReview.getByText('Aprovado na revisão final')).toBeVisible();
    await expect(recordedReview.getByText(VIDEO_SHA256)).toBeVisible();
    await expect(recordedReview.getByText('DEMO / TESTE (teste: true)')).toBeVisible();

    // Switch to Light theme at 1040x680 and capture screenshot
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'CLARO', exact: true }).click();
    await page.setViewportSize({ width: 1040, height: 680 });
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    await expect(recordedReview).toBeVisible();
    await recordedReview.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifactDir, 'production-demo-approved-light-1040.png') });
  });

  test('Idempotência, tratamento de erros 401/409/422, flags ausentes como não verificados e recuperação de estado interrompido após reinício', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture(2, 'approved');

    let postAttempts = 0;
    const keysUsed: string[] = [];
    let nextBehavior: 'network_fail' | '401' | '409' | '422' | 'interrupted_ok' = 'network_fail';

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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'POST') {
        postAttempts += 1;
        keysUsed.push(request.headers()['idempotency-key']);

        if (nextBehavior === 'network_fail') {
          await route.abort('failed');
          return;
        }
        if (nextBehavior === '401') {
          await route.fulfill({
            status: 401,
            headers: corsHeaders,
            json: { detail: 'Sessão expirada ao iniciar produção.' },
          });
          return;
        }
        if (nextBehavior === '409') {
          await route.fulfill({
            status: 409,
            headers: corsHeaders,
            json: { detail: 'Versão do roteiro desatualizada ou execução já em andamento.' },
          });
          return;
        }
        if (nextBehavior === '422') {
          await route.fulfill({
            status: 422,
            headers: corsHeaders,
            json: { detail: 'Plano de produção recusado pelo validador de contrato.' },
          });
          return;
        }

        // Omit optional flags demo_only/real_voice/speech_aligned to verify backward-compatible 'unverified' handling
        const record = {
          id: PROD_SIM_ID,
          script_id: SCRIPT_V2_ID,
          script_version: 2,
          script_content_hash: SCRIPT_V2_HASH,
          job_id: JOB_SIM_ID,
          mode: 'simulated',
          stage: 'scenes',
          status: 'interrupted',
          error: 'Execução interrompida; concilie antes de repetir.',
          created_at: '2026-11-12T11:20:00Z',
          updated_at: '2026-11-12T11:21:00Z',
          artifacts: [],
          review: null,
        };
        await route.fulfill({ status: 201, headers: corsHeaders, json: record });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_SIM_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body:
            JSON.stringify({
              kind: 'complete',
              job: {
                id: JOB_SIM_ID,
                status: 'interrupted',
                attempt: 1,
                payload: { operation: 'production.run', production_id: PROD_SIM_ID },
                error: 'Execução interrompida; concilie antes de repetir.',
                result: null,
                created_at: '2026-11-12T11:20:00Z',
                updated_at: '2026-11-12T11:21:00Z',
              },
            }) + '\n',
        });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    const startBtn = prodRegion.getByRole('button', { name: 'Iniciar produção simulada', exact: true });

    // 1. Network failure preserves Idempotency-Key for next retry
    nextBehavior = 'network_fail';
    await startBtn.click();
    await expect(prodRegion.getByRole('alert')).toContainText('Falha de rede ao comunicar com o backend local');
    expect(postAttempts).toBe(1);

    // 2. Retry reuses the same Idempotency-Key and surfaces 401
    nextBehavior = '401';
    await startBtn.click();
    expect(postAttempts).toBe(2);
    expect(keysUsed[1]).toBe(keysUsed[0]);
    await expect(prodRegion.getByRole('alert')).toContainText(
      'Sessão não autorizada (401): Sessão expirada ao iniciar produção.'
    );

    // 3. After HTTP status response, a fresh Idempotency-Key is generated; test 409 and 422
    nextBehavior = '409';
    await startBtn.click();
    expect(keysUsed[2]).not.toBe(keysUsed[1]);
    await expect(prodRegion.getByRole('alert')).toContainText(
      'Conflito de versão, hash ou estado (409): Versão do roteiro desatualizada ou execução já em andamento.'
    );

    nextBehavior = '422';
    await startBtn.click();
    await expect(prodRegion.getByRole('alert')).toContainText(
      'Contrato ou payload inválido (422): Plano de produção recusado pelo validador de contrato.'
    );

    // 4. Interrupted state after backend restart shows explicit recovery alert, retry button, and unverified fallback for absent flags
    nextBehavior = 'interrupted_ok';
    await startBtn.click();
    const detailRegion = prodRegion.getByRole('region', { name: `Detalhes da produção ${PROD_SIM_ID}` });
    await expect(detailRegion.getByRole('alert', { name: 'Produção interrompida' })).toContainText(
      'Execução interrompida; concilie antes de repetir.'
    );
    await expect(detailRegion.getByText('Não verificado (ausente; nunca inferir voz real)')).toBeVisible();
    await expect(detailRegion.getByText('Não verificado (ausente; nunca inferir alinhamento real)')).toBeVisible();
    await expect(detailRegion.getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
    await expect(detailRegion.getByRole('button', { name: 'Criar nova produção após conciliação', exact: true })).toBeDisabled();
  });

  test('Modo Piloto Local com Narração (local_pilot): compatibilidade com backend antigo (422), bloqueio real sem inferir capacidade pelo modo pedido, e diferenciação entre TTS local sintético, tom de fixture e quality_report não verificado via pilot-evidence.json', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture(2, 'approved');
    const PROD_PILOT_BLOCKED_ID = 'ccccddddeeeeffff0000111122223333';
    const PROD_PILOT_OK_ID = 'ddddeeeeffff00001111222233334444';
    const JOB_PILOT_BLOCKED_ID = 'job_pilot_blocked_01';
    const JOB_PILOT_OK_ID = 'job_pilot_ok_02';
    const PILOT_EVIDENCE_ID = 'e1e2e3e4f1f2f3f4a1a2a3a4b1b2b3b4';
    const PILOT_SECTION_1_AUDIO_ID = '10101010202020203030303040404041';
    const PILOT_SECTION_2_AUDIO_ID = '10101010202020203030303040404042';
    const PILOT_SECTION_3_AUDIO_ID = '10101010202020203030303040404043';
    const PILOT_AUDIO_ID = 'a1a2a3a4b1b2b3b4c1c2c3c4d1d2d3d4';
    const PILOT_AUDIO_REVIEW_ID = '10101010202020203030303040404049';

    let postStage: 'old_backend_422' | 'blocked_missing_tts' | 'succeeded_pilot' = 'old_backend_422';
    let evidenceFetchMode: '401' | 'unknown_hash' | 'ok' = '401';
    let omitEvidenceArtifact = false;
    let productionsList: Record<string, unknown>[] = [];

    const mockPilotEvidence = {
      schema_version: 1,
      demo_only: true,
      alignment_method: 'measured_sections',
      narration: {
        kind: 'local_tts',
        engine: 'windows_sapi',
        voice: 'Microsoft Maria Desktop - Portuguese(Brazil)',
        duration_seconds: 16.0,
        sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
      },
      scenes: [
        { id: 'hook', start: 0.0, end: 5.2, asset_id: 'scene-1' },
        { id: 'body', start: 5.2, end: 10.8, asset_id: 'scene-2' },
        { id: 'conclusion', start: 10.8, end: 16.0, asset_id: 'scene-3' },
      ],
      subtitles: [
        { start: 0.0, end: 5.2, text: 'Como garantir que cada artefato corresponde ao roteiro aprovado?' },
        { start: 5.2, end: 10.8, text: 'O plano gera cenas demonstrativas e narração TTS local sintética.' },
        { start: 10.8, end: 16.0, text: 'O render técnico exige revisão humana vinculada ao SHA-256.' },
      ],
      assets: [
        {
          id: 'scene-1',
          relative_path: 'canais/demo/videos/fixture/scene-1.png',
          sha256: 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58',
          origin: 'original_local',
          license: 'original',
          attribution: 'Cena informativa original gerada localmente a partir do roteiro aprovado.',
          generated_at: '2026-11-13T13:04:49Z',
        },
        {
          id: 'narration',
          relative_path: 'canais/demo/videos/fixture/fixture.wav',
          sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
          origin: 'system_voice',
          license: 'unverified',
          attribution:
            'Microsoft Maria Desktop - Portuguese(Brazil); Narração sintética local Windows SAPI (pt-BR); não é voz humana ou clonada; licença não verificada.',
          generated_at: '2026-11-13T13:04:49Z',
        },
      ],
      video: {
        duration_seconds: 16.8,
        width: 540,
        height: 960,
        frames: 504,
      },
    };

    const pilotArtifacts = [
      {
        id: 'art_plan_pilot',
        kind: 'plan' as const,
        relative_path: 'plan.json',
        size_bytes: 1420,
        sha256: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
      },
      {
        id: PILOT_SECTION_1_AUDIO_ID,
        kind: 'audio' as const,
        relative_path: 'canais/demo/videos/fixture/section-1.wav',
        size_bytes: 10240,
        sha256: 'a242cb549dbb7f35a2643c94c1d7be59225bc33aba513754da3af2fec5a3bd1b',
      },
      {
        id: PILOT_SECTION_2_AUDIO_ID,
        kind: 'audio' as const,
        relative_path: 'canais/demo/videos/fixture/section-2.wav',
        size_bytes: 11240,
        sha256: '5d0361f1049795aa78ebb84c8630577ffa6f7ad6172b9e1b67b0941aa81be023',
      },
      {
        id: PILOT_SECTION_3_AUDIO_ID,
        kind: 'audio' as const,
        relative_path: 'canais/demo/videos/fixture/section-3.wav',
        size_bytes: 10564,
        sha256: '70176a894ce4fd841a25ef1d985fae982ddac135ba5e625b1e881cadc9038c42',
      },
      {
        id: PILOT_AUDIO_ID,
        kind: 'audio' as const,
        relative_path: 'canais/demo/videos/fixture/fixture.wav',
        size_bytes: 32044,
        sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
      },
      {
        id: PILOT_AUDIO_REVIEW_ID,
        kind: 'audio' as const,
        relative_path: 'canais/demo/videos/fixture/render/audio-review.wav',
        size_bytes: 33120,
        sha256: '9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
      },
      {
        id: 'art_scene_pilot_1',
        kind: 'scene' as const,
        relative_path: 'canais/demo/videos/fixture/scene-1.png',
        size_bytes: 680,
        sha256: 'bbbb1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
      },
      {
        id: 'art_subs_pilot',
        kind: 'subtitles' as const,
        relative_path: 'canais/demo/videos/fixture/fixture.srt',
        size_bytes: 312,
        sha256: 'cccc1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
      },
      {
        id: PILOT_EVIDENCE_ID,
        kind: 'manifest' as const,
        relative_path: 'pilot-evidence.json',
        size_bytes: 640,
        sha256: 'f0f01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
      },
      {
        id: VIDEO_ARTIFACT_ID,
        kind: 'video' as const,
        relative_path: 'canais/demo/videos/fixture/render/short-rascunho.mp4',
        size_bytes: 96902,
        sha256: VIDEO_SHA256,
      },
    ];

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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: productionsList } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body).toEqual({ expected_version: 2, mode: 'local_pilot', render_quality: 'draft' });

        if (postStage === 'old_backend_422') {
          await route.fulfill({
            status: 422,
            headers: corsHeaders,
            json: { detail: 'Input should be simulated or local_demo' },
          });
          return;
        }

        if (postStage === 'blocked_missing_tts') {
          const blockedRecord = {
            id: PROD_PILOT_BLOCKED_ID,
            script_id: SCRIPT_V2_ID,
            script_version: 2,
            script_content_hash: SCRIPT_V2_HASH,
            job_id: JOB_PILOT_BLOCKED_ID,
            mode: 'local_pilot',
            stage: 'narration',
            status: 'blocked',
            error:
              'Bloqueado no piloto local: sintetizador TTS local offline ausente ou não configurado; nenhum áudio ou vídeo falso foi gerado.',
            created_at: '2026-11-13T10:00:00Z',
            updated_at: '2026-11-13T10:00:02Z',
            artifacts: [],
            review: null,
            demo_only: true,
            real_voice: false,
            speech_aligned: false,
            narration_kind: null,
            narration_disclosure: null,
            alignment_method: null,
            publishable: false,
          };
          productionsList = [blockedRecord];
          await route.fulfill({ status: 201, headers: corsHeaders, json: blockedRecord });
          return;
        }

        const okRecord = {
          id: PROD_PILOT_OK_ID,
          script_id: SCRIPT_V2_ID,
          script_version: 2,
          script_content_hash: SCRIPT_V2_HASH,
          job_id: JOB_PILOT_OK_ID,
          mode: 'local_pilot',
          stage: 'review',
          status: 'succeeded',
          error: null,
          created_at: '2026-11-13T10:05:00Z',
          updated_at: '2026-11-13T10:05:10Z',
          artifacts: pilotArtifacts,
          review: null,
          demo_only: true,
          real_voice: false,
          speech_aligned: false,
          narration_kind: 'local_tts',
          narration_disclosure:
            'Narração sintética local Windows SAPI (pt-BR); não é voz humana ou clonada; licença não verificada.',
          alignment_method: 'measured_sections',
          publishable: false,
        };
        productionsList = [okRecord, ...productionsList];
        await route.fulfill({ status: 201, headers: corsHeaders, json: okRecord });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_PILOT_BLOCKED_ID}` && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: productionsList.find(p => p.id === PROD_PILOT_BLOCKED_ID),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_PILOT_OK_ID}` && request.method() === 'GET') {
        const baseProd = productionsList.find(p => p.id === PROD_PILOT_OK_ID) as
          | Record<string, unknown>
          | undefined;
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json:
            baseProd && omitEvidenceArtifact
              ? {
                  ...baseProd,
                  artifacts: pilotArtifacts.filter(a => a.id !== PILOT_EVIDENCE_ID),
                }
              : baseProd,
        });
        return;
      }
      if (
        (pathUrl === `/v1/jobs/${JOB_PILOT_BLOCKED_ID}/events` ||
          pathUrl === `/v1/jobs/${JOB_PILOT_OK_ID}/events`) &&
        request.method() === 'GET'
      ) {
        const isOk = pathUrl.includes(JOB_PILOT_OK_ID);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body:
            JSON.stringify({
              sequence: 1,
              kind: 'stage',
              message: isOk ? 'review' : 'narration',
            }) + '\n',
        });
        return;
      }
      if (
        pathUrl === `/v1/productions/${PROD_PILOT_OK_ID}/artifacts/${PILOT_EVIDENCE_ID}` &&
        request.method() === 'GET'
      ) {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        if (evidenceFetchMode === '401') {
          await route.fulfill({
            status: 401,
            headers: corsHeaders,
            json: { detail: 'Token expirado ao ler pilot-evidence.json.' },
          });
          return;
        }
        if (evidenceFetchMode === 'unknown_hash') {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...mockPilotEvidence,
              narration: {
                ...mockPilotEvidence.narration,
                sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
              },
            }),
          });
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(mockPilotEvidence),
        });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    const modeSelect = prodRegion.getByLabel('Modo de execução da produção');

    // Select 'local_pilot' ('Piloto local com narração')
    await modeSelect.selectOption('local_pilot');
    await expect(prodRegion.getByText('PILOTO LOCAL COM NARRAÇÃO').first()).toBeVisible();
    await expect(
      prodRegion.getByText(/Não promete ferramenta instalada: se motor de voz\/render faltar/i)
    ).toBeVisible();

    const startPilotBtn = prodRegion.getByRole('button', {
      name: 'Iniciar piloto local com narração',
      exact: true,
    });
    await expect(startPilotBtn).toBeEnabled();

    // 1. Against older backend returning 422, shows explicit 422 and never infers success
    await startPilotBtn.click();
    await expect(prodRegion.getByRole('alert')).toContainText(
      'Contrato ou payload inválido (422): Input should be simulated or local_demo'
    );
    await expect(prodRegion.getByRole('region', { name: /^Detalhes da produção / })).toHaveCount(0);

    // 2. Missing TTS / voice dependency blocks the job: UI must NOT infer TTS or aligned subtitles from mode='local_pilot'
    postStage = 'blocked_missing_tts';
    await startPilotBtn.click();

    const blockedDetail = prodRegion.getByRole('region', {
      name: `Detalhes da produção ${PROD_PILOT_BLOCKED_ID}`,
    });
    await expect(blockedDetail).toBeVisible();
    await expect(blockedDetail.getByRole('alert', { name: 'Produção bloqueada' })).toContainText(
      'sintetizador TTS local offline ausente ou não configurado'
    );
    // Provenance must reflect unverified state since narration_kind/alignment_method are null and no artifacts were produced
    await expect(
      blockedDetail.getByText(
        'Não verificado (sem evidência de áudio/TTS no resultado; nunca inferir do modo pedido)'
      )
    ).toBeVisible();
    await expect(
      blockedDetail.getByText(
        'Não verificado (sem legenda SRT registrada; alinhamento de fala não verificado)'
      )
    ).toBeVisible();
    await expect(
      blockedDetail.getByText('Não verificado (sem cenas registradas nos artefatos)')
    ).toBeVisible();
    await expect(
      blockedDetail.getByText('Não verificado (relatório de qualidade indisponível)')
    ).toBeVisible();
    await expect(
      blockedDetail.getByText('Não verificado (pilot-evidence.json ausente nos artefatos)')
    ).toBeVisible();

    await blockedDetail.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'production-pilot-blocked-dark.png') });

    // 3. Reconcile explicitly and start succeeded local_pilot run with pilot-evidence.json
    postStage = 'succeeded_pilot';
    evidenceFetchMode = '401';
    await blockedDetail.getByLabel('Conferi os artefatos e os efeitos da tentativa anterior').check();
    await blockedDetail
      .getByRole('button', { name: 'Criar nova produção após conciliação', exact: true })
      .click();

    const okDetail = prodRegion.getByRole('region', {
      name: `Detalhes da produção ${PROD_PILOT_OK_ID}`,
    });
    await expect(okDetail).toBeVisible();

    // First, pilot-evidence.json returns 401 -> surfaces explicit 401 alert while preserving known production state
    // and does NOT expose the complete narration shortcut button (avoiding picking section-1.wav)
    const evidenceErrorAlert = okDetail.getByRole('alert', {
      name: 'Erro ao carregar evidência do piloto',
    });
    await expect(evidenceErrorAlert).toContainText(
      'Sessão não autorizada (401): Token expirado ao ler pilot-evidence.json.'
    );
    const okQuickBar = okDetail.getByRole('region', {
      name: 'Acesso rápido de insumos para revisão',
    });
    await expect(
      okQuickBar.getByRole('button', { name: 'Áudio / narração WAV', exact: true })
    ).toHaveCount(0);
    await expect(
      okQuickBar.getByText(
        'Narração completa não verificada (falha ao ler pilot-evidence.json · use a tabela para faixas individuais)'
      )
    ).toBeVisible();

    // Negative case: pilot-evidence.json loads with an unknown/unmatched narration.sha256 -> shortcut stays disabled/hidden with explicit hash mismatch badge
    evidenceFetchMode = 'unknown_hash';
    await evidenceErrorAlert
      .getByRole('button', { name: 'Recarregar evidência do piloto', exact: true })
      .click();
    await expect(evidenceErrorAlert).toHaveCount(0);
    await expect(
      okQuickBar.getByRole('button', { name: 'Áudio / narração WAV', exact: true })
    ).toHaveCount(0);
    await expect(
      okQuickBar.getByText(
        'Narração completa não verificada (narration.sha256 ausente ou sem correspondência nos artefatos · use a tabela para faixas individuais)'
      )
    ).toBeVisible();

    // Negative case: pilot-evidence.json absent from artifacts -> shortcut stays hidden with explicit missing-evidence badge
    omitEvidenceArtifact = true;
    await prodRegion.getByRole('button', { name: 'Recarregar produção atual', exact: true }).click();
    await expect(
      okQuickBar.getByRole('button', { name: 'Áudio / narração WAV', exact: true })
    ).toHaveCount(0);
    await expect(
      okQuickBar.getByText(
        'Narração completa não verificada (pilot-evidence.json ausente · use a tabela para faixas individuais)'
      )
    ).toBeVisible();

    // Reload pilot-evidence.json with matching narration.sha256 -> shows loading badge while in-flight, then enables shortcut and populates full provenance while keeping quality_report as unverified
    omitEvidenceArtifact = false;
    evidenceFetchMode = 'ok';
    await prodRegion.getByRole('button', { name: 'Recarregar produção atual', exact: true }).click();
    await expect(
      okQuickBar.getByText('Verificando narração completa em pilot-evidence.json…')
    ).toBeVisible();
    await expect(
      okQuickBar.getByRole('button', { name: 'Áudio / narração WAV', exact: true })
    ).toBeVisible();

    const provRegion = okDetail.getByLabel('Avisos de proveniência e escopo de demonstração');
    await expect(
      provRegion.getByText(
        'TTS local sintético (local_tts · não é voz humana nem clone · real_voice: false · motor: windows_sapi (Microsoft Maria Desktop - Portuguese(Brazil)))'
      )
    ).toBeVisible();
    await expect(
      provRegion.getByText(
        'Legenda segmentada local (.srt · measured_sections) · Alinhamento de fala não verificado (speech_aligned: false · sem alinhamento fino por palavra)'
      )
    ).toBeVisible();
    await expect(
      provRegion.getByText('Cenas demonstrativas locais (original_local · 1 arquivo(s) PNG · sem assets externos)')
    ).toBeVisible();
    await expect(
      provRegion.getByText('Não verificado (relatório de qualidade indisponível)')
    ).toBeVisible();
    await expect(
      provRegion.getByText('pilot-evidence.json (Evidência carregada)')
    ).toBeVisible();
    await expect(
      provRegion.getByText(/1 asset\(s\) não verificado\(s\) \(license: unverified — voz do Windows não comprova licença comercial nem publicabilidade\)/)
    ).toBeVisible();
  });

  test('Modo Piloto Local: preview autenticado de vídeo/SRT/áudio/evidência com QC parcial (not_checked), revogação de Blob URL ao trocar/fechar, preservação do estado em erro 401/rede na prévia e rejeição/aprovação por hash sem implicar publicabilidade', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture(2, 'approved');
    const PROD_PILOT_ID = 'eeeeffff000011112222333344445555';
    const JOB_PILOT_ID = 'job_pilot_review_01';
    const PILOT_EVIDENCE_ID = 'e1e2e3e4f1f2f3f4a1a2a3a4b1b2b3b4';
    const PILOT_SECTION_1_AUDIO_ID = '20202020303030304040404050505051';
    const PILOT_SECTION_2_AUDIO_ID = '20202020303030304040404050505052';
    const PILOT_SECTION_3_AUDIO_ID = '20202020303030304040404050505053';
    const PILOT_AUDIO_ID = 'a1a2a3a4b1b2b3b4c1c2c3c4d1d2d3d4';
    const PILOT_AUDIO_REVIEW_ID = '20202020303030304040404050505059';
    const PILOT_SUBS_ID = 'b1b2b3b4c1c2c3c4d1d2d3c4e1e2e3e4';

    let srtFetchFailure: 'none' | '401' | 'network' = 'none';
    const externalRequests: string[] = [];
    const requestedAudioArtifactIds: string[] = [];

    const mockPilotEvidence = {
      schema_version: 1,
      demo_only: true,
      alignment_method: 'measured_sections',
      narration: {
        kind: 'local_tts',
        engine: 'windows_sapi',
        voice: 'Microsoft Maria Desktop - Portuguese(Brazil)',
        duration_seconds: 47.912925,
        sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
      },
      scenes: [
        { id: 'hook', start: 0.0, end: 14.87, asset_id: 'scene-1' },
        { id: 'body', start: 14.87, end: 31.28, asset_id: 'scene-2' },
        { id: 'conclusion', start: 31.28, end: 47.91, asset_id: 'scene-3' },
      ],
      subtitles: [
        { start: 0.0, end: 1.85, text: 'No bairro fictício Jardim Aurora' },
        { start: 14.87, end: 16.84, text: 'A proposta começa com um reservatório fechado.' },
        { start: 31.28, end: 33.06, text: 'O resultado precisa de revisão humana.' },
      ],
      assets: [
        {
          id: 'scene-1',
          relative_path: 'canais/demo/videos/fixture/scene-1.png',
          sha256: 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58',
          origin: 'original_local',
          license: 'original',
          attribution: 'Cena informativa original gerada localmente a partir do roteiro aprovado.',
          generated_at: '2026-11-13T13:04:49Z',
        },
        {
          id: 'narration',
          relative_path: 'canais/demo/videos/fixture/fixture.wav',
          sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
          origin: 'system_voice',
          license: 'unverified',
          attribution:
            'Microsoft Maria Desktop - Portuguese(Brazil); Narração sintética local Windows SAPI (pt-BR); não é voz humana ou clonada; licença não verificada.',
          generated_at: '2026-11-13T13:04:49Z',
        },
      ],
      video: {
        duration_seconds: 48.733333,
        width: 540,
        height: 960,
        frames: 1462,
      },
      // Sonnet QC schema v1: checks pass/fail/not_checked, warnings, publishable=false
      quality_report: {
        schema_version: 1,
        checks: [
          { id: 'schema', status: 'pass', detail: 'Schema válido.' },
          { id: 'narration', status: 'pass', detail: 'TTS local registrado.' },
          { id: 'provenance_licenses', status: 'not_checked', detail: 'Voz SAPI com license=unverified.' },
          { id: 'acoustic_evidence', status: 'not_checked', detail: 'Loudness e inteligibilidade não medidos.' },
          { id: 'word_alignment', status: 'not_checked', detail: 'Alinhamento fino por palavra não medido.' },
          { id: 'publishability', status: 'not_checked', detail: 'Publicação bloqueada para piloto local.' },
        ],
        blocking_errors: [],
        warnings: ['Resolução 540x960 diferente de 1080x1920', 'Voz SAPI possui licença unverified'],
        publishable: false,
      },
    };

    let prodState: Record<string, unknown> = {
      id: PROD_PILOT_ID,
      script_id: SCRIPT_V2_ID,
      script_version: 2,
      script_content_hash: SCRIPT_V2_HASH,
      job_id: JOB_PILOT_ID,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      error: null,
      created_at: '2026-11-13T10:15:00Z',
      updated_at: '2026-11-13T10:15:10Z',
      artifacts: [
        {
          id: 'art_plan_pilot',
          kind: 'plan' as const,
          relative_path: 'plan.json',
          size_bytes: 1420,
          sha256: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
        {
          id: PILOT_SECTION_1_AUDIO_ID,
          kind: 'audio' as const,
          relative_path: 'canais/demo/videos/fixture/section-1.wav',
          size_bytes: 10240,
          sha256: 'a242cb549dbb7f35a2643c94c1d7be59225bc33aba513754da3af2fec5a3bd1b',
        },
        {
          id: PILOT_SECTION_2_AUDIO_ID,
          kind: 'audio' as const,
          relative_path: 'canais/demo/videos/fixture/section-2.wav',
          size_bytes: 11240,
          sha256: '5d0361f1049795aa78ebb84c8630577ffa6f7ad6172b9e1b67b0941aa81be023',
        },
        {
          id: PILOT_SECTION_3_AUDIO_ID,
          kind: 'audio' as const,
          relative_path: 'canais/demo/videos/fixture/section-3.wav',
          size_bytes: 10564,
          sha256: '70176a894ce4fd841a25ef1d985fae982ddac135ba5e625b1e881cadc9038c42',
        },
        {
          id: PILOT_AUDIO_ID,
          kind: 'audio' as const,
          relative_path: 'canais/demo/videos/fixture/fixture.wav',
          size_bytes: 32044,
          sha256: '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a',
        },
        {
          id: PILOT_AUDIO_REVIEW_ID,
          kind: 'audio' as const,
          relative_path: 'canais/demo/videos/fixture/render/audio-review.wav',
          size_bytes: 33120,
          sha256: '9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
        },
        {
          id: PILOT_SUBS_ID,
          kind: 'subtitles' as const,
          relative_path: 'canais/demo/videos/fixture/fixture.srt',
          size_bytes: 312,
          sha256: 'cccc1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
        {
          id: PILOT_EVIDENCE_ID,
          kind: 'manifest' as const,
          relative_path: 'pilot-evidence.json',
          size_bytes: 640,
          sha256: 'f0f01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
        {
          id: VIDEO_ARTIFACT_ID,
          kind: 'video' as const,
          relative_path: 'canais/demo/videos/fixture/render/short-rascunho.mp4',
          size_bytes: 96902,
          sha256: VIDEO_SHA256,
        },
      ],
      review: null,
      demo_only: true,
      real_voice: false,
      speech_aligned: false,
      narration_kind: 'local_tts',
      narration_disclosure:
        'Narração sintética local Windows SAPI (pt-BR); não é voz humana ou clonada; licença não verificada.',
      alignment_method: 'measured_sections',
      publishable: false,
    };

    await page.addInitScript(() => {
      const origRevoke = URL.revokeObjectURL.bind(URL);
      (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls = [];
      URL.revokeObjectURL = (url: string) => {
        (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls.push(url);
        return origRevoke(url);
      };
    });

    page.on('request', req => {
      const url = req.url();
      if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
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
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [prodState] } });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_PILOT_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_PILOT_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
        });
        return;
      }
      if (pathUrl.endsWith(`/artifacts/${VIDEO_ARTIFACT_ID}`) && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'video/mp4' },
          body: getDemoVideoBuffer(),
        });
        return;
      }
      if (
        (pathUrl.endsWith(`/artifacts/${PILOT_AUDIO_ID}`) ||
          pathUrl.endsWith(`/artifacts/${PILOT_SECTION_1_AUDIO_ID}`) ||
          pathUrl.endsWith(`/artifacts/${PILOT_SECTION_2_AUDIO_ID}`) ||
          pathUrl.endsWith(`/artifacts/${PILOT_SECTION_3_AUDIO_ID}`) ||
          pathUrl.endsWith(`/artifacts/${PILOT_AUDIO_REVIEW_ID}`)) &&
        request.method() === 'GET'
      ) {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        const requestedId = pathUrl.split('/').pop()!;
        requestedAudioArtifactIds.push(requestedId);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'audio/wav' },
          body: getDemoVideoBuffer(),
        });
        return;
      }
      if (pathUrl.endsWith(`/artifacts/${PILOT_SUBS_ID}`) && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        if (srtFetchFailure === '401') {
          await route.fulfill({
            status: 401,
            headers: corsHeaders,
            json: { detail: 'Sessão inválida ao abrir legenda SRT.' },
          });
          return;
        }
        if (srtFetchFailure === 'network') {
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
          body: mockSrtContent,
        });
        return;
      }
      if (pathUrl.endsWith(`/artifacts/${PILOT_EVIDENCE_ID}`) && request.method() === 'GET') {
        expect(request.headers()['authorization']).toBe(`Bearer ${SESSION_TOKEN}`);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(mockPilotEvidence),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_PILOT_ID}/review` && request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body).toEqual({
          decision: 'reject',
          artifact_sha256: VIDEO_SHA256,
        });
        prodState = {
          ...prodState,
          review: {
            decision: 'reject',
            artifact_sha256: VIDEO_SHA256,
            reviewed_at: '2026-11-13T10:20:00Z',
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const prodRegion = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
    const detailRegion = prodRegion.getByRole('region', {
      name: `Detalhes da produção ${PROD_PILOT_ID}`,
    });
    await expect(detailRegion).toBeVisible();

    // Verify QC schema v1 partial status (never claiming all checks passed when not_checked items exist)
    await expect(
      detailRegion
        .getByLabel('Avisos de proveniência e escopo de demonstração')
        .getByText(
          'QC parcial (2 pass, 0 fail, 4 not_checked: provenance_licenses, acoustic_evidence, word_alignment, publishability) · 2 aviso(s) · publishable: false (não equivale a aprovação total)'
        )
    ).toBeVisible();

    const quickReviewBar = detailRegion.getByRole('region', {
      name: 'Acesso rápido de insumos para revisão',
    });
    await expect(quickReviewBar).toBeVisible();

    // 1. Open video preview via quick-access bar
    await quickReviewBar.getByRole('button', { name: 'Prévia de vídeo (MP4)', exact: true }).click();
    const videoPlayer = detailRegion.getByLabel(
      'Player de vídeo canais/demo/videos/fixture/render/short-rascunho.mp4'
    );
    await expect(videoPlayer).toBeVisible();
    const videoBlobUrl = await videoPlayer.getAttribute('src');
    expect(videoBlobUrl).toMatch(/^blob:/);

    // 2. Switching to SRT when 401 or network error occurs surfaces explicit message AND preserves open video preview
    srtFetchFailure = '401';
    await quickReviewBar
      .getByRole('button', { name: 'Legendas / transcrição SRT', exact: true })
      .click();
    await expect(detailRegion.getByRole('alert')).toContainText(
      'Sessão não autorizada (401): Sessão inválida ao abrir legenda SRT.'
    );
    await expect(videoPlayer).toBeVisible();

    srtFetchFailure = 'network';
    await quickReviewBar
      .getByRole('button', { name: 'Legendas / transcrição SRT', exact: true })
      .click();
    await expect(detailRegion.getByRole('alert')).toContainText(
      'Falha de rede ao comunicar com o backend local'
    );
    await expect(videoPlayer).toBeVisible();

    // 3. Switching to SRT when network recovers revokes the video blob URL immediately and renders segmented SRT
    srtFetchFailure = 'none';
    await quickReviewBar
      .getByRole('button', { name: 'Legendas / transcrição SRT', exact: true })
      .click();

    const revokedAfterSwitchToSrt = await page.evaluate(
      () => (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls
    );
    expect(revokedAfterSwitchToSrt).toContain(videoBlobUrl);

    const srtSegmentsRegion = detailRegion.getByRole('region', {
      name: 'Segmentos de legenda SRT',
    });
    await expect(srtSegmentsRegion).toBeVisible();
    await expect(srtSegmentsRegion).toContainText('TRANSCRIÇÃO / LEGENDA SEGMENTADA (3 TRECHO(S))');
    await expect(srtSegmentsRegion).toContainText(
      'Limites medidos por seção (measured_sections) · Alinhamento fino por palavra não verificado'
    );
    await expect(srtSegmentsRegion).toContainText('#1 · 00:00:00,000 → 00:00:05,200');

    const srtPreviewCard = detailRegion.getByRole('region', {
      name: 'Prévia do artefato canais/demo/videos/fixture/fixture.srt',
    });
    await srtPreviewCard.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifactDir, 'production-pilot-srt-preview-dark.png') });

    // 4. Switch to audio preview via quick-access bar -> must select ONLY the complete narration WAV matching narration.sha256 (PILOT_AUDIO_ID), never section-1/2/3.wav or render/audio-review.wav
    await quickReviewBar
      .getByRole('button', { name: 'Áudio / narração WAV', exact: true })
      .click();
    expect(requestedAudioArtifactIds).toEqual([PILOT_AUDIO_ID]);
    const audioPlayer = detailRegion.getByLabel(
      'Player de áudio canais/demo/videos/fixture/fixture.wav'
    );
    await expect(audioPlayer).toBeVisible();
    const audioBlobUrl = await audioPlayer.getAttribute('src');
    expect(audioBlobUrl).toMatch(/^blob:/);
    await expect(
      detailRegion.getByText('Áudio de TTS local sintético — não é voz humana nem clone de voz')
    ).toBeVisible();
    await expect(
      detailRegion.getByText('SHA-256: 2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a')
    ).toBeVisible();

    // Individual section audio remains accessible in the artifacts table with an honest non-complete caption
    const artifactsTable = detailRegion.getByRole('table', {
      name: 'Tabela de artefatos da produção',
    });
    const section1Row = artifactsTable.locator('tr', {
      hasText: 'canais/demo/videos/fixture/section-1.wav',
    });
    await section1Row.getByRole('button', { name: 'Ouvir áudio', exact: true }).click();
    expect(requestedAudioArtifactIds).toEqual([PILOT_AUDIO_ID, PILOT_SECTION_1_AUDIO_ID]);
    const section1Player = detailRegion.getByLabel(
      'Player de áudio canais/demo/videos/fixture/section-1.wav'
    );
    await expect(section1Player).toBeVisible();
    const section1BlobUrl = await section1Player.getAttribute('src');
    expect(section1BlobUrl).toMatch(/^blob:/);
    await expect(
      detailRegion.getByText(
        'Faixa de áudio individual ou auxiliar — completude de narração não inferida fora do narration.sha256 de pilot-evidence.json (não é voz humana nem clone de voz).'
      )
    ).toBeVisible();

    await quickReviewBar
      .getByRole('button', {
        name: 'Proveniência / qualidade (pilot-evidence.json)',
        exact: true,
      })
      .click();

    const metadataSummaryRegion = detailRegion.getByRole('region', {
      name: 'Resumo de metadados do artefato',
    });
    await expect(metadataSummaryRegion).toBeVisible();
    await expect(metadataSummaryRegion).toContainText('local_tts (windows_sapi)');
    await expect(metadataSummaryRegion).toContainText('measured_sections · 3 segmento(s)');
    await expect(metadataSummaryRegion).toContainText('2 pass, 0 fail, 4 not_checked · publishable: false');

    const revokedAfterSwitchToJson = await page.evaluate(
      () => (window as unknown as { __revokedBlobUrls: string[] }).__revokedBlobUrls
    );
    expect(revokedAfterSwitchToJson).toContain(audioBlobUrl);
    expect(revokedAfterSwitchToJson).toContain(section1BlobUrl);

    const evidencePreviewCard = detailRegion.getByRole('region', {
      name: 'Prévia do artefato pilot-evidence.json',
    });
    await evidencePreviewCard.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(artifactDir, 'production-pilot-evidence-preview-dark.png'),
    });

    // 5. Reject production in Final Human Review bound to VIDEO_SHA256
    const reviewRegion = detailRegion.getByRole('region', {
      name: 'Revisão humana final da produção',
    });
    await expect(reviewRegion).toBeVisible();
    await expect(reviewRegion).toContainText(
      'TTS local sintético (não é voz humana nem clone)'
    );
    await expect(reviewRegion).toContainText(
      'não implica licença ou publicabilidade'
    );

    await reviewRegion.getByRole('button', { name: 'Rejeitar produção', exact: true }).click();

    const recordedReview = detailRegion.getByRole('region', {
      name: 'Decisão de revisão final registrada',
    });
    await expect(recordedReview).toBeVisible();
    await expect(recordedReview.getByText('Rejeitado na revisão final')).toBeVisible();
    await expect(recordedReview.getByText(VIDEO_SHA256)).toBeVisible();
    await expect(recordedReview).toContainText(
      'Decisão vinculada ao hash não implica licença/publicabilidade, não realiza upload/publicação e não forja marcador da fábrica'
    );

    // Verify zero external requests were made
    expect(externalRequests).toEqual([]);

    // Switch to Light theme at 1040x680 and capture screenshot
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'CLARO', exact: true }).click();
    await page.setViewportSize({ width: 1040, height: 680 });
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    await expect(recordedReview).toBeVisible();
    await recordedReview.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true
    );
    await page.screenshot({
      path: path.join(artifactDir, 'production-pilot-rejected-light-1040.png'),
    });
  });
});
