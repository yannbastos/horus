import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const SESSION_TOKEN = 'test-session-token-hor-088-089-097';
const WORKFLOW_ID = '11111111222233334444555566667777';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_V2_ID = '99999999888877776666555544443332';
const SCRIPT_V2_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const PROD_REVIEW_ID = 'f1f2f3f4a1a2a3a4b1b2b3b4c1c2c3c4';
const JOB_REVIEW_ID = 'job_review_hor088_01';
const VIDEO_ARTIFACT_ID = '00001111222233334444555566667777';
const VIDEO_SHA256 = '30ab612eba3e7345e9b3cae3620b672aed985aa4199473fa8416d7a79647c0b2';
const NARRATION_SHA256 = '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a';
const PILOT_EVIDENCE_ID = 'e1e2e3e4f1f2f3f4a1a2a3a4b1b2b3b4';
const WORD_TIMINGS_ID = 'w1w2w3w4a1a2a3a4b1b2b3b4c1c2c3c4';

async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill(SESSION_TOKEN);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

function createWorkflowFixture() {
  return {
    id: WORKFLOW_ID,
    status: 'approved',
    revision: 1,
    executor: 'hermes_simulated',
    simulated: true,
    request: {
      objective: 'Validar revisão por timecode, relatório QC e licenças.',
    },
    current_artifact_id: PROPOSAL_ARTIFACT_ID,
    pending_authorization: null,
    steps: [
      {
        id: 'job_step_1',
        workflow_id: WORKFLOW_ID,
        workflow_revision: 1,
        step_key: 'proposal',
        step_index: 0,
        status: 'succeeded',
        attempt: 1,
        created_at: '2026-11-13T10:00:00Z',
        updated_at: '2026-11-13T10:00:04Z',
        depends_on: null,
        error: null,
        result: null,
      },
    ],
    artifacts: [
      {
        id: PROPOSAL_ARTIFACT_ID,
        workflow_id: WORKFLOW_ID,
        revision: 1,
        stage: 'proposal',
        job_id: 'job_step_1',
        attempt_id: 'att_prop_1',
        schema_version: 2,
        content: {
          schema_version: 2,
          simulated: true,
          stage: 'proposal',
          title: 'Revisão Audiovisual por Timecode e QC',
          result_status: 'complete',
          recommendation: {
            title_options: ['Revisão Audiovisual por Timecode e QC'],
            premise: 'Validar contratos 1 a 5 na interface.',
            angle: 'Transparência de medição e proveniência.',
            format: 'short',
            originality: 'Dados locais.',
            differs_from: [],
            risks: [],
            licensing_notes: 'Somente demonstração (publishable: false).',
          },
          evidence: { sources: 1, facts: 1, hypotheses: 0 },
          requires_human_review: true,
        },
        content_hash: PROPOSAL_HASH,
        created_at: '2026-11-13T10:00:04Z',
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
        created_at: '2026-11-13T10:05:00Z',
      },
    ],
    cognitive_runs: [],
    authorizations: [],
    created_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:05:00Z',
  };
}

function createScriptRecordFixture() {
  return {
    id: SCRIPT_V2_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
    proposal_content_hash: PROPOSAL_HASH,
    version: 2,
    status: 'approved',
    document: {
      schema_version: 1 as const,
      simulated: true as const,
      title: 'Roteiro Editorial v2: Jardim Aurora',
      sections: [
        {
          id: 'hook',
          kind: 'hook' as const,
          heading: 'Gancho inicial',
          narration: 'Jardim Aurora abre hoje.',
          source_ids: ['video_01'],
        },
        {
          id: 'body',
          kind: 'body' as const,
          heading: 'Desenvolvimento',
          narration: 'As reservas seguem ativas.',
          source_ids: ['video_01'],
        },
        {
          id: 'conclusion',
          kind: 'conclusion' as const,
          heading: 'Conclusão',
          narration: 'Revise cada trecho final.',
          source_ids: [],
        },
      ],
    },
    created_at: '2026-11-13T10:20:00Z',
    review: {
      decision: 'approve' as const,
      feedback: 'Aprovado para piloto.',
      reviewed_at: '2026-11-13T10:25:00Z',
    },
  };
}

