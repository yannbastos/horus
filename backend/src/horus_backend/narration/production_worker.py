"""Síntese de produção em processo possuído pelo worker, sem transporte pago."""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

from .providers import PRODUCTION_ORIGINS


def synthesize_sections(request, providers):
    selection = request['narration']
    provider = providers.get(selection['provider'])
    if provider is None:
        raise ValueError('provider_not_found')
    # Não ler credenciais nem transmitir roteiro para provedores pagos.
    if provider.kind == 'paid_api':
        raise ValueError('paid_provider_not_authorized')
    if provider.id not in PRODUCTION_ORIGINS:
        raise ValueError('narration_provider_origin_unknown')
    status = provider.status()
    if status['status'] != 'available':
        raise ValueError('narration_provider_unavailable: ' + provider.id + '; ' + status['reason'])
    voice_id = selection['voice_id']
    voices = provider.voices()
    selected = next((v for v in voices if v['id'] == voice_id), None)
    if selected is None:
        raise ValueError('voice_not_found: ' + provider.id)
    folder = Path(request['folder'])
    metadata = None
    for section in request['sections']:
        result = provider.synthesize(section['text'], voice_id, folder / f"section-{section['n']}.wav")
        current = (result or {}).get('model')
        if metadata is not None and metadata.get('model') != current:
            raise ValueError('narration_model_changed')
        metadata = {'model':current}
    # GDI/cenas continuam no helper existente. A fala vem exclusivamente do registro.
    from horus_backend.local_pilot_windows import scene
    for section in request['sections']:
        scene(folder / f"scene-{section['n']}.png", section, *request['scene_size'])
    voice = {'voice': selected['name'], 'voice_id': voice_id, 'culture': selected['language'],
             'provider': provider.id, 'engine': provider.id,
             'origin': PRODUCTION_ORIGINS[provider.id],
             'model': (metadata or {}).get('model')}
    (folder / 'voice.json').write_text(json.dumps(voice, ensure_ascii=False), encoding='utf-8')


def main(path):
    from horus_backend.narration.service import provider_registry
    from horus_backend.narration.providers import NarrationError
    request = json.loads(Path(path).read_text(encoding='utf-8'))
    try:
        # Não descobrir Hermes/perfil operacional no ambiente mínimo da produção.
        settings = SimpleNamespace(data_dir=Path(path).parent, narration_paid_enabled=False,
            elevenlabs_price_per_1k_chars=None, elevenlabs_currency=None,
            piper_executable=os.environ.get('HORUS_PIPER_EXECUTABLE'),
            piper_models=os.environ.get('HORUS_PIPER_MODELS'),
            kokoro_python=os.environ.get('HORUS_KOKORO_PYTHON'),
            kokoro_model_dir=os.environ.get('HORUS_KOKORO_MODEL_DIR'))
        synthesize_sections(request, provider_registry(settings))
    except (ValueError, NarrationError) as error:
        # Somente códigos/estado controlados, nunca texto do roteiro ou erro bruto de ferramenta.
        code = error.code if isinstance(error, NarrationError) else str(error)
        detail = error.detail if isinstance(error, NarrationError) else None
        Path(path).with_suffix('.error.json').write_text(json.dumps({'error': code, 'failure': detail}), encoding='utf-8')
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
