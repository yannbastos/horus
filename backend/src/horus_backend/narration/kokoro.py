"""Adaptador offline: pesos fixados; motor carregado somente no Python externo."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import tempfile
import wave

from ..processes import OwnedProcess
from .providers import LocalProvider, NarrationError, voice

# docs/avaliacao-vozes.md, seção 6.1; revisão f3ff3571791e39611d31c381e3a41a3af07b4987.
HASHES = {
    'kokoro-v1_0.pth': '496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4',
    'config.json': '5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f',
    'voices/pf_dora.pt': '07e4ff987c5d5a8c3995efd15cc4f0db7c4c15e881b198d8ab7f67ecf51f5eb7',
    'voices/pm_alex.pt': 'cf0ba8c573c2480fc54123683a35cf1e2ae130428e441eb91f9149bdb188a526',
    'voices/pm_santa.pt': 'd42103169c5c872abbafb9129133af7e942bb9d272c3cc3b95c203e7d7198c29',
}
NOTES = ('Pesos Apache-2.0; treino inclui áudio sintético de TTS proprietários e dados CC BY. '
         'Direitos comerciais do áudio não verificados; espeak-ng GPL somente no processo externo.')


class Kokoro(LocalProvider):
    id, name = 'kokoro', 'Kokoro-82M'
    license = {'name': 'Apache-2.0', 'url': 'https://huggingface.co/hexgrad/Kokoro-82M', 'notes': NOTES}
    timeout = 120

    def __init__(self, python, model_dir):
        self.python = Path(python).resolve() if python else None
        self.model_dir = Path(model_dir).resolve() if model_dir else None

    def verify(self):
        if not self.python or not self.model_dir:
            return False
        if not self.python.is_file() or not self.model_dir.is_dir():
            raise NarrationError('kokoro_configuration_invalid')
        for relative, expected in HASHES.items():
            path = self.model_dir / relative
            try:
                if path.is_symlink() or not path.resolve().is_relative_to(self.model_dir):
                    raise NarrationError('kokoro_artifact_invalid')
                with path.open('rb') as stream:
                    actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            except OSError:
                raise NarrationError('kokoro_artifact_missing') from None
            if actual != expected:
                raise NarrationError('kokoro_hash_mismatch:' + relative)
        return True

    def voices(self):
        if not self.verify(): return []
        result = []
        for ident in ('pf_dora', 'pm_alex', 'pm_santa'):
            item = voice(ident, ident, 'pt-BR')
            item['license'] = dict(self.license)
            item['notes'] = NOTES
            result.append(item)
        return result

    def status(self):
        result = super().status()
        if result['status'] == 'blocked':
            try: self.verify()
            except NarrationError as error: result['reason'] = error.code
        return result

    async def synthesize_async(self, text, voice_id, output):
        if voice_id not in {v['id'] for v in self.voices()}:
            raise NarrationError('voice_not_found', 422)
        output = Path(output).resolve()
        env = {k: v for k, v in os.environ.items() if k.upper() in
               {'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
        env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                   DO_NOT_TRACK='1', PYTHONUTF8='1')
        # OwnedProcess usa stdin fechado: somente arquivos JSON/WAV atravessam a fronteira.
        with tempfile.TemporaryDirectory(prefix='horus-kokoro-') as folder:
            request = Path(folder) / 'request.json'
            request.write_text(json.dumps({'text': text, 'voice_id': voice_id,
                'output': str(output), 'model_dir': str(self.model_dir)}), encoding='utf-8')
            owned = None
            valid = False
            try:
                owned = await OwnedProcess.start([str(self.python), '-I',
                    str(Path(__file__).with_name('kokoro_worker.py')), str(request)], env=env, cwd=folder)
                await asyncio.wait_for(owned.process.communicate(), timeout=self.timeout)
                if owned.process.returncode:
                    raise NarrationError('kokoro_synthesis_failed')
                self.verify()
                if output.is_symlink() or not output.is_file() or output.stat().st_size > 200_000_000:
                    raise NarrationError('kokoro_invalid_wav')
                try:
                    with wave.open(str(output), 'rb') as wav:
                        frames = wav.getnframes()
                        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 24000, 'NONE') or frames <= 0:
                            raise ValueError()
                        if len(wav.readframes(frames)) != frames * 2: raise ValueError()
                except (OSError, EOFError, wave.Error, ValueError):
                    raise NarrationError('kokoro_invalid_wav') from None
                valid = True
            except TimeoutError:
                raise NarrationError('kokoro_timeout', 504) from None
            finally:
                if owned:
                    await owned.stop()
                    owned.close()
                if not valid:
                    output.unlink(missing_ok=True)
        return {'speech_aligned': False, 'publishable': False, 'demo_only': True,
                'model': {'id': voice_id, 'version': 'kokoro-0.9.4/v1.0;config=' + HASHES['config.json'] +
                          ';voice=' + HASHES['voices/' + voice_id + '.pt'],
                          'sha256': HASHES['kokoro-v1_0.pth']}}

    def synthesize(self, text, voice_id, output, authorization=None):
        return asyncio.run(self.synthesize_async(text, voice_id, output))
