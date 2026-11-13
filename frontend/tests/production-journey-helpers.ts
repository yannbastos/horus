import config from '../playwright.config';
import { expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// Respostas no formato real da API (backend/src/horus_backend/production.py, narration/*.py,
// license_reviews.py). Nenhuma chamada sai da máquina: tudo é interceptado.
export const origin = new URL(config.use!.baseURL!).origin;
export const corsHeaders = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
export const SESSION_TOKEN = 'test-session-token-journey-0123456789';
export const WORKFLOW_ID = '11111111222233334444555566667777';
export const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
export const SCRIPT_ID = '99999999888877776666555544443332';
export const SCRIPT_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const PRODUCTION_ID = 'aaaabbbbccccddddeeeeffff00001111';
export const JOB_ID = 'job_pilot_aaaabbbbccccddddeeeeffff';
export const VIDEO_ID = '00001111222233334444555566667777';
export const VIDEO_SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
export const PROVENANCE_ARTIFACT_ID = 'dddd1111222233334444555566667777';

export async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill(SESSION_TOKEN);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
}

const voice = (id: string, name: string, language: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  language,
  license: { name: 'Licença da voz', url: 'https://example.com/licenca' },
  commercial_use: 'unknown',
  preview: 'local',
  notes: null,
  ...extra,
});
const engine = { name: 'Licença do motor', url: 'https://example.com/motor', notes: null };
const provider = (
  id: string,
  name: string,
  kind: string,
  status: string,
  voices: unknown[],
  reason = status
) => ({
  id,
  name,
  kind,
  status,
  reason,
  engine_license: engine,
  voices,
  native_word_timestamps: false,
  requires_authorization: kind === 'paid_api',
});

export const providersFixture = () => [
  provider('windows_sapi', 'Windows SAPI', 'local', 'available', [
    voice('sapi-maria', 'Maria', 'pt-BR'),
    voice('sapi-zira', 'Zira', 'en-US'),
  ]),
  provider('piper', 'Piper', 'local', 'not_installed', []),
  provider('kokoro', 'Kokoro-82M', 'local', 'available', [
    voice('pf_dora', 'pf_dora', 'pt-BR', {
      license: { name: 'Apache-2.0', url: 'https://huggingface.co/hexgrad/Kokoro-82M' },
      commercial_use: 'unknown',
      notes: 'Direitos comerciais do áudio não verificados.',
    }),
  ]),
  provider('elevenlabs', 'ElevenLabs', 'paid_api', 'not_configured', [
    voice('el-ana', 'Ana', 'pt-BR', { preview: 'requires_authorization' }),
  ]),
];

export function scriptFixture() {
  return {
    id: SCRIPT_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
    proposal_content_hash: 'sha256_prop_hash_0123456789abcdef',
    version: 2,
    status: 'approved',
    document: {
      schema_version: 1,
      simulated: true,
      title: 'Roteiro Editorial v2',
      sections: [
        {
          id: 'sec_hook',
          kind: 'hook',
          heading: 'Gancho',
          narration: 'Como garantir que cada artefato corresponde ao roteiro aprovado?',
          source_ids: ['video_01'],
        },
      ],
    },
    created_at: '2026-11-12T10:20:00Z',
    review: {
      decision: 'approve',
      feedback: 'Aprovado.',
      reviewed_at: '2026-11-12T10:25:00Z',
    },
  };
}

function workflowFixture() {
  return {
    id: WORKFLOW_ID,
    status: 'approved',
    revision: 1,
    executor: 'hermes_simulated',
    simulated: true,
    request: { objective: 'Produzir artefatos verificáveis.' },
    current_artifact_id: PROPOSAL_ARTIFACT_ID,
    pending_authorization: null,
    steps: [],
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
          title: 'Proposta de teste',
          result_status: 'complete',
          recommendation: {
            title_options: ['Proposta de teste'],
            premise: 'Premissa.',
            angle: 'Ângulo.',
            format: 'short',
            originality: 'Original.',
            differs_from: [],
            risks: [],
            licensing_notes: 'Dados de demonstração.',
          },
          evidence: { sources: 1, facts: 1, hypotheses: 0 },
          requires_human_review: true,
        },
        content_hash: 'sha256_prop_hash_0123456789abcdef',
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
}

