import { expect, test } from '@playwright/test';

// Regressão encontrada no Tauri real: ao reabrir com recibo pendente, a tela voltava para Small/Automático.
// Um novo Transcrever usaria outro modelo (possivelmente com download) sem o usuário perceber.
test('recibo pendente restaura modelo e idioma da tarefa original', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('horus.transcription.pending.v1', JSON.stringify({
      id: 'original-job', key: 'receipt-key', version: 2, previous: '', databaseId: 'test-db',
      payload: { operation: 'transcription.run', path: 'C:/midia/longa.wav', model: 'tiny', language: 'en' },
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'longa.wav' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'RETOMAR ACOMPANHAMENTO', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true })).toHaveValue('tiny');
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('en');
});

test('sem recibo, os padrões continuam Small e detecção automática', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true })).toHaveValue('small');
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('auto');
});
