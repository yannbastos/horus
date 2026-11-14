from __future__ import annotations
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Protocol
from ..processes import failure_detail

# Registro de origens dos motores locais; novos adaptadores declaram aqui sua origem.
PRODUCTION_ORIGINS = {'windows_sapi': 'system_voice', 'piper': 'local_tts_model', 'kokoro': 'local_tts_model'}


class NarrationError(Exception):
    def __init__(self, code, status=503, *, detail=None):
        self.code, self.status = code, status
        self.detail = detail or failure_detail(code, 'narration')
        self.message = ('Narração indisponível (' + code + '); confira a voz, os modelos e o executável em Ajustes antes de tentar novamente.')
        super().__init__(code)


class NarrationProvider(Protocol):
    id: str
    def status(self) -> dict: ...
    def voices(self) -> list[dict]: ...
    def estimate(self, text: str) -> dict: ...
    def preview(self, text: str, voice_id: str, output: Path, authorization=None) -> dict: ...
    def synthesize(self, text: str, voice_id: str, output: Path, authorization=None) -> dict: ...


def voice(ident, name, language, preview='local'):
    return dict(id=ident, name=name, language=language, license={'name': 'unknown', 'url': None},
                commercial_use='unknown', preview=preview)


def run(command, payload=None, text=None):
    env = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    env['PYTHONUTF8'] = '1'
    env['PYTHONPATH'] = str(Path(__file__).resolve().parents[2])
    started = time.monotonic()
    try:
        return subprocess.run(command, input=json.dumps(payload) if payload else text,
                              capture_output=True, text=True, encoding='utf-8', env=env, timeout=60, check=True).stdout
    except (OSError, subprocess.SubprocessError) as error:
        private = [text] if text else []
        if payload:
            private += [payload.get('text')]
        detail = failure_detail('local_narration_failed', 'narration', started=started, error=error, private=private)
        detail['reason'] = ('timeout' if isinstance(error, subprocess.TimeoutExpired) else
                            'executable_unavailable' if isinstance(error, OSError) else 'nonzero_exit')
        raise NarrationError('local_narration_failed', detail=detail) from None


class LocalProvider:
    kind = 'local'
    def estimate(self, text):
        return {'characters': len(text), 'cost': {'amount': None, 'currency': None, 'basis': 'characters', 'source': 'unknown'},
                'credits': {'required': None, 'available': None, 'source': 'not_checked'}, 'requires_authorization': False}

    def status(self):
        try:
            voices = self.voices()
            status = 'available' if voices else 'not_installed'
        except NarrationError:
            voices, status = [], 'blocked'
        return dict(id=self.id, name=self.name, kind=self.kind, status=status, reason=status,
                    engine_license=self.license, voices=voices, native_word_timestamps=False, requires_authorization=False)

    def preview(self, text, voice_id, output, authorization=None):
        return self.synthesize(text, voice_id, output, authorization)


class WindowsSapi(LocalProvider):
    id, name = 'windows_sapi', 'Windows SAPI'
    license = {'name': 'Microsoft Windows', 'url': 'https://www.microsoft.com/useterms', 'notes': 'Licença da voz deve ser verificada separadamente.'}
    def voices(self):
        if sys.platform != 'win32': return []
        try:
            items = json.loads(run([sys.executable, '-m', 'horus_backend.narration.sapi_worker'], {'action': 'voices'}))
            return [voice(v['id'], v['name'], v['language']) for v in items]
        except (ValueError, KeyError, TypeError):
            raise NarrationError('local_narration_failed') from None
    def synthesize(self, text, voice_id, output, authorization=None):
        if voice_id not in {v['id'] for v in self.voices()}: raise NarrationError('voice_not_found', 422)
        run([sys.executable, '-m', 'horus_backend.narration.sapi_worker'],
            {'action': 'synthesize', 'text': text, 'voice_id': voice_id, 'output': str(output)})
        return {'speech_aligned': False, 'publishable': False, 'demo_only': True}


