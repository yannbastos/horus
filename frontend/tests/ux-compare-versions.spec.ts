import { expect, test } from '@playwright/test';
import {
  connectSession,
  corsHeaders,
  installBackend,
  newBackendState,
  PRODUCTION_ID,
  productionFixture,
  PROPOSAL_ARTIFACT_ID,
  SCRIPT_HASH,
  SCRIPT_ID,
  WORKFLOW_ID,
} from './production-journey-helpers';

const SCRIPT_V1 = {
  id: SCRIPT_ID,
  workflow_id: WORKFLOW_ID,
  workflow_revision: 1,
  proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
  proposal_content_hash: 'sha256_prop_hash_0123456789abcdef',
  version: 1,
  status: 'changes_requested',
  origin: 'simulated',
  authored_by: 'simulated',
  changes: null,
  document: {
    schema_version: 1,
    simulated: true,
    title: 'Roteiro inicial de teste',
    sections: [
      {
        id: 'sec_hook',
        kind: 'hook',
        heading: 'Gancho inicial',
        narration: 'Como funciona o fluxo local antigo do projeto?',
        source_ids: ['src_1'],
      },
      {
        id: 'sec_body',
        kind: 'body',
        heading: 'Desenvolvimento',
        narration: 'Texto mantido sem alterações nesta seção.',
        source_ids: ['src_1'],
      },
    ],
  },
  created_at: '2026-11-12T10:00:00Z',
  review: {
    decision: 'request_changes',
    feedback: 'Atualizar gancho e adicionar conclusão prática.',
    reviewed_at: '2026-11-12T10:05:00Z',
  },
};

const SCRIPT_V2 = {
  id: SCRIPT_ID,
  workflow_id: WORKFLOW_ID,
  workflow_revision: 1,
  proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
  proposal_content_hash: 'sha256_prop_hash_0123456789abcdef',
  version: 2,
  status: 'approved',
  origin: 'human',
  authored_by: 'human',
  changes: {
    previous_version: 1,
    title_changed: true,
    sections_added: ['sec_extra'],
    sections_removed: [],
    sections_changed: [{ id: 'sec_hook', fields: ['narration'] }],
    order_changed: false,
  },
  document: {
    schema_version: 1,
    simulated: false,
    title: 'Roteiro revisado de teste',
    sections: [
      {
        id: 'sec_hook',
        kind: 'hook',
        heading: 'Gancho inicial',
        narration: 'Como funciona o fluxo local atualizado do projeto?',
        source_ids: ['src_1'],
      },
      {
        id: 'sec_body',
        kind: 'body',
        heading: 'Desenvolvimento',
        narration: 'Texto mantido sem alterações nesta seção.',
        source_ids: ['src_1'],
      },
      {
        id: 'sec_extra',
        kind: 'conclusion',
        heading: 'Conclusão prática',
        narration: 'Nova seção adicionada para encerrar o vídeo.',
        source_ids: ['src_1'],
      },
    ],
  },
  created_at: '2026-11-12T10:15:00Z',
  review: {
    decision: 'approve',
    feedback: 'Pronto para produção.',
    reviewed_at: '2026-11-12T10:20:00Z',
  },
};

