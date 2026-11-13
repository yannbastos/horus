import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const SESSION_TOKEN = 'test-session-token-hor-097-license-ui';
const WORKFLOW_ID = '11111111222233334444555566667777';
const PROPOSAL_ARTIFACT_ID = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const PROPOSAL_HASH = 'sha256_prop_hash_0123456789abcdef';
const SCRIPT_ID = '99999999888877776666555544443332';
const SCRIPT_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const PROD_ID = 'f1f2f3f4a1a2a3a4b1b2b3b4c1c2c3c4';
const JOB_ID = 'job_license_hor097_01';
const SCENE_SHA = 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58';
const VOICE_SHA = '2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a';
const SECRET_EVIDENCE = 'EVIDENCIA-SECRETA-NAO-DEVE-VAZAR';

type Review = Record<string, any>;

function provenance() {
  const unknownLicense = (id: string | null, name: string) => ({
    id,
    name,
    url: null,
    commercial_use: 'unknown',
    attribution_required: null,
    verified_by: null,
    verified_at: null,
  });
  return {
    schema_version: 1,
    assets: [
      {
        asset_id: 'scene-1',
        relative_path: 'canais/demo/videos/fixture/scene-1.png',
        sha256: SCENE_SHA,
        kind: 'image',
        origin: 'original_local',
        source_url: null,
        author: 'Operador Local HORUS',
        license: unknownLicense('horus-original-local', 'Original Local Demo'),
        status: 'unverified',
        notes: null,
      },
      {
        asset_id: 'narration-sapi',
        relative_path: 'canais/demo/videos/fixture/fixture.wav',
        sha256: VOICE_SHA,
        kind: 'voice',
        origin: 'system_voice',
        source_url: null,
        author: 'Microsoft Windows SAPI',
        license: unknownLicense(null, 'Windows Desktop Voice EULA'),
        status: 'unverified',
        notes: null,
      },
    ],
  };
}

function effective(history: Review[]) {
  const base = provenance();
  const latest = new Map<string, Review>();
  for (const r of history) latest.set(r.asset_id, r);
  base.assets = base.assets.map((asset: any) => {
    const r = latest.get(asset.asset_id);
    if (!r || r.asset_sha256 !== asset.sha256) return asset;
    return {
      ...asset,
      status: r.decision,
      license: {
        ...r.license,
        verified_by: 'human',
        verified_at: r.decision === 'verified' ? r.reviewed_at : null,
      },
    };
  });
  return base;
}

