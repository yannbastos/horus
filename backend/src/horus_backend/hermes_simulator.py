"""Hermes em processo: dados determinísticos, sem conexão ou ferramentas externas."""
import hashlib
import json
import threading

from .hermes_contract.models import RunEnvelope
from .workflow_hermes import HermesHTTPError


def editorial_result(envelope):
    sources, facts = [], []
    occupied = {item.source_id for item in envelope.dataset.items}
    def identifier(prefix, index):
        salt = 0
        value = prefix + '_' + hashlib.sha256(f'{index}:{salt}'.encode()).hexdigest()[:18]
        while value in occupied:
            salt += 1
            value = prefix + '_' + hashlib.sha256(f'{index}:{salt}'.encode()).hexdigest()[:18]
        occupied.add(value)
        return value
    for index, item in enumerate(envelope.dataset.items):
        sources.append(dict(id=item.source_id, kind='dataset', url=item.url, retrieved_at=item.retrieved_at.isoformat()))
        facts.append(dict(id=identifier('fact', index), text='Referência pública presente no snapshot fornecido.',
                          source_ids=[item.source_id], metric_refs=[dict(source_id=item.source_id, field=k, value=v) for k,v in item.metrics.items()]))
    return dict(contract_version='1.0', task_id=envelope.task_id, status='complete',
                plan=[dict(step='Examinar o snapshot fornecido e preparar uma proposta para revisão.', done=True)],
                sources=sources, facts=facts, hypotheses=[], opportunities=[dict(id=identifier('opportunity', 0),
                summary='Explorar uma abordagem autoral a partir das referências.', based_on=[facts[0]['id']],
                br_fit_rationale='Validar linguagem e contexto com o público brasileiro.')],
                recommendation=dict(title_options=['Uma perspectiva autoral para explorar'], premise='Investigar o tema com pesquisa própria.',
                angle='Contrastar perguntas e exemplos locais.', format='long', originality='Criar narrativa e materiais próprios.',
                differs_from=[sources[0]['id']], risks=['A amostra exige avaliação humana.'], licensing_notes='Verificar licenças antes de usar qualquer material.'),
                unknowns=['A simulação não avalia o mérito editorial do objetivo.'], memory_proposals=[])


class HermesSimulator:
    def __init__(self):
        self.runs, self.keys = {}, {}
        self.lock = threading.Lock()

    def submit(self, body, key):
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        with self.lock:
            if key in self.keys:
                previous, run_id = self.keys[key]
                if previous != fingerprint:
                    raise HermesHTTPError(409, 'idempotency_key_conflict', 'Chave reutilizada.')
                return dict(run_id=run_id, status=self.runs[run_id]['status'], replayed=True)
            envelope = RunEnvelope.model_validate_json(body['input'])
            run_id = 'sim_' + hashlib.sha256(key.encode()).hexdigest()[:32]
            self.runs[run_id] = dict(status='queued', polls=0, output=json.dumps(editorial_result(envelope), ensure_ascii=False),
                                     usage={name: 0 for name in ('input_tokens','output_tokens','total_tokens','cache_read_tokens','cache_write_tokens')})
            self.keys[key] = fingerprint, run_id
            return dict(run_id=run_id, status='queued', replayed=False)

    def status(self, run_id):
        with self.lock:
            if run_id not in self.runs:
                raise HermesHTTPError(404, 'run_not_found', 'Execução simulada indisponível após reinício.')
            run = self.runs[run_id]
            if run['status'] not in {'completed', 'cancelled'}:
                run['polls'] += 1
                run['status'] = 'queued' if run['polls'] == 1 else 'running' if run['polls'] < 4 else 'completed'
            return {k:v for k,v in run.items() if k != 'polls'}

    def stop(self, run_id):
        with self.lock:
            self.runs[run_id]['status'] = 'cancelled'
            return dict(run_id=run_id, status='cancelled')
