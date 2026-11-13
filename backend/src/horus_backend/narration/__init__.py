"""Contratos de narração independentes de modelos de texto e da produção."""
from .providers import NarrationProvider

__all__ = ["NarrationService", "NarrationProvider"]


def __getattr__(name):
    # Render/QC puro não depende de FastAPI nem do cofre do sistema operacional.
    if name == 'NarrationService':
        from .service import NarrationService
        return NarrationService
    raise AttributeError(name)
