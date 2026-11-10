import { expect, test } from '@playwright/test';

test('preserva navegação, temas e organização nos tamanhos do desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Um novo olhar para criar.' })).toBeVisible();
  await expect(page.getByText('Integração pendente', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ABRIR PRODUÇÃO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
  await page.getByRole('button', { name: 'Histórico operacional', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cada produção deixa um registro.' })).toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sua mídia, em um lugar.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/overview-dark-1320.png', fullPage: true });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'CLARO', exact: true }).click();
  await page.reload();
  await expect(page.locator('.horus')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 1040, height: 680 });
  await page.screenshot({ path: 'test-results/overview-light-1040.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Produção', exact: true }).click();
  await expect(page.getByRole('button', { name: 'CONSULTAR PERFIL' })).toBeDisabled();
  await page.getByRole('button', { name: 'Transcrição', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ABRIR TRANSCRIÇÃO ATUAL' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('reproduz mídia local sem enviar o arquivo a serviços externos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  // WAV PCM curto e válido; o player também aceita áudio local.
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  await page.getByLabel('Selecionar mídia local').setInputFiles({ name: 'teste-local.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.getByRole('heading', { name: 'teste-local.wav' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
});
