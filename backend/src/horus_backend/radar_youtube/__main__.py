"""Entrada manual opcional; rede somente após autorização e --allow-network."""
import argparse
import os
from pathlib import Path

from . import CollectionRequest, GoogleTransport, RadarState, YouTubeCollector

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True, help='JSON conforme CollectionRequest')
    parser.add_argument('--state-dir', type=Path, required=True, help='Diretório exclusivo do cache/datasets do Radar')
    parser.add_argument('--allow-network', action='store_true')
    args = parser.parse_args(argv)
    if not args.allow_network:
        parser.error('Rede desabilitada. Esta entrega é validada apenas com mocks; coleta real exige autorização.')
    key = os.environ.get('YOUTUBE_API_KEY', '')
    if not key:
        parser.error('Configure YOUTUBE_API_KEY fora do código/Git; não informe chave na linha de comando.')
    request = CollectionRequest.model_validate_json(args.request.read_text(encoding='utf-8'))
    state = RadarState(args.state_dir / 'radar-youtube.sqlite3')
    dataset = YouTubeCollector(GoogleTransport(key, allow_network=True), state).collect(request)
    print(dataset.model_dump_json(indent=2))

if __name__ == '__main__':
    main()
