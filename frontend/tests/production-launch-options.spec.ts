import { expect, test } from '@playwright/test';
import { installBackend, newBackendState, openProduction } from './production-journey-helpers';

// J-01: voz e qualidade escolhidas no cartão de disparo seguem no pedido (ProductionRequest).
test.describe('HOR-087 J-01: voz e qualidade no disparo do piloto local', () => {
  test('pré-seleciona a preferência, mostra licença e envia narration + render_quality', async ({ page }) => {
    const state = newBackendState({ preference: { provider: 'kokoro', voice_id: 'pf_dora' } });
    await installBackend(page, state);
    const region = await openProduction(page);

    await region.getByLabel('Modo de execução da produção').selectOption('local_pilot');
    const provider = region.getByLabel('Provedor de voz');
    await expect(provider).toHaveValue('kokoro');
    await expect(region.getByLabel('Voz da narração')).toHaveValue('pf_dora');

    const license = region.getByRole('note', { name: 'Licença da voz escolhida' });
    await expect(license).toContainText('Apache-2.0');
    await expect(license).toContainText('Uso comercial: desconhecido');

    // Provedores indisponíveis ou pagos não são selecionáveis.
    await expect(provider.locator('option[value="piper"]')).toBeDisabled();
    await expect(provider.locator('option[value="elevenlabs"]')).toBeDisabled();

    await region.getByLabel('Qualidade da renderização').selectOption('final');
    await expect(region.getByRole('note', { name: 'Tempo estimado da renderização' })).toContainText(
      '1080×1920'
    );

    await region.getByRole('button', { name: 'Iniciar piloto local com narração' }).click();
    await expect.poll(() => state.posts.length).toBe(1);
    expect(state.posts[0].body).toMatchObject({
      mode: 'local_pilot',
      render_quality: 'final',
      narration: { provider: 'kokoro', voice_id: 'pf_dora' },
    });
  });

  test('sem preferência usa a primeira voz disponível e o rascunho', async ({ page }) => {
    const state = newBackendState();
    await installBackend(page, state);
    const region = await openProduction(page);

    await region.getByLabel('Modo de execução da produção').selectOption('local_pilot');
    await expect(region.getByLabel('Provedor de voz')).toHaveValue('windows_sapi');
    await region.getByRole('button', { name: 'Iniciar piloto local com narração' }).click();
    await expect.poll(() => state.posts.length).toBe(1);
    expect(state.posts[0].body).toMatchObject({
      render_quality: 'draft',
      narration: { provider: 'windows_sapi', voice_id: 'sapi-maria' },
    });
  });

  test('modos simulado e demo não enviam voz nem qualidade', async ({ page }) => {
    const state = newBackendState();
    await installBackend(page, state);
    const region = await openProduction(page);
    await region.getByRole('button', { name: 'Iniciar produção simulada' }).click();
    await expect.poll(() => state.posts.length).toBe(1);
    expect(state.posts[0].body).toEqual({ expected_version: 2, mode: 'simulated' });
  });
});
