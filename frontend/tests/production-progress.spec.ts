import { expect, test } from '@playwright/test';
import { corsHeaders, installBackend, JOB_ID, newBackendState, openProduction, productionFixture } from './production-journey-helpers';

// J-10: esperas longas mostram etapa traduzida, tempo decorrido e última atualização, sem barra inventada.
test.describe('HOR-087 J-10: progresso nas esperas longas', () => {
  test('etapa align em português, tempo decorrido que avança e último evento do job', async ({ page }) => {
    const created = new Date(Date.now() - 75_000).toISOString();
    const state = newBackendState({
      productions: [productionFixture({ stage: 'align', status: 'running', created_at: created, updated_at: created })],
    });
    state.extra = async (route, path) => {
      if (path === `/v1/jobs/${JOB_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body:
            JSON.stringify({ sequence: 1, kind: 'state', message: 'running' }) +
            '\n' +
            JSON.stringify({ sequence: 2, kind: 'stage', message: 'align' }) +
            '\n',
        });
        return true;
      }
      return false;
    };
    await installBackend(page, state);
    const region = await openProduction(page);
    const progress = region.getByRole('status', { name: 'Progresso da execução' });
    await expect(progress).toBeVisible();
    await expect(progress.getByText('Alinhando fala').first()).toBeVisible();
    await expect(progress).toContainText(/1 min \d\d s/);
    await expect(progress).toContainText('etapa: Alinhando fala (stage: align)');
    await expect(progress).toContainText('não informa porcentagem');
    await expect(progress).toContainText('Kokoro');
    await expect(region.getByRole('progressbar')).toHaveCount(0);
    // A trilha não exibe `align` cru e marca Cenas como concluída.
    await expect(region.getByRole('list', { name: 'Etapas da produção' }).getByRole('listitem').filter({ hasText: '3. Cenas' })).toContainText('Concluída');
    await expect(region.getByText('stage: align', { exact: true })).toHaveCount(0);

    const before = await progress.innerText();
    await expect.poll(async () => progress.innerText(), { timeout: 5000 }).not.toBe(before);
  });

  test('execução concluída mostra a duração total, sem aviso de espera', async ({ page }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'review',
          status: 'succeeded',
          created_at: '2026-11-13T10:00:00Z',
          updated_at: '2026-11-13T10:02:26Z',
        }),
      ],
    });
    await installBackend(page, state);
    const region = await openProduction(page);
    const progress = region.getByRole('status', { name: 'Progresso da execução' });
    await expect(progress).toContainText('DURAÇÃO TOTAL');
    await expect(progress).toContainText('2 min 26 s');
    await expect(progress).not.toContainText('não informa porcentagem');
  });
});
