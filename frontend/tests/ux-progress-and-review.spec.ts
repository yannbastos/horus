import { expect, test } from '@playwright/test';
import {
  corsHeaders,
  installBackend,
  JOB_ID,
  newBackendState,
  openProduction,
  PRODUCTION_ID,
  productionFixture,
  VIDEO_ID,
  VIDEO_SHA,
} from './production-journey-helpers';

test.describe('UX primeiro vídeo — Progresso e Revisão (HOR-087 / HOR-101)', () => {
  test('progresso tem aria-live, dica da etapa e ação sugerida quando falha', async ({ page }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'narration',
          status: 'failed',
          error: 'kokoro_unavailable: modelo Kokoro não encontrado no caminho configurado.',
          created_at: '2026-11-14T08:00:00Z',
          updated_at: '2026-11-14T08:01:15Z',
        }),
      ],
    });
    state.extra = async (route, path) => {
      if (path === `/v1/jobs/${JOB_ID}/events`) {
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' },
          body: JSON.stringify({ sequence: 1, kind: 'state', message: 'failed' }) + '\n',
        });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    const region = await openProduction(page);

    const progress = region.getByRole('status', { name: 'Progresso da execução' });
    await expect(progress).toHaveAttribute('aria-live', 'polite');
    await expect(progress).toContainText('1 min 15 s');

    const failAlert = region.getByRole('alert', { name: 'Falha na produção' });
    await expect(failAlert).toContainText('kokoro_unavailable');
    await expect(failAlert).toContainText('O que fazer:');
    await expect(failAlert).toContainText('Ajustes → Narração');

    // A tela não trava: usuário consegue conciliar e liberar nova produção
    await region.getByLabel('Conferi os artefatos e os efeitos da tentativa anterior').check();
    await expect(region.getByRole('button', { name: 'Criar nova produção após conciliação' })).toBeEnabled();
  });

  test('revisão ordena QC por gravidade, destaca licenças antes de Aprovar e explica motivo do bloqueio', async ({ page }) => {
    const state = newBackendState({
      productions: [
        productionFixture({
          stage: 'review',
          status: 'succeeded',
          quality_acknowledgement_required: true,
          quality_report: {
            overall_status: 'fail',
            tool: { name: 'horus-qc', version: '1.0' },
            checks: [
              {
                id: 'duration',
                category: 'video',
                status: 'pass',
                method: 'measured',
                detail: 'Duração 48.7 s dentro do esperado.',
              },
              {
                id: 'loudness',
                category: 'audio',
                status: 'warn',
                method: 'measured',
                detail: '-28.1 LUFS abaixo da faixa.',
                timecode: { start: 3.0, end: 8.5 },
              },
              {
                id: 'audio_clipping',
                category: 'audio',
                status: 'fail',
                method: 'measured',
                detail: 'Pico acima de 0 dBFS detectado.',
                timecode: { start: 12.4, end: 14.1 },
              },
            ],
          },
          asset_provenance: {
            assets: [
              {
                asset_id: 'voice_kokoro_pf_dora',
                kind: 'audio',
                origin: 'local_tts_model',
                relative_path: 'narration.wav',
                sha256: 'a'.repeat(64),
                license: { id: 'Apache-2.0', name: 'Apache-2.0', url: null, attribution_required: false },
                commercial_use: 'unknown',
                status: 'unverified',
                verified_by: null,
              },
            ],
          },
          artifacts: [
            {
              id: VIDEO_ID,
              kind: 'video',
              relative_path: 'render/short.mp4',
              sha256: VIDEO_SHA,
              size_bytes: 102400,
              created_at: '2026-11-14T08:05:00Z',
            },
          ],
        }),
      ],
    });
    state.extra = async (route, path) => {
      if (path === `/v1/productions/${PRODUCTION_ID}/license-reviews`) {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: {
            production_id: PRODUCTION_ID,
            effective_provenance: { assets: [] },
            history: [],
          },
        });
        return true;
      }
      if (path === `/v1/productions/${PRODUCTION_ID}/artifacts/${VIDEO_ID}/content`) {
        await route.fulfill({ status: 200, headers: { ...corsHeaders, 'Content-Type': 'video/mp4' }, body: Buffer.from('mp4') });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    const region = await openProduction(page);

    // QC ordena fail -> warn -> pass na tabela e exibe explicação curta
    const qcPanel = region.getByRole('region', { name: 'Painel de qualidade (QC)' });
    await expect(qcPanel).toContainText('O que significa: Distorção por saturação no áudio.');
    const rows = qcPanel.getByRole('table', { name: 'Tabela de checks de qualidade' }).locator('tbody tr');
    await expect(rows.nth(0)).toContainText('audio_clipping');
    await expect(rows.nth(1)).toContainText('loudness');
    await expect(rows.nth(2)).toContainText('duration');

    // Clicar no timecode do erro posiciona no trecho do vídeo
    await qcPanel.getByRole('button', { name: 'Ir para timecode do erro audio_clipping (00:12.400)' }).click();
    const tcWorkspace = region.getByRole('region', { name: 'Revisão e navegação por timecode' });
    await expect(tcWorkspace.getByLabel('Timecode selecionado atual')).toContainText('00:12.400 (12.40s)');

    // Pendências de licença destacadas antes do botão Aprovar
    const reviewRegion = region.getByRole('region', { name: 'Revisão humana final da produção' });
    const licensePendencies = reviewRegion.getByRole('note', { name: 'Pendências de licença antes de aprovar' });
    await expect(licensePendencies).toContainText('voice_kokoro_pf_dora');
    await expect(licensePendencies).toContainText('unverified');

    // Motivo do bloqueio visível quando Aprovar está desabilitado
    const approveBtn = reviewRegion.getByRole('button', { name: 'Aprovar produção (hash verificado)', exact: true });
    await expect(approveBtn).toBeDisabled();
    const blockReason = reviewRegion.getByRole('status', { name: 'Motivo do bloqueio de aprovação' });
    await expect(blockReason).toContainText('Aprovação bloqueada:');
    await expect(blockReason).toContainText('caixa de ciência explícita');

    // Ao confirmar ciência explícita, Aprovar habilita e o motivo do bloqueio desaparece
    await reviewRegion.getByLabel(/Confirmo ciência das pendências de QC/).check();
    await expect(approveBtn).toBeEnabled();
    await expect(blockReason).toHaveCount(0);
  });
});
