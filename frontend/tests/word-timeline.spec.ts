import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// HOR-054 (UI) / HOR-088: linha do tempo de palavras na revisão por timecode.
// TODOS os payloads abaixo são DADOS DE TESTE sintéticos que seguem
// contracts/media/word-timings.schema.json; não são medições reais de nenhuma narração.

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const SESSION_TOKEN = 'test-session-token-hor-088-timeline';
const WORKFLOW_ID = '11111111222233334444555566667777';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_V2_ID = '99999999888877776666555544443332';
const SCRIPT_V2_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const PROD_ID = 'f1f2f3f4a1a2a3a4b1b2b3b4c1c2c3c4';
const JOB_ID = 'job_review_hor088_tl';
const VIDEO_ARTIFACT_ID = '00001111222233334444555566667777';
const VIDEO_SHA256 = '30ab612eba3e7345e9b3cae3620b672aed985aa4199473fa8416d7a79647c0b2';
const NARRATION_SHA256 = '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a';
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

type Doc = Record<string, unknown>;

const TOKENS = ['Jardim', 'Aurora', 'abre', 'hoje.', 'As', 'reservas', 'seguem', 'ativas.', 'Revise', 'cada', 'trecho', 'final.'];
const SECTIONS = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
const STARTS = [0.0, 1.1, 2.3, 3.4, 5.2, 5.8, 7.4, 9.0, 10.8, 12.1, 13.2, 14.5];
const ENDS = [1.1, 2.3, 3.4, 5.0, 5.8, 7.4, 9.0, 10.6, 12.1, 13.2, 14.5, 15.9];

function buildWords(timings?: (string | null)[]) {
  let offset = 0;
  return TOKENS.map((text, i) => {
    const w: Doc = {
      index: i,
      text,
      section: SECTIONS[i],
      start: STARTS[i],
      end: ENDS[i],
      char_offset: offset,
      char_length: text.length,
    };
    offset += text.length + 1;
    if (timings) w.timing = timings[i];
    return w;
  });
}

const BASE_DOC = {
  schema_version: 1,
  narration_sha256: NARRATION_SHA256,
  duration_seconds: 16.0,
  engine: { name: 'windows_sapi', voice: 'Microsoft Maria Desktop - Portuguese(Brazil)' },
};

function measuredDoc(): Doc {
  return {
    ...BASE_DOC,
    source: 'forced_alignment',
    words: buildWords(TOKENS.map(() => 'measured')),
    alignment: {
      method: 'asr_sequence_match',
      asr_engine: 'faster-whisper-small (dado de teste)',
      matched_words: 12,
      interpolated_words: 0,
      match_rate: 1,
      longest_interpolated_seconds: 0,
    },
  };
}

function mixedDoc(): Doc {
  const timings = TOKENS.map((_, i) => (i === 5 ? 'interpolated' : 'measured'));
  return {
    ...BASE_DOC,
    source: 'forced_alignment',
    words: buildWords(timings),
    alignment: {
      method: 'asr_sequence_match',
      asr_engine: 'faster-whisper-small (dado de teste)',
      matched_words: 11,
      interpolated_words: 1,
      match_rate: 11 / 12,
      longest_interpolated_seconds: 1.6,
    },
  };
}

function inconsistentDoc(): Doc {
  // Bloco declara 12 casadas, mas uma palavra é interpolada: o cliente deve recomputar e rejeitar.
  const doc = mixedDoc();
  doc.alignment = {
    ...(doc.alignment as Doc),
    matched_words: 12,
    interpolated_words: 0,
    match_rate: 1,
    longest_interpolated_seconds: 0,
  };
  return doc;
}

function estimatedDoc(): Doc {
  return { ...BASE_DOC, source: 'estimated', words: buildWords() };
}

function legacyTtsDoc(): Doc {
  return { ...BASE_DOC, source: 'tts_engine_events', words: buildWords() };
}

