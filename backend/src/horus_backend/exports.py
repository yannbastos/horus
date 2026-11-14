"""Pacotes locais auditáveis; sem publicação, migração ou caminhos fornecidos pelo cliente."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
import re
from threading import RLock
import uuid
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo, BadZipFile

from .license_reviews import LicenseReviewService
from .media_contracts import apply_license_reviews
from .migrations import SCHEMA_VERSION
from .production import confined, inspect_artifact
from .storage import now
from .workflows import WorkflowConflict, digest

HORUS_VERSION = '0.1.0'  # mesma versão do backend em /health e pyproject.toml
FILES = {'video.mp4', 'subtitles.srt', 'script.json', 'script.txt', 'quality-report.json', 'licenses.json', 'review.json'}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode('utf-8')


class ExportService:
    def __init__(self, productions):
        self.productions = productions
        self.store, self.settings = productions.store, productions.settings
        self.lock = RLock()

    def _root(self, production_id):
        self.productions.root(production_id)  # valida o ID antes de compor caminhos
        root = self.settings.data_dir / 'exports' / production_id
        for part in (root, *root.parents):
            if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
                raise WorkflowConflict('Links não são permitidos na pasta de exportação.')
        return root

    def _private(self, data: bytes):
        text = data.decode('utf-8')
        # Não alterar silenciosamente o roteiro aprovado ou as evidências.
        # URLs públicas e caminhos relativos de artefatos são preservados.
        paths = re.compile(r'''(?i)(?:(?<!\w)[a-z]:[\\/]|(?<![\w\\])\\\\|(?<![\w:/])/(?!/)[\w.~])''')
        credentials = re.compile(r'''(?i)\b(?:bearer\s+\S+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*\S+)''')
        if self.settings.token in text or paths.search(text) or credentials.search(text):
            raise WorkflowConflict('O pacote contém caminho absoluto ou possível credencial em texto; revise o conteúdo antes de exportar.')

    def _audit_metadata(self, value):
        """Cópia portátil dos metadados: nunca alterar artefatos ou decisões persistidas."""
        if isinstance(value, dict):
            return {key: '[credencial omitida]' if re.fullmatch(r'(?i)(?:authorization|.*(?:api[_-]?key|token|secret|password))', key)
                    else self._audit_metadata(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._audit_metadata(item) for item in value]
        if not isinstance(value, str):
            return value
        value = value.replace(self.settings.token, '[credencial omitida]')
        value = re.sub(r'''(?i)\b(?:bearer\s+\S+|(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?[^\s,;"']+)''',
                       '[credencial omitida]', value)
        value = re.sub(r'''(?i)(?:(?<!\w)[a-z]:[\\/]|(?<![\w:/])/(?!/)[\w.~])[^\r\n;"']*''',
                       '[caminho omitido]', value)
        return re.sub(r'''(?<!\S)\\\\[^\r\n;"']+''', '[caminho omitido]', value)

    def _metadata(self, production_id, export_id):
        if not re.fullmatch(r'[a-f0-9]{64}', export_id):
            raise KeyError(export_id)
        root = self._root(production_id)
        archive = confined(root, f'{export_id}/package.zip')
        try:
            with ZipFile(archive) as zipped:
                manifest = json.loads(zipped.read('manifest.json'))
                if manifest['schema_version'] != 1 or not isinstance(manifest['created_at'], str):
                    raise ValueError()
                datetime.fromisoformat(manifest['created_at'])
                self._private(_json(manifest))
                if manifest['id'] != export_id or manifest['production_id'] != production_id:
                    raise ValueError()
                expected = {item['name']: item for item in manifest['files']}
                if set(expected) != FILES:
                    raise ValueError()
                if set(zipped.namelist()) != {'manifest.json', *expected} or len(zipped.namelist()) != len(expected) + 1:
                    raise ValueError()
                for name, item in expected.items():
                    if zipped.getinfo(name).file_size != item['size_bytes']:
                        raise ValueError()
                    with zipped.open(name) as stream:
                        if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                            raise ValueError()
            with archive.open('rb') as stream:
                sha = hashlib.file_digest(stream, 'sha256').hexdigest()
        except (OSError, ValueError, KeyError, TypeError, BadZipFile):
            raise WorkflowConflict('Pacote de exportação ausente ou adulterado; preserve-o e use uma nova chave para gerar outro.') from None
        return {'id': export_id, 'production_id': production_id, 'created_at': manifest['created_at'],
                'relative_path': f'exports/{production_id}/{export_id}/package.zip',
                'size_bytes': archive.stat().st_size, 'sha256': sha, 'publishable': False}

    def list(self, production_id):
        with self.store.connect() as db:
            self.productions.require(db, production_id)
        with self.lock:
            root = self._root(production_id)
            items = [self._metadata(production_id, p.name) for p in root.iterdir()
                     if re.fullmatch(r'[a-f0-9]{64}', p.name) and (p / 'package.zip').exists()] if root.exists() else []
            return {'items': sorted(items, key=lambda item: (item['created_at'], item['id']))}

    def file(self, production_id, export_id):
        with self.store.connect() as db:
            self.productions.require(db, production_id)
        self._metadata(production_id, export_id)
        return confined(self._root(production_id), f'{export_id}/package.zip')

    def create(self, production_id, key):
        try:
            return self._create(production_id, key)
        except WorkflowConflict:
            raise
        except (OSError, ValueError, TypeError, BadZipFile):
            raise WorkflowConflict('Não foi possível exportar com integridade; confira os artefatos e a pasta de exportação e use outra chave se a tentativa foi interrompida.') from None

    def _create(self, production_id, key):
        export_id = hashlib.sha256(f'{production_id}:{key}'.encode()).hexdigest()
        with self.lock, self.store.connect() as db:
            db.execute('BEGIN')
            row = self.productions.require(db, production_id)
            root = self._root(production_id)
            folder = root / export_id
            if folder.exists() or folder.is_symlink():
                return self._metadata(production_id, export_id), False
            review = json.loads(row['review']) if row['review'] else {}
            job = self.store.job(db.execute('SELECT * FROM jobs WHERE id=?', (row['job_id'],)).fetchone())
            if review.get('decision') != 'approve' or job['status'] != 'succeeded':
                raise WorkflowConflict('Exportação exige produção concluída e aprovada por revisão humana.')
            artifacts = json.loads(row['artifacts'])
            source = self.productions.root(production_id)
            for item in artifacts:
                if inspect_artifact(source, item['relative_path'], item['kind']) != item:
                    raise WorkflowConflict('Artefato adulterado; exportação recusada.')
            video = next((a for a in artifacts if a['kind'] == 'video' and a['sha256'] == review.get('artifact_sha256')), None)
            subtitles = next((a for a in artifacts if a['kind'] == 'subtitles'), None)
            if not video or not subtitles:
                raise WorkflowConflict('Exportação exige vídeo aprovado e legendas registrados.')
            snapshot = None
            for receipt in db.execute('SELECT response FROM script_receipts WHERE scope=?', (f"review:{row['script_id']}",)):
                approved = json.loads(receipt['response'])
                if (approved.get('status') == 'approved' and approved.get('version') == row['script_version']
                        and approved.get('review') == json.loads(row['script_review'])
                        and digest(approved.get('document')) == row['script_content_hash']):
                    snapshot = approved
                    break
            if snapshot is None:
                raise WorkflowConflict('Snapshot do roteiro aprovado indisponível; exportação recusada.')
            record = self.productions.record(db, row)
            licenses = LicenseReviewService(self.store, self.settings.data_dir)
            provenance = licenses._provenance(db, production_id)
            history = licenses._history(db, production_id)
            effective = apply_license_reviews(provenance, history) if provenance is not None else None
            document = snapshot['document']
            text = document['title'] + '\n\n' + '\n\n'.join(
                section['heading'] + '\n' + section['narration'] for section in document['sections']) + '\n'
            audit = {'quality-report.json': record['quality_report'] or {'status': 'not_run',
                           'reason': 'Relatório de QC registrado indisponível nesta produção.'},
                       'licenses.json': {'original_provenance': provenance, 'history': history,
                           'effective_provenance': effective, 'publishable': False},
                       'review.json': {'production_review': review, 'script_review': snapshot['review'],
                           'script_id': row['script_id'], 'script_version': row['script_version'],
                           'script_content_hash': row['script_content_hash'], 'publishable': False}}
            safe_audit = self._audit_metadata(audit)
            payload = {name: _json(data) for name, data in safe_audit.items()}
            payload.update({'script.json': _json(document), 'script.txt': text.encode('utf-8')})
            for data in payload.values():
                self._private(data)
            # Só os artefatos explicitamente selecionados entram no ZIP.
            srt = confined(source, subtitles['relative_path']).read_bytes()
            if hashlib.sha256(srt).hexdigest() != subtitles['sha256']:
                raise WorkflowConflict('Legendas alteradas durante a exportação.')
            self._private(srt)
            payload['subtitles.srt'] = srt
            manifest = {'schema_version': 1, 'horus_version': HORUS_VERSION, 'database_schema_version': SCHEMA_VERSION,
                        'id': export_id, 'production_id': production_id, 'created_at': now(), 'publishable': False,
                        'metadata_redacted': safe_audit != audit,
                        'files': []}
            root.mkdir(parents=True, exist_ok=True)
            folder.mkdir()  # reserva exclusiva; uma tentativa interrompida nunca é sobrescrita
            temporary = folder / ('partial-' + uuid.uuid4().hex)
            try:
                with ZipFile(temporary, 'x', compression=ZIP_DEFLATED) as zipped:
                    for name, data in payload.items():
                        zipped.writestr(name, data)
                        manifest['files'].append({'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size_bytes': len(data)})
                    sha, size = hashlib.sha256(), 0
                    # MP4 já comprimido: armazenar sem nova compressão e permitir ZIP64.
                    with confined(source, video['relative_path']).open('rb') as stream, zipped.open(ZipInfo('video.mp4'), 'w', force_zip64=True) as target:
                        while block := stream.read(1024 * 1024):
                            sha.update(block)
                            size += len(block)
                            target.write(block)
                    if sha.hexdigest() != video['sha256'] or size != video['size_bytes']:
                        raise WorkflowConflict('Vídeo alterado durante a exportação.')
                    manifest['files'].append({'name': 'video.mp4', 'sha256': sha.hexdigest(), 'size_bytes': size})
                    zipped.writestr('manifest.json', _json(manifest))
                temporary.rename(folder / 'package.zip')
            finally:
                if temporary.exists():
                    temporary.unlink()  # apenas o temporário criado por esta chamada
            return self._metadata(production_id, export_id), True
