"""Executado com -I no ambiente isolado do operador; nunca importar no backend."""
from __future__ import annotations
import json
from pathlib import Path
import socket
import sys
import wave


def deny_network(*args, **kwargs):
    raise RuntimeError('kokoro_network_forbidden')


def block_network():
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.getaddrinfo = deny_network
    socket.create_connection = deny_network
    # Também recusa socket.sendto e chamadas diretas que emitam eventos de auditoria.
    def audit(event, args):
        if event in {'socket.connect', 'socket.getaddrinfo', 'socket.sendto', 'socket.sendmsg'}:
            deny_network()
    sys.addaudithook(audit)


def main(path):
    block_network()
    from importlib.metadata import version
    if version("kokoro") != "0.9.4":
        raise RuntimeError("kokoro_version_mismatch")
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline
    request = json.loads(Path(path).read_text(encoding='utf-8'))
    root = Path(request['model_dir'])
    if request['voice_id'] not in {'pf_dora', 'pm_alex', 'pm_santa'}:
        raise ValueError('voice_not_found')
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(root / 'config.json'), model=str(root / 'kokoro-v1_0.pth')).to(device).eval()
    pipeline = KPipeline(lang_code='p', repo_id='hexgrad/Kokoro-82M', model=model)
    parts = [audio.detach().cpu().numpy() for _, _, audio in pipeline(
        request['text'], voice=str(root / 'voices' / (request['voice_id'] + '.pt')), speed=1.0)]
    if not parts: raise ValueError('empty_audio')
    pcm = np.clip(np.round(np.concatenate(parts) * 32768), -32768, 32767).astype('<i2')
    with wave.open(request['output'], 'wb') as wav:
        wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        wav.writeframes(pcm.tobytes())


if __name__ == '__main__':
    main(sys.argv[1])