function largeDoc(count: number): Doc {
  const words: Doc[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const text = `p${i}`;
    words.push({
      index: i,
      text,
      section: 1,
      start: Math.round(i * 0.2 * 1000) / 1000,
      end: Math.round((i * 0.2 + 0.2) * 1000) / 1000,
      char_offset: offset,
      char_length: text.length,
    });
    offset += text.length + 1;
  }
  return {
    ...BASE_DOC,
    duration_seconds: count * 0.2 + 1,
    source: 'tts_engine_events',
    words,
  };
}

const QC_SUBTITLES_VS_WORDS = {
  schema_version: 1,
  production_id: PROD_ID,
  video_sha256: VIDEO_SHA256,
  generated_at: '2026-11-13T11:10:00Z',
  tool: { name: 'horus_pilot_qc', version: '1.2.0' },
  status: 'warn',
  checks: [
    {
      id: 'subtitles_vs_words',
      category: 'sync',
      status: 'warn',
      method: 'measured',
      measured: { source: 'word_timings', max_deviation_s: 0.42, interpolated_cues: 1 },
      threshold: { max_deviation_s: 0.3 },
      detail: 'Desvio máximo 0.42s entre legenda e palavra medida (dado de teste).',
      timecode: { start: 5.8, end: 7.4 },
    },
  ],
  blocking_errors: [],
  warnings: [],
};

async function openProduction(page: Page, wordTimings: Doc | null, qualityReport: Doc | null = null) {
  const wf = createWorkflowFixture();
  const script = createScriptRecordFixture();
  const artifacts: Doc[] = [];
  if (wordTimings) {
    artifacts.push({
      id: WORD_TIMINGS_ID,
      kind: 'manifest',
      relative_path: 'word-timings.json',
      size_bytes: 820,
      sha256: 'a0a01111222233334444555566667777888899990000aaaabbbbccccddddeeee',
    });
  }
  artifacts.push({
    id: VIDEO_ARTIFACT_ID,
    kind: 'video',
    relative_path: 'canais/demo/videos/fixture/render/short-rascunho.mp4',
    size_bytes: 96902,
    sha256: VIDEO_SHA256,
  });
  const prod: Doc = {
    id: PROD_ID,
    script_id: SCRIPT_V2_ID,
    script_version: 2,
    script_content_hash: SCRIPT_V2_HASH,
    job_id: JOB_ID,
    mode: 'local_pilot',
    stage: 'review',
    status: 'succeeded',
    error: null,
    created_at: '2026-11-13T11:00:00Z',
    updated_at: '2026-11-13T11:10:00Z',
    artifacts,
    review: null,
    demo_only: true,
    real_voice: false,
    narration_kind: 'local_tts',
    alignment_method: 'measured_sections',
    publishable: false,
    quality_report: qualityReport,
  };
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const ok = (json: unknown) => route.fulfill({ status: 200, headers: corsHeaders, json });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (p === '/health') return ok({ status: 'ready' });
    if (p === '/v1/hermes')
      return ok({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    if (p === '/v1/jobs') return ok([]);
    if (p === '/v1/workflows') return ok([wf]);
    if (p === `/v1/workflows/${WORKFLOW_ID}`) return ok(wf);
    if (p === `/v1/workflows/${WORKFLOW_ID}/scripts`) return ok({ items: [script] });
    if (p === `/v1/scripts/${SCRIPT_V2_ID}/productions`) return ok({ items: [prod] });
    if (p === `/v1/productions/${PROD_ID}`) return ok(prod);
    if (p === `/v1/jobs/${JOB_ID}/events`)
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
        body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
      });
    if (p === `/v1/productions/${PROD_ID}/artifacts/${WORD_TIMINGS_ID}`)
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(wordTimings),
      });
    if (p === `/v1/productions/${PROD_ID}/artifacts/${VIDEO_ARTIFACT_ID}`)
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'video/mp4' },
        body: Buffer.alloc(64),
      });
    return route.fulfill({ status: 404, headers: corsHeaders, json: { detail: 'Não encontrado' } });
  });
  await connectSession(page);
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  const detail = page.getByRole('region', { name: `Detalhes da produção ${PROD_ID}` });
  await expect(detail).toBeVisible();
  return detail.getByRole('region', { name: 'Revisão e navegação por timecode' });
}

