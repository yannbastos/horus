import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const artifactDir = path.resolve(repoRoot, 'artifacts/hor-126-privacy-null');
fs.mkdirSync(artifactDir, { recursive: true });

function getCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

type MockMode =
  | { kind: 'ok'; body: unknown }
  | { kind: 'http'; code: number; detail: string }
  | { kind: 'network' };

async function setupMockBackend(page: Page, baseURL: string | undefined, getMode: () => MockMode) {
  const configuredOrigin = baseURL ? new URL(baseURL).origin : '';
  await page.route('http://127.0.0.1:8765/**', async route => {
    const request = route.request();
    const corsHeaders = getCorsHeaders(
      request.headers()['origin'] || configuredOrigin || new URL(page.url()).origin
    );
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
        json: {
          state: 'unconfigured',
          connected: false,
          cli_available: false,
          configured: false,
          message: 'Conexão local do Hermes ainda não configurada.',
          checked_at: null,
          version: null,
          features: [],
        },
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
      const mode = getMode();
      if (mode.kind === 'network') {
        await route.abort('failed');
        return;
      }
      if (mode.kind === 'http') {
        await route.fulfill({
          status: mode.code,
          headers: corsHeaders,
          json: { detail: mode.detail },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: mode.body,
      });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, json: {} });
  });
}

async function connectAndOpenPrivacy(
  page: Page,
  baseUrl = 'http://127.0.0.1:8765',
  sessionToken = 'test-session-token-0123456789'
) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByLabel('Endereço local').fill(baseUrl);
  await page.getByLabel('Token da sessão').fill(sessionToken);
  await page.getByRole('button', { name: 'CONECTAR BACKEND', exact: true }).click();
  await expect(page.getByText('Backend local conectado.')).toBeVisible();
  await page.getByRole('tab', { name: 'PRIVACIDADE E SEGURANÇA', exact: true }).click();
}