class Piper(LocalProvider):
    id, name = 'piper', 'Piper'
    license = {'name': 'GPL-3.0', 'url': 'https://github.com/OHF-Voice/piper1-gpl', 'notes': 'Executável externo; cada modelo possui licença própria.'}
    def __init__(self, executable, models):
        self.executable, self.models = executable, models
    def voices(self):
        if not self.executable or not Path(self.executable).is_file() or not self.models or not Path(self.models).is_dir(): return []
        return [voice(p.name, p.stem, 'und') for p in sorted(Path(self.models).glob('*.onnx'))
                if p.with_suffix('.onnx.json').is_file() and not p.is_symlink()]
    def synthesize(self, text, voice_id, output, authorization=None):
        if voice_id not in {v['id'] for v in self.voices()}: raise NarrationError('voice_not_found', 422)
        root = Path(self.models).resolve()
        model = (root / voice_id).resolve()
        if not model.is_relative_to(root): raise NarrationError('voice_not_found', 422)
        import hashlib
        with model.open('rb') as stream:
            model_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        run([str(self.executable), '--model', str(model), '--output_file', str(output)], text=text)
        with model.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != model_hash:
                raise NarrationError('narration_model_changed')
        return {'speech_aligned': False, 'publishable': False, 'demo_only': True,
                'model': {'id': voice_id, 'sha256': model_hash, 'version': 'sha256:' + model_hash}}


class ElevenLabs(LocalProvider):
    id, name, kind = 'elevenlabs', 'ElevenLabs', 'paid_api'
    license = {'name': 'Proprietary', 'url': 'https://elevenlabs.io/terms-of-use', 'notes': 'Plano não consultado; licença comercial unknown.'}
    def __init__(self, settings, credentials, transport=None):
        self.settings, self.credentials, self.transport = settings, credentials, transport
    def voices(self): return []  # Nenhuma consulta remota na descoberta.
    def status(self):
        result = super().status()
        status = 'disabled'
        if self.settings.narration_paid_enabled:
            try:
                status = 'blocked' if self.credentials.get() else 'not_configured'
            except NarrationError:
                status = 'blocked'
        result.update(status=status,
                      reason='paid_generation_authorization_flow_disabled', requires_authorization=True,
                      native_word_timestamps=True)
        return result
    def estimate(self, text):
        result = super().estimate(text)
        result['requires_authorization'] = True
        price, currency = self.settings.elevenlabs_price_per_1k_chars, self.settings.elevenlabs_currency
        if price is not None and currency and len(currency) == 3 and currency.isalpha():
            result['cost'].update(amount=float(price * len(text) / 1000), currency=currency.upper(), source='configured_price')
        return result
    def synthesize(self, text, voice_id, output, authorization=None):
        # A autorização é interna e vinculada ao pedido; a API não aceita esse campo.
        import hashlib
        expected = {'text_sha256': hashlib.sha256(text.encode()).hexdigest(), 'voice_id': voice_id,
                    'estimated_cost': self.estimate(text)['cost'], 'confirmed': True}
        if not self.settings.narration_paid_enabled or authorization != expected:
            raise NarrationError('paid_provider_not_authorized', 403)
        key = self.credentials.get()
        if not key: raise NarrationError('paid_provider_not_authorized', 403)
        if self.transport is None: raise NarrationError('paid_provider_not_authorized', 403)
        try:
            result = self.transport.synthesize(key=key, text=text, voice_id=voice_id, output=output)
        except TimeoutError: raise NarrationError('provider_timeout', 504) from None
        except Exception as error:
            status = getattr(error, 'status_code', None)
            raise NarrationError({401: 'provider_credential_rejected', 429: 'provider_quota_exceeded'}.get(status, 'provider_failed'), 502) from None
        return {'speech_aligned': False, 'publishable': False, 'demo_only': True,
                'license': 'unknown', 'credits': {'required': result.get('credits'), 'available': None, 'source': 'mock'}}