function workflow() {
  return {
    id: WORKFLOW_ID,
    status: 'approved',
    revision: 1,
    executor: 'hermes_simulated',
    simulated: true,
    request: { objective: 'Validar a verificação humana de licença.' },
    current_artifact_id: PROPOSAL_ARTIFACT_ID,
    pending_authorization: null,
    steps: [],
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
          title: 'Verificação de licença',
          result_status: 'complete',
          recommendation: {
            title_options: ['Verificação de licença'],
            premise: 'Registrar decisão humana.',
            angle: 'Proveniência.',
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

function script() {
  return {
    id: SCRIPT_ID,
    workflow_id: WORKFLOW_ID,
    workflow_revision: 1,
    proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
    proposal_content_hash: PROPOSAL_HASH,
    version: 2,
    status: 'approved',
    document: {
      schema_version: 1 as const,
      simulated: true as const,
      title: 'Roteiro v2',
      sections: [
        { id: 'hook', kind: 'hook' as const, heading: 'Gancho', narration: 'Olá.', source_ids: [] },
      ],
    },
    created_at: '2026-11-13T10:20:00Z',
    review: { decision: 'approve' as const, feedback: 'ok', reviewed_at: '2026-11-13T10:25:00Z' },
  };
}

type PostMode = 'ok' | 'conflict' | 'invalid' | 'abort-once';

async function setup(page: Page, initial: Review[] = []) {
  const state = {
    reviews: [...initial],
    postMode: 'ok' as PostMode,
    posts: [] as { key: string | null; body: Review }[],
    aborted: false,
  };
  const production = {
    id: PROD_ID,
    script_id: SCRIPT_ID,
    script_version: 2,
    script_content_hash: SCRIPT_HASH,
    job_id: JOB_ID,
    mode: 'local_pilot',
    stage: 'review',
    status: 'succeeded',
    error: null,
    created_at: '2026-11-13T11:00:00Z',
    updated_at: '2026-11-13T11:10:00Z',
    artifacts: [],
    review: null,
    demo_only: true,
    real_voice: false,
    speech_aligned: false,
    narration_kind: 'local_tts',
    alignment_method: 'measured_sections',
    publishable: false,
    quality_report: null,
    asset_provenance: provenance(),
    quality_acknowledgement_required: true,
  };

  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: corsHeaders, json: body });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (path === '/health') return json({ status: 'ready' });
    if (path === '/v1/hermes') {
      return json({ state: 'ready', connected: true, cli_available: true, configured: true, features: [] });
    }
    if (path === '/v1/jobs') return json([]);
    if (path === '/v1/workflows') return json([workflow()]);
    if (path === `/v1/workflows/${WORKFLOW_ID}`) return json(workflow());
    if (path === `/v1/workflows/${WORKFLOW_ID}/scripts`) return json({ items: [script()] });
    if (path === `/v1/scripts/${SCRIPT_ID}/productions`) return json({ items: [production] });
    if (path === `/v1/productions/${PROD_ID}`) return json(production);
    if (path === `/v1/jobs/${JOB_ID}/events`) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
        body: JSON.stringify({ sequence: 1, kind: 'stage', message: 'review' }) + '\n',
      });
    }
    if (path === `/v1/productions/${PROD_ID}/license-reviews`) {
      if (request.method() === 'GET') {
        return json({
          production_id: PROD_ID,
          current: [...new Map(state.reviews.map(r => [r.asset_id, r])).values()],
          history: state.reviews,
          effective_provenance: effective(state.reviews),
          publishable: false,
        });
      }
      const body = request.postDataJSON() as Review;
      const key = request.headers()['idempotency-key'] ?? null;
      state.posts.push({ key, body });
      if (state.postMode === 'abort-once' && !state.aborted) {
        state.aborted = true;
        return route.abort('failed');
      }
      if (state.postMode === 'conflict') {
        return json({ detail: 'asset_sha256 diverge do asset registrado.' }, 409);
      }
      if (state.postMode === 'invalid') {
        // Formato real do FastAPI/pydantic: lista em `detail`, sem eco do conteúdo no cliente.
        return json({ detail: [{ type: 'string_too_long', loc: ['body', 'evidence'], msg: 'inválido' }] }, 422);
      }
      const repeat = state.reviews.find(r => r._key === key);
      if (repeat) {
        const { _key, ...rest } = repeat;
        return json(rest, 200);
      }
      const previous = [...state.reviews].reverse().find(r => r.asset_id === body.asset_id);
      const review = {
        id: `review${state.reviews.length + 1}`.padEnd(32, '0'),
        production_id: PROD_ID,
        ...body,
        reviewed_at: `2026-11-13T12:0${state.reviews.length}:00Z`,
        supersedes: previous?.id ?? null,
      };
      state.reviews.push({ ...review, _key: key });
      return json(review, 201);
    }
    return json({ detail: 'Não encontrado' }, 404);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill(SESSION_TOKEN);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  const detail = page.getByRole('region', { name: `Detalhes da produção ${PROD_ID}` });
  await expect(detail).toBeVisible();
  const panel = detail.getByRole('region', { name: 'Painel de licenças e proveniência' });
  await expect(panel).toBeVisible();
  const asset = panel.getByRole('group', { name: 'Verificação humana do asset scene-1' });
  await expect(asset).toBeVisible();
  return { state, panel, asset };
}

async function fill(asset: ReturnType<Page['getByRole']>, opts: { commercial?: string; evidence?: string } = {}) {
  await asset.getByRole('button', { name: /Registrar decisão humana/ }).click();
  await asset.getByLabel('Licença (id)').fill('horus-original-local');
  await asset.getByLabel('Nome da licença').fill('Original Local Demo');
  await asset.getByLabel('URL da licença (https)').fill('https://horus.local/licencas/original');
  await asset.getByLabel('Uso comercial').selectOption(opts.commercial ?? 'allowed');
  await asset.getByLabel(/^Evidência/).fill(opts.evidence ?? 'Arquivo gerado localmente pelo operador.');
}

