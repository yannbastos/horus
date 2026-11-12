import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '../../artifacts/m2-privacy');
fs.mkdirSync(artifactDir, { recursive: true });

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:1420',
  'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

type RouteOptions = {
  securityStatus?: unknown;
  securityCode?: number;
  securityDetail?: string;
  abortSecurity?: boolean;
  onSecurityCall?: () => void;
};

async function setupDefaultRoute(page: Page, options: RouteOptions = {}) {
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const pathUrl = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (pathUrl === '/health') {
      await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
      return;
    }
    if (pathUrl === '/v1/hermes') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
      });
      return;
    }
    if (pathUrl === '/v1/diagnostics') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { checks: [], notice: 'Ambiente de teste.' },
      });
      return;
    }
    if (pathUrl === '/v1/security/status') {
      options.onSecurityCall?.();
      if (options.abortSecurity) {
        await route.abort('failed');
        return;
      }
      const code = options.securityCode ?? 200;
      if (code >= 400) {
        await route.fulfill({
          status: code,
          headers: corsHeaders,
          json: { detail: options.securityDetail ?? 'Erro simulado' },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: options.securityStatus ?? mockInsecureStatus,
      });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, json: {} });
  });
}

async function connectSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Token da sessão').fill('test-session-token-0123456789');
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await expect(page.getByText('Backend local conectado.')).toBeVisible();
}

const mockInsecureStatus = {
  schema_version: 'security.status.v1',
  checked_at: '2026-11-12T12:00:00Z',
  real_execution_allowed: false,
  blockers: [
    {
      code: 'dangerous_tools_enabled',
      severity: 'critical',
      message: 'O perfil horus permite terminal, arquivos e web pela API.',
    },
    {
      code: 'no_network_isolation',
      severity: 'warning',
      message: 'Sem bloqueio de rede no nível do sistema operacional.',
    },
  ],
  processing: {
    local_only: true,
    workflow_executor_default: 'simulated',
    radar_executor: 'hermes_simulated',
    external_connections: [
      {
        id: 'hermes_gateway',
        kind: 'loopback',
        target: '127.0.0.1:8643',
        enabled: true,
        purpose: 'Agente local Hermes',
      },
      {
        id: 'youtube_data_api',
        kind: 'external',
        target: 'googleapis.com',
        enabled: false,
        purpose: 'Coleta do Radar (desativada)',
      },
    ],
  },
  hermes: {
    connection: 'loopback',
    profile_found: true,
    profile_label: '%LOCALAPPDATA%/hermes/profiles/horus',
    tools: {
      source: 'platform_toolsets.api_server',
      restricted: false,
      effective: ['terminal', 'read_file', 'web_search', 'python', 'cron', 'mcp_client', 'memory_store'],
      dangerous: ['terminal', 'read_file', 'web_search'],
      required_for_editorial: [],
    },
    memory: {
      local_enabled: true,
      user_profile_enabled: true,
      write_approval: false,
      external_provider: null,
    },
    provider_configured: false,
    network_isolation: {
      enforced: false,
      mechanism: null,
      reason: 'Sem bloqueio de rede no nível do SO.',
    },
    cost_limits: {
      configured: false,
      max_tokens_per_run: null,
      max_tokens_per_day: null,
    },
  },
  radar: {
    retention_days: 28,
    network_enabled: false,
    automatic_cleanup: {
      available: false,
      last_run_at: null,
    },
  },
  credentials: {
    items: [
      {
        id: 'backend_session_token',
        storage: 'memory',
        description: 'Token de sessão gerado a cada execução, mantido em memória.',
        token: 'SECRET-LEAK-IF-RENDERED-001',
      },
      {
        id: 'hermes_connection_key',
        storage: 'local_file',
        protection: 'permissões do usuário do Windows; sem cifragem dedicada',
        location_label: '%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json',
        password: 'SUPER-SECRET-PASSWORD-002',
      },
    ],
  },
  private_mode: {
    available: false,
    enabled: false,
    reason: 'Ainda não implementado no backend.',
  },
  audit: {
    available: false,
    reason: 'Registro de transmissões externas ainda não implementado.',
  },
};

