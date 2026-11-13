// Jornada completa de produção pela interface real, contra o backend real (HOR-087 / HOR-054 / HOR-132).
//
// Condicional: pula sem HORUS_E2E_BACKEND_URL e HORUS_E2E_TOKEN. Use o script de suporte, que sobe o
// backend em porta livre, com banco temporário, Hermes simulado e sem rede externa:
//
//   $env:HORUS_PILOT_FACTORY = '<sandbox da fábrica>'; $env:HORUS_ALIGNMENT_MODEL = '<pasta whisper>'
//   $env:HORUS_FFMPEG = '<ffmpeg com libass>'
//   $env:HORUS_KOKORO_PYTHON = '<python do Kokoro>'; $env:HORUS_KOKORO_MODEL_DIR = '<modelo Kokoro>'  # opcional
//   node frontend/scripts/e2e-backend.mjs run      # sobe o backend, roda esta jornada e encerra
//
// Notas de atrito (não bloqueantes) são registradas como anotações do teste e em
// artifacts/journey/timings.json; HORUS_E2E_STRICT=1 transforma os atritos esperados em falhas.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendUrl = process.env.HORUS_E2E_BACKEND_URL ?? '';
const token = process.env.HORUS_E2E_TOKEN ?? '';
const strict = process.env.HORUS_E2E_STRICT === '1';
const withKokoro = Boolean(process.env.HORUS_KOKORO_PYTHON && process.env.HORUS_KOKORO_MODEL_DIR);

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(here, '../../artifacts/journey');
const timings: Record<string, number> = {};
const frictions: string[] = [];

