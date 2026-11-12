import { frontendConfig, localPath } from './worktree-config.mjs';
frontendConfig();
for (const path of ['backend/.venv', 'backend/.cache', 'backend/dist']) localPath(path);
console.log('Diretórios locais verificados; nenhum link compartilhado nos destinos de execução.');