test.describe('Linha do tempo de palavras — HOR-054 (UI) / HOR-088 (dados de teste do contrato)', () => {
  test('forced_alignment 100% medido: resumo, destaque da palavra atual, clique posiciona e aria-live desligável', async ({ page }) => {
    const ws = await openProduction(page, measuredDoc());
    await expect(ws.getByText('FONTE: Alinhamento acústico forçado (forced_alignment — medido)')).toBeVisible();
    await expect(ws.getByText('speech_aligned: true').first()).toBeVisible();
    const summary = ws.getByRole('group', { name: 'Resumo do alinhamento por palavra' });
    await expect(summary).toContainText('TAXA DE CASAMENTO: 100.0% (12/12)');
    await expect(summary).toContainText('INTERPOLADAS: 0');
    await expect(summary).toContainText('MAIOR LACUNA INTERPOLADA: 0.00s');
    await expect(summary).toContainText('faster-whisper-small (dado de teste)');

    const track = ws.getByTestId('word-timeline-track');
    await expect(track.locator('button[data-word-timing="interpolated"]')).toHaveCount(0);
    await ws.getByRole('button', { name: 'Palavra 6: seguem (00:07.400)' }).click();
    await expect(ws.getByLabel('Timecode selecionado atual')).toContainText('00:07.400');
    await expect(track).toHaveAttribute('data-active-word', '6');
    await expect(ws.getByRole('button', { name: /Palavra 6: seguem/ })).toHaveAttribute('aria-current', 'true');
    await expect(ws.getByTestId('word-timeline-live')).toHaveText('Palavra atual: seguem');

    await ws.getByLabel('Anunciar palavra atual a leitores de tela').uncheck();
    await expect(ws.getByTestId('word-timeline-live')).toHaveAttribute('aria-live', 'off');
    await expect(ws.getByTestId('word-timeline-live')).toHaveText('');
  });

  test('forced_alignment misto: palavra interpolada marcada, legenda acessível e resumo recomputado', async ({ page }) => {
    const ws = await openProduction(page, mixedDoc());
    const summary = ws.getByRole('group', { name: 'Resumo do alinhamento por palavra' });
    await expect(summary).toContainText('TAXA DE CASAMENTO: 91.7% (11/12)');
    await expect(summary).toContainText('INTERPOLADAS: 1');
    await expect(summary).toContainText('MAIOR LACUNA INTERPOLADA: 1.60s');

    const interpolated = ws.getByRole('button', {
      name: 'Palavra 5: reservas (00:05.800) — tempo interpolado, não medido',
    });
    await expect(interpolated).toBeVisible();
    await expect(interpolated).toHaveAttribute('data-word-timing', 'interpolated');
    await expect(interpolated).toHaveText('~reservas');
    await expect(ws.getByTestId('word-timeline-legend')).toContainText('tempo interpolado, não medido');
    await expect(ws.getByRole('button', { name: 'Palavra 4: As (00:05.200)' })).toHaveAttribute('data-word-timing', 'measured');
    await interpolated.click();
    await expect(ws.getByTestId('word-timeline-track')).toHaveAttribute('data-active-word', '5');
  });

  test('bloco alignment inconsistente com as palavras é rejeitado (não confia no bloco declarado)', async ({ page }) => {
    const ws = await openProduction(page, inconsistentDoc());
    await expect(ws.getByText('speech_aligned: false').first()).toBeVisible();
    await expect(ws.getByText(/alignment_counts/)).toBeVisible();
    await expect(ws.getByText(/TAXA DE CASAMENTO/)).toHaveCount(0);
    await expect(ws.getByText('ALINHAMENTO INVÁLIDO — resumo não exibido')).toBeVisible();
  });

  test('forced_alignment sem bloco alignment viola o contrato', async ({ page }) => {
    const doc = measuredDoc();
    delete doc.alignment;
    const ws = await openProduction(page, doc);
    await expect(ws.getByText('speech_aligned: false').first()).toBeVisible();
    await expect(ws.getByText(/alignment_missing/)).toBeVisible();
  });

  test('timing em fonte que não é forced_alignment é proibido', async ({ page }) => {
    const doc = legacyTtsDoc();
    doc.words = buildWords(TOKENS.map(() => 'measured'));
    const ws = await openProduction(page, doc);
    await expect(ws.getByText('speech_aligned: false').first()).toBeVisible();
    await expect(ws.getByText(/timing_not_allowed/)).toBeVisible();
  });

  test('source=estimated é exibido como estimado em toda a faixa e nunca como alinhado', async ({ page }) => {
    const ws = await openProduction(page, estimatedDoc());
    await expect(ws.getByTestId('word-timeline-estimated')).toContainText('ESTIMADOS');
    await expect(ws.getByText('speech_aligned: false').first()).toBeVisible();
    const track = ws.getByTestId('word-timeline-track');
    await expect(track.locator('button')).toHaveCount(12);
    await expect(track.locator('button[data-word-timing="estimated"]')).toHaveCount(12);
    await expect(ws.getByRole('button', { name: /Palavra 0: Jardim .* tempo estimado, não medido/ })).toBeVisible();
  });

  test('tts_engine_events legado (sem timing/alignment) continua navegável', async ({ page }) => {
    const ws = await openProduction(page, legacyTtsDoc());
    await expect(ws.getByText('speech_aligned: true').first()).toBeVisible();
    await expect(ws.getByText('SEM BLOCO DE ALINHAMENTO ACÚSTICO (tempos do motor TTS)')).toBeVisible();
    await ws.getByRole('button', { name: 'Palavra 3: hoje. (00:03.400)' }).click();
    await expect(ws.getByTestId('word-timeline-track')).toHaveAttribute('data-active-word', '3');
  });

  test('word-timings.json ausente: sem faixa e speech_aligned=false', async ({ page }) => {
    const ws = await openProduction(page, null);
    await expect(ws.getByText(/word-timings\.json ausente/i).first()).toBeVisible();
    await expect(ws.getByTestId('word-timeline-track')).toHaveCount(0);
    await expect(ws.getByText('speech_aligned: false').first()).toBeVisible();
  });

  test('navegação por teclado entre palavras (roving tabindex) e Enter posiciona o vídeo', async ({ page }) => {
    const ws = await openProduction(page, measuredDoc());
    const first = ws.getByRole('button', { name: /^Palavra 0: Jardim/ });
    await first.focus();
    await expect(first).toHaveAttribute('tabindex', '0');
    await expect(ws.getByRole('button', { name: /^Palavra 1: Aurora/ })).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowRight');
    await expect(ws.getByRole('button', { name: /^Palavra 1: Aurora/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(ws.getByRole('button', { name: /^Palavra 11: final\./ })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(ws.getByLabel('Timecode selecionado atual')).toContainText('00:02.300');
  });

  test('QC subtitles_vs_words exibe o desvio junto da faixa e o timecode é clicável', async ({ page }) => {
    const ws = await openProduction(page, mixedDoc(), QC_SUBTITLES_VS_WORDS);
    const qc = ws.getByTestId('word-timeline-qc');
    await expect(qc).toContainText('subtitles_vs_words');
    await expect(qc).toContainText('0.42');
    await qc.getByRole('button', { name: /Ir para timecode do check subtitles_vs_words \(00:05.800\)/ }).click();
    await expect(ws.getByLabel('Timecode selecionado atual')).toContainText('00:05.800');
    await expect(ws.getByTestId('word-timeline-track')).toHaveAttribute('data-active-word', '5');
  });

  test('QC sem check subtitles_vs_words informa ausência (nunca aprovado implícito)', async ({ page }) => {
    const ws = await openProduction(page, mixedDoc());
    await expect(ws.getByTestId('word-timeline-qc')).toContainText('não registrado');
  });

  test('roteiro de 5000 palavras renderiza e o destaque responde sem travar', async ({ page }) => {
    const ws = await openProduction(page, largeDoc(5000));
    const track = ws.getByTestId('word-timeline-track');
    await expect(track.locator('button')).toHaveCount(5000);
    const t0 = Date.now();
    const target = ws.getByRole('button', { name: /^Palavra 4000: p4000 / });
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(track).toHaveAttribute('data-active-word', '4000', { timeout: 2000 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
