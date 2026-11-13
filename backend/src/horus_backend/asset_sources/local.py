"""Importação de arquivo local indicado pelo usuário, com licença declarada (`licensed_manual`). Sem rede."""
from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

from .base import AssetCandidate, AssetSource, AssetSourceError, ParsedResponse, check_url_https, iso_utc

CHUNK = 1024 * 1024
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
MAX_BYTES = {"image": 50 * 1024 ** 2, "video": 500 * 1024 ** 2, "audio": 100 * 1024 ** 2,
             "music": 100 * 1024 ** 2, "voice": 100 * 1024 ** 2, "font": 20 * 1024 ** 2}
EXTENSIONS = {
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp"},
    "video": {".mp4", ".mov", ".webm"},
    "audio": {".mp3", ".wav", ".ogg", ".flac"},
    "music": {".mp3", ".wav", ".ogg", ".flac"},
    "voice": {".mp3", ".wav", ".ogg", ".flac"},
    "font": {".ttf", ".otf", ".woff", ".woff2"},
}
_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def _signature_ok(extension: str, head: bytes) -> bool:
    """Confere os bytes iniciais com a extensão (barra arquivo renomeado; não prova o conteúdo inteiro)."""
    if extension == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if extension in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if extension == ".gif":
        return head.startswith((b"GIF87a", b"GIF89a"))
    if extension == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if extension in (".mp4", ".mov"):
        return head[4:8] == b"ftyp" or (extension == ".mov" and head[4:8] in (b"moov", b"mdat", b"wide", b"free"))
    if extension == ".webm":
        return head.startswith(b"\x1aE\xdf\xa3")
    if extension == ".mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if extension == ".wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if extension == ".ogg":
        return head.startswith(b"OggS")
    if extension == ".flac":
        return head.startswith(b"fLaC")
    if extension == ".ttf":
        return head.startswith((b"\x00\x01\x00\x00", b"true"))
    if extension == ".otf":
        return head.startswith(b"OTTO")
    if extension == ".woff":
        return head.startswith(b"wOFF")
    if extension == ".woff2":
        return head.startswith(b"wOF2")
    return False


