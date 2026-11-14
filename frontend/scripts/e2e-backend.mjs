// Sobe o backend real em porta livre, com banco temporário isolado e Hermes simulado
// (nenhuma chamada externa), e opcionalmente executa a jornada E2E contra ele.
//   node scripts/e2e-backend.mjs serve   -> mantém o backend no ar e imprime a conexão
//   node scripts/e2e-backend.mjs run     -> sobe backend, roda a jornada Playwright, encerra
// Requisitos para o modo local_pilot real: HORUS_PILOT_FACTORY, HORUS_ALIGNMENT_MODEL,
// HORUS_FFMPEG; para a voz Kokoro: HORUS_KOKORO_PYTHON e HORUS_KOKORO_MODEL_DIR.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { root, localPath } from './worktree-config.mjs';

const mode = process.argv[2] ?? 'serve';
// HORUS_E2E_NO_OVERLAY=1 omite HORUS_FFMPEG (legenda embutida da fábrica, sem a fonte como asset).
const noOverlay = process.env.HORUS_E2E_NO_OVERLAY === '1';
const required = ['HORUS_PILOT_FACTORY', 'HORUS_ALIGNMENT_MODEL', ...(noOverlay ? [] : ['HORUS_FFMPEG'])];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Variáveis ausentes: ${missing.join(', ')}. Veja docs/piloto-local.md.`);
  process.exit(mode === 'run' && process.env.HORUS_E2E_STRICT !== '1' ? 0 : 2);
}

function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => ok(port)); });
  });
}

const backendPort = await freePort();
const frontendPort = Number(process.env.HORUS_FRONTEND_PORT ?? await freePort());
const token = randomBytes(24).toString('hex');
const data = mkdtempSync(join(tmpdir(), 'horus-e2e-'));
const python = resolve(localPath('backend/.venv'), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const origin = `http://127.0.0.1:${frontendPort}`;
const env = {
  ...process.env, ...(noOverlay ? { HORUS_FFMPEG: '' } : {}), HORUS_DATA_DIR: data, HORUS_FRONTEND_ORIGIN: origin, HORUS_API_TOKEN: token,
  HORUS_MANAGED: '0', HORUS_WORKFLOW_EXECUTOR: 'simulated', HORUS_RADAR_EXECUTOR: 'hermes_simulated',
  HORUS_HERMES_CONFIG: join(data, 'integrations', 'hermes.json'), HORUS_HERMES_PROFILE: join(data, 'hermes-profile'),
  HORUS_FRONTEND_PORT: String(frontendPort),
  // O backend descobre a fábrica por FABRICA_HOME; HORUS_PILOT_FACTORY é a variável dos ensaios.
  FABRICA_HOME: process.env.FABRICA_HOME ?? process.env.HORUS_PILOT_FACTORY,
};
const backend = spawn(python, ['-m', 'horus_backend', '--port', String(backendPort)], { cwd: root, env, stdio: 'inherit' });
backend.on('error', error => { console.error(error.message); process.exitCode = 1; });

async function ready() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/health`, { headers: { Authorization: `Bearer ${token}` } })).ok) return; } catch { /* aguardando */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw (new Error('Backend não respondeu em 60 s'));
}
function stop() {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' });
  else backend.kill('SIGTERM');
  setTimeout(() => { try { rmSync(data, { recursive: true, force: true }); } catch { /* arquivos em uso */ } }, 2000);
}
process.on('SIGINT', () => { stop(); process.exit(130); });

try { await ready(); } catch (error) { console.error(error.message ?? error); stop(); process.exit(1); }
const connection = { HORUS_E2E_BACKEND_URL: `http://127.0.0.1:${backendPort}`, HORUS_E2E_TOKEN: token, HORUS_FRONTEND_PORT: String(frontendPort) };
if (mode === 'serve') {
  console.log(JSON.stringify({ ...connection, data }));
} else {
  const cli = resolve(root, 'frontend/node_modules/@playwright/test/cli.js');
  const args = [cli, 'test', 'tests/e2e-production-journey.spec.ts', ...process.argv.slice(3)];
  const child = spawn(process.execPath, args, { cwd: resolve(root, 'frontend'), stdio: 'inherit', env: { ...env, ...connection } });
  child.on('exit', code => { stop(); process.exitCode = code ?? 1; });
}
