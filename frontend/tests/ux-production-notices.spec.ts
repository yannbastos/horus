import { expect, test } from '@playwright/test';
import {
  connectSession,
  corsHeaders,
  installBackend,
  newBackendState,
  openProduction,
  PRODUCTION_ID,
  productionFixture,
} from './production-journey-helpers';

test.describe('Avisos discretos de produção em segundo plano (HOR-098)', () => {
  test('sem produção ativa: não faz polling em /v1/productions e navegação exibe Produção sem contador', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __HORUS_PRODUCTION_POLL_MS__?: number }).__HORUS_PRODUCTION_POLL_MS__ = 80;
    });
    let productionGetCalls = 0;
    const state = newBackendState({
      extra: async (_route, path, method) => {
        if (path.startsWith('/v1/productions/') && method === 'GET') {
          productionGetCalls += 1;
        }
        return false;
      },
    });
    await installBackend(page, state);
    await connectSession(page);

    await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await page.waitForTimeout(260);

    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true })).toBeVisible();
    await expect(page.getByTestId('production-notice')).toHaveCount(0);
    expect(productionGetCalls).toBe(0);
  });

  test('conclusão fora da tela de Produção: exibe Produção (1), avisa pronta para revisão, para o polling e navega pelo botão Abrir produção', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __HORUS_PRODUCTION_POLL_MS__?: number }).__HORUS_PRODUCTION_POLL_MS__ = 100;
    });
    let pollCount = 0;
    const state = newBackendState({
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}` && method === 'GET') {
          pollCount += 1;
          const finished = pollCount >= 2;
          const updated = productionFixture({
            status: finished ? 'succeeded' : 'running',
            stage: finished ? 'review' : 'render',
            updated_at: finished ? '2026-11-14T10:05:00Z' : '2026-11-14T10:01:00Z',
          });
          state.productions = [updated];
          await route.fulfill({ status: 200, headers: corsHeaders, json: updated });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    const region = await openProduction(page);
    await region.getByRole('button', { name: 'Iniciar produção simulada', exact: true }).click();

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('button', { name: 'Produção (1)', exact: true })).toBeVisible();

    // Sai da tela de Produção enquanto a execução roda em segundo plano
    await nav.getByRole('button', { name: 'Visão geral', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Um novo olhar para criar.' })).toBeVisible();

    const notice = page.getByRole('status', { name: 'Aviso de produção' });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('aria-live', 'polite');
    await expect(notice).toContainText('pronta para revisão');

    // Contador some quando a produção atinge estado terminal e o polling encerra
    await expect(nav.getByRole('button', { name: 'Produção', exact: true })).toBeVisible();
    const callsAtCompletion = pollCount;
    await page.waitForTimeout(250);
    expect(pollCount).toBe(callsAtCompletion);

    // Botão Abrir produção leva à tela de Produção e fecha o aviso
    await notice.getByRole('button', { name: 'Abrir produção', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Da ideia à próxima entrega.' })).toBeVisible();
    await expect(page.getByTestId('production-notice')).toHaveCount(0);
  });

  test('falha/bloqueio: exibe aviso com a mensagem do backend e para de consultar', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __HORUS_PRODUCTION_POLL_MS__?: number }).__HORUS_PRODUCTION_POLL_MS__ = 100;
    });
    let pollCount = 0;
    const backendMessage = 'FFmpeg retornou código 1 durante a sobreposição de legendas.';
    const state = newBackendState({
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}` && method === 'GET') {
          pollCount += 1;
          const updated = productionFixture({
            status: 'failed',
            stage: 'subtitles',
            error: backendMessage,
            updated_at: '2026-11-14T10:06:00Z',
          });
          state.productions = [updated];
          await route.fulfill({ status: 200, headers: corsHeaders, json: updated });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    const region = await openProduction(page);
    await region.getByRole('button', { name: 'Iniciar produção simulada', exact: true }).click();

    await page.getByRole('button', { name: 'Visão geral', exact: true }).click();

    const notice = page.getByRole('status', { name: 'Aviso de produção' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('FALHA NA PRODUÇÃO');
    await expect(notice).toContainText(backendMessage);
    await expect(notice.getByRole('button', { name: 'Abrir produção', exact: true })).toBeVisible();

    const callsAfterFail = pollCount;
    await page.waitForTimeout(250);
    expect(pollCount).toBe(callsAfterFail);
  });

  test('interrompida: exibe aviso de produção interrompida com mensagem do backend', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __HORUS_PRODUCTION_POLL_MS__?: number }).__HORUS_PRODUCTION_POLL_MS__ = 100;
    });
    const state = newBackendState({
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}` && method === 'GET') {
          const updated = productionFixture({
            status: 'interrupted',
            stage: 'render',
            error: 'Execução interrompida após reinício; concilie antes de iniciar outra.',
            updated_at: '2026-11-14T10:07:00Z',
          });
          state.productions = [updated];
          await route.fulfill({ status: 200, headers: corsHeaders, json: updated });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    const region = await openProduction(page);
    await region.getByRole('button', { name: 'Iniciar produção simulada', exact: true }).click();

    await page.getByRole('button', { name: 'Visão geral', exact: true }).click();

    const notice = page.getByRole('status', { name: 'Aviso de produção' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('PRODUÇÃO INTERROMPIDA');
    await expect(notice).toContainText('Execução interrompida após reinício; concilie antes de iniciar outra.');
  });

  test('erro de rede com backoff: aumenta intervalo após falhas e recupera até concluir', async ({ page }) => {
    await page.addInitScript(() => {
      (window as { __HORUS_PRODUCTION_POLL_MS__?: number }).__HORUS_PRODUCTION_POLL_MS__ = 90;
    });
    const attemptTimes: number[] = [];
    const state = newBackendState({
      extra: async (route, path, method) => {
        if (path === `/v1/productions/${PRODUCTION_ID}` && method === 'GET') {
          attemptTimes.push(Date.now());
          if (attemptTimes.length <= 2) {
            await route.abort('failed');
            return true;
          }
          const updated = productionFixture({
            status: 'succeeded',
            stage: 'review',
            updated_at: '2026-11-14T10:08:00Z',
          });
          state.productions = [updated];
          await route.fulfill({ status: 200, headers: corsHeaders, json: updated });
          return true;
        }
        return false;
      },
    });

    await installBackend(page, state);
    const region = await openProduction(page);
    await region.getByRole('button', { name: 'Iniciar produção simulada', exact: true }).click();

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await nav.getByRole('button', { name: 'Visão geral', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Produção (1)', exact: true })).toBeVisible();

    const notice = page.getByRole('status', { name: 'Aviso de produção' });
    await expect(notice).toContainText('pronta para revisão', { timeout: 5000 });

    expect(attemptTimes.length).toBeGreaterThanOrEqual(3);
    const gap1 = attemptTimes[1] - attemptTimes[0]; // ~180ms (2^1 * 90ms)
    const gap2 = attemptTimes[2] - attemptTimes[1]; // ~360ms (2^2 * 90ms)
    expect(gap2).toBeGreaterThan(gap1 + 70);
  });
});