async function shot(page: Page, name: string) {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`) });
}

/** Mede cada etapa com relógio do teste (Date.now), sem estimativas. */
async function timed<T>(name: string, body: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await test.step(name, body);
  } finally {
    timings[name] = (Date.now() - started) / 1000;
  }
}

function friction(id: string, text: string) {
  frictions.push(`${id}: ${text}`);
  test.info().annotations.push({ type: `atrito ${id}`, description: text });
}

async function goTo(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name, exact: true }).click();
}

async function connect(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Endereço local').fill(backendUrl);
  await page.getByLabel('Token da sessão').fill(token);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await expect(page.getByText('Backend local conectado.')).toBeVisible();
}

const productionHeading = (page: Page) => page.locator('h3', { hasText: /^Produção [0-9a-f]{32}$/ }).first();

/** Dispara a produção e devolve o id da execução ANTERIOR exibida (se houver), para esperar a nova. */
async function startPilotProduction(page: Page): Promise<string | null> {
  const previous = await productionHeading(page).textContent({ timeout: 3_000 }).catch(() => null);
  await page.getByLabel('Modo de execução da produção').selectOption('local_pilot');
  await page.getByRole('button', { name: 'Iniciar piloto local com narração' }).click();
  return previous;
}

/** Espera o desfecho técnico da produção mais recente; falha com o motivo exibido se bloquear. */
async function waitProduction(page: Page, previous: string | null = null): Promise<number> {
  const started = Date.now();
  // A tela mantém a execução concluída anterior até a nova aparecer: espera o id mudar.
  if (previous) await expect(productionHeading(page)).not.toHaveText(previous, { timeout: 60_000 });
  // Somente o painel da execução atual: o histórico lista também execuções concluídas anteriores.
  const details = page.getByRole('region', { name: /^Detalhes da produção/ });
  const done = details.getByText('Execução técnica concluída').first();
  const blocked = details.getByText('EXECUÇÃO BLOQUEADA POR PRÉ-CONDIÇÃO OU DEPENDÊNCIA');
  await expect(done.or(blocked)).toBeVisible({ timeout: 8 * 60_000 });
  if (await blocked.isVisible()) {
    const reason = await page.locator('.blocker-item').first().innerText().catch(() => '(motivo não exibido)');
    throw new Error(`Produção bloqueada: ${reason}`);
  }
  return (Date.now() - started) / 1000;
}

test.describe.configure({ mode: 'serial' });
// Gravação opcional (exige `npx playwright install ffmpeg`, um download que este teste nunca faz sozinho).
test.use({ video: process.env.HORUS_E2E_VIDEO === '1' ? 'on' : 'off' });

test.describe('Jornada de produção — backend real', () => {
  test.skip(!backendUrl || !token, 'Defina HORUS_E2E_BACKEND_URL e HORUS_E2E_TOKEN (veja scripts/e2e-backend.mjs).');
  test.setTimeout(25 * 60_000);

  test.afterAll(() => {
    if (!Object.keys(timings).length) return;
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'timings.json'),
      JSON.stringify({ source: 'relógio do Playwright (Date.now) por etapa, em segundos', timings, frictions }, null, 2));
  });

  test('Radar → roteiro aprovado → produção com Maria → prévia, QC, licenças, revisão e decisão', async ({ page }) => {
    await timed('conectar ao backend', () => connect(page));

    await timed('radar: dados de demonstração', async () => {
      await goTo(page, 'Radar');
      await page.getByRole('button', { name: 'Carregar dados de demonstração' }).click();
      await expect(page.getByText('4 de 4 elegíveis selecionados')).toBeVisible();
      await shot(page, '01-radar-demo');
    });

    await timed('radar: iniciar análise editorial', async () => {
      await page.getByLabel('Identificador do canal').fill('canal-demo');
      await page.getByLabel('Resumo editorial do canal').fill('Canal fictício de tecnologia com vídeos curtos e verificados.');
      await page.getByLabel('Objetivo editorial da análise').fill('Propor um vídeo curto sobre automação local com supervisão humana.');
      await page.getByRole('button', { name: 'Iniciar análise' }).click();
      await expect(page.getByText('ANÁLISE INICIADA COM SUCESSO')).toBeVisible();
      await shot(page, '02-analise-iniciada');
      // Atrito conhecido: a mensagem manda "acompanhar na página Produção", sem link/atalho.
      if (await page.locator('#main').getByRole('button', { name: /Produção/ }).count() === 0) {
        friction('J-03', 'Após iniciar a análise não há atalho para a página Produção.');
      }
    });

    await timed('proposta: autorizar e aguardar', async () => {
      await goTo(page, 'Produção');
      await page.getByRole('button', { name: /Autorizar uma execução/ }).click();
      await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toBeVisible({ timeout: 60_000 });
      await shot(page, '03-proposta');
    });

    await timed('proposta: aprovar', async () => {
      await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Gerar roteiro' })).toBeEnabled();
    });

    await timed('roteiro: gerar e revisar', async () => {
      await page.getByRole('button', { name: 'Gerar roteiro' }).click();
      await expect(page.getByText('DOCUMENTO DO ROTEIRO · VERSÃO 1')).toBeVisible();
      await shot(page, '04-roteiro');
      // Atrito conhecido: texto de seção simulado termina com um título vazio ("Ajustes da revisão anterior:").
      if ((await page.locator('#main').innerText()).includes('Ajustes da revisão anterior:')) {
        friction('J-07', 'O roteiro simulado contém "Ajustes da revisão anterior:" sem conteúdo.');
      }
    });

    await timed('roteiro: aprovar', async () => {
      await page.getByRole('button', { name: 'Aprovar roteiro' }).click();
      await expect(page.getByLabel('Modo de execução da produção')).toBeVisible();
    });

    await timed('produção local_pilot (Maria, padrão): do clique ao fim do render+QC', async () => {
      const previous = await startPilotProduction(page);
      const seconds = await waitProduction(page, previous);
      timings['produção local_pilot (Maria): duração observada pela tela'] = seconds;
      await shot(page, '05-producao-concluida');
    });

    const narration = page.getByText(/windows_sapi/).first();
    await timed('proveniência: narração identifica motor e voz', async () => {
      await expect(narration).toContainText('Maria');
    });

    await timed('prévia: vídeo, SRT, narração e linha do tempo de palavras', async () => {
      await page.getByRole('button', { name: 'Prévia de vídeo (MP4)' }).click();
      const video = page.locator('video');
      await expect(video).toBeVisible();
      await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(3);
      expect(await video.evaluate((el: HTMLVideoElement) => el.duration)).toBeGreaterThan(5);
      await page.getByRole('button', { name: 'Legendas / transcrição SRT' }).click();
      await page.getByRole('button', { name: 'Áudio / narração WAV' }).click();
      await shot(page, '06-previa');
      const timeline = page.getByRole('region', { name: 'Revisão e navegação por timecode' });
      await timeline.scrollIntoViewIfNeeded();
      await expect(timeline.getByText('NAVEGAR POR PALAVRAS')).toBeVisible();
      await shot(page, '07-linha-do-tempo-palavras');
      if (await timeline.getByText('SEM MEDIÇÃO ACÚSTICA (estimado)').count()) {
        friction('J-12', 'Alinhamento acústico não concluído: palavras estimadas (script com quebra de linha na seção).');
      }
    });

    await timed('qc: relatório de qualidade', async () => {
      const qc = page.getByRole('region', { name: 'Painel de qualidade (QC)' });
      await qc.scrollIntoViewIfNeeded();
      await expect(qc.getByText(/pass ·/)).toBeVisible();
      await expect(qc.getByText(/0 fail/)).toBeVisible();
      await shot(page, '08-qc');
    });

    await timed('licenças: verificação humana fictícia de um asset', async () => {
      const panel = () => page.getByRole('region', { name: 'Verificação humana de licença por asset' });
      const unavailable = () => panel().getByText('A API não devolveu proveniência efetiva');
      await panel().scrollIntoViewIfNeeded();
      await expect(unavailable().or(panel().getByRole('button', { name: /Registrar decisão humana/ }).first())).toBeVisible({ timeout: 15_000 });
      if (await unavailable().isVisible()) {
        // J-14: o painel carrega a proveniência uma vez e não se atualiza quando a produção termina na própria tela.
        friction('J-14', 'Painel de verificação de licença fica "indisponível" após a produção terminar; só abre ao sair e voltar à produção.');
        expect(!strict, 'HORUS_E2E_STRICT=1: o painel deveria atualizar sem navegar').toBe(true);
        await goTo(page, 'Central de Produção');
        await page.getByRole('button', { name: 'REVISAR PRODUÇÃO' }).click();
        await panel().scrollIntoViewIfNeeded();
        await expect(unavailable().or(panel().getByRole('button', { name: /Registrar decisão humana/ }).first())).toBeVisible({ timeout: 15_000 });
      }
      if (await unavailable().isVisible()) {
        // J-13: a fonte da legenda (fonts/*.ttf) é um asset de proveniência que license_reviews.py não reconhece.
        friction('J-13', 'Verificação de licença impossível com legenda por libass: asset da fonte não é aceito por license_reviews.py (effective_provenance=null).');
        await shot(page, '09-licencas-indisponivel');
        expect(!strict, 'HORUS_E2E_STRICT=1: verificação de licença deveria estar disponível').toBe(true);
        return;
      }
      await shot(page, '09-licencas');
      await panel().getByRole('button', { name: 'Registrar decisão humana — scene-1' }).click();
      await panel().getByLabel('Nome da licença').fill('Licença fictícia de teste');
      await panel().getByLabel('URL da licença (https)').fill('https://example.org/licenca-ficticia');
      await panel().getByLabel(/Uso comercial/).selectOption('restricted');
      await panel().getByLabel(/Evidência/).fill('Verificação humana FICTÍCIA para teste E2E; sem valor jurídico.');
      await panel().getByRole('button', { name: 'Verificar', exact: true }).click();
      await panel().getByRole('button', { name: 'Confirmar decisão' }).click();
      await expect(panel().getByText('Verificado (verified)')).toBeVisible();
      await shot(page, '09b-licenca-registrada');
    });

    await timed('revisão: nota com timecode', async () => {
      await page.getByRole('button', { name: 'Prévia de vídeo (MP4)' }).click();
      const review = page.getByRole('region', { name: 'Revisão e navegação por timecode' });
      await review.scrollIntoViewIfNeeded();
      await page.locator('video').evaluate((el: HTMLVideoElement) => { el.currentTime = 7.9; });
      await page.getByRole('button', { name: 'Capturar tempo atual do player' }).click();
      await page.getByLabel('Texto da nova nota por timecode').fill('Pausa estranha antes do desenvolvimento; revisar ritmo.');
      await page.getByRole('button', { name: 'Adicionar nota no timecode' }).click();
      await expect(page.getByText('(1/200 NOTA(S))')).toBeVisible();
      await shot(page, '10-nota-timecode');
    });

    await timed('decisão: aprovar por hash com ciência das pendências', async () => {
      const decision = page.getByRole('region', { name: 'Revisão humana final da produção' });
      await decision.scrollIntoViewIfNeeded();
      const approve = page.getByRole('button', { name: 'Aprovar produção (hash verificado)' });
      await expect(approve).toBeDisabled();
      await page.getByLabel(/Confirmo ciência das pendências/).check();
      await approve.click();
      await expect(page.getByText('REVISÃO HUMANA FINAL REGISTRADA')).toBeVisible();
      await expect(page.getByText('Aprovado na revisão final').first()).toBeVisible();
      await shot(page, '11-decisao-registrada');
    });

    await timed('central de produção reflete a decisão', async () => {
      await goTo(page, 'Central de Produção');
      await expect(page.getByText('Aprovada na revisão (demonstração; não publicável)')).toBeVisible();
      await expect(page.getByText('Sem ação pendente')).toBeVisible();
      await shot(page, '12-central');
    });
  });

  test('voz Kokoro escolhida nas preferências → produção local_pilot pela interface', async ({ page }) => {
    test.skip(!withKokoro, 'Defina HORUS_KOKORO_PYTHON e HORUS_KOKORO_MODEL_DIR para o ensaio Kokoro.');
    // Atrito J-01: a interface não oferece seletor de voz/provedor; a preferência só existe na API.
    friction('J-01', 'Sem seletor de voz na interface: a preferência de narração é gravada por PUT /v1/narration/preference.');
    const response = await page.request.put(`${backendUrl}/v1/narration/preference`, {
      headers: { Authorization: `Bearer ${token}` }, data: { provider: 'kokoro', voice_id: 'pf_dora' },
    });
    expect(response.ok()).toBe(true);

    await timed('kokoro: reconectar e reabrir o roteiro aprovado', async () => {
      await connect(page);
      await goTo(page, 'Produção');
      const mode = page.getByLabel('Modo de execução da produção');
      if (!await mode.isVisible({ timeout: 5_000 }).catch(() => false)) {
        friction('J-15', 'Após recarregar, a análise precisa ser reaberta na lista de análises recentes.');
        await page.getByRole('button', { name: /Revisão 1/ }).first().click();
      }
      await expect(mode).toBeVisible({ timeout: 30_000 });
    });

    await timed('produção local_pilot (Kokoro pf_dora): do clique ao fim do render+QC', async () => {
      const previous = await startPilotProduction(page);
      timings['produção local_pilot (Kokoro): duração observada pela tela'] = await waitProduction(page, previous);
      await shot(page, '13-producao-kokoro');
    });

    // Só elementos visíveis: o seletor de voz (J-01) contém <option> com o mesmo texto, que não conta como visível.
    await expect(page.locator('text=/kokoro/i >> visible=true').first()).toBeVisible();
    await expect(page.locator('text=/pf_dora/ >> visible=true').first()).toBeVisible();
  });
});
