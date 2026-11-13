import { expect, test } from '@playwright/test';
import { installBackend, newBackendState, openProduction, productionFixture } from './production-journey-helpers';

// J-08: termos internos explicados em linguagem simples, sem esconder o valor técnico.
test('HOR-087 J-08: glossário e dicas dos termos técnicos mantêm os valores visíveis', async ({ page }) => {
  await installBackend(
    page,
    newBackendState({ productions: [productionFixture({ stage: 'review', status: 'succeeded' })] })
  );
  const region = await openProduction(page);
  const notice = region.getByRole('note', { name: 'Avisos de proveniência e escopo de demonstração' });

  // Valores técnicos continuam visíveis para auditoria.
  await expect(notice.getByText('NÃO PUBLICÁVEL (publishable: false)')).toBeVisible();
  await expect(notice.getByText('ESCOPO (demo_only)')).toBeVisible();
  await expect(notice.getByText('NARRAÇÃO (real_voice)')).toBeVisible();
  await expect(notice.getByText('LEGENDAS (speech_aligned)')).toBeVisible();

  // Dicas em português nos próprios rótulos.
  await expect(notice.getByText('NARRAÇÃO (real_voice)')).toHaveAttribute('title', /voz sintética/);
  await expect(notice.getByText('NÃO PUBLICÁVEL (publishable: false)')).toHaveAttribute(
    'title',
    /ainda não pode ser publicado/
  );
  await expect(region.getByText('HASH DO ROTEIRO (M3)')).toHaveAttribute('title', /64 caracteres/);

  // Glossário recolhido por padrão e legível ao abrir.
  const glossary = notice.getByLabel('Glossário dos termos técnicos');
  await glossary.getByText('O que significam estes termos?').click();
  await expect(glossary).toContainText('Voz humana real');
  await expect(glossary).toContainText('Legenda sincronizada com a fala');
  await expect(glossary).toContainText('speech_aligned');
});
