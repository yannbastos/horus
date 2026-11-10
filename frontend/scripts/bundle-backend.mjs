import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const backend = fileURLToPath(new URL('../../backend', import.meta.url));
const python = process.env.HORUS_PYTHON || resolve(backend, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(python)) {
  throw new Error('Prepare backend/.venv com o extra bundle antes de gerar o instalador.');
}
const result = spawnSync(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
  '--name', 'horus-backend', '--distpath', 'dist', '--workpath', 'build/work', '--specpath', 'build',
  '--paths', 'src', '--collect-submodules', 'uvicorn', '--collect-submodules', 'horus_backend',
  // Transcrição roda no mesmo executável (subcomando "transcribe"/"download"); bibliotecas nativas e assets inclusos.
  '--collect-all', 'faster_whisper', '--collect-all', 'ctranslate2', '--collect-all', 'av',
  '--collect-all', 'tokenizers', '--collect-submodules', 'yt_dlp', '--collect-submodules', 'huggingface_hub',
  'launcher.py'],
{ cwd: backend, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
