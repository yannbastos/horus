from __future__ import annotations
import json
import os
import tempfile
import threading
import time
import uuid
import wave
from pathlib import Path
import keyring
from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator
from starlette.background import BackgroundTask
from .providers import WindowsSapi, Piper, ElevenLabs, NarrationError

from .kokoro import Kokoro

DEFAULT_TEXT = 'Esta é uma frase fictícia para testar a voz de narração.'


class Credentials:
    def __init__(self, workspace):
        import hashlib
        self.account = hashlib.sha256(str(workspace.resolve()).encode()).hexdigest()
    def get(self):
        try: return keyring.get_password('horus.narration.elevenlabs', self.account)
        except Exception: raise NarrationError('credential_store_unavailable') from None
    def put(self, key):
        try: keyring.set_password('horus.narration.elevenlabs', self.account, key)
        except Exception: raise NarrationError('credential_store_unavailable') from None
    def delete(self):
        try:
            if self.get() is not None: keyring.delete_password('horus.narration.elevenlabs', self.account)
        except Exception: raise NarrationError('credential_store_unavailable') from None


class EstimateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: str = Field(max_length=80)
    voice_id: str = Field(max_length=1000)
    model_id: str | None = Field(default=None, max_length=100)
    text: str | None = Field(default=None, max_length=1000000)
    script_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    script_version: int | None = Field(default=None, ge=1)
    @model_validator(mode='after')
    def source(self):
        if (self.text is None) == (self.script_id is None): raise ValueError('Escolha texto ou roteiro.')
        if self.script_id is not None and self.script_version is None: raise ValueError('Versão necessária.')
        if self.text is not None and self.script_version is not None: raise ValueError('Versão sem roteiro.')
        return self


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: str = Field(max_length=80)
    voice_id: str = Field(max_length=1000)
    text: str = Field(default=DEFAULT_TEXT, min_length=1, max_length=300)


class Preference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: str = Field(max_length=80)
    voice_id: str = Field(max_length=1000)


class CredentialRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: SecretStr = Field(min_length=1, max_length=4096)


def provider_registry(settings):
    credentials = Credentials(settings.data_dir)
    return {p.id: p for p in (WindowsSapi(), Piper(settings.piper_executable, settings.piper_models),
                              Kokoro(getattr(settings, "kokoro_python", None), getattr(settings, "kokoro_model_dir", None)),
                              ElevenLabs(settings, credentials))}


class NarrationService:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.credentials = Credentials(settings.data_dir)
        self.providers = provider_registry(settings)
        self.preference = settings.data_dir / 'narration-preference.json'
        self.previews = {}
        self.lock = threading.Lock()

    def provider(self, ident):
        if ident not in self.providers: raise NarrationError('provider_not_found', 404)
        return self.providers[ident]

    def estimate(self, request):
        provider = self.provider(request.provider)
        text = request.text
        if text is None:
            from ..production import ProductionService
            from ..workflows import WorkflowConflict
            try:
                with self.store.connect() as db:
                    _, document = ProductionService.approved(db, request.script_id, request.script_version)
                text = '\n'.join(section['narration'] for section in document['sections'])
            except KeyError: raise NarrationError('script_not_found', 404) from None
            except (WorkflowConflict, ValueError): raise NarrationError('approved_script_required', 409) from None
        return provider.estimate(text)

    def save_preference(self, request):
        provider = self.provider(request.provider)
        if request.voice_id not in {v['id'] for v in provider.voices()}: raise NarrationError('voice_not_found', 422)
        self.preference.parent.mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(dir=self.preference.parent, prefix='.narration-', suffix='.json')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as file: json.dump(request.model_dump(), file)
            os.replace(path, self.preference)
        finally: Path(path).unlink(missing_ok=True)
        return request.model_dump()

    def remove_preview(self, ident):
        with self.lock: item = self.previews.pop(ident, None)
        if item: item[0].cleanup()

    def close(self):
        for ident in list(self.previews): self.remove_preview(ident)

    def preview(self, request):
        provider = self.provider(request.provider)
        if provider.kind == 'paid_api': raise NarrationError('paid_provider_not_authorized', 403)
        temp = tempfile.TemporaryDirectory(prefix='horus-narration-')
        output = Path(temp.name) / 'preview.wav'
        try:
            provider.preview(request.text, request.voice_id, output)
            if output.is_symlink() or not output.is_file() or output.stat().st_size > 20_000_000:
                raise NarrationError('invalid_preview')
            with wave.open(str(output), 'rb') as wav:
                if wav.getnframes() <= 0: raise NarrationError('invalid_preview')
            ident = uuid.uuid4().hex
            with self.lock: self.previews[ident] = (temp, output, time.monotonic() + 300)
            timer = threading.Timer(300, self.remove_preview, args=(ident,)); timer.daemon = True; timer.start()
            return {'id': ident, 'url': f'/v1/narration/previews/{ident}', 'expires_in_seconds': 300}
        except NarrationError:
            temp.cleanup(); raise
        except Exception:
            temp.cleanup(); raise NarrationError('invalid_preview') from None


def narration_router(service):
    router = APIRouter(prefix='/v1/narration')
    def call(action):
        try: return action()
        except NarrationError as error:
            if error.code == 'paid_provider_not_authorized':
                return JSONResponse({'code': error.code}, status_code=error.status)
            return JSONResponse({'code': error.code, 'message': error.message, 'failure': error.detail}, status_code=error.status)
    @router.get('/providers')
    def providers(): return call(lambda: [p.status() for p in service.providers.values()])
    @router.post('/estimate')
    def estimate(request: EstimateRequest): return call(lambda: service.estimate(request))
    @router.post('/preview')
    def preview(request: PreviewRequest): return call(lambda: service.preview(request))
    @router.put('/providers/elevenlabs/credential')
    def credential(request: CredentialRequest):
        def save():
            service.credentials.put(request.key.get_secret_value()); return {'configured': True}
        return call(save)
    @router.delete('/providers/elevenlabs/credential')
    def delete_credential():
        def delete():
            service.credentials.delete(); return {'configured': False}
        return call(delete)
    @router.get('/preference')
    def preference():
        try: return Preference.model_validate_json(service.preference.read_text(encoding='utf-8')).model_dump()
        except (OSError, ValueError): return {'provider': None, 'voice_id': None}
    @router.put('/preference')
    def save_preference(request: Preference): return call(lambda: service.save_preference(request))
    @router.get('/previews/{ident}')
    def audio(ident: str):
        with service.lock: item = service.previews.pop(ident, None)
        if not item or item[2] < time.monotonic():
            if item: item[0].cleanup()
            return JSONResponse({'code': 'preview_not_found'}, status_code=404)
        return FileResponse(item[1], media_type='audio/wav', background=BackgroundTask(item[0].cleanup))
    return router