def _is_link(path: Path) -> bool:
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        return True
    try:
        return bool(getattr(os.lstat(path), "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT)
    except OSError:
        return False


class LocalLicensedSource(AssetSource):
    """Copia um arquivo do usuário para a biblioteca, calcula o SHA-256 e devolve um candidato `licensed_manual`.

    O arquivo original nunca é aberto para escrita, movido nem alterado. A licença é a declarada pelo usuário e
    continua `unverified` até a revisão humana (HOR-097).
    """
    origin = "licensed_manual"

    def __init__(self, library_dir: str | os.PathLike[str], *, max_bytes: Mapping[str, int] | None = None):
        self._library = Path(library_dir)
        self._max = {**MAX_BYTES, **(max_bytes or {})}

    def search(self, query: str, *, kind: str, queried_at: datetime) -> ParsedResponse:
        raise AssetSourceError("not_searchable", "fonte local não tem busca; indique o arquivo.")

    def parse_response(self, payload: Mapping[str, Any], *, kind: str, queried_at: datetime) -> ParsedResponse:
        raise AssetSourceError("not_searchable", "fonte local não converte respostas de API.")

    def declare(self, *, kind: str, author: str, source_url: str, license_id: str, license_name: str,
                license_url: str, commercial_use: str, attribution_required: bool | None,
                queried_at: datetime, terms_restrictions: tuple[str, ...] = ()) -> AssetCandidate:
        """Candidato com a licença declarada pelo usuário, ainda sem arquivo."""
        if kind not in EXTENSIONS:
            raise AssetSourceError("unsupported_kind", f"tipo desconhecido: {kind!r}.")
        if commercial_use not in ("allowed", "restricted", "unknown"):
            raise AssetSourceError("invalid_license", "commercial_use deve ser allowed, restricted ou unknown.")
        for label, value in (("autor", author), ("licença (id)", license_id), ("licença (nome)", license_name)):
            if not isinstance(value, str) or not value.strip():
                raise AssetSourceError("missing_license" if "licença" in label else "missing_author", f"{label} ausente.")
        return AssetCandidate(
            origin=self.origin, kind=kind, source_id="pending", source_url=check_url_https(source_url, "source_url"),
            author=author.strip()[:300], author_url=None, license_id=license_id.strip()[:100],
            license_name=license_name.strip()[:200], license_url=check_url_https(license_url, "license_url"),
            commercial_use=commercial_use, attribution_required=attribution_required,
            queried_at=iso_utc(queried_at), terms_restrictions=tuple(terms_restrictions))

    def obtain(self, candidate: AssetCandidate, source_path: str | os.PathLike[str] | None = None,
               *args: Any, **kwargs: Any) -> AssetCandidate:
        if candidate.origin != self.origin or source_path is None:
            raise AssetSourceError("invalid_candidate", "candidato local e caminho do arquivo são obrigatórios.")
        raw = os.fspath(source_path)
        if "\x00" in raw or any(part == ".." for part in re.split(r"[\\/]", raw)):
            raise AssetSourceError("unsafe_path", "caminho com '..' ou byte nulo.")
        source = Path(raw)
        if not source.is_absolute():
            raise AssetSourceError("unsafe_path", "indique o caminho absoluto do arquivo.")
        for part in (source, *source.parents):
            if _is_link(part):
                raise AssetSourceError("symlink_not_allowed", "link simbólico/junção no caminho do arquivo.")
        try:
            info = os.lstat(source)
        except OSError as error:
            raise AssetSourceError("not_found", "arquivo não encontrado ou ilegível.") from error
        if not stat.S_ISREG(info.st_mode):
            raise AssetSourceError("not_a_file", "o caminho não é um arquivo regular.")
        extension = source.suffix.lower()
        if extension not in EXTENSIONS[candidate.kind]:
            raise AssetSourceError("unsupported_type", f"extensão {extension or '(nenhuma)'} não aceita para {candidate.kind}.")
        limit = self._max[candidate.kind]
        if info.st_size <= 0 or info.st_size > limit:
            raise AssetSourceError("size_not_allowed", f"tamanho fora de 1..{limit} bytes.")
        library = self._library
        if not library.is_dir() or _is_link(library):
            raise AssetSourceError("invalid_library", "pasta da biblioteca inexistente ou é um link.")

        digest = hashlib.sha256()
        total = 0
        head = b""
        fd, temp_name = tempfile.mkstemp(dir=library, prefix=".import-", suffix=".part")
        try:
            with os.fdopen(fd, "wb") as out, open(source, "rb") as src:
                while chunk := src.read(CHUNK):
                    total += len(chunk)
                    if total > limit:  # arquivo cresceu depois do lstat
                        raise AssetSourceError("size_not_allowed", "arquivo excede o limite durante a cópia.")
                    head = head or chunk[:16]
                    digest.update(chunk)
                    out.write(chunk)
            if not _signature_ok(extension, head):
                raise AssetSourceError("signature_mismatch", "o conteúdo não corresponde à extensão declarada.")
            sha = digest.hexdigest()
            name = f"{sha[:12]}-{_NAME.sub('_', source.stem).strip('._') or 'asset'}"[:80] + extension
            target = library / name
            if target.exists() or _is_link(target):
                if _is_link(target) or hashlib.sha256(target.read_bytes()).hexdigest() != sha:
                    raise AssetSourceError("target_conflict", "já existe outro arquivo com esse nome na biblioteca.")
                os.unlink(temp_name)
            else:
                os.replace(temp_name, target)
        except BaseException:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
            raise
        return replace(candidate, source_id=sha[:12], relative_path=name, sha256=sha, size_bytes=total)

    def import_file(self, source_path: str | os.PathLike[str], **declaration: Any) -> AssetCandidate:
        return self.obtain(self.declare(**declaration), source_path)
