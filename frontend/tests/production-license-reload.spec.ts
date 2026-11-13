import { expect, test } from '@playwright/test';
import { installBackend, newBackendState, openProduction, productionFixture } from './production-journey-helpers';

const SCENE_SHA = 'dbd285b4763b75888790bd3bfac1e38865377bf9d58f50d37f84487db70b3e58';

function provenance() {
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
        license: {
          id: 'horus-original-local',
          name: 'Original Local Demo',
          url: null,
          commercial_use: 'unknown',
          attribution_required: null,
          verified_by: null,
          verified_at: null,
        },
        status: 'unverified',
        notes: null,
      },
    ],
  };
}

// J-14: o painel recarrega quando a produção termina na própria tela e mostra "carregando".
test.describe('HOR-087 J-14: painel de licenças acompanha o fim da produção', () => {
  test('mostra carregando e libera a verificação quando a produção conclui sem remontar', async ({ page }) => {
    const running = productionFixture({ asset_provenance: provenance() });
    const state = newBackendState({ productions: [running] });
    let finished = false;
    state.licenseReviews = production => ({
      production_id: production.id,
      current: [],
      history: [],
      effective_provenance: finished ? provenance() : null,
      publishable: false,
    });
    // Atrasa a resposta de licenças para observar o estado "carregando".
    state.extra = async (route, path, method) => {
      if (method === 'GET' && /\/license-reviews$/.test(path)) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      return false;
    };
    await installBackend(page, state);
    const region = await openProduction(page);
    const panel = region.getByRole('region', { name: 'Painel de licenças e proveniência' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Carregando proveniência e licenças')).toBeVisible();
    await expect(panel.getByText('A API não devolveu proveniência efetiva')).toBeVisible();

    const callsBefore = state.licenseCalls;
    finished = true;
    state.productions = [
      productionFixture({
        asset_provenance: provenance(),
        status: 'succeeded',
        stage: 'review',
        updated_at: '2026-11-13T10:02:00Z',
      }),
    ];
    await expect(panel.getByRole('group', { name: 'Verificação humana do asset scene-1' })).toBeVisible({
      timeout: 10_000,
    });
    expect(state.licenseCalls).toBeGreaterThan(callsBefore);
  });
});