test.describe('Verificação humana de licença por asset — HOR-097', () => {
  test('registra decisão verificada com confirmação, mostra histórico humano e mantém publishable=false', async ({ page }) => {
    const { state, panel, asset } = await setup(page);

    await expect(panel.getByText('APROVAÇÃO DE LICENÇA NÃO TORNA O VÍDEO PUBLICÁVEL')).toBeVisible();
    await expect(panel.getByText('NÃO PUBLICÁVEL (publishable: false)')).toBeVisible();

    await fill(asset);
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    const confirm = asset.getByRole('alertdialog', { name: 'Confirmar decisão scene-1' });
    await expect(confirm).toContainText('VERIFICADA');
    expect(state.posts).toHaveLength(0); // nada é enviado antes da confirmação explícita
    await confirm.getByRole('button', { name: 'Confirmar decisão' }).click();

    const history = asset.getByRole('region', { name: 'Histórico de decisões do asset scene-1' });
    await expect(history.getByText('VERIFICADA')).toBeVisible();
    await expect(history.getByText('por humano')).toBeVisible();
    await expect(history.getByText('2026-11-13T12:00:00Z')).toBeVisible();
    await expect(history.getByText('Evidência: Arquivo gerado localmente pelo operador.')).toBeVisible();

    expect(state.posts).toHaveLength(1);
    expect(state.posts[0].key).toBeTruthy();
    expect(state.posts[0].body).toEqual({
      asset_id: 'scene-1',
      asset_sha256: SCENE_SHA,
      decision: 'verified',
      license: {
        id: 'horus-original-local',
        name: 'Original Local Demo',
        url: 'https://horus.local/licencas/original',
        commercial_use: 'allowed',
        attribution_required: false,
      },
      evidence: 'Arquivo gerado localmente pelo operador.',
      reviewed_by: 'human',
    });
    // A visão efetiva substitui a proveniência registrada, e o vídeo segue não publicável.
    await expect(panel.getByText('Verificado (verified)').first()).toBeVisible();
    await expect(panel.getByText('NÃO PUBLICÁVEL (publishable: false)')).toBeVisible();
  });

  test('reenvio após falha de rede usa a mesma Idempotency-Key e não duplica o histórico', async ({ page }) => {
    const { state, asset } = await setup(page);
    state.postMode = 'abort-once';

    await fill(asset);
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();
    await expect(asset.getByRole('alert')).toContainText('reenviada com segurança');

    // Mesmo envio de novo.
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();

    await expect(asset.getByText('VERIFICADA').first()).toBeVisible();
    expect(state.posts).toHaveLength(2);
    expect(state.posts[0].key).toBeTruthy();
    expect(state.posts[1].key).toBe(state.posts[0].key);
    expect(state.reviews).toHaveLength(1);
  });

  test('exibe 409 da API sem perder o formulário', async ({ page }) => {
    const { state, asset } = await setup(page);
    state.postMode = 'conflict';

    await fill(asset);
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();

    await expect(asset.getByRole('alert')).toContainText('Conflito (409): asset_sha256 diverge do asset registrado.');
    await expect(asset.getByLabel(/^Evidência/)).toHaveValue('Arquivo gerado localmente pelo operador.');
    await expect(asset.getByText('Nenhuma decisão humana registrada.')).toBeVisible();
  });

  test('exibe 422 de forma genérica, sem eco do conteúdo enviado', async ({ page }) => {
    const { state, asset } = await setup(page);
    state.postMode = 'invalid';

    await fill(asset, { evidence: SECRET_EVIDENCE });
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();

    const alert = asset.getByRole('alert');
    await expect(alert).toContainText('Dados rejeitados pela API (422)');
    await expect(alert).not.toContainText(SECRET_EVIDENCE);
    await expect(alert).not.toContainText('string_too_long');
  });

  test('uso comercial unknown bloqueia Verificar no cliente, mas permite Rejeitar; histórico é append-only', async ({ page }) => {
    const { state, asset } = await setup(page);

    await fill(asset, { commercial: 'unknown' });
    await expect(asset.getByRole('button', { name: 'Verificar', exact: true })).toBeDisabled();
    await expect(asset.getByText('commercial_use unknown nunca pode ser verificado')).toBeVisible();
    expect(state.posts).toHaveLength(0);

    await asset.getByRole('button', { name: 'Rejeitar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();
    await expect(asset.getByText('REJEITADA').first()).toBeVisible();
    expect(state.posts[0].body.decision).toBe('rejected');
    expect(state.posts[0].body.license.commercial_use).toBe('unknown');

    // Nova decisão sobre o mesmo asset: as duas ficam no histórico, a mais nova primeiro.
    await fill(asset, { commercial: 'restricted', evidence: 'Termos revistos: uso restrito.' });
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    await asset.getByRole('button', { name: 'Confirmar decisão' }).click();
    const items = asset.getByRole('region', { name: /Histórico de decisões/ }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('VERIFICADA');
    await expect(items.nth(0)).toContainText('Substitui a decisão');
    await expect(items.nth(1)).toContainText('REJEITADA');
  });

  test('valida evidência e URL no cliente antes de enviar', async ({ page }) => {
    const { state, asset } = await setup(page);

    await fill(asset, { evidence: '   ' });
    await asset.getByLabel('URL da licença (https)').fill('http://inseguro.example');
    await asset.getByRole('button', { name: 'Verificar', exact: true }).click();
    const alert = asset.getByRole('alert');
    await expect(alert).toContainText('A evidência é obrigatória.');
    await expect(alert).toContainText('A URL da licença deve ser https, sem credenciais.');
    expect(state.posts).toHaveLength(0);
  });

  test('voz do sistema não verificada exibe aviso claro', async ({ page }) => {
    const { panel } = await setup(page);
    const voice = panel.getByRole('group', { name: 'Verificação humana do asset narration-sapi' });
    await expect(voice).toContainText('Voz do sistema (system_voice) sem licença verificada');
    await expect(voice.getByText('Não verificado (unverified)')).toBeVisible();
  });
});
