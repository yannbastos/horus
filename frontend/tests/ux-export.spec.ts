import { expect, test } from '@playwright/test';
import {
  corsHeaders,
  installBackend,
  newBackendState,
  openProduction,
  PRODUCTION_ID,
  productionFixture,
  SESSION_TOKEN,
  VIDEO_ID,
  VIDEO_SHA,
} from './production-journey-helpers';

const EXPORT_ID_1 = 'a'.repeat(64);
const EXPORT_ID_2 = 'b'.repeat(64);
const EXPORT_SHA_1 = '1234567890abcdef'.repeat(4);
const EXPORT_SHA_2 = 'fedcba0987654321'.repeat(4);

function makeExportItem(id = EXPORT_ID_1, sha = EXPORT_SHA_1, size = 24576) {
  return {
    id,
    production_id: PRODUCTION_ID,
    created_at: '2026-11-14T11:30:00Z',
    relative_path: `exports/${PRODUCTION_ID}/${id}/package.zip`,
    size_bytes: size,
    sha256: sha,
    publishable: false,
  };
}

function approvedProductionFixture() {
  return productionFixture({
    stage: 'review',
    status: 'succeeded',
    artifacts: [
      {
        id: VIDEO_ID,
        kind: 'video',
        relative_path: 'render/short.mp4',
        sha256: VIDEO_SHA,
        size_bytes: 20480,
      },
    ],
    review: {
      decision: 'approve',
      artifact_sha256: VIDEO_SHA,
      reviewed_at: '2026-11-14T11:00:00Z',
    },
  });
}

