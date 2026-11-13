import { expect, test } from '@playwright/test';
import { connectSession, installBackend, newBackendState } from './production-journey-helpers';

// J-03: proposta aprovada oferece atalho para a Central de Produção.
test('HOR-087 J-03: proposta aprovada abre a Central de Produção', async ({ page }) => {
  await installBackend(page, newBackendState());
  await connectSession(page);
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  const next = page.getByRole('region', { name: 'Próxima ação da proposta aprovada' });
  await expect(next).toBeVisible();
  await next.getByRole('button', { name: 'Abrir Central de Produção' }).click();
  await expect(page.getByRole('button', { name: 'Central de Produção', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
});
