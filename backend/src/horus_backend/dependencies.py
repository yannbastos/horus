"""Descoberta leve, sem importar motores ou executar programas."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import sys

TOOL_ENV = {'ffmpeg': 'HORUS_FFMPEG', 'ffprobe': 'HORUS_FFPROBE', 'node': 'HORUS_NODE', 'yt-dlp': 'HORUS_YTDLP'}


def find_tool(name: str) -> str | None:
    configured = os.environ.get(TOOL_ENV[name])
    if configured:
        path = Path(configured).expanduser()
        return str(path.resolve()) if path.is_file() else None
    directory = os.environ.get('HORUS_TOOLS_DIR')
    folders = [Path(directory).expanduser()] if directory else []
    if getattr(sys, 'frozen', False):
        folders.append(Path(sys.executable).parent / 'tools')
    for folder in folders:
        candidate = folder / (name + '.exe' if os.name == 'nt' else name)
        if candidate.is_file():
            return str(candidate.resolve())
    return shutil.which(name)


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def transcription_capabilities():
    return {'engine': all(has_module(name) for name in ('faster_whisper', 'ctranslate2', 'av')),
            'downloader': has_module('yt_dlp') or find_tool('yt-dlp') is not None,
            'ffmpeg': find_tool('ffmpeg') is not None}
