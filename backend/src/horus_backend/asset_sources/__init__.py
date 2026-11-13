"""Fontes de assets licenciados (HOR-055). Arquitetura offline: sem rede, chaves ou download automático."""
from .base import (AssetCandidate, AssetSource, AssetSourceError, FixtureTransport, ParsedResponse, SourceRequest,
                   SourceTransport)
from .local import LocalLicensedSource
from .pexels import PexelsSource
from .pixabay import PixabaySource
from .provenance import build_provenance, to_provenance_asset, with_obtained_file

__all__ = ["AssetCandidate", "AssetSource", "AssetSourceError", "FixtureTransport", "LocalLicensedSource",
           "ParsedResponse", "PexelsSource", "PixabaySource", "SourceRequest", "SourceTransport",
           "build_provenance", "to_provenance_asset", "with_obtained_file"]
