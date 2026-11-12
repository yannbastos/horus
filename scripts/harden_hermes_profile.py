"""Gerar perfil mínimo Hermes sem iniciar processos ou tocar credenciais."""
import argparse
from pathlib import Path

from horus_backend.security import harden_profile, restore_profile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--allow-real', action='store_true', help='Exige autorização prévia do idealizador.')
parser.add_argument('--dry-run', action='store_true', help='Exibe diff/plano sem escrever nada.')
parser.add_argument('--restore', type=Path, help='Diretório backup criado dentro deste perfil.')
args = parser.parse_args()
try:
    if args.restore:
        result = restore_profile(args.profile, args.restore, allow_real=args.allow_real, dry_run=args.dry_run)
        print('Restauração prevista (sem escrita).' if args.dry_run else 'Estado anterior restaurado e verificado por SHA-256.')
        if args.dry_run:
            print('Itens a restaurar: ' + ', '.join(result['restore']))
    else:
        result = harden_profile(args.profile, allow_real=args.allow_real, dry_run=args.dry_run)
        if args.dry_run:
            print(result['diff'])
            print('Quarentena prevista: ' + ', '.join(result['would_quarantine']))
            print('Marcador previsto: .no-bundled-skills; backup: config e extensões no próprio perfil.')
        else:
            print('Configuração mínima gravada; backup verificado: ' + str(result['backup']))
except (ValueError, OSError):
    # Não refletir conteúdo de configuração, credenciais ou erros internos de parsing.
    parser.exit(2, 'Operação recusada: alvo, configuração, backup ou estado ativo não verificável; preserve os arquivos e revise o procedimento.\n')