/** Payload exato retornado por security_status() quando o perfil Hermes não existe em disco. */
const missingProfileBackendPayload = {
  schema_version: 'security.status.v1',
  checked_at: '2026-11-12T12:00:00Z',
  real_execution_allowed: false,
  blockers: [
    {
      code: 'profile_unverifiable',
      severity: 'critical',
      message: 'Perfil Hermes ausente, inválido ou fora do subconjunto verificável.',
    },
    {
      code: 'gateway_bind_unverified',
      severity: 'critical',
      message: 'Bind do gateway fora de loopback ou não verificável.',
    },
    {
      code: 'connection_not_configured',
      severity: 'critical',
      message: 'Conexão local do Hermes não configurada.',
    },
    {
      code: 'pricing_missing',
      severity: 'critical',
      message: 'Configure preços explícitos positivos de entrada e saída em USD por milhão de tokens.',
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
        target: null,
        enabled: false,
        purpose: 'Agente local Hermes',
      },
      {
        id: 'youtube_data_api',
        kind: 'external',
        target: 'googleapis.com',
        enabled: false,
        purpose: 'Coleta não conectada à API do aplicativo',
      },
    ],
  },
  hermes: {
    profile_found: false,
    connection: 'not_configured',
    profile_label: '%LOCALAPPDATA%/hermes/profiles/horus',
    tools: {
      source: 'unknown',
      restricted: null,
      effective: null,
      dangerous: null,
      required_for_editorial: [],
    },
    memory: {
      local_enabled: null,
      user_profile_enabled: null,
      write_approval: null,
      external_provider: null,
    },
    provider_configured: null,
    network_isolation: {
      enforced: false,
      mechanism: null,
      reason: 'Sem bloqueio de rede no nível do SO; gateway externo não é iniciado pelo Hórus.',
    },
    cost_limits: {
      configured: true,
      max_tokens_per_run: 16384,
      max_tokens_per_day: 32768,
      max_runs_per_day: 2,
      runs_configured: true,
      budget_total_usd: '5',
      budget_daily_usd: '1',
      budget_configured: true,
      pricing_configured: false,
      estimated_spent_total_usd: '0',
      estimated_spent_today_usd: '0',
      reserved_usd: '0',
      runs_today: 0,
    },
  },
  radar: {
    retention_days: 28,
    network_enabled: false,
    automatic_cleanup: {
      available: true,
      interval_hours: 6,
      last_run_at: '2026-11-12T11:55:00Z',
      last_status: 'ok',
      redacted_workflows: 0,
    },
  },
  credentials: {
    items: [
      {
        id: 'backend_session_token',
        storage: 'memory',
        description: 'Token de sessão mantido em memória.',
      },
      {
        id: 'hermes_connection_key',
        storage: 'local_file',
        protection: 'arquivo local; ACLs não auditadas; sem cifragem dedicada',
        location_label: '%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json',
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

test.describe('HOR-126 · Regressão de null/incompleto em Privacidade e Segurança', () => {
  test('sem perfil Hermes (effective/dangerous null): não quebra, exibe perfil não configurado e não converte desconhecido em seguro', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', err => pageErrors.push(err));

    await setupMockBackend(page, baseURL, () => ({ kind: 'ok', body: missingProfileBackendPayload }));
    await connectAndOpenPrivacy(page);

    expect(pageErrors).toEqual([]);

    // 1. Faixa de resumo: bloqueado e ferramentas não verificadas (nunca "0 ferramentas efetivas")
    const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Execução real do Hermes bloqueada');
    await expect(summary.getByText('BLOQUEADO', { exact: true })).toBeVisible();
    await expect(summary).toContainText(
      'Não verificado: o diagnóstico não inspecionou as ferramentas do perfil.'
    );
    await expect(summary).not.toContainText('0 ferramentas efetivas');
    await expect(summary).not.toContainText('informado como restrito');

    // 2. Seção Permissões do Hermes: exibe perfil não configurado e não afirma 0 ferramentas
    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection).toBeVisible();
    await expect(hermesSection.getByText('NÃO CONFIGURADA', { exact: true })).toBeVisible();
    await expect(hermesSection.getByText('NÃO LOCALIZADO', { exact: true })).toBeVisible();
    await expect(hermesSection).toContainText('Perfil Hermes não configurado');
    await expect(hermesSection).toContainText('%LOCALAPPDATA%/hermes/profiles/horus');
    await expect(hermesSection).toContainText(
      'Perfil Hermes não configurado; conjunto de ferramentas não inspecionado.'
    );
    await expect(hermesSection.getByTestId('tools-total')).toHaveCount(0);
    await expect(
      hermesSection.getByText('O diagnóstico não lista nenhuma ferramenta efetiva.')
    ).toHaveCount(0);
    await expect(hermesSection.locator('code', { hasText: /^unknown$/ })).toHaveCount(0);
    await expect(hermesSection.getByText('RESTRITO', { exact: true })).toHaveCount(0);

    // 3. Seção Memória do Agente: não exibe "NENHUM INFORMADO" (verde) quando a memória não foi inspecionada
    const memorySection = page.getByRole('region', { name: 'Memória do Agente' });
    await expect(memorySection).toBeVisible();
    await expect(memorySection.getByText('NENHUM INFORMADO')).toHaveCount(0);
    await expect(memorySection.locator('.unverified-badge-wrapper')).toHaveCount(4);

    // 4. Tabela de conexões: target null renderiza "Não configurado"
    const privacySection = page.getByRole('region', { name: 'Estado da Privacidade' });
    await expect(privacySection.getByRole('table', { name: 'Tabela de conexões' })).toContainText(
      'Não configurado'
    );
  });

  test('respostas parciais/incompletas: dangerous null com effective preenchido e payload vazio nunca inferem segurança', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', err => pageErrors.push(err));

    const partialDangerousNull = {
      ...missingProfileBackendPayload,
      hermes: {
        ...missingProfileBackendPayload.hermes,
        profile_found: true,
        connection: 'loopback',
        tools: {
          source: 'platform_toolsets.api_server',
          // Mesmo que um payload inconsistente traga restricted: true, dangerous: null impede declarar RESTRITO.
          restricted: true,
          effective: ['terminal', 'read_file'],
          dangerous: null,
          required_for_editorial: null,
        },
      },
    };

    let currentBody: unknown = partialDangerousNull;
    await setupMockBackend(page, baseURL, () => ({ kind: 'ok', body: currentBody }));
    await connectAndOpenPrivacy(page);

    expect(pageErrors).toEqual([]);

    const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
    await expect(summary).not.toContainText('informado como restrito');
    await expect(summary).toContainText(
      'Restrição do perfil não informada; 2 ferramentas efetivas listadas abaixo.'
    );

    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection.getByText('RESTRITO', { exact: true })).toHaveCount(0);
    await expect(hermesSection).toContainText(
      'Classificação de ferramentas de alto risco não informada.'
    );
    await expect(hermesSection.getByTestId('tools-total')).toContainText(
      '2 ferramentas em 2 categorias'
    );

    // Agora simula resposta JSON incompleta `{}` e verifica que todas as seções caem em NÃO VERIFICADO / BLOQUEADO
    currentBody = {};
    await page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();

    expect(pageErrors).toEqual([]);
    await expect(summary).toContainText('Execução real do Hermes bloqueada');
    await expect(summary.getByText('BLOQUEADO', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Estado da Privacidade' }).locator('.unverified-badge-wrapper')
    ).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Permissões do Hermes' }).locator('.unverified-badge-wrapper')
    ).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Memória do Agente' }).locator('.unverified-badge-wrapper')
    ).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Serviços Externos' }).locator('.unverified-badge-wrapper')
    ).toHaveCount(1);
    await expect(
      page
        .getByRole('region', { name: 'Armazenamento de Credenciais' })
        .locator('.unverified-badge-wrapper')
    ).toHaveCount(1);
    await expect(page.getByText('Nenhuma conexão externa configurada.')).toHaveCount(0);
    await expect(page.getByText('Nenhuma credencial catalogada.')).toHaveCount(0);
  });

  test('transição de perfil ausente para perfil presente e preservação de HTTP 401 e falha de API', async ({
    page,
    baseURL,
  }) => {
    const presentProfilePayload = {
      ...missingProfileBackendPayload,
      hermes: {
        ...missingProfileBackendPayload.hermes,
        profile_found: true,
        connection: 'loopback',
        tools: {
          source: 'platform_toolsets.api_server',
          restricted: false,
          effective: ['terminal', 'read_file'],
          dangerous: ['terminal'],
          required_for_editorial: [],
        },
        memory: {
          local_enabled: false,
          user_profile_enabled: false,
          write_approval: true,
          external_provider: null,
        },
      },
    };

    let mode: MockMode = { kind: 'ok', body: missingProfileBackendPayload };
    await setupMockBackend(page, baseURL, () => mode);
    await connectAndOpenPrivacy(page);

    const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
    await expect(hermesSection).toContainText('Perfil Hermes não configurado');

    // Transição para perfil presente sem desmontar o componente
    mode = { kind: 'ok', body: presentProfilePayload };
    await page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();

    await expect(hermesSection.getByText('LOCALIZADO', { exact: true })).toBeVisible();
    await expect(hermesSection.getByText('NÃO RESTRITO', { exact: true })).toBeVisible();
    await expect(hermesSection.getByTestId('tools-total')).toContainText(
      '2 ferramentas em 2 categorias · 1 de alto risco'
    );
    // Categoria com ferramenta perigosa abre automaticamente mesmo após transição de effective=null
    await expect(
      hermesSection.getByRole('button', { name: 'Comandos e processos' })
    ).toHaveAttribute('aria-expanded', 'true');
    // Memória inspecionada agora exibe NENHUM INFORMADO para external_provider=null
    await expect(
      page.getByRole('region', { name: 'Memória do Agente' }).getByText('NENHUM INFORMADO')
    ).toBeVisible();

    // Preserva erro HTTP 401 sem mascarar como status vazio
    mode = { kind: 'http', code: 401, detail: 'Autenticação local necessária.' };
    await page.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('O backend recusou o token da sessão.');
    await expect(alert).toContainText('401');
    await expect(hermesSection).toHaveCount(0);

    // Preserva falha de rede sem mascarar erro
    mode = { kind: 'network' };
    await alert.getByRole('button', { name: 'VERIFICAR NOVAMENTE' }).click();
    await expect(alert).toContainText('Não foi possível alcançar o backend local.');
  });

  test('integração real contra API local (porta dinâmica 127.0.0.1:0) sem perfil Hermes configurado + captura visual', async ({
    page,
    baseURL,
  }) => {
    const pythonRel = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const pythonExe = path.resolve(repoRoot, 'backend/.venv', pythonRel);
    if (!fs.existsSync(pythonExe)) {
      throw new Error(
        `Interpretador Python do backend ausente em ${pythonExe}. Execute "uv sync --directory backend --frozen" antes de rodar os testes.`
      );
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horus-hor126-'));
    const ephemeralToken = crypto.randomUUID() + crypto.randomUUID();
    const configuredOrigin = baseURL ? new URL(baseURL).origin : 'http://127.0.0.1:1431';

    const pyScript = [
      'import json, os, pathlib, socket, uvicorn',
      'from horus_backend.api import create_app',
      'from horus_backend.config import Settings',
      'tmp = pathlib.Path(os.environ["HORUS_TEST_TMP"])',
      'origin = os.environ["HORUS_TEST_ORIGIN"]',
      'settings = Settings(',
      '    token=os.environ["HORUS_API_TOKEN"],',
      '    data_dir=tmp / "data",',
      '    factory_root=None,',
      '    hermes_executable=None,',
      '    hermes_profile=tmp / "missing-hermes-profile",',
      '    hermes_config=tmp / "missing-hermes.json",',
      '    workflow_executor="simulated",',
      '    radar_executor="hermes_simulated",',
      '    origins=(origin,),',
      ')',
      'sock = socket.socket()',
      'sock.bind(("127.0.0.1", 0))',
      'sock.listen(64)',
      'port = sock.getsockname()[1]',
      'app = create_app(settings, ready=lambda: print(json.dumps({"event": "ready", "port": port}), flush=True))',
      'server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", access_log=False))',
      'server.run(sockets=[sock])',
    ].join('\n');

    const child = spawn(pythonExe, ['-c', pyScript], {
      cwd: path.resolve(repoRoot, 'backend'),
      env: {
        ...process.env,
        HORUS_TEST_TMP: tmpDir,
        HORUS_API_TOKEN: ephemeralToken,
        HORUS_TEST_ORIGIN: configuredOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const backendPort = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout aguardando prontidão do backend em 127.0.0.1:0')),
          10000
        );
        let stdoutBuf = '';
        let stderr = '';
        child.stderr.on('data', chunk => {
          stderr += String(chunk);
        });
        child.stdout.on('data', chunk => {
          stdoutBuf += String(chunk);
          const lines = stdoutBuf.split(/\r?\n/);
          stdoutBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as { event?: string; port?: number };
              if (msg.event === 'ready' && typeof msg.port === 'number' && msg.port > 0) {
                clearTimeout(timer);
                resolve(msg.port);
                return;
              }
            } catch {
              // Ignora linhas que não sejam o JSON de prontidão
            }
          }
        });
        child.once('exit', code => {
          clearTimeout(timer);
          reject(new Error(`Backend encerrou prematuramente (${code}): ${stderr}`));
        });
      });

      const pageErrors: Error[] = [];
      page.on('pageerror', err => pageErrors.push(err));

      await page.setViewportSize({ width: 1320, height: 840 });
      await connectAndOpenPrivacy(page, `http://127.0.0.1:${backendPort}`, ephemeralToken);

      expect(pageErrors).toEqual([]);

      const summary = page.getByRole('status', { name: 'Resumo de execução e segurança' });
      await expect(summary).toBeVisible();
      await expect(summary).toContainText('Execução real do Hermes bloqueada');
      await expect(summary).toContainText(
        'Não verificado: o diagnóstico não inspecionou as ferramentas do perfil.'
      );

      const hermesSection = page.getByRole('region', { name: 'Permissões do Hermes' });
      await expect(hermesSection).toBeVisible();
      await expect(hermesSection.getByText('NÃO CONFIGURADA', { exact: true })).toBeVisible();
      await expect(hermesSection.getByText('NÃO LOCALIZADO', { exact: true })).toBeVisible();
      await expect(hermesSection).toContainText('Perfil Hermes não configurado');
      await expect(hermesSection).toContainText(
        'Perfil Hermes não configurado; conjunto de ferramentas não inspecionado.'
      );
      await expect(hermesSection).toContainText('profile_unverifiable');

      const memorySection = page.getByRole('region', { name: 'Memória do Agente' });
      await expect(memorySection.getByText('NENHUM INFORMADO')).toHaveCount(0);
      await expect(memorySection.locator('.unverified-badge-wrapper')).toHaveCount(4);

      await page.evaluate(() => document.fonts.ready);
      const fullShot = path.join(artifactDir, 'privacy-real-no-profile-dark-1320.png');
      const hermesShot = path.join(artifactDir, 'privacy-real-no-profile-hermes-card.png');
      await page.screenshot({ path: fullShot, fullPage: true });
      await hermesSection.screenshot({ path: hermesShot });

      expect(fs.existsSync(fullShot)).toBe(true);
      expect(fs.existsSync(hermesShot)).toBe(true);
    } finally {
      child.kill();
      await new Promise(resolve => child.once('close', resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
