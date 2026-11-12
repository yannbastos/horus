import { lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function port(value, fallback, name) {
  const raw = value ?? String(fallback);
  if (!/^[0-9]{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new Error(`${name}: informe uma porta inteira entre 1 e 65535`);
  }
  return Number(raw);
}

// Recusa junctions/symlinks nos diretórios graváveis, inclusive nos ancestrais.
export function localPath(path) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`Diretório deve pertencer a este worktree: ${target}`);
  }
  let current = target;
  while (current !== root) {
    try {
      if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) {
        throw new Error(`Link compartilhado recusado: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
  return target;
}

export function frontendConfig(env = process.env) {
  const frontendPort = port(env.HORUS_FRONTEND_PORT, 1420, 'HORUS_FRONTEND_PORT');
  for (const path of ['frontend/node_modules', 'frontend/dist', 'frontend/test-results', 'frontend/playwright-report', 'artifacts']) localPath(path);
  return { port: frontendPort, origin: `http://127.0.0.1:${frontendPort}` };
}