test.describe('Pacote para publicação manual — Exportação local (HOR-099)', () => {
  test('produção não aprovada: explica que exportação exige aprovação e não exibe botão de exportar', async ({ page }) => {
    let exportCalls = 0;
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'review',
          status: 'succeeded',
          review: null,
        }),
      ],
      extra: async (_route, path) => {
        if (path.includes('/export')) exportCalls += 1;
        return false;
      },
    });
    await installBackend(page, state);
    await openProduction(page);

    const panel = page.getByTestId('production-export-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Pacote para publicação manual' })).toBeVisible();
    await expect(panel).toContainText('Não publica nada; prepara arquivos para você publicar e auditar');
    await expect(page.getByTestId('export-requires-approval')).toContainText(
      'Disponível somente após aprovação na revisão humana desta produção.'
    );
    await expect(panel.getByRole('button', { name: 'Exportar pacote' })).toHaveCount(0);
    expect(exportCalls).toBe(0);
  });

  test('aprovada exporta (lista vazia -> cheia), repete com mesma Idempotency-Key (200) e baixa ZIP autenticado', async ({ page }) => {
    const keysReceived: string[] = [];
    const downloadAuthHeaders: string[] = [];
    let releasePost!: () => void;
    const firstPostGate = new Promise<void>(resolve => { releasePost = resolve; });
    const zipBytes = Buffer.from('PK\x03\x04horus-export-package-fixture');
    const pkg1 = makeExportItem(EXPORT_ID_1, EXPORT_SHA_1, zipBytes.length);

    const state = newBackendState({
      productions: [approvedProductionFixture()],
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}/exports` && method === 'GET') {
          await route.fulfill({
            status: 200,
            headers: corsHeaders,
            json: { items: keysReceived.length > 0 ? [pkg1] : [] },
          });
          return true;
        }
        if (path === `/v1/productions/${PRODUCTION_ID}/export` && method === 'POST') {
          const key = route.request().headers()['idempotency-key'] ?? '';
          const isRepeat = keysReceived.includes(key);
          keysReceived.push(key);
          if (!isRepeat) {
            await firstPostGate;
          }
          await route.fulfill({
            status: isRepeat ? 200 : 201,
            headers: corsHeaders,
            json: pkg1,
          });
          return true;
        }
        if (path === `/v1/productions/${PRODUCTION_ID}/exports/${EXPORT_ID_1}/file` && method === 'GET') {
          downloadAuthHeaders.push(route.request().headers()['authorization'] ?? '');
          await route.fulfill({
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/zip',
            },
            body: zipBytes,
          });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    await openProduction(page);

    const panel = page.getByTestId('production-export-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Não publica nada; prepara arquivos para você publicar e auditar');
    await expect(page.getByTestId('exports-empty')).toBeVisible();

    const exportBtn = panel.getByRole('button', { name: 'Exportar pacote' });
    await exportBtn.click();

    await expect(panel.getByRole('status')).toContainText('Gerando pacote de exportação…');
    releasePost();

    await expect(page.getByTestId('export-ready-status')).toContainText('Pacote pronto para download.');
    await expect(page.getByTestId('exports-list').locator('li')).toHaveCount(1);

    const itemRow = page.getByTestId(`export-item-${EXPORT_ID_1}`);
    await expect(itemRow).toContainText(pkg1.relative_path);
    await expect(itemRow).toContainText(`${zipBytes.length} B`);
    await expect(itemRow).toContainText(`${EXPORT_SHA_1.slice(0, 12)}…`);

    // Repetição com a mesma Idempotency-Key recebe 200 e não duplica item na lista
    await exportBtn.click();
    await expect(page.getByTestId('export-ready-status')).toContainText(
      'Pacote pronto (mesma chave de idempotência reutilizada, sem duplicar arquivo).'
    );
    await expect(page.getByTestId('exports-list').locator('li')).toHaveCount(1);
    expect(keysReceived.length).toBe(2);
    expect(keysReceived[0]).toBeTruthy();
    expect(keysReceived[1]).toBe(keysReceived[0]);

    // Download via fetch autenticado + Blob
    const downloadPromise = page.waitForEvent('download');
    await itemRow.getByRole('button', { name: 'Baixar ZIP' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `horus-pacote-${PRODUCTION_ID.slice(0, 8)}-${EXPORT_ID_1.slice(0, 8)}.zip`
    );
    expect(downloadAuthHeaders).toEqual([`Bearer ${SESSION_TOKEN}`]);
  });

  test('lista cheia ao abrir e erro 409 exibe a mensagem do backend e rotaciona a chave na tentativa seguinte', async ({ page }) => {
    const pkg1 = makeExportItem(EXPORT_ID_1, EXPORT_SHA_1, 15360);
    const pkg2 = makeExportItem(EXPORT_ID_2, EXPORT_SHA_2, 32768);
    const keys: string[] = [];
    let shouldFail409 = true;
    const conflictMessage =
      'O pacote contém caminho absoluto ou possível credencial em texto; revise o conteúdo antes de exportar.';

    const state = newBackendState({
      productions: [approvedProductionFixture()],
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}/exports` && method === 'GET') {
          await route.fulfill({
            status: 200,
            headers: corsHeaders,
            json: { items: [pkg1] },
          });
          return true;
        }
        if (path === `/v1/productions/${PRODUCTION_ID}/export` && method === 'POST') {
          keys.push(route.request().headers()['idempotency-key'] ?? '');
          if (shouldFail409) {
            await route.fulfill({
              status: 409,
              headers: corsHeaders,
              json: { detail: conflictMessage },
            });
            return true;
          }
          await route.fulfill({
            status: 201,
            headers: corsHeaders,
            json: pkg2,
          });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    await openProduction(page);

    const panel = page.getByTestId('production-export-panel');
    await expect(page.getByTestId('exports-list').locator('li')).toHaveCount(1);
    await expect(page.getByTestId(`export-item-${EXPORT_ID_1}`)).toContainText('15.0 KB (15360 B)');

    await panel.getByRole('button', { name: 'Exportar pacote' }).click();
    const alert = page.getByTestId('export-error-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(conflictMessage);

    shouldFail409 = false;
    await panel.getByRole('button', { name: 'Exportar pacote' }).click();
    await expect(page.getByTestId('export-ready-status')).toContainText('Pacote pronto para download.');
    await expect(page.getByTestId('exports-list').locator('li')).toHaveCount(2);
    expect(keys.length).toBe(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