const mockPilotEvidence = {
  schema_version: 1,
  demo_only: true,
  alignment_method: 'measured_sections',
  narration: {
    kind: 'local_tts',
    engine: 'windows_sapi',
    voice: 'Microsoft Maria Desktop - Portuguese(Brazil)',
    duration_seconds: 16.0,
    sha256: NARRATION_SHA256,
  },
  scenes: [
    { id: 'hook', start: 0.0, end: 5.2, asset_id: 'scene-1' },
    { id: 'body', start: 5.2, end: 10.8, asset_id: 'scene-2' },
    { id: 'conclusion', start: 10.8, end: 16.0, asset_id: 'scene-3' },
  ],
  subtitles: [
    { start: 0.0, end: 5.2, text: 'Jardim Aurora abre hoje.' },
    { start: 5.2, end: 10.8, text: 'As reservas seguem ativas.' },
    { start: 10.8, end: 16.0, text: 'Revise cada trecho final.' },
  ],
  assets: [
    {
      id: 'scene-1',
      relative_path: 'canais/demo/videos/fixture/scene-1.png',
      sha256: 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58',
      origin: 'original_local',
      license: 'original',
      attribution: 'Cena original local.',
      generated_at: '2026-11-13T13:04:49Z',
    },
    {
      id: 'narration',
      relative_path: 'canais/demo/videos/fixture/fixture.wav',
      sha256: NARRATION_SHA256,
      origin: 'system_voice',
      license: 'unverified',
      attribution: 'Microsoft Maria Desktop - Portuguese(Brazil); licença não verificada.',
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

const mockValidWordTimings = {
  schema_version: 1,
  narration_sha256: NARRATION_SHA256,
  duration_seconds: 16.0,
  source: 'tts_engine_events',
  engine: {
    name: 'windows_sapi',
    voice: 'Microsoft Maria Desktop - Portuguese(Brazil)',
  },
  words: [
    { index: 0, text: 'Jardim', section: 1, start: 0.0, end: 1.1, char_offset: 0, char_length: 6 },
    { index: 1, text: 'Aurora', section: 1, start: 1.1, end: 2.3, char_offset: 7, char_length: 6 },
    { index: 2, text: 'abre', section: 1, start: 2.3, end: 3.4, char_offset: 14, char_length: 4 },
    { index: 3, text: 'hoje.', section: 1, start: 3.4, end: 5.0, char_offset: 19, char_length: 5 },
    { index: 4, text: 'As', section: 2, start: 5.2, end: 5.8, char_offset: 25, char_length: 2 },
    { index: 5, text: 'reservas', section: 2, start: 5.8, end: 7.4, char_offset: 28, char_length: 8 },
    { index: 6, text: 'seguem', section: 2, start: 7.4, end: 9.0, char_offset: 37, char_length: 6 },
    { index: 7, text: 'ativas.', section: 2, start: 9.0, end: 10.6, char_offset: 44, char_length: 7 },
    { index: 8, text: 'Revise', section: 3, start: 10.8, end: 12.1, char_offset: 52, char_length: 6 },
    { index: 9, text: 'cada', section: 3, start: 12.1, end: 13.2, char_offset: 59, char_length: 4 },
    { index: 10, text: 'trecho', section: 3, start: 13.2, end: 14.5, char_offset: 64, char_length: 6 },
    { index: 11, text: 'final.', section: 3, start: 14.5, end: 15.9, char_offset: 71, char_length: 6 },
  ],
};

function createSyntheticMediaBuffer(): Buffer {
  const wav = Buffer.alloc(44 + 1600);
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
  wav.writeUInt32LE(1600, 40);
  return wav;
}

test.describe('Revisão audiovisual por timecode, QC (Contrato 2) e Licenças (Contrato 3) — HOR-088 / HOR-089 / HOR-097', () => {
  test('Ausência de quality_report exibe "QC não executado" (nunca aprovado), word-timings ausente mantém speech_aligned=false e Pexels/Pixabay não aparecem quando ausentes nos dados', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture();

    const prodRecord = {
      id: PROD_REVIEW_ID,
      script_id: SCRIPT_V2_ID,
      script_version: 2,
      script_content_hash: SCRIPT_V2_HASH,
      job_id: JOB_REVIEW_ID,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      error: null,
      created_at: '2026-11-13T11:00:00Z',
      updated_at: '2026-11-13T11:00:10Z',
      artifacts: [
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
      alignment_method: 'measured_sections',
      publishable: false,
      quality_report: null,
      asset_provenance: null,
      quality_acknowledgement_required: true,
    };

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
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [prodRecord] } });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodRecord });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_REVIEW_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
        });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const detailRegion = page.getByRole('region', { name: `Detalhes da produção ${PROD_REVIEW_ID}` });
    await expect(detailRegion).toBeVisible();

    // 1. Painel de qualidade com quality_report=null -> "QC não executado", nunca aprovado
    const qcPanel = detailRegion.getByRole('region', { name: 'Painel de qualidade (QC)' });
    await expect(qcPanel).toBeVisible();
    await expect(qcPanel.getByText('QC NÃO EXECUTADO').first()).toBeVisible();
    await expect(
      qcPanel.getByText(/nenhum relatório de qualidade \(quality-report\.json\) foi registrado/i)
    ).toBeVisible();
    await expect(qcPanel.getByText(/QC técnico aprovado/i)).toHaveCount(0);

    // 2. Painel de licenças com asset_provenance=null -> aviso explícito e sem Pexels/Pixabay
    const licensePanel = detailRegion.getByRole('region', { name: 'Painel de licenças e proveniência' });
    await expect(licensePanel).toBeVisible();
    await expect(licensePanel.getByText('LICENÇA NÃO VERIFICADA / UNKNOWN')).toBeVisible();
    await expect(licensePanel.getByText(/commercial_use: unknown/i).first()).toBeVisible();
    await expect(licensePanel.getByText(/Pexels/i)).toHaveCount(0);
    await expect(licensePanel.getByText(/Pixabay/i)).toHaveCount(0);

    // 3. Timecode workspace sem word-timings.json -> speech_aligned: false
    const timecodeWorkspace = detailRegion.getByRole('region', {
      name: 'Revisão e navegação por timecode',
    });
    await expect(timecodeWorkspace).toBeVisible();
    await expect(timecodeWorkspace.getByText('speech_aligned: false').first()).toBeVisible();
    await expect(
      timecodeWorkspace
        .getByRole('region', { name: 'Navegação por palavras' })
        .getByText(/word-timings\.json ausente/i)
        .first()
    ).toBeVisible();
  });

  test('Painel de qualidade (Contrato 2), navegação por timecode (cenas, legendas, palavras e QC), edição de notas e aprovação por hash com confirmação adicional (Contrato 4)', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture();
    let submittedReviewBody: Record<string, unknown> | null = null;

    const qualityReportContract2 = {
      schema_version: 1,
      production_id: PROD_REVIEW_ID,
      video_sha256: VIDEO_SHA256,
      generated_at: '2026-11-13T11:10:00Z',
      tool: { name: 'horus_pilot_qc', version: '1.2.0' },
      status: 'fail',
      checks: [
        {
          id: 'container_integrity',
          category: 'integrity',
          status: 'pass',
          method: 'measured',
          measured: { source: 'ffprobe', frames: 504, codec: 'h264' },
          threshold: { min_frames: 300 },
          detail: 'Contêiner MP4 íntegro e decodificado.',
        },
        {
          id: 'duration_tail',
          category: 'duration',
          status: 'pass',
          method: 'measured',
          measured: { source: 'ffprobe', video_s: 16.8, audio_s: 16.0, tail_s: 0.8 },
          threshold: { expected_tail_s: 0.8, tolerance_s: 0.15 },
          detail: 'Cauda final dentro da tolerância.',
        },
        {
          id: 'audio_clipping',
          category: 'audio',
          status: 'fail',
          method: 'measured',
          measured: { source: 'ffmpeg_astats', peak: 0.999, clipping_pct: 0.35 },
          threshold: { max_clipping_pct: 0.1 },
          detail: 'Clipping acima de 0,1% no trecho final.',
          timecode: { start: 12.4, end: 14.1 },
        },
        {
          id: 'subtitle_safe_area',
          category: 'visual',
          status: 'warn',
          method: 'estimated',
          measured: { margin_px: 18 },
          threshold: { min_margin_px: 24 },
          detail: 'Estimativa heurística de margem inferior próxima da legenda.',
          timecode: { start: 7.5, end: 9.2 },
        },
        {
          id: 'provenance_declaration',
          category: 'provenance',
          status: 'warn',
          method: 'declared',
          measured: { unverified_assets: 1 },
          threshold: { max_unverified_for_publish: 0 },
          detail: 'Voz do sistema declarada como unverified.',
        },
      ],
      blocking_errors: ['audio_clipping'],
      warnings: ['subtitle_safe_area', 'provenance_declaration'],
    };

    const assetProvenanceContract3 = {
      schema_version: 1,
      assets: [
        {
          asset_id: 'scene-1',
          relative_path: 'canais/demo/videos/fixture/scene-1.png',
          sha256: 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58',
          kind: 'image',
          origin: 'original_local',
          source_url: null,
          author: 'Operador Local HORUS',
          license: {
            id: 'horus-original-local',
            name: 'Original Local Demo',
            url: null,
            commercial_use: 'allowed',
            attribution_required: false,
            verified_by: 'human',
            verified_at: '2026-11-13T11:05:00Z',
          },
          status: 'verified',
          notes: 'PNG gerado localmente sem insumos de terceiros.',
        },
        {
          asset_id: 'narration-sapi',
          relative_path: 'canais/demo/videos/fixture/fixture.wav',
          sha256: NARRATION_SHA256,
          kind: 'voice',
          origin: 'system_voice',
          source_url: null,
          author: 'Microsoft Windows SAPI',
          license: {
            id: null,
            name: 'Windows Desktop Voice EULA',
            url: null,
            commercial_use: 'unknown',
            attribution_required: null,
            verified_by: null,
            verified_at: null,
          },
          status: 'unverified',
          notes: 'Presença da voz no Windows não atesta licença comercial.',
        },
      ],
    };

    let prodState: Record<string, unknown> = {
      id: PROD_REVIEW_ID,
      script_id: SCRIPT_V2_ID,
      script_version: 2,
      script_content_hash: SCRIPT_V2_HASH,
      job_id: JOB_REVIEW_ID,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      error: null,
      created_at: '2026-11-13T11:00:00Z',
      updated_at: '2026-11-13T11:10:00Z',
      artifacts: [
        {
          id: PILOT_EVIDENCE_ID,
          kind: 'manifest' as const,
          relative_path: 'pilot-evidence.json',
          size_bytes: 640,
          sha256: 'f0f01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
        {
          id: WORD_TIMINGS_ID,
          kind: 'manifest' as const,
          relative_path: 'word-timings.json',
          size_bytes: 820,
          sha256: 'a0a01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
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
      speech_aligned: true,
      narration_kind: 'local_tts',
      alignment_method: 'measured_sections',
      publishable: false,
      quality_report: qualityReportContract2,
      asset_provenance: assetProvenanceContract3,
      quality_acknowledgement_required: true,
    };

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
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [prodState] } });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_REVIEW_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/artifacts/${PILOT_EVIDENCE_ID}`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(mockPilotEvidence),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/artifacts/${WORD_TIMINGS_ID}`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(mockValidWordTimings),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/artifacts/${VIDEO_ARTIFACT_ID}`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'video/mp4' },
          body: createSyntheticMediaBuffer(),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/review` && request.method() === 'POST') {
        submittedReviewBody = request.postDataJSON() as Record<string, unknown>;
        prodState = {
          ...prodState,
          review: {
            decision: submittedReviewBody.decision,
            artifact_sha256: submittedReviewBody.artifact_sha256,
            reviewed_at: '2026-11-13T11:25:00Z',
            notes: submittedReviewBody.notes,
            acknowledge_quality_errors: submittedReviewBody.acknowledge_quality_errors,
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const detailRegion = page.getByRole('region', { name: `Detalhes da produção ${PROD_REVIEW_ID}` });
    await expect(detailRegion).toBeVisible();

    // 1. Painel de qualidade (Contrato 2): status, tool, method (measured/declared/estimated), measured x threshold, blocking_errors e warnings clicáveis
    const qcPanel = detailRegion.getByRole('region', { name: 'Painel de qualidade (QC)' });
    await expect(qcPanel).toBeVisible();
    await expect(qcPanel.getByText('QC REPROVADO (FAIL)', { exact: true })).toBeVisible();
    await expect(qcPanel.getByText('horus_pilot_qc v1.2.0')).toBeVisible();

    const qcTable = qcPanel.getByRole('table', { name: 'Tabela de checks de qualidade' });
    await expect(qcTable).toBeVisible();
    await expect(qcTable.getByText('Medido (measured · source: ffprobe)').first()).toBeVisible();
    await expect(qcTable.getByText('Medido (measured · source: ffmpeg_astats)')).toBeVisible();
    await expect(qcTable.getByText('Declarado (declared)')).toBeVisible();
    await expect(qcTable.getByText('Estimado (estimated — não é medição real)')).toBeVisible();
    await expect(qcTable.getByText('Estimado (heurística): margin_px: 18')).toBeVisible();
    await expect(qcTable.getByText('source: ffmpeg_astats · peak: 0.999 · clipping_pct: 0.35')).toBeVisible();
    await expect(qcTable.getByText('max_clipping_pct: 0.1')).toBeVisible();

    // Clicar no erro bloqueante destacado com timecode -> posiciona no tempo 12.40s e abre prévia do vídeo
    const blockingSection = qcPanel.getByRole('region', { name: 'Erros bloqueantes do QC' });
    await expect(blockingSection).toBeVisible();
    await blockingSection
      .getByRole('button', { name: 'Ir para timecode do erro audio_clipping (00:12.400)' })
      .click();

    const timecodeWorkspace = detailRegion.getByRole('region', {
      name: 'Revisão e navegação por timecode',
    });
    const currentTcBadge = timecodeWorkspace.getByLabel('Timecode selecionado atual');
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:12.400 (12.40s)');

    // Vídeo foi aberto automaticamente ao clicar no timecode
    await expect(
      detailRegion.getByLabel('Player de vídeo canais/demo/videos/fixture/render/short-rascunho.mp4')
    ).toBeVisible();

    // Clicar no aviso destacado com timecode -> posiciona em 07.50s
    const warningsSection = qcPanel.getByRole('region', { name: 'Avisos do QC' });
    await warningsSection
      .getByRole('button', { name: 'Ir para timecode do aviso subtitle_safe_area (00:07.500)' })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:07.500 (7.50s)');

    // 2. Navegação por cenas, legendas e palavras (word-timings.json válido -> speech_aligned: true)
    await expect(timecodeWorkspace.getByText('speech_aligned: true').first()).toBeVisible();
    await expect(
      timecodeWorkspace.getByText('FONTE: Eventos do motor TTS (tts_engine_events — medido na síntese)')
    ).toBeVisible();

    // Navegar para Cena 2 (body) -> 05.20s
    await timecodeWorkspace
      .getByRole('region', { name: 'Navegação por cenas' })
      .getByRole('button', { name: /Cena 2 \(body\)/ })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:05.200 (5.20s)');

    // Navegar para Palavra "reservas" -> 05.80s
    await timecodeWorkspace
      .getByRole('region', { name: 'Navegação por palavras' })
      .getByRole('button', { name: 'Palavra 5: reservas (00:05.800)' })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:05.800 (5.80s)');

    // Marcar nota 1 neste tempo (5.8s)
    const noteTimeInput = timecodeWorkspace.getByLabel('Timecode da nova nota (s)');
    await expect(noteTimeInput).toHaveValue('5.8');
    await timecodeWorkspace
      .getByLabel('Texto da nova nota por timecode')
      .fill('Ajustar ênfase na palavra reservas.');
    await timecodeWorkspace.getByRole('button', { name: 'Adicionar nota no timecode', exact: true }).click();

    // Navegar para Legenda #3 -> 10.80s e marcar nota 2
    await timecodeWorkspace
      .getByRole('region', { name: 'Navegação por legendas' })
      .getByRole('button', { name: 'Ir para legenda #3 em 00:10.800' })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:10.800 (10.80s)');
    await timecodeWorkspace
      .getByLabel('Texto da nova nota por timecode')
      .fill('Nota temporária que será removida.');
    await timecodeWorkspace.getByRole('button', { name: 'Adicionar nota no timecode', exact: true }).click();

    // Navegar pelo problema do QC no workspace -> 12.40s e marcar nota 3
    await timecodeWorkspace
      .getByRole('region', { name: 'Problemas do QC com timecode' })
      .getByRole('button', { name: 'Ir para problema QC audio_clipping em 00:12.400' })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:12.400 (12.40s)');
    await timecodeWorkspace
      .getByLabel('Texto da nova nota por timecode')
      .fill('Reduzir ganho para eliminar clipping.');
    await timecodeWorkspace.getByRole('button', { name: 'Adicionar nota no timecode', exact: true }).click();

    // Editar nota 1 e remover nota 2 na lista editável antes do envio
    const notesList = timecodeWorkspace.getByRole('region', { name: 'Lista de notas por timecode' });
    await expect(notesList.getByText('LISTA DE NOTAS EDITÁVEL ANTES DO ENVIO (3)')).toBeVisible();

    await notesList.getByLabel('Remover nota 2').click();
    await expect(notesList.getByText('LISTA DE NOTAS EDITÁVEL ANTES DO ENVIO (2)')).toBeVisible();

    await notesList.getByLabel('Timecode da nota 1').fill('5.85');
    await notesList
      .getByLabel('Texto da nota 1')
      .fill('Ajustar ênfase na palavra reservas (revisado).');

    // 3. Aprovação com QC fail e licença não verificada exige confirmação explícita; Rejeitar continua sempre disponível
    const reviewRegion = detailRegion.getByRole('region', {
      name: 'Revisão humana final da produção',
    });
    await expect(reviewRegion).toBeVisible();
    await expect(
      reviewRegion.getByRole('note', { name: 'Aviso explícito para aprovação com ressalvas' })
    ).toContainText('Relatório de qualidade reprovado (status: fail)');
    await expect(
      reviewRegion.getByRole('note', { name: 'Aviso explícito para aprovação com ressalvas' })
    ).toContainText('Licença ou proveniência não verificada');

    const approveBtn = reviewRegion.getByRole('button', {
      name: 'Aprovar produção (hash verificado)',
      exact: true,
    });
    const rejectBtn = reviewRegion.getByRole('button', {
      name: 'Rejeitar produção',
      exact: true,
    });
    await expect(approveBtn).toBeDisabled();
    await expect(rejectBtn).toBeEnabled();

    await reviewRegion
      .getByLabel(
        'Confirmo ciência das pendências de QC e/ou licenças não verificadas (publishable: false)'
      )
      .check();
    await expect(approveBtn).toBeEnabled();

    await approveBtn.click();

    expect(submittedReviewBody).toEqual({
      decision: 'approve',
      artifact_sha256: VIDEO_SHA256,
      acknowledge_quality_errors: true,
      notes: [
        { at_seconds: 5.85, text: 'Ajustar ênfase na palavra reservas (revisado).' },
        { at_seconds: 12.4, text: 'Reduzir ganho para eliminar clipping.' },
      ],
    });

    // 4. Exibição das notas da revisão registrada, acknowledge_quality_errors e manutenção de publishable=false
    const recordedReview = detailRegion.getByRole('region', {
      name: 'Decisão de revisão final registrada',
    });
    await expect(recordedReview).toBeVisible();
    await expect(recordedReview.getByText('Aprovado na revisão final')).toBeVisible();
    await expect(recordedReview.getByText('publishable: false')).toBeVisible();
    await expect(
      recordedReview.getByText(/acknowledge_quality_errors: true/i)
    ).toBeVisible();

    const recordedNotes = recordedReview.getByRole('region', {
      name: 'Notas registradas na revisão',
    });
    await expect(recordedNotes).toContainText('NOTAS DE REVISÃO POR TIMECODE REGISTRADAS (2)');
    await expect(
      recordedNotes.getByText('Ajustar ênfase na palavra reservas (revisado).')
    ).toBeVisible();
    await expect(recordedNotes.getByText('Reduzir ganho para eliminar clipping.')).toBeVisible();

    await recordedNotes
      .getByRole('button', { name: 'Ir para nota registrada 1 em 00:05.850' })
      .click();
    await expect(currentTcBadge).toContainText('TIMECODE ATUAL: 00:05.850 (5.85s)');
  });

  test('word-timings estimado força speech_aligned=false, stock Pexels/Pixabay exibe avisos de validação sem chamadas externas e Rejeitar funciona sem confirmação adicional', async ({
    page,
  }) => {
    const currentWf = createWorkflowFixture();
    const scriptV2 = createScriptRecordFixture();
    const externalRequests: string[] = [];
    let submittedReviewBody: Record<string, unknown> | null = null;

    const estimatedWordTimings = {
      ...mockValidWordTimings,
      source: 'estimated',
    };

    const stockAssetProvenance = {
      schema_version: 1,
      assets: [
        {
          asset_id: 'bg-pexels-01',
          relative_path: 'canais/demo/videos/fixture/pexels-bg.png',
          sha256: '1111222233334444555566667777888899990000aaaabbbbccccddddeeee0001',
          kind: 'image',
          origin: 'stock_pexels',
          source_url: 'https://www.pexels.com/photo/example-12345/',
          author: null,
          license: {
            id: 'pexels-license',
            name: 'Pexels License',
            url: 'https://www.pexels.com/license/',
            commercial_use: 'unknown',
            attribution_required: true,
            verified_by: null,
            verified_at: null,
          },
          status: 'unverified',
          notes: 'Asset de stock pendente de revisão humana e autor.',
        },
        {
          asset_id: 'sfx-pixabay-02',
          relative_path: 'canais/demo/videos/fixture/pixabay-sfx.wav',
          sha256: '1111222233334444555566667777888899990000aaaabbbbccccddddeeee0002',
          kind: 'music',
          origin: 'stock_pixabay',
          source_url: 'https://pixabay.com/music/example-67890/',
          author: 'Autor Exemplo',
          license: {
            id: 'pixabay-content',
            name: 'Pixabay Content License',
            url: 'https://pixabay.com/service/license-summary/',
            commercial_use: 'restricted',
            attribution_required: false,
            verified_by: 'human',
            verified_at: '2026-11-13T11:15:00Z',
          },
          status: 'rejected',
          notes: 'Uso comercial restrito.',
        },
      ],
    };

    let prodState: Record<string, unknown> = {
      id: PROD_REVIEW_ID,
      script_id: SCRIPT_V2_ID,
      script_version: 2,
      script_content_hash: SCRIPT_V2_HASH,
      job_id: JOB_REVIEW_ID,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      error: null,
      created_at: '2026-11-13T11:00:00Z',
      updated_at: '2026-11-13T11:15:00Z',
      artifacts: [
        {
          id: WORD_TIMINGS_ID,
          kind: 'manifest' as const,
          relative_path: 'word-timings.json',
          size_bytes: 820,
          sha256: 'a0a01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
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
      alignment_method: 'measured_sections',
      publishable: false,
      quality_report: {
        schema_version: 1,
        production_id: PROD_REVIEW_ID,
        video_sha256: VIDEO_SHA256,
        generated_at: '2026-11-13T11:15:00Z',
        tool: { name: 'horus_pilot_qc', version: '1.2.0' },
        status: 'fail',
        checks: [
          {
            id: 'provenance_check',
            category: 'provenance',
            status: 'fail',
            method: 'declared',
            measured: { rejected_assets: 1, unverified_assets: 1 },
            threshold: { max_rejected: 0 },
            detail: 'Asset stock rejeitado e asset sem autor/verificação humana.',
          },
        ],
        blocking_errors: ['provenance_check'],
        warnings: [],
      },
      asset_provenance: stockAssetProvenance,
    };

    page.on('request', req => {
      const url = req.url();
      if (
        !url.startsWith('http://127.0.0.1:') &&
        !url.startsWith('blob:') &&
        !url.startsWith('data:')
      ) {
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
      if (pathUrl === `/v1/workflows/${WORKFLOW_ID}/scripts`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [scriptV2] } });
        return;
      }
      if (pathUrl === `/v1/scripts/${SCRIPT_V2_ID}/productions`) {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [prodState] } });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}` && request.method() === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      if (pathUrl === `/v1/jobs/${JOB_REVIEW_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/artifacts/${WORD_TIMINGS_ID}`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(estimatedWordTimings),
        });
        return;
      }
      if (pathUrl === `/v1/productions/${PROD_REVIEW_ID}/review` && request.method() === 'POST') {
        submittedReviewBody = request.postDataJSON() as Record<string, unknown>;
        prodState = {
          ...prodState,
          review: {
            decision: submittedReviewBody.decision,
            artifact_sha256: submittedReviewBody.artifact_sha256,
            reviewed_at: '2026-11-13T11:30:00Z',
            notes: submittedReviewBody.notes,
          },
        };
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodState });
        return;
      }
      await route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
    });

    await connectSession(page);
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const detailRegion = page.getByRole('region', { name: `Detalhes da produção ${PROD_REVIEW_ID}` });
    await expect(detailRegion).toBeVisible();

    // 1. word-timings com source='estimated' -> speech_aligned: false e aviso explícito de heurística
    const timecodeWorkspace = detailRegion.getByRole('region', {
      name: 'Revisão e navegação por timecode',
    });
    await expect(timecodeWorkspace.getByText('speech_aligned: false').first()).toBeVisible();
    await expect(
      timecodeWorkspace.getByText('FONTE: Estimado / heurístico (estimated — NÃO é medição real)')
    ).toBeVisible();
    await expect(
      timecodeWorkspace.getByText(/source=estimated \(heurística nunca habilita speech_aligned=true\)/)
    ).toBeVisible();

    // 2. Painel de licenças exibe stock_pexels e stock_pixabay pois vieram nos dados, com validação de campos faltantes
    const licensePanel = detailRegion.getByRole('region', { name: 'Painel de licenças e proveniência' });
    await expect(licensePanel.getByText('LICENÇA REJEITADA (REJECTED)')).toBeVisible();
    await expect(licensePanel.getByText('Stock Pexels (stock_pexels)')).toBeVisible();
    await expect(licensePanel.getByText('Stock Pixabay (stock_pixabay)')).toBeVisible();
    await expect(
      licensePanel.getByText(/Regra de stock \(stock_pexels\) incompleta: exige author, verificação humana/)
    ).toBeVisible();
    await expect(
      licensePanel.getByText('Desconhecido (unknown — nunca equivale a permitido)')
    ).toBeVisible();
    await expect(
      licensePanel.getByText('Restrito / Não comercial (restricted)')
    ).toBeVisible();

    // 3. Adicionar nota e rejeitar diretamente sem marcar confirmação de aprovação
    await timecodeWorkspace.getByLabel('Timecode da nova nota (s)').fill('2.5');
    await timecodeWorkspace
      .getByLabel('Texto da nova nota por timecode')
      .fill('Substituir assets stock sem verificação humana.');
    await timecodeWorkspace.getByRole('button', { name: 'Adicionar nota no timecode', exact: true }).click();

    const reviewRegion = detailRegion.getByRole('region', {
      name: 'Revisão humana final da produção',
    });
    await expect(
      reviewRegion.getByRole('button', { name: 'Aprovar produção (hash verificado)', exact: true })
    ).toBeDisabled();
    const rejectBtn = reviewRegion.getByRole('button', { name: 'Rejeitar produção', exact: true });
    await expect(rejectBtn).toBeEnabled();
    await rejectBtn.click();

    expect(submittedReviewBody).toEqual({
      decision: 'reject',
      artifact_sha256: VIDEO_SHA256,
      notes: [{ at_seconds: 2.5, text: 'Substituir assets stock sem verificação humana.' }],
    });

    // Verificar responsividade 1040x680 no tema claro e zero requisições externas
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('button', { name: 'CLARO', exact: true }).click();
    await page.setViewportSize({ width: 1040, height: 680 });
    await page.getByRole('button', { name: 'Produção', exact: true }).click();

    const recordedReview = detailRegion.getByRole('region', {
      name: 'Decisão de revisão final registrada',
    });
    await expect(recordedReview).toBeVisible();
    await expect(recordedReview.getByText('Rejeitado na revisão final')).toBeVisible();
    await expect(
      recordedReview.getByText('Substituir assets stock sem verificação humana.')
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true
    );
    expect(externalRequests).toEqual([]);
  });
});