const mockMinimalStatus = {
  schema_version: 'security.status.v1',
  checked_at: '2026-11-12T12:00:00Z',
  real_execution_allowed: true,
  blockers: [],
  processing: {
    local_only: true,
    workflow_executor_default: 'simulated',
    radar_executor: 'hermes_simulated',
    external_connections: [
      {
        id: 'hermes_gateway',
        kind: 'loopback',
        target: '127.0.0.1:8643',
        enabled: true,
        purpose: 'Agente local Hermes',
      },
    ],
  },
  hermes: {
    connection: 'loopback',
    profile_found: true,
    profile_label: '%LOCALAPPDATA%/hermes/profiles/horus-restricted',
    tools: {
      source: 'default:hermes-api-server',
      restricted: true,
      effective: ['read_file'],
      dangerous: [],
      required_for_editorial: [],
    },
    memory: {
      local_enabled: true,
      user_profile_enabled: true,
      write_approval: true,
      external_provider: null,
    },
    provider_configured: true,
    network_isolation: {
      enforced: true,
      mechanism: 'windows_firewall_rule',
      reason: null,
    },
    cost_limits: {
      configured: true,
      max_tokens_per_run: 50000,
      max_tokens_per_day: 200000,
    },
  },
  credentials: {
    items: [
      {
        id: 'backend_session_token',
        storage: 'memory',
        description: 'Token de sessão na memória.',
      },
    ],
  },
  private_mode: {
    available: false,
    enabled: false,
    reason: 'Ainda não implementado no backend.',
  },
  audit: {
    available: false,
    reason: 'Registro de transmissões externas ainda não implementado.',
  },
};

const mockNullStatus = {
  schema_version: 'security.status.v1',
  checked_at: '2026-11-12T12:00:00Z',
  real_execution_allowed: false,
  blockers: [
    {
      code: 'uninspected_environment',
      severity: 'warning',
      message: 'Não foi possível inspecionar arquivos locais de configuração.',
    },
  ],
  processing: {
    local_only: null,
    workflow_executor_default: null,
    radar_executor: null,
    external_connections: [],
  },
  hermes: {
    connection: null,
    profile_found: null,
    profile_label: null,
    tools: null,
    memory: null,
    provider_configured: null,
    network_isolation: null,
    cost_limits: null,
  },
  credentials: {
    items: [
      {
        id: 'session_credential',
        storage: 'memory',
        protection: null,
      },
    ],
  },
  private_mode: {
    available: false,
    enabled: false,
    reason: 'Recurso indisponível.',
  },
  audit: {
    available: false,
    reason: 'Recurso indisponível.',
  },
};