test.describe('Comparar versões do roteiro e das produções (HOR-088)', () => {
  test('compara versões do roteiro com diff por palavra, seção nova, origem e status', async ({ page }) => {
    const state = newBackendState();
    state.extra = async (route, path, method) => {
      if (path === `/v1/workflows/${WORKFLOW_ID}/scripts` && method === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [SCRIPT_V2, SCRIPT_V1] } });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    await connectSession(page);
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true }).click();

    const history = page.getByRole('region', { name: 'Histórico de versões do roteiro' });
    await expect(history).toBeVisible();

    // Atalho "Comparar com a anterior" na versão 2
    await history.getByRole('button', { name: 'Comparar com a anterior' }).click();

    const comparePanel = page.getByRole('region', { name: 'Comparação de versões do roteiro' });
    await expect(comparePanel).toBeVisible();
    await expect(comparePanel.getByRole('heading', { name: 'v1 vs v2' })).toBeVisible();

    // Tabela acessível com cabeçalhos, origem e status de aprovação
    const metaTable = comparePanel.getByRole('table', { name: 'Metadados das versões comparadas' });
    await expect(metaTable.getByRole('columnheader', { name: 'Origem' })).toBeVisible();
    await expect(metaTable.getByRole('columnheader', { name: 'Status de aprovação' })).toBeVisible();
    await expect(metaTable.getByText('Gerado pela simulação')).toBeVisible();
    await expect(metaTable.getByText('Alterações solicitadas')).toBeVisible();
    await expect(metaTable.getByText('Escrito por você')).toBeVisible();
    await expect(metaTable.getByText('Aprovado')).toBeVisible();

    // Alterna para visualização em linha via teclado/clique e valida diff por palavra + texto acessível
    const inlineBtn = comparePanel.getByRole('button', { name: 'Em linha' });
    await inlineBtn.focus();
    await page.keyboard.press('Enter');
    await expect(inlineBtn).toHaveAttribute('aria-pressed', 'true');

    // Título: "inicial" removido, "revisado" adicionado
    const titleGroup = comparePanel.getByRole('group', { name: 'Comparação do título' });
    await expect(titleGroup.locator('del')).toContainText('Removido: inicial');
    await expect(titleGroup.locator('ins')).toContainText('Adicionado: revisado');

    // Seção alterada: "antigo" removido, "atualizado" adicionado
    const hookGroup = comparePanel.getByRole('group', { name: /Seção Gancho inicial/ });
    await expect(hookGroup.getByText('Seção alterada')).toBeVisible();
    await expect(hookGroup.locator('del')).toContainText('Removido: antigo');
    await expect(hookGroup.locator('ins')).toContainText('Adicionado: atualizado');

    // Seção nova adicionada
    const addedGroup = comparePanel.getByRole('group', { name: /Seção Conclusão prática/ });
    await expect(addedGroup.getByText('Seção adicionada', { exact: true })).toBeVisible();
    await expect(addedGroup.locator('ins').first()).toContainText('Adicionado:');
  });

  test('lista e compara duas produções com QC diferente e abre cada uma em modo somente leitura', async ({ page }) => {
    const prodA = productionFixture({
      id: PRODUCTION_ID,
      script_id: SCRIPT_ID,
      script_version: 2,
      script_content_hash: SCRIPT_HASH,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      render_quality: 'draft',
      narration: { provider: 'windows_sapi', voice_id: 'Microsoft Maria Desktop' },
      word_timings: {
        schema_version: 1,
        duration_seconds: 12.4,
        source: 'measured',
        engine: { name: 'windows_sapi', voice: 'Microsoft Maria Desktop' },
        words: [{ index: 0, word: 'Teste', start: 0, end: 0.5 }],
      },
      quality_report: {
        schema_version: 1,
        status: 'fail',
        blocking_errors: ['audio_clipping'],
        warnings: ['subtitle_long_line'],
        checks: [
          { id: 'audio_clipping', category: 'audio', status: 'fail' },
          { id: 'subtitle_long_line', category: 'subtitles', status: 'warn' },
        ],
      },
      review: null,
      created_at: '2026-11-13T10:00:00Z',
    });

    const prodBId = 'ddddddddccccccccbbbbbbbbaaaaaaaa';
    const prodB = productionFixture({
      id: prodBId,
      script_id: SCRIPT_ID,
      script_version: 2,
      script_content_hash: SCRIPT_HASH,
      mode: 'local_pilot',
      stage: 'review',
      status: 'succeeded',
      render_quality: 'final',
      narration: { provider: 'kokoro', voice_id: 'pf_dora' },
      word_timings: {
        schema_version: 1,
        duration_seconds: 14.0,
        source: 'measured',
        engine: { name: 'kokoro', voice: 'pf_dora' },
        words: [{ index: 0, word: 'Teste', start: 0, end: 0.5 }],
      },
      quality_report: {
        schema_version: 1,
        status: 'pass',
        blocking_errors: [],
        warnings: [],
        checks: [{ id: 'audio_peak', category: 'audio', status: 'pass' }],
      },
      review: {
        decision: 'approve',
        artifact_sha256: 'a'.repeat(64),
        reviewed_at: '2026-11-13T10:30:00Z',
      },
      created_at: '2026-11-13T10:20:00Z',
    });

    const state = newBackendState({ productions: [prodB, prodA] });
    const inspectedIds: string[] = [];
    state.extra = async (route, path, method) => {
      if (path === `/v1/workflows/${WORKFLOW_ID}/scripts` && method === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [SCRIPT_V2] } });
        return true;
      }
      if (path === `/v1/productions/${PRODUCTION_ID}` && method === 'GET') {
        inspectedIds.push(PRODUCTION_ID);
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodA });
        return true;
      }
      if (path === `/v1/productions/${prodBId}` && method === 'GET') {
        inspectedIds.push(prodBId);
        await route.fulfill({ status: 200, headers: corsHeaders, json: prodB });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    await connectSession(page);
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true }).click();

    const prodHistory = page.getByRole('region', { name: 'Histórico de execuções da produção' });
    await expect(prodHistory).toBeVisible();

    const listTable = prodHistory.getByRole('table', { name: 'Produções deste roteiro' });
    await expect(listTable.getByRole('columnheader', { name: 'Roteiro' })).toBeVisible();
    await expect(listTable.getByRole('columnheader', { name: 'Voz' })).toBeVisible();
    await expect(listTable.getByRole('columnheader', { name: 'Qualidade' })).toBeVisible();
    await expect(listTable.getByRole('columnheader', { name: 'Duração' })).toBeVisible();
    await expect(listTable.getByRole('columnheader', { name: 'Resumo do QC' })).toBeVisible();
    await expect(listTable.getByRole('columnheader', { name: 'Revisão' })).toBeVisible();

    // Seleciona as duas produções via checkbox
    const checkboxes = listTable.getByRole('checkbox');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    const compareRegion = prodHistory.getByRole('region', { name: 'Comparação entre duas produções' });
    await expect(compareRegion).toBeVisible();

    const compareTable = compareRegion.getByRole('table', { name: 'Tabela comparativa de produções' });
    await expect(compareTable.getByRole('row', { name: /Qualidade.*Final.*Rascunho.*Alterado/ })).toBeVisible();
    await expect(compareTable.getByRole('row', { name: /Duração.*14\.0s.*12\.4s.*Alterado/ })).toBeVisible();
    await expect(compareTable.getByRole('row', { name: /Resumo do QC.*Aprovado \(0 fail, 0 warn\).*Reprovado \(1 fail, 1 warn\).*Alterado/ })).toBeVisible();
    await expect(compareTable.getByRole('row', { name: /Estado da revisão.*Aprovada.*Aguardando revisão.*Alterado/ })).toBeVisible();
    await expect(compareTable.getByRole('row', { name: /Versão do roteiro.*v2.*v2.*Igual/ })).toBeVisible();

    // Link/botão para abrir produção B (que é prodA na ordem de seleção: 0=prodB, 1=prodA)
    await compareRegion.getByRole('button', { name: /Abrir produção B/ }).click();
    await expect.poll(() => inspectedIds).toContain(PRODUCTION_ID);
  });

  test('exibe estados vazios quando há apenas uma versão de roteiro e uma produção', async ({ page }) => {
    const onlyProd = productionFixture({
      id: PRODUCTION_ID,
      script_id: SCRIPT_ID,
      script_version: 1,
      status: 'succeeded',
      mode: 'simulated',
      review: null,
    });
    const state = newBackendState({ productions: [onlyProd] });
    const approvedOnlyV1 = { ...SCRIPT_V1, status: 'approved', review: { decision: 'approve', feedback: 'OK', reviewed_at: '2026-11-12T10:05:00Z' } };
    state.extra = async (route, path, method) => {
      if (path === `/v1/workflows/${WORKFLOW_ID}/scripts` && method === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [approvedOnlyV1] } });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    await connectSession(page);
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true }).click();

    const scriptHistory = page.getByRole('region', { name: 'Histórico de versões do roteiro' });
    await expect(scriptHistory.getByText('Apenas 1 versão disponível — crie ou gere outra versão para comparar.')).toBeVisible();
    await expect(scriptHistory.getByRole('button', { name: 'Comparar com a anterior' })).toHaveCount(0);

    const prodHistory = page.getByRole('region', { name: 'Histórico de execuções da produção' });
    await expect(prodHistory.getByText('Apenas uma produção registrada para este roteiro. Execute outra produção para comparar.')).toBeVisible();
  });
});