export function productionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCTION_ID,
    script_id: SCRIPT_ID,
    script_version: 2,
    script_content_hash: SCRIPT_HASH,
    job_id: JOB_ID,
    mode: 'local_pilot',
    stage: 'prepare',
    status: 'running',
    error: null,
    created_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:00:02Z',
    artifacts: [] as unknown[],
    review: null,
    demo_only: true,
    real_voice: false,
    speech_aligned: false,
    narration_kind: null,
    narration_disclosure: null,
    alignment_method: null,
    publishable: false,
    ...overrides,
  };
}

export type BackendState = {
  productions: Record<string, unknown>[];
  providers: unknown[];
  /** `null` -> 404 (sem preferência salva). */
  preference: { provider: string; voice_id: string } | null;
  posts: { body: Record<string, unknown>; key: string | undefined }[];
  licenseCalls: number;
  /** Corpo de GET /v1/productions/{id}/license-reviews; pode variar com o tempo. */
  licenseReviews: (production: Record<string, unknown>) => unknown;
  /** Tratamento adicional (retorna true quando respondeu). */
  extra?: (route: Route, path: string, method: string) => Promise<boolean>;
};

export function newBackendState(overrides: Partial<BackendState> = {}): BackendState {
  return {
    productions: [],
    providers: providersFixture(),
    preference: null,
    posts: [],
    licenseCalls: 0,
    licenseReviews: production => ({
      production_id: production.id,
      current: [],
      history: [],
      effective_provenance: null,
      publishable: false,
    }),
    ...overrides,
  };
}

export async function installBackend(page: Page, state: BackendState) {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: corsHeaders, json: body });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (state.extra && (await state.extra(route, path, method))) return;
    if (path === '/health') return json({ status: 'ready' });
    if (path === '/v1/hermes')
      return json({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    if (path === '/v1/jobs') return json([]);
    if (path === '/v1/workflows') return json([workflowFixture()]);
    if (path === `/v1/workflows/${WORKFLOW_ID}`) return json(workflowFixture());
    if (path === `/v1/workflows/${WORKFLOW_ID}/scripts`) return json({ items: [scriptFixture()] });
    if (path === '/v1/narration/providers') return json(state.providers);
    if (path === '/v1/narration/preference') {
      return state.preference ? json(state.preference) : json({ code: 'not_found' }, 404);
    }
    if (path === `/v1/scripts/${SCRIPT_ID}/productions` && method === 'GET')
      return json({ items: state.productions });
    if (path === `/v1/scripts/${SCRIPT_ID}/productions` && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.posts.push({ body, key: request.headers()['idempotency-key'] });
      const created = productionFixture({
        mode: body.mode,
        render_quality: body.render_quality ?? 'draft',
      });
      state.productions = [created, ...state.productions];
      return json(created, 201);
    }
    const productionMatch = path.match(/^\/v1\/productions\/([0-9a-f]+)$/);
    if (productionMatch && method === 'GET') {
      const found = state.productions.find(item => item.id === productionMatch[1]);
      return found ? json(found) : json({ detail: 'não encontrado' }, 404);
    }
    const licenseMatch = path.match(/^\/v1\/productions\/([0-9a-f]+)\/license-reviews$/);
    if (licenseMatch && method === 'GET') {
      state.licenseCalls += 1;
      const found = state.productions.find(item => item.id === licenseMatch[1]);
      return found ? json(state.licenseReviews(found)) : json({ detail: 'não encontrado' }, 404);
    }
    if (/^\/v1\/jobs\/[^/]+\/events$/.test(path)) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
        body: JSON.stringify({ sequence: 1, kind: 'state', message: 'running' }) + '\n',
      });
    }
    return json({ detail: 'Não encontrado' }, 404);
  });
}

export async function openProduction(page: Page) {
  await connectSession(page);
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  const region = page.getByRole('region', { name: 'Produção técnica local e revisão final' });
  await expect(region).toBeVisible();
  return region;
}
