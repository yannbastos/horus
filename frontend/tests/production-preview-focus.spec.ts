import { expect, test } from '@playwright/test';
import { corsHeaders, installBackend, newBackendState, openProduction, PRODUCTION_ID, productionFixture } from './production-journey-helpers';

// J-11: a prévia aparece (e recebe foco) perto de onde se clicou.
test('HOR-087 J-11: a prévia é levada à vista e recebe foco ao clicar', async ({ page }) => {
  const plan = {
    id: 'art_plan_01',
    kind: 'plan' as const,
    relative_path: 'plan.json',
    size_bytes: 20,
    sha256: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
  };
  const state = newBackendState({
    productions: [productionFixture({ stage: 'review', status: 'succeeded', artifacts: [plan] })],
  });
  state.extra = async (route, path) => {
    if (path === `/v1/productions/${PRODUCTION_ID}/artifacts/art_plan_01`) {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 1, scenes: [] }),
      });
      return true;
    }
    return false;
  };
  await installBackend(page, state);
  const region = await openProduction(page);
  // Rola para longe da prévia e clica no botão do cabeçalho de artefatos.
  await page.setViewportSize({ width: 1320, height: 500 });
  const button = region.getByRole('button', { name: 'Plano e metadados', exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const preview = region.getByRole('region', { name: 'Prévia do artefato plan.json' });
  await expect(preview).toBeVisible();
  await expect(preview).toBeFocused();
  await expect(preview).toBeInViewport();
});
