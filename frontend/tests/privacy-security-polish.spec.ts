import config from '../playwright.config';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/sec-privacy');
fs.mkdirSync(artifactDir, { recursive: true });

const corsHeaders = {
  'Access-Control-Allow-Origin': new URL(config.use!.baseURL!).origin,
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

type Mode = { kind: 'ok'; body?: unknown; delayMs?: number } | { kind: 'http'; code: number; detail: string } | { kind: 'network' } | { kind: 'hang' };

async function setupRoutes(page: Page, getMode: () => Mode, onCall?: () => void) {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const pathUrl = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (pathUrl === '/health') return route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
    if (pathUrl === '/v1/hermes') {
      return route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
      });
    }
    if (pathUrl === '/v1/diagnostics') {
      return route.fulfill({ status: 200, headers: corsHeaders, json: { checks: [], notice: '' } });
    }
    if (pathUrl === '/v1/security/status') {
      onCall?.();
      const mode = getMode();
      if (mode.kind === 'network') return route.abort('failed');
      if (mode.kind === 'hang') return; // nunca responde: simula o tempo esgotado
      if (mode.kind === 'http') {
        return route.fulfill({ status: mode.code, headers: corsHeaders, json: { detail: mode.detail } });
      }
      if (mode.delayMs) await new Promise(resolve => setTimeout(resolve, mode.delayMs));
      return route.fulfill({ status: 200, headers: corsHeaders, json: mode.body ?? baseStatus() });
    }
    return route.fulfill({ status: 200, headers: corsHeaders, json: {} });
  });
}

async function connectAndOpen(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await expect(page.getByText('Backend local conectado.')).toBeVisible();
  await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
}

function baseStatus(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'security.status.v1',
    checked_at: '2026-11-12T12:00:00Z',
    real_execution_allowed: false,
    blockers: [{ code: 'dangerous_tools_enabled', severity: 'critical', message: 'O perfil permite terminal, arquivos e web.' }],
    processing: { local_only: true, workflow_executor_default: 'simulated', radar_executor: 'hermes_simulated', external_connections: [] },
    hermes: {
      connection: 'loopback',
      profile_found: true,
      profile_label: '%LOCALAPPDATA%/hermes/profiles/horus',
      tools: {
        source: 'platform_toolsets.api_server',
        restricted: false,
        effective: ['terminal', 'process', 'read_file', 'web_search', 'execute_code', 'cron', 'memory', 'image_generate', 'weird_thing'],
        dangerous: ['terminal', 'process', 'read_file', 'web_search', 'execute_code'],
        required_for_editorial: [],
      },
      memory: { local_enabled: true, user_profile_enabled: true, write_approval: false, external_provider: null },
      provider_configured: false,
      network_isolation: { enforced: false, mechanism: null, reason: 'Sem bloqueio de rede.' },
      cost_limits: { configured: false, max_tokens_per_run: null, max_tokens_per_day: null },
    },
    radar: {
      retention_days: 28,
      network_enabled: false,
      automatic_cleanup: { available: true, interval_hours: 6, last_run_at: '2026-11-12T11:30:00Z', last_status: 'ok', redacted_workflows: 3 },
    },
    credentials: { items: [{ id: 'backend_session_token', storage: 'memory', description: 'Token em memória.' }] },
    private_mode: { available: false, enabled: false, reason: 'Ainda não implementado no backend.' },
    audit: { available: false, reason: 'Registro de transmissões externas ainda não implementado.' },
    ...overrides,
  };
}

const withCleanup = (cleanup: unknown) => baseStatus({ radar: { retention_days: 28, network_enabled: false, automatic_cleanup: cleanup } });

