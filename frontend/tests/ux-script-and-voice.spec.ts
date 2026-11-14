import { expect, test } from '@playwright/test';
import {
  connectSession,
  corsHeaders,
  installBackend,
  newBackendState,
  openProduction,
  PROPOSAL_ARTIFACT_ID,
  providersFixture,
  SCRIPT_ID,
  WORKFLOW_ID,
} from './production-journey-helpers';

function wavFixture(seconds = 0.6, rate = 8000) {
  const samples = Math.floor(seconds * rate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  }
  return buffer;
}

test.describe('UX primeiro vídeo — Roteiro e Vozes (HOR-087 / HOR-101)', () => {
  test('editor foca nova seção ao adicionar, valida ao lado do campo e salva com Ctrl+S', async ({ page }) => {
    const state = newBackendState();
    let savedBody: Record<string, unknown> | null = null;
    state.extra = async (route, path, method) => {
      if (path === `/v1/workflows/${WORKFLOW_ID}/scripts` && method === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [] } });
        return true;
      }
      if (path === `/v1/workflows/${WORKFLOW_ID}/scripts` && method === 'POST') {
        const raw = route.request().postData();
        savedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: {
            id: SCRIPT_ID,
            workflow_id: WORKFLOW_ID,
            workflow_revision: 1,
            proposal_artifact_id: PROPOSAL_ARTIFACT_ID,
            proposal_content_hash: 'sha256_prop_hash_0123456789abcdef',
            version: 1,
            status: 'awaiting_review',
            origin: 'human',
            authored_by: 'human',
            document: (savedBody as Record<string, unknown>)?.document,
            created_at: '2026-11-14T09:00:00Z',
            review: null,
          },
        });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    await connectSession(page);
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Produção', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Roteiro e revisão humana' })).toBeVisible();

    await page.getByRole('button', { name: 'Escrever roteiro do zero' }).click();
    const editor = page.getByRole('region', { name: 'Editor de roteiro humano' });
    await expect(editor).toBeVisible();

    // Adicionar seção move o foco para o título da nova seção (#3)
    await editor.getByRole('button', { name: 'Adicionar seção' }).click();
    const newSectionHeading = editor.getByLabel(/Título da seção #3/);
    await expect(newSectionHeading).toBeFocused();

    // Ctrl+S com campos inválidos mostra validação acionável ao lado do campo de título e foca o título
    await page.keyboard.press('Control+s');
    const titleInput = editor.getByLabel(/Título do roteiro/);
    await expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    await expect(titleInput).toBeFocused();
    await expect(editor.getByText(/Informe um título curto para identificar o vídeo/)).toBeVisible();

    // Preenche título e todas as 4 seções e salva via Ctrl+S
    await titleInput.fill('Meu primeiro roteiro com Ctrl+S');
    await expect(editor.getByText('ALTERAÇÕES NÃO SALVAS')).toBeVisible();

    for (let i = 1; i <= 4; i++) {
      await editor.getByLabel(new RegExp(`Título da seção #${i}`)).fill(`Seção ${i}`);
      await editor.getByLabel(new RegExp(`Narração da seção #${i}`)).fill(`Texto narrado da seção ${i} com palavras suficientes.`);
    }

    await page.keyboard.press('Control+s');
    await expect.poll(() => savedBody).not.toBeNull();
    expect(savedBody).toMatchObject({
      source: 'manual',
      document: {
        title: 'Meu primeiro roteiro com Ctrl+S',
      },
    });
  });

  test('vozes: mostra voz padrão clara, estados da prévia com botão parar e explica escolha na produção', async ({ page }) => {
    const state = newBackendState();
    let defaultVoice: { provider: string; voice_id: string } | null = null;
    let previewCalls = 0;

    state.extra = async (route, path, method) => {
      if (path === '/v1/narration/providers' && method === 'GET') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: providersFixture() });
        return true;
      }
      if (path === '/v1/narration/preference') {
        if (method === 'PUT') {
          const raw = route.request().postData();
          defaultVoice = raw ? JSON.parse(raw) : null;
        }
        await route.fulfill({ status: 200, headers: corsHeaders, json: defaultVoice });
        return true;
      }
      if (path === '/v1/narration/preview' && method === 'POST') {
        previewCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 120));
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { id: `prev-${previewCalls}`, url: `/v1/narration/previews/prev-${previewCalls}`, expires_in_seconds: 300 },
        });
        return true;
      }
      if (path.startsWith('/v1/narration/previews/') && method === 'GET') {
        await route.fulfill({ status: 200, headers: { ...corsHeaders, 'Content-Type': 'audio/wav' }, body: wavFixture() });
        return true;
      }
      return false;
    };

    await installBackend(page, state);
    await connectSession(page);
    await page.getByRole('button', { name: 'ABRIR NARRAÇÃO' }).click();

    // Sem preferência salva, explica claramente
    await expect(page.getByText(/Nenhuma voz padrão salva\./)).toBeVisible();

    // Salva Kokoro pf_dora como padrão e verifica rótulo amigável + uso comercial
    const pfDora = page.getByRole('listitem', { name: 'pf_dora (Kokoro-82M)' });
    await expect(pfDora).toContainText('USO COMERCIAL: DESCONHECIDO');
    await pfDora.getByRole('button', { name: /Usar pf_dora \(Kokoro-82M\) como voz padrão/ }).click();
    await expect(page.getByText(/Voz padrão atual:.*pf_dora \(Kokoro-82M\)/)).toBeVisible();

    // Prévia mostra estado gerando, botão de parar aparece e interrompe
    await pfDora.getByRole('button', { name: /Ouvir prévia de pf_dora/ }).click();
    await expect(pfDora.getByText(/Estado da prévia: gerando áudio…/)).toBeVisible();
    const stopBtn = pfDora.getByRole('button', { name: /Parar prévia de pf_dora/ });
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();
    await expect(pfDora.getByText(/Estado da prévia:/)).toHaveCount(0);

    // Na tela de produção, explica por que a voz foi pré-selecionada e ao trocar manualmente explica escolha manual
    const prodRegion = await openProduction(page);
    await prodRegion.getByLabel('Modo de execução da produção').selectOption('local_pilot');
    const licenseNote = prodRegion.getByRole('note', { name: 'Licença da voz escolhida' });
    await expect(licenseNote).toContainText('pré-selecionada pela sua preferência salva em Ajustes');
    await expect(licenseNote).toContainText('Apache-2.0');
    await expect(licenseNote).toContainText('Uso comercial: desconhecido');

    await prodRegion.getByLabel('Provedor de voz').selectOption('windows_sapi');
    await expect(licenseNote).toContainText('selecionada manualmente para esta produção');
  });
});
