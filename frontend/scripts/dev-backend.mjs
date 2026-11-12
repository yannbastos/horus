import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { frontendConfig, localPath, port, root } from './worktree-config.mjs';

const frontend = frontendConfig();
if (!process.env.HORUS_API_TOKEN || process.env.HORUS_API_TOKEN.length < 24) {
  throw new Error('Defina HORUS_API_TOKEN com pelo menos 24 caracteres aleatórios');
}
const backendPort = port(process.env.HORUS_BACKEND_PORT, 8765, 'HORUS_BACKEND_PORT');
if (backendPort === frontend.port) throw new Error('Frontend e backend precisam de portas distintas');
const python = resolve(localPath('backend/.venv'), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const data = localPath(process.env.HORUS_DATA_DIR ?? 'backend/.cache/worktree-data');
const child = spawn(python, ['-m', 'horus_backend', '--port', String(backendPort)], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env, HORUS_DATA_DIR: data, HORUS_FRONTEND_ORIGIN: frontend.origin,
    HORUS_API_TOKEN: process.env.HORUS_API_TOKEN, HORUS_MANAGED: '0',
    HORUS_WORKFLOW_EXECUTOR: 'simulated', HORUS_RADAR_EXECUTOR: 'hermes_simulated',
    HORUS_HERMES_CONFIG: localPath('backend/.cache/worktree-data/integrations/hermes.json'),
    HORUS_HERMES_PROFILE: localPath('backend/.cache/worktree-data/hermes-profile'),
  },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
