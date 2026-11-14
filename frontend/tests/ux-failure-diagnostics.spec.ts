import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import {
  corsHeaders,
  installBackend,
  newBackendState,
  openProduction,
  productionFixture,
} from './production-journey-helpers';

const origin = new URL(config.use!.baseURL!).origin;
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

test.describe('HOR-095: diagnóstico de falha legível na produção e narração', () => {
  test('falha com diagnóstico técnico recolhido por padrão, expansível e copiável', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let lastCopied = '';
      Object.defineProperty(window, '__horusLastCopied', {
        get: () => lastCopied,
        configurable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            lastCopied = text;
          },
        },
        configurable: true,
      });
    });

    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'render',
          status: 'failed',
          error: 'A renderização do vídeo falhou na etapa local.',
          failure: {
            code: 'render_failed',
            stage: 'render',
            type: 'CalledProcessError',
            exit_code: 1,
            duration_seconds: 14.32,
            stderr_tail: 'Error: Remotion bundle failed\n  at renderMedia (index.js:42)',
            stderr_limit_bytes: 8192,
          },
        }),
      ],
    });

    await installBackend(page, state);
    const region = await openProduction(page);

    const alert = region.getByRole('alert', { name: 'Falha na produção' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('A renderização do vídeo falhou na etapa local.');
    // Ação sugerida prioriza failure.code ('render_failed')
    await expect(alert).toContainText(
      'A renderização do vídeo falhou na fábrica local. Confira o diagnóstico técnico abaixo (Remotion/FFmpeg)'
    );

    const details = alert.locator('details.failure-diagnostics');
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator('summary')).toHaveText('Diagnóstico técnico');

    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');

    await expect(details).toContainText('Render');
    await expect(details).toContainText('render_failed');
    await expect(details).toContainText('14.32 s');
    await expect(details).toContainText('1');
    await expect(details.locator('pre.failure-diagnostics-stderr')).toContainText(
      'Error: Remotion bundle failed'
    );

    await details.getByRole('button', { name: 'Copiar diagnóstico' }).click();
    await expect(details).toContainText('Diagnóstico copiado.');

    const copied = await page.evaluate(
      () => (window as unknown as { __horusLastCopied?: string }).__horusLastCopied ?? ''
    );
    expect(copied).toContain('render_failed');
    expect(copied).toContain('Render (render)');
    expect(copied).toContain('Error: Remotion bundle failed');
  });

  test('produção interrompida com failure usa ação por código e exibe diagnóstico', async ({
    page,
  }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'narration',
          status: 'interrupted',
          error: 'A produção foi interrompida pelo reinício do backend.',
          failure: {
            code: 'production_interrupted',
            stage: 'narration',
            type: 'ProcessError',
            exit_code: null,
            duration_seconds: 5.5,
            stderr_tail: '',
            stderr_limit_bytes: 8192,
          },
        }),
      ],
    });

    await installBackend(page, state);
    const region = await openProduction(page);

    const alert = region.getByRole('alert', { name: 'Produção interrompida' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('A produção foi interrompida pelo reinício do backend.');
    await expect(alert).toContainText(
      'A produção foi interrompida antes de concluir (por reinício do backend ou encerramento do processo).'
    );

    const details = alert.locator('details.failure-diagnostics');
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');

    await details.locator('summary').click();
    await expect(details).toContainText('Narração');
    await expect(details).toContainText('production_interrupted');
    await expect(details).toContainText('5.5 s');
    await expect(details).toContainText('Sem saída de erro capturada.');
  });

  test('sem campo failure mantém a tela anterior sem bloco de diagnóstico', async ({ page }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'narration',
          status: 'failed',
          error: 'Erro legado sem campo failure.',
        }),
      ],
    });

    await installBackend(page, state);
    const region = await openProduction(page);

    const alert = region.getByRole('alert', { name: 'Falha na produção' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Erro legado sem campo failure.');
    await expect(alert.locator('details.failure-diagnostics')).toHaveCount(0);
    await expect(alert.getByText('Diagnóstico técnico')).toHaveCount(0);
  });

  test('failure malformado (não-objeto) não quebra a tela e degrada com segurança', async ({
    page,
  }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          id: 'prod-malformed-string',
          stage: 'prepare',
          status: 'failed',
          error: 'Erro com failure string malformada.',
          failure: 'payload-invalido',
        }),
      ],
    });

    await installBackend(page, state);
    const region = await openProduction(page);

    const alert = region.getByRole('alert', { name: 'Falha na produção' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Erro com failure string malformada.');
    await expect(alert.locator('details.failure-diagnostics')).toHaveCount(0);
  });

  test('failure parcialmente malformado ignora campos inválidos sem quebrar a tela', async ({
    page,
  }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          id: 'prod-malformed-fields',
          stage: 'narration',
          status: 'failed',
          error: 'Erro com campos parciais.',
          failure: {
            code: 'kokoro_synthesis_failed',
            stage: 'narration',
            exit_code: 'nao-numero',
            duration_seconds: -10,
            stderr_tail: 'traceback omitido',
          },
        }),
      ],
    });

    await installBackend(page, state);
    const region = await openProduction(page);

    const alert = region.getByRole('alert', { name: 'Falha na produção' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Erro com campos parciais.');
    await expect(alert).toContainText('A síntese local do Kokoro falhou.');
    const details = alert.locator('details.failure-diagnostics');
    await expect(details).toBeVisible();
    await details.locator('summary').click();
    await expect(details).toContainText('kokoro_synthesis_failed');
    await expect(details).toContainText('traceback omitido');
  });

  test('prévia e estimativa de narração exibem message legível do backend em vez de só o código', async ({
    page,
  }) => {
    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (method === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...cors, ...corsHeaders } });
        return;
      }
      if (path === '/health') {
        return route.fulfill({ headers: cors, json: { status: 'ready', database_id: 'test-db' } });
      }
      if (path === '/v1/narration/providers') {
        return route.fulfill({
          headers: cors,
          json: [
            {
              id: 'kokoro',
              name: 'Kokoro-82M',
              kind: 'local',
              status: 'available',
              reason: 'available',
              engine_license: { name: 'Apache-2.0', url: null, notes: null },
              native_word_timestamps: false,
              requires_authorization: false,
              voices: [
                {
                  id: 'pf_dora',
                  name: 'Dora',
                  language: 'pt-BR',
                  license: { name: 'Apache-2.0', url: null },
                  commercial_use: 'unknown',
                  preview: 'local',
                  notes: null,
                },
              ],
            },
          ],
        });
      }
      if (path === '/v1/narration/preference') {
        return route.fulfill({ status: 404, headers: cors, json: { detail: 'not_set' } });
      }
      if (path === '/v1/narration/preview' && method === 'POST') {
        return route.fulfill({
          status: 500,
          headers: cors,
          json: {
            code: 'kokoro_synthesis_failed',
            message: 'Falha ao sintetizar áudio no Kokoro local: modelo não encontrado.',
            failure: {
              code: 'kokoro_synthesis_failed',
              stage: 'narration',
              type: 'CalledProcessError',
              exit_code: 2,
              duration_seconds: 1.4,
              stderr_tail: 'RuntimeError: model missing',
              stderr_limit_bytes: 8192,
            },
          },
        });
      }
      if (path === '/v1/narration/estimate' && method === 'POST') {
        return route.fulfill({
          status: 422,
          headers: cors,
          json: {
            code: 'estimate_failed',
            message: 'Não foi possível estimar o custo para esta voz.',
            failure: null,
          },
        });
      }
      return route.fulfill({
        headers: cors,
        json: { connected: false, features: [], configured: false, cli_available: false, checks: [], notice: '' },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByLabel('Token da sessão').fill('browser-test-session-token-0123456789');
    await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
    await page.getByRole('button', { name: 'ABRIR NARRAÇÃO' }).click();
    await expect(page.getByRole('region', { name: 'Provedor Kokoro-82M' })).toBeVisible();

    const voiceItem = page.getByRole('listitem', { name: 'Dora (Kokoro-82M)' });
    await voiceItem.getByRole('button', { name: 'Ouvir prévia de Dora (Kokoro-82M)' }).click();
    await expect(voiceItem.getByRole('alert')).toContainText(
      'Falha ao sintetizar áudio no Kokoro local: modelo não encontrado.'
    );

    await voiceItem.getByRole('button', { name: 'Estimar custo de Dora (Kokoro-82M)' }).click();
    await expect(voiceItem.getByRole('alert')).toContainText(
      'Não foi possível estimar o custo para esta voz.'
    );
  });
});
