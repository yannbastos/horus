"""Contratos de narração independentes de modelos de texto e da produção."""
from .service import NarrationService
from .providers import NarrationProvider

__all__ = ["NarrationService", "NarrationProvider"]
