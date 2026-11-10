from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
from pathlib import Path

import uvicorn

from .api import create_app
from .config import Settings, default_data_dir


def main():
    parser = argparse.ArgumentParser(description="API local do Hórus, independente do desktop.")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    token = os.environ.get("HORUS_API_TOKEN", "")
    if len(token) < 24:
        parser.error("Defina HORUS_API_TOKEN com pelo menos 24 caracteres aleatórios. Não use chaves de provedores.")
    settings = Settings(token=token, data_dir=Path(os.environ.get("HORUS_DATA_DIR", default_data_dir())))
    listener = socket.socket()
    listener.bind(("127.0.0.1", args.port))
    listener.listen(128)
    port = listener.getsockname()[1]
    server = None

    def shutdown():
        if server:
            server.should_exit = True

    def ready():
        print(json.dumps({"event": "ready", "port": port, "pid": os.getpid()}), flush=True)

    app = create_app(settings, shutdown=shutdown, ready=ready)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False))
    if os.environ.get("HORUS_MANAGED") == "1":
        # EOF detecta morte do desktop sem polling de CPU.
        threading.Thread(target=lambda: (sys.stdin.buffer.read(), shutdown()), daemon=True).start()
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