test.describe('SEC-A2 · Refinamento da interface de Privacidade e Segurança', () => {
  test.describe('Retenção do Radar', () => {
    const cases: Array<[string, unknown, string[]]> = [
      ['ok', { available: true, interval_hours: 6, last_run_at: '2026-11-12T11:30:00Z', last_status: 'ok', redacted_workflows: 3 }, ['a cada 6 h', 'CONCLUÍDO', 'Workflows redigidos no último ciclo', '3']],
      ['partial', { available: true, interval_hours: 6, last_run_at: '2026-11-12T11:30:00Z', last_status: 'partial', redacted_workflows: 1 }, ['PARCIAL', 'Algum workflow falhou e foi preservado sem alteração.']],
      ['failed', { available: true, interval_hours: 6, last_run_at: '2026-11-12T11:30:00Z', last_status: 'failed', redacted_workflows: 0 }, ['FALHOU']],
      ['sem ciclo (null)', { available: true, interval_hours: 6, last_run_at: null, last_status: null, redacted_workflows: null }, ['Ainda não executado nesta sessão', 'a cada 6 h']],
      ['indisponível', { available: false, last_run_at: null }, ['NÃO DISPONÍVEL', 'Rotina não disponível nesta versão do backend.']],
    ];
    for (const [name, cleanup, expected] of cases) {
      test(`exibe automatic_cleanup: ${name}`, async ({ page }) => {
        await setupRoutes(page, () => ({ kind: 'ok', body: withCleanup(cleanup) }));
        await connectAndOpen(page);
        const section = page.getByRole('region', { name: 'Retenção do Radar' });
        await expect(section).toBeVisible();
        await expect(section).toContainText('28 dias');
        for (const text of expected) await expect(section).toContainText(text);
      });
    }

    test('radar ausente no payload vira "Não verificado"', async ({ page }) => {
      const body = baseStatus();
      delete (body as Record<string, unknown>).radar;
      await setupRoutes(page, () => ({ kind: 'ok', body }));
      await connectAndOpen(page);
      const section = page.getByRole('region', { name: 'Retenção do Radar' });
      await expect(section.locator('.unverified-badge-wrapper')).toHaveCount(1);
    });
  });

  test.describe('Clareza dos avisos', () => {
    test('separa "o que o Hórus bloqueia" de "o que o perfil Hermes permite"', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
      await expect(summary.getByText('O que o Hórus bloqueia')).toBeVisible();
      await expect(summary.getByText('O que o perfil Hermes permite')).toBeVisible();
      await expect(summary).toContainText('Perfil não restrito, com 9 ferramentas efetivas (5 de alto risco).');
    });

    for (const restricted of [null, false] as const) {
      test(`restricted=${restricted} nunca afirma perfil restrito`, async ({ page }) => {
        const body = baseStatus();
        (body.hermes.tools as { restricted: boolean | null }).restricted = restricted;
        await setupRoutes(page, () => ({ kind: 'ok', body }));
        await connectAndOpen(page);
        const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
        await expect(summary).toBeVisible();
        await expect(summary).not.toContainText('informado como restrito');
        await expect(summary).not.toContainText(/(^|[^o] )restrito, com/);
        await expect(summary).toContainText(restricted === false ? 'Perfil não restrito' : 'Restrição do perfil não informada');
        await expect(page.getByRole('region', { name: 'Permissões do Hermes' }).getByText(/^RESTRITO$/)).toHaveCount(0);
      });
    }

    test('ferramentas não inspecionadas: perfil "Não verificado" no resumo', async ({ page }) => {
      const body = baseStatus();
      (body.hermes as { tools: unknown }).tools = null;
      await setupRoutes(page, () => ({ kind: 'ok', body }));
      await connectAndOpen(page);
      const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
      await expect(summary).toContainText('Não verificado: o diagnóstico não inspecionou as ferramentas do perfil.');
    });

    test('"somente local" não promete ausência de tráfego em nuvem', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const section = page.getByRole('region', { name: 'Estado da Privacidade' });
      await expect(section).toContainText('Informado pelo backend; não é bloqueio de rede.');
      await expect(page.getByText('Nenhum dado é enviado para nuvem')).toHaveCount(0);
    });
  });

  test.describe('Ferramentas do Hermes', () => {
    test('contagens, perigosas primeiro, linha de risco e nenhuma ferramenta omitida', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const section = page.getByRole('region', { name: 'Permissões do Hermes' });

      await expect(section.getByTestId('tools-total')).toHaveText(/9 ferramentas em 8 categorias · 5 de alto risco/);

      // Ordem: categorias com mais ferramentas de alto risco primeiro; sem risco por último.
      const headings = await section.locator('.tool-category-title').allTextContents();
      expect(headings.slice(0, 4).sort()).toEqual(['Arquivos', 'Comandos e processos', 'Execução de código', 'Web e navegador']);
      expect(headings[0]).toBe('Comandos e processos'); // 2 de alto risco (terminal, process)
      expect(headings.slice(4)).toContain('Outras');

      // Uma linha de risco por categoria exibida.
      await expect(section.locator('.tool-category-card').first()).toContainText('Pode rodar comandos e processos');

      // Nenhuma ferramenta omitida, mesmo recolhidas.
      await expect(section.locator('.tool-tag-item')).toHaveCount(9);
      await expect(section.getByText('Sem ferramentas em:')).toContainText('Skills e conectores');
    });

    test('categorias perigosas abertas; demais recolhidas; teclado abre e fecha', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const section = page.getByRole('region', { name: 'Permissões do Hermes' });

      const cron = section.getByRole('button', { name: 'Delegação e agendamento' });
      const terminal = section.getByRole('button', { name: 'Comandos e processos' });
      await expect(terminal).toHaveAttribute('aria-expanded', 'true');
      await expect(cron).toHaveAttribute('aria-expanded', 'false');
      await expect(section.getByText('cron', { exact: true })).toBeHidden();

      await cron.focus();
      await expect(cron).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(cron).toHaveAttribute('aria-expanded', 'true');
      await expect(section.getByText('cron', { exact: true })).toBeVisible();
      await page.keyboard.press('Space');
      await expect(cron).toHaveAttribute('aria-expanded', 'false');

      // Expandir / recolher todas
      await section.getByRole('button', { name: 'EXPANDIR TODAS' }).click();
      await expect(section.locator('.tool-tags-list:not([hidden])')).toHaveCount(8);
      await section.getByRole('button', { name: 'RECOLHER TODAS' }).click();
      await expect(section.locator('.tool-tags-list:not([hidden])')).toHaveCount(0);
    });

    test('foco visível nos controles de lista', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const button = page.getByRole('region', { name: 'Permissões do Hermes' }).getByRole('button', { name: 'Arquivos' });
      await page.keyboard.press('Tab'); // garante modalidade de teclado
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const outline = await button.evaluate(el => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
    });
  });

  test.describe('Selos padronizados', () => {
    test('legenda acessível com os quatro estados', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const legend = page.getByRole('region', { name: 'Legenda dos selos' });
      await expect(legend).toBeVisible();
      for (const label of ['ATIVO', 'BLOQUEADO', 'NÃO VERIFICADO', 'NÃO DISPONÍVEL']) {
        await expect(legend.locator('dt').filter({ hasText: label })).toHaveCount(1);
      }
      await expect(legend.locator('dd')).toHaveCount(4);
    });

    test('todos os selos de estado usam o mesmo componente (data-state)', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const states = await page.locator('.status-badge').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-state')))].sort());
      expect(states).toEqual(['active', 'blocked', 'unavailable', 'unverified']);
      // Modo Privado, Auditoria e Consentimento: "Não disponível" e sem controles
      for (const name of ['Modo Privado', 'Auditoria de Transmissões']) {
        const section = page.getByRole('region', { name });
        await expect(section.locator('.status-badge[data-state="unavailable"]')).toHaveCount(1);
        await expect(section.locator('input, button, [role="switch"]')).toHaveCount(0);
      }
      const consent = page.locator('.consent-future-area');
      await expect(consent.locator('.status-badge[data-state="unavailable"]')).toHaveCount(1);
      await expect(consent.locator('input, button')).toHaveCount(0);
    });
  });

  test.describe('Estados de carregamento e erro', () => {
    test('carregamento anunciado em região viva e conclusão anunciada', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok', delayMs: 700 }));
      await connectAndOpen(page);
      const live = page.locator('p[role="status"][aria-live="polite"]');
      await expect(live).toHaveText('Verificando privacidade e segurança…');
      await expect(page.getByRole('button', { name: 'VERIFICANDO…' })).toBeDisabled();
      await expect(live).toHaveText('Diagnóstico de segurança atualizado.');
      await expect(live).toHaveClass(/visually-hidden/);
    });

    const failures: Array<[string, Mode, string, string]> = [
      ['401', { kind: 'http', code: 401, detail: 'x' }, 'O backend recusou o token da sessão.', '401'],
      ['404', { kind: 'http', code: 404, detail: 'Not Found' }, 'Atualize o backend', '404'],
      ['503', { kind: 'http', code: 503, detail: 'indisponível' }, 'O backend não conseguiu montar o diagnóstico.', '503'],
      ['rede', { kind: 'network' }, 'Não foi possível alcançar o backend local.', 'aplicativo está em execução'],
    ];
    for (const [name, mode, title, detail] of failures) {
      test(`erro ${name}: mensagem específica, alerta e recuperação com "Verificar novamente"`, async ({ page }) => {
        let current: Mode = mode;
        await setupRoutes(page, () => current);
        await connectAndOpen(page);
        const alert = page.getByRole('alert');
        await expect(alert).toContainText(title);
        await expect(alert).toContainText(detail);
        // Nenhum dado obsoleto é exibido junto ao erro.
        await expect(page.getByRole('region', { name: 'Permissões do Hermes' })).toHaveCount(0);
        // Um único botão de ação, dentro do alerta.
        await expect(page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' })).toHaveCount(1);

        current = { kind: 'ok' };
        await alert.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Permissões do Hermes' })).toBeVisible();
      });
    }

    test('timeout: sem resposta em 15 s mostra "Tempo esgotado"', async ({ page }) => {
      await page.clock.install();
      await setupRoutes(page, () => ({ kind: 'hang' }));
      await connectAndOpen(page);
      await expect(page.getByRole('button', { name: 'VERIFICANDO…' })).toBeVisible();
      await page.clock.fastForward(16000);
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('O backend não respondeu a tempo.');
      await expect(alert).toContainText('15 segundos');
    });

    test('backend desconectado: estado, mensagem e nenhuma chamada de segurança', async ({ page }) => {
      let calls = 0;
      await setupRoutes(page, () => ({ kind: 'ok' }), () => calls++);
      await page.goto('/');
      await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
      await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
      const card = page.getByRole('status', { name: 'Backend desconectado' });
      await expect(card).toBeVisible();
      await expect(card).toContainText('Nenhum diagnóstico foi obtido.');
      await expect(card.getByRole('heading', { level: 2, name: 'Backend desconectado.' })).toBeVisible();
      expect(calls).toBe(0);
    });
  });

  test.describe('Acessibilidade', () => {
    test('hierarquia de títulos: um h1, seções em h2, categorias em h3', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacidade e Segurança');
      const levels = await page.locator('main h1, main h2, main h3, .page h1, .page h2, .page h3').evaluateAll(els => els.map(e => Number(e.tagName[1])));
      let prev = 0;
      for (const level of levels) {
        expect(level - prev).toBeLessThanOrEqual(1); // nunca pula um nível
        prev = level;
      }
      await expect(page.getByRole('heading', { level: 2, name: 'Retenção do Radar' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'Comandos e processos' })).toBeVisible();
    });

    test('abas: setas, Home e End movem foco e seleção; apenas a aba ativa está na ordem de Tab', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const general = page.getByRole('tab', { name: 'GERAL', exact: true });
      const privacy = page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true });
      await expect(privacy).toHaveAttribute('tabindex', '0');
      await expect(general).toHaveAttribute('tabindex', '-1');
      await privacy.focus();
      await page.keyboard.press('Home');
      await expect(general).toBeFocused();
      await expect(general).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('End');
      await expect(privacy).toBeFocused();
      await expect(privacy).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowLeft');
      await expect(general).toBeFocused();
    });

    test('nenhum dado de segurança em localStorage/sessionStorage', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'ok' }));
      await connectAndOpen(page);
      const dump = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
      expect(dump).not.toContain('terminal');
      expect(dump).not.toContain('security');
      expect(dump).not.toContain('test-session-token');
    });
  });

  test.describe('Layout e capturas (artifacts/sec-privacy)', () => {
    // toHaveScreenshot não é usado: fontes e renderização do Edge variam entre máquinas e a
    // página tem datas locais; as capturas são evidência e o layout é validado por asserções.
    const viewports = [
      { name: '1320', width: 1320, height: 840 },
      { name: '1040', width: 1040, height: 680 },
    ];
    const themes = [
      { name: 'dark', button: 'ESCURO' },
      { name: 'light', button: 'CLARO' },
    ];
    for (const theme of themes) {
      for (const vp of viewports) {
        test(`${theme.name} ${vp.name}: sem rolagem horizontal nem estouro de cartões`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await setupRoutes(page, () => ({ kind: 'ok' }));
          await connectAndOpen(page);
          await page.getByRole('tab', { name: 'GERAL', exact: true }).click();
          await page.getByRole('button', { name: theme.button, exact: true }).click();
          await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
          await expect(page.getByRole('region', { name: 'Retenção do Radar' })).toBeVisible();
          await page.evaluate(() => document.fonts.ready);

          const overflow = await page.evaluate(() => {
            const doc = document.documentElement;
            const root = document.querySelector('.privacy-security-page')!.getBoundingClientRect();
            const offenders = [...document.querySelectorAll('.privacy-security-page *')].filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > root.right + 1 && !el.closest('.data-table-container');
            }).map(el => el.className || el.tagName);
            return { horizontal: doc.scrollWidth - doc.clientWidth, offenders: offenders.slice(0, 5) };
          });
          expect(overflow.horizontal).toBeLessThanOrEqual(0);
          expect(overflow.offenders).toEqual([]);

          // A rolagem da aplicação é interna: as seções são capturadas individualmente.
          for (const [region, slug] of [['Permissões do Hermes', 'hermes'], ['Retenção do Radar', 'radar']] as const) {
            await page.getByRole('region', { name: region }).screenshot({ path: path.join(artifactDir, `privacy-${slug}-${theme.name}-${vp.name}.png`) });
          }
          await page.screenshot({ path: path.join(artifactDir, `privacy-${theme.name}-${vp.name}.png`), fullPage: true });
          expect(fs.existsSync(path.join(artifactDir, `privacy-${theme.name}-${vp.name}.png`))).toBe(true);
        });
      }
    }

    test('captura do estado de erro 401 e de desconectado', async ({ page }) => {
      await setupRoutes(page, () => ({ kind: 'http', code: 401, detail: 'x' }));
      await connectAndOpen(page);
      await expect(page.getByRole('alert')).toBeVisible();
      await page.screenshot({ path: path.join(artifactDir, 'privacy-error-401.png'), fullPage: true });
    });
  });
});