test.describe('M2 · Tarefa 03 (HOR-126) — Interface de Privacidade e Segurança', () => {
  test('navegação por teclado até a seção Privacidade e Segurança', async ({ page }) => {
    await setupDefaultRoute(page, { securityStatus: mockInsecureStatus });
    await connectSession(page);

    // Foca na aba GERAL e usa tecla ArrowRight para navegar até PRIVACIDADE E SEGURANÇA
    const tabGeneral = page.getByRole('tab', { name: 'GERAL', exact: true });
    await expect(tabGeneral).toBeVisible();
    await tabGeneral.focus();
    await page.keyboard.press('ArrowRight');

    const tabPrivacy = page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true });
    await expect(tabPrivacy).toBeFocused();
    await expect(tabPrivacy).toHaveAttribute('aria-selected', 'true');

    // Confirma que o painel de Privacidade e Segurança está visível
    await expect(page.getByRole('region', { name: 'Privacidade e Segurança' })).toBeVisible();
    await expect(page.getByText('Diagnóstico de Integridade e Isolamento')).toBeVisible();
  });

  test('perfil inseguro: bloqueios críticos visíveis, ferramentas perigosas destacadas', async ({ page }) => {
    await setupDefaultRoute(page, { securityStatus: mockInsecureStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    // 1. Faixa de resumo: Execução real bloqueada
    const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Execução real do Hermes bloqueada');
    await expect(summary).toContainText('O QUE O HÓRUS BLOQUEIA');
    await expect(summary).toContainText('O envio de execuções reais ao Hermes, enquanto houver bloqueios críticos.');
    await expect(summary).toContainText('O QUE O PERFIL HERMES PERMITE');
    await expect(summary).toContainText('Perfil não restrito, com 7 ferramentas efetivas (3 de alto risco).');
    await expect(summary).toContainText('O bloqueio do Hórus não altera o perfil');
    await expect(summary.getByText('BLOQUEADO', { exact: true })).toBeVisible();

    // 2. Bloqueio crítico em destaque
    const criticalHighlight = page.getByRole('region', { name: 'Bloqueios críticos' });
    await expect(criticalHighlight).toBeVisible();
    await expect(criticalHighlight).toContainText('dangerous_tools_enabled');
    await expect(criticalHighlight).toContainText('O perfil horus permite terminal, arquivos e web pela API.');
    await expect(criticalHighlight.getByText('CRÍTICO', { exact: true })).toBeVisible();

    // 3. Ferramentas perigosas destacadas com badge PERIGOSA
    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection).toBeVisible();
    await expect(hermesSection).toContainText('NÃO RESTRITO');

    // Categorias de ferramentas
    await expect(hermesSection.getByRole('heading', { name: 'Comandos e processos' })).toBeVisible();
    await expect(hermesSection.getByRole('heading', { name: 'Arquivos' })).toBeVisible();
    await expect(hermesSection.getByRole('heading', { name: 'Web e navegador' })).toBeVisible();

    // Tags PERIGOSA associadas às ferramentas perigosas
    const dangerousBadges = hermesSection.locator('.tool-tag-item.dangerous');
    await expect(dangerousBadges).toHaveCount(3);
    await expect(dangerousBadges.filter({ hasText: 'terminal' })).toBeVisible();
    await expect(dangerousBadges.filter({ hasText: 'read_file' })).toBeVisible();
    await expect(dangerousBadges.filter({ hasText: 'web_search' })).toBeVisible();
  });

  test('perfil mínimo: restricted: true, sem perigosas, real_execution_allowed conforme payload', async ({
    page,
  }) => {
    await setupDefaultRoute(page, { securityStatus: mockMinimalStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    // Faixa de resumo: Execução real permitida
    const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Execução real do Hermes permitida');
    await expect(summary).toContainText('Nenhum bloqueio crítico informado');
    await expect(summary).toContainText('Perfil informado como restrito, com 1 ferramenta efetiva.');
    await expect(summary.getByText('ATIVO', { exact: true })).toBeVisible();

    // Restrito ativo
    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection.getByText('RESTRITO', { exact: true })).toBeVisible();

    // Sem ferramentas perigosas
    const dangerousBadges = hermesSection.locator('.tool-tag-item.dangerous');
    await expect(dangerousBadges).toHaveCount(0);
    await expect(page.getByText('PERIGOSA')).not.toBeVisible();
  });

  test('categorização precisa de ferramentas do Hermes (HOR-126 revisão 2)', async ({ page }) => {
    const categorizedToolsStatus = {
      ...mockMinimalStatus,
      hermes: {
        ...mockMinimalStatus.hermes,
        tools: {
          source: 'test_toolset',
          restricted: true,
          effective: [
            'execute_code',
            'browser_exec',
            'session_search',
            'image_generate',
            'vision_analyze',
            'memory',
            'todo_list',
            'skill_view',
            'skills_list',
            'skill_manage',
            'manage_connections',
            'terminal',
            'read_file',
            'unknown_custom_tool',
          ],
          dangerous: [],
          required_for_editorial: [],
        },
      },
    };

    await setupDefaultRoute(page, { securityStatus: categorizedToolsStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection).toBeVisible();
    await hermesSection.getByRole('button', { name: 'EXPANDIR TODAS' }).click();

    const getCategoryCard = (categoryName: string) =>
      hermesSection.locator('.tool-category-card').filter({
        has: page.getByRole('heading', { name: categoryName, exact: true }),
      });

    // 1. Execução de código: execute_code (não deve ir para Comandos e processos)
    const codeCard = getCategoryCard('Execução de código');
    await expect(codeCard.getByText('execute_code', { exact: true })).toBeVisible();

    // 2. Web e navegador: browser_exec (não deve ir para Comandos e processos)
    const webCard = getCategoryCard('Web e navegador');
    await expect(webCard.getByText('browser_exec', { exact: true })).toBeVisible();

    // 3. Memória: session_search (não deve ir para Web), memory, todo_list
    const memoryCard = getCategoryCard('Memória');
    await expect(memoryCard.getByText('session_search', { exact: true })).toBeVisible();
    await expect(memoryCard.getByText('memory', { exact: true })).toBeVisible();
    await expect(memoryCard.getByText('todo_list', { exact: true })).toBeVisible();

    // 4. Mídia: image_generate, vision_analyze (não são skills/conectores)
    const mediaCard = getCategoryCard('Mídia');
    await expect(mediaCard.getByText('image_generate', { exact: true })).toBeVisible();
    await expect(mediaCard.getByText('vision_analyze', { exact: true })).toBeVisible();

    // 5. Skills e conectores: skill_view, skills_list, skill_manage, manage_connections
    const skillsCard = getCategoryCard('Skills e conectores');
    await expect(skillsCard.getByText('skill_view', { exact: true })).toBeVisible();
    await expect(skillsCard.getByText('skills_list', { exact: true })).toBeVisible();
    await expect(skillsCard.getByText('skill_manage', { exact: true })).toBeVisible();
    await expect(skillsCard.getByText('manage_connections', { exact: true })).toBeVisible();

    // 6. Comandos e processos: terminal (não deve conter execute_code ou browser_exec)
    const cmdCard = getCategoryCard('Comandos e processos');
    await expect(cmdCard.getByText('terminal', { exact: true })).toBeVisible();
    await expect(cmdCard.getByText('execute_code')).not.toBeVisible();
    await expect(cmdCard.getByText('browser_exec')).not.toBeVisible();

    // 7. Arquivos: read_file
    const fileCard = getCategoryCard('Arquivos');
    await expect(fileCard.getByText('read_file', { exact: true })).toBeVisible();

    // 8. Outras: ferramentas desconhecidas nunca são omitidas
    const otherCard = getCategoryCard('Outras');
    await expect(otherCard.getByText('unknown_custom_tool', { exact: true })).toBeVisible();
  });

  test('campos null -> "Não verificado" com motivo e sem inferir proteção', async ({ page }) => {
    await setupDefaultRoute(page, { securityStatus: mockNullStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    // Múltiplos selos "NÃO VERIFICADO" visíveis
    const unverifiedBadges = page.locator('.unverified-badge-wrapper');
    await expect(unverifiedBadges.first()).toBeVisible();
    const count = await unverifiedBadges.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Nunca deve inferir proteção/segurança sem evidência
    await expect(page.getByText('Protegido')).not.toBeVisible();
  });

  test('Modo Privado, Auditoria e Consentimento marcados como "Não disponível" e sem controles ativos', async ({
    page,
  }) => {
    await setupDefaultRoute(page, { securityStatus: mockInsecureStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    // 1. Modo Privado
    const privateModeSection = page.getByRole('region', { name: 'Modo Privado' });
    await expect(privateModeSection).toBeVisible();
    await expect(privateModeSection.getByText('NÃO DISPONÍVEL').first()).toBeVisible();
    await expect(privateModeSection).toContainText('Ainda não implementado no backend.');
    // Sem controles interativos (switch, checkbox, button de alternância)
    await expect(privateModeSection.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(privateModeSection.locator('button')).toHaveCount(0);

    // 2. Auditoria
    const auditSection = page.getByRole('region', { name: 'Auditoria de Transmissões' });
    await expect(auditSection).toBeVisible();
    await expect(auditSection.getByText('NÃO DISPONÍVEL')).toBeVisible();
    await expect(auditSection).toContainText('Registro de transmissões externas ainda não implementado.');
    // Estrutura vazia
    await expect(auditSection.getByText('Nenhum evento registrado')).toBeVisible();
    await expect(auditSection.locator('button')).toHaveCount(0);

    // 3. Consentimento futuro em Serviços Externos
    const extServicesSection = page.getByRole('region', { name: 'Serviços Externos' });
    await expect(extServicesSection).toBeVisible();
    const consentArea = extServicesSection.locator('.consent-future-area');
    await expect(consentArea.getByText('NÃO DISPONÍVEL')).toBeVisible();
    await expect(consentArea.locator('input, button')).toHaveCount(0);
  });

  test('tratamento de erro 401, 500 e erro de rede', async ({ page }) => {
    let mode: '401' | '500' | 'network' = '401';

    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request();
      const pathUrl = new URL(request.url()).pathname;
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      if (pathUrl === '/health') {
        await route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ready' } });
        return;
      }
      if (pathUrl === '/v1/hermes') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { state: 'ready', connected: true, cli_available: true, configured: true, features: [] },
        });
        return;
      }
      if (pathUrl === '/v1/diagnostics') {
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { checks: [], notice: '' },
        });
        return;
      }
      if (pathUrl === '/v1/security/status') {
        if (mode === '401') {
          await route.fulfill({
            status: 401,
            headers: corsHeaders,
            json: { detail: 'Token de sessão inválido ou expirado.' },
          });
          return;
        }
        if (mode === '500') {
          await route.fulfill({
            status: 500,
            headers: corsHeaders,
            json: { detail: 'Falha interna ao verificar segurança.' },
          });
          return;
        }
        if (mode === 'network') {
          await route.abort('failed');
          return;
        }
      }
      await route.fulfill({ status: 200, headers: corsHeaders, json: {} });
    });

    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    // 401
    await expect(page.getByRole('alert')).toContainText('401');

    // 500
    mode = '500';
    await page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
    await expect(page.getByRole('alert')).toContainText('500');

    // network
    mode = 'network';
    await page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('rota 404 (backend antigo) exibe mensagem "Atualize o backend"', async ({ page }) => {
    await setupDefaultRoute(page, { securityCode: 404, securityDetail: 'Not Found' });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Atualize o backend');
  });

  test('"Verificar novamente" refaz a consulta GET', async ({ page }) => {
    let getSecurityCalls = 0;
    await setupDefaultRoute(page, {
      securityStatus: mockInsecureStatus,
      onSecurityCall: () => {
        getSecurityCalls++;
      },
    });

    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    await expect(page.getByText('Diagnóstico de Integridade e Isolamento')).toBeVisible();
    const initialCalls = getSecurityCalls;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    await page.getByRole('button', { name: /verificar novamente/i }).click();
    await expect.poll(() => getSecurityCalls).toBe(initialCalls + 1);
  });

  test('nenhum segredo renderizado mesmo com campos inesperados no payload', async ({ page }) => {
    await setupDefaultRoute(page, { securityStatus: mockInsecureStatus });
    await connectSession(page);
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();

    const credSection = page.getByRole('region', { name: 'Armazenamento de Credenciais' });
    await expect(credSection).toBeVisible();

    // Os metadados seguros aparecem
    await expect(credSection.getByText('backend_session_token')).toBeVisible();
    await expect(credSection.getByText('hermes_connection_key')).toBeVisible();

    // Nenhum segredo/token inesperado aparece na página
    const content = await page.content();
    expect(content).not.toContain('SECRET-LEAK-IF-RENDERED-001');
    expect(content).not.toContain('SUPER-SECRET-PASSWORD-002');
  });

  test('capturas visuais nos temas claro e escuro em 1320x840 e 1040x680 em artifacts/m2-privacy/', async ({
    page,
  }) => {
    await setupDefaultRoute(page, { securityStatus: mockInsecureStatus });
    await connectSession(page);
    await page.evaluate(() => document.fonts.ready);

    // 1. Escuro 1320x840
    await page.setViewportSize({ width: 1320, height: 840 });
    await page.getByRole('tab', { name: 'GERAL', exact: true }).click();
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
    await page.waitForTimeout(300);
    const shotDark1320 = path.join(artifactDir, 'privacy-dark-1320.png');
    await page.screenshot({ path: shotDark1320, fullPage: true });

    // 2. Claro 1320x840
    await page.getByRole('tab', { name: 'GERAL', exact: true }).click();
    await page.getByRole('button', { name: 'CLARO', exact: true }).click();
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
    await page.waitForTimeout(300);
    const shotLight1320 = path.join(artifactDir, 'privacy-light-1320.png');
    await page.screenshot({ path: shotLight1320, fullPage: true });

    // 3. Claro 1040x680
    await page.setViewportSize({ width: 1040, height: 680 });
    await page.waitForTimeout(300);
    const shotLight1040 = path.join(artifactDir, 'privacy-light-1040.png');
    await page.screenshot({ path: shotLight1040, fullPage: true });

    // 4. Escuro 1040x680
    await page.getByRole('tab', { name: 'GERAL', exact: true }).click();
    await page.getByRole('button', { name: 'ESCURO', exact: true }).click();
    await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
    await page.waitForTimeout(300);
    const shotDark1040 = path.join(artifactDir, 'privacy-dark-1040.png');
    await page.screenshot({ path: shotDark1040, fullPage: true });

    // Confirma que os arquivos foram criados
    expect(fs.existsSync(shotDark1320)).toBe(true);
    expect(fs.existsSync(shotLight1320)).toBe(true);
    expect(fs.existsSync(shotDark1040)).toBe(true);
    expect(fs.existsSync(shotLight1040)).toBe(true);
  });
});
