"""Subprocesso de transcrição e download do YouTube.

Executado somente como tarefa; a API nunca importa Whisper ou yt-dlp. Mensagens
estruturadas saem no stdout como NDJSON ({"type": ..., "message": ...}).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

MODELS = ("tiny", "base", "small", "medium", "large-v3-turbo")
LANGUAGES = ("auto", "pt", "en", "es")
FILE_MARKER = "HORUS_FILE:"
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}


def is_youtube_url(value: str) -> bool:
    """Mesma regra do desktop Avalonia: somente vídeo único, HTTPS e sem credenciais."""
    try:
        url = urlsplit(value)
    except ValueError:
        return False
    if url.scheme != "https" or url.username or url.password or url.port:
        return False
    if url.hostname == "youtu.be":
        return bool(_VIDEO_ID.match(url.path.strip("/")))
    if url.hostname not in _YOUTUBE_HOSTS:
        return False
    parts = [part for part in url.path.split("/") if part]
    if len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}:
        return bool(_VIDEO_ID.match(parts[1]))
    return url.path == "/watch" and any(_VIDEO_ID.match(v) for v in parse_qs(url.query).get("v", []))


def emit(kind: str, message: str):
    print(json.dumps({"type": kind, "message": message}, ensure_ascii=False), flush=True)


def transcribe(path: Path, model_name: str, language: str, models_dir: Path):
    import ctranslate2
    from faster_whisper import WhisperModel

    device = os.environ.get("HORUS_WHISPER_DEVICE") or ("cuda" if ctranslate2.get_cuda_device_count() else "cpu")
    emit("status", f"Carregando modelo {model_name} em {device.upper()} (o primeiro uso baixa o modelo)...")
    models_dir.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(model_name, device=device, compute_type="float16" if device == "cuda" else "int8",
                         download_root=str(models_dir))
    emit("status", "Transcrevendo...")
    segments, info = model.transcribe(str(path), language=None if language == "auto" else language)
    last = -1
    for segment in segments:
        text = segment.text.strip()
        if text:
            emit("segment", text)
        if info.duration:
            percent = min(99, int(segment.end * 100 / info.duration))
            if percent > last:
                last = percent
                emit("progress", str(percent))
    emit("progress", "100")


def download(url: str, directory: Path) -> int:
    if not is_youtube_url(url):
        raise ValueError("Informe um link válido de vídeo do YouTube.")
    directory.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    args = ["--ignore-config", "--js-runtimes", "node", "--no-playlist", "--no-overwrites", "--newline",
            "--progress", "--progress-delta", "1", "--no-colors", "--socket-timeout", "20", "--retries", "3",
            "--windows-filenames", "--trim-filenames", "150", "-P", str(directory),
            "-o", "%(title).150B [%(id)s].%(ext)s",
            "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" if ffmpeg else "best[ext=mp4]/best",
            "--merge-output-format", "mp4", "--print", f"after_move:{FILE_MARKER}%(filepath)s"]
    if ffmpeg:
        args += ["--ffmpeg-location", ffmpeg]
    args += ["--", url]
    try:
        import yt_dlp
    except ImportError:
        yt_dlp = None
    if yt_dlp is not None:
        try:
            return yt_dlp.main(args) or 0
        except SystemExit as exit_:
            return exit_.code if isinstance(exit_.code, int) else 1
    executable = shutil.which("yt-dlp")
    if not executable:
        raise RuntimeError("yt-dlp não encontrado. Instale o extra transcription do backend ou o yt-dlp no PATH.")
    import subprocess
    return subprocess.call([executable, *args])


def main(argv: list[str]):
    parser = argparse.ArgumentParser(prog="horus-backend")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("transcribe")
    run.add_argument("--path", type=Path, required=True)
    run.add_argument("--model", choices=MODELS, required=True)
    run.add_argument("--language", choices=LANGUAGES, required=True)
    run.add_argument("--models-dir", type=Path, required=True)
    fetch = commands.add_parser("download")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args(argv)
    # O backend lê UTF-8; no Windows o console padrão (cp1252) quebra em texto transcrito.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    try:
        if args.command == "transcribe":
            transcribe(args.path, args.model, args.language, args.models_dir)
            return 0
        return download(args.url, args.directory)
    except Exception as error:  # noqa: BLE001 - o motivo segue para o log da tarefa
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        return 1
