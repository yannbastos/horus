import { expect, test } from '@playwright/test';
import { installBackend, newBackendState, openProduction } from './production-journey-helpers';

// J-18: modo e qualidade escolhidos são lembrados e o botão acompanha o modo.
test.describe('HOR-087 J-18: lembra modo e qualidade', () => {
  test('mantém piloto local e qualidade final após recarregar a página', async ({ page }) => {
    await installBackend(page, newBackendState());
    let region = await openProduction(page);
    await expect(region.getByRole('button', { name: 'Iniciar produção simulada' })).toBeVisible();
    await region.getByLabel('Modo de execução da produção').selectOption('local_pilot');
    await region.getByLabel('Qualidade da renderização').selectOption('final');

    await page.reload();
    region = await openProduction(page);
    await expect(region.getByLabel('Modo de execução da produção')).toHaveValue('local_pilot');
    await expect(region.getByLabel('Qualidade da renderização')).toHaveValue('final');
    await expect(region.getByRole('button', { name: 'Iniciar piloto local com narração' })).toBeVisible();
  });

  test('armazenamento indisponível não quebra a tela e volta ao padrão', async ({ page }) => {
    await page.addInitScript(() => {
      const key = 'horus.production.launchPrefs';
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k: string) {
        if (k === key) throw new Error('bloqueado');
        return get.call(this, k);
      };
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new Error('bloqueado');
        return set.call(this, k, v);
      };
    });
    await installBackend(page, newBackendState());
    const region = await openProduction(page);
    await expect(region.getByLabel('Modo de execução da produção')).toHaveValue('simulated');
    await region.getByLabel('Modo de execução da produção').selectOption('local_pilot');
    await expect(region.getByRole('button', { name: 'Iniciar piloto local com narração' })).toBeVisible();
  });

  test('valor inválido guardado é ignorado', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('horus.production.launchPrefs', '{"mode":"hack","quality":"x"}')
    );
    await installBackend(page, newBackendState());
    const region = await openProduction(page);
    await expect(region.getByLabel('Modo de execução da produção')).toHaveValue('simulated');
  });
});
