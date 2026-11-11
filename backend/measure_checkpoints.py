"""Mede o checkpoint atual em bancos temporários; não aceita caminho de banco operacional."""
from __future__ import annotations

import argparse
import json
import platform
import sqlite3
import statistics
import tempfile
import time
from pathlib import Path

from horus_backend.storage import Store


def measure(segments: int, characters: int):
    with tempfile.TemporaryDirectory(prefix='horus-checkpoint-measure-') as directory:
        path = Path(directory) / 'temporary.sqlite3'
        store = Store(path)
        job, _ = store.create_job({'operation': 'transcription.run', 'path': 'simulated.wav'}, 'measure')
        store.update(job['id'], 'running', new_attempt=True)
        text = 'x' * characters
        samples = []
        cpu_started, started = time.process_time(), time.perf_counter()
        for _ in range(segments):
            before = time.perf_counter()
            store.event(job['id'], 'segment', text)
            samples.append((time.perf_counter() - before) * 1000)
        elapsed, cpu = time.perf_counter() - started, time.process_time() - cpu_started
        result = store.get_job(job['id'])['result']
        assert len(result['text']) == segments * (characters + 1)
        store.recover()
        assert store.get_job(job['id'])['result'] == result
        return {'segments': segments, 'characters_per_segment': characters, 'elapsed_seconds': round(elapsed, 3),
                'cpu_seconds': round(cpu, 3), 'median_event_ms': round(statistics.median(samples), 3),
                'p95_event_ms': round(sorted(samples)[max(0, int(len(samples) * .95) - 1)], 3),
                'text_bytes': len(result['text'].encode()), 'database_bytes': path.stat().st_size,
                'approx_text_bytes_rewritten': (characters + 1) * segments * (segments + 1) // 2}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--segments', type=int, nargs='+', default=[500, 2000])
    parser.add_argument('--characters', type=int, default=120)
    args = parser.parse_args()
    if not all(1 <= value <= 20000 for value in args.segments) or not 1 <= args.characters <= 2000:
        parser.error('Use 1..20000 segmentos e 1..2000 caracteres por segmento.')
    print(json.dumps({'platform': platform.platform(), 'sqlite': sqlite3.sqlite_version,
                      'results': [measure(value, args.characters) for value in args.segments]}, indent=2))
