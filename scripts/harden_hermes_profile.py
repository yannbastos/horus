"""Gerar perfil mínimo Hermes sem iniciar processos ou tocar credenciais."""
import argparse
from pathlib import Path

from horus_backend.security import harden_profile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--allow-real', action='store_true', help='Exige autorização prévia do idealizador.')
args = parser.parse_args()
harden_profile(args.profile, allow_real=args.allow_real)
print('Configuração mínima gravada; nenhuma credencial foi criada e nenhum processo foi iniciado.')
