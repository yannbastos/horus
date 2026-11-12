# Desenvolvimento e testes em worktrees

Cada checkout deve instalar suas dependências e gravar seus próprios dados e resultados. Este procedimento cobre o frontend no navegador, Playwright e o backend local simulado. Não usa perfil Hermes, credenciais de provedores ou inferência real.

## Preparação no Windows

Use um worktree/branch exclusivo, criado pelo Orca ou pelo responsável pela coordenação. Execute na raiz desse checkout, nunca no checkout de outro agente:

```powershell
node frontend/scripts/check-worktree.mjs
uv sync --project backend --frozen --extra test
npm.cmd ci --prefix frontend --ignore-scripts --userconfig frontend/.npmrc
```

O projeto exige Python 3.12; o `uv` seleciona a versão compatível. Não copie nem vincule `node_modules`, `.venv`, `dist`, resultados ou bancos de outro checkout. O preflight não depende de pacotes instalados e recusa symlinks/junctions nos destinos e seus ancestrais dentro do worktree. Se encontrar um link, interrompa e peça ao responsável que corrija o ambiente; não execute instalação sobre ele. Os locks permanecem intactos. Caches normais dos gerenciadores de pacotes não substituem os ambientes próprios de cada checkout.

## Portas e dados por ambiente

Na sessão de cada worktree:

```powershell
$env:HORUS_FRONTEND_PORT = '1432'
$env:HORUS_BACKEND_PORT = '8772'
$env:HORUS_API_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
npm.cmd --prefix frontend run backend:dev
```

Em outro terminal **do mesmo worktree**, configure `HORUS_FRONTEND_PORT=1432` e execute:

```powershell
npm.cmd --prefix frontend run dev
```

Abra `http://127.0.0.1:1432`; em Ajustes → Geral conecte `http://127.0.0.1:8772` com o token gerado. O launcher exige token de pelo menos 24 caracteres e nunca o imprime. Ele usa o Python de `backend/.venv`, força executores simulados e direciona conexão/perfil Hermes a caminhos locais vazios; não cria nem configura um perfil real. Não copie configurações Hermes para esses caminhos.

| Variável | Padrão | Uso |
|---|---|---|
| `HORUS_FRONTEND_PORT` | `1420` | Vite dev/preview, baseURL e servidor do Playwright; origem CORS enviada pelo launcher |
| `HORUS_BACKEND_PORT` | `8765` | Porta do backend iniciado por `backend:dev` |
| `HORUS_DATA_DIR` | `backend/.cache/worktree-data` | Dados do launcher; caminho relativo à raiz ou absoluto dentro deste worktree, sem links |
| `HORUS_FRONTEND_ORIGIN` | ausente | Backend direto: uma origem adicional exata `http://127.0.0.1:porta` ou `http://localhost:porta` |

Portas aceitam somente dígitos e valores 1–65535; frontend e backend do launcher precisam de portas diferentes. Valor vazio/inválido falha, sem fallback silencioso. `HORUS_FRONTEND_ORIGIN` recusa HTTPS, hosts externos, outros IPs, credenciais, caminhos, barras finais e curingas. As origens padrão de 1420 e Tauri permanecem permitidas; token e validação de Host continuam obrigatórios. CORS não substitui autenticação. O launcher deriva a origem de `HORUS_FRONTEND_PORT`; não use uma origem divergente.

Para iniciar o backend diretamente, mantenha a configuração equivalente e **defina um diretório de dados isolado**:

```powershell
$env:HORUS_FRONTEND_ORIGIN = 'http://127.0.0.1:1432'
$env:HORUS_DATA_DIR = Join-Path $PWD 'backend/.cache/manual-data'
$env:HORUS_WORKFLOW_EXECUTOR = 'simulated'
$env:HORUS_RADAR_EXECUTOR = 'hermes_simulated'
& backend/.venv/Scripts/python.exe -m horus_backend --port 8772
```

Prefira `backend:dev`: o comando direto não faz o preflight nem redireciona configurações Hermes. Não execute operações Hermes no modo direto deste exemplo.

As reservas desta coordenação são main `1420/8765`, Antigravity `1431/8771`, HOR-011 `1432/8772` e Sonnet `1433/8773`. O par `1434/8774` fica para ensaio duplo. Essas reservas são convenção da sessão, não alocação automática. Nunca encerre um servidor de outro agente para liberar uma porta: escolha outro par com o coordenador.

## Testar e validar colisões

```powershell
$env:HORUS_FRONTEND_PORT = '1432'
npm.cmd --prefix frontend run test:config
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_worktree_config.py -q
```

`test:config` precisa das portas **1432 e 1434 livres**; pare seu próprio Vite antes de executá-lo. Ele inicia duas instâncias Vite simultâneas, verifica configurações independentes, recusa junction compartilhada e comprova que Vite/Playwright recusam um servidor existente, dentro e fora de CI. O teste dedicado Python inicia dois backends simulados em **8772 e 8774**, com dados temporários e IDs de bancos distintos, e verifica recusa de colisão. Libere somente processos próprios antes desse ensaio. Os testes encerram apenas os processos que iniciaram.

Playwright sempre usa `reuseExistingServer: false`: até um servidor saudável do mesmo checkout é recusado se já estiver na porta. Vite usa `strictPort: true`; não migra silenciosamente para a porta seguinte. O backend faz bind exclusivo antes de abrir o banco e informa erro se a porta estiver ocupada. Não há mecanismo de descobrir/reutilizar servidores por resposta HTTP.

`node_modules`, cache Vite, `dist`, `.venv`, dados e `artifacts` pertencem ao checkout. Resultados Playwright ficam em `frontend/test-results/<porta>`. Os mocks CORS dos testes derivam a origem da mesma configuração; nenhum servidor real em 8765 é necessário para a suíte de interface. Não execute dois builds ou duas suítes na mesma porta/diretório simultaneamente no mesmo checkout; use outro worktree para isso. Os testes dedicados exercitam duas configurações/instâncias na mesma árvore, sem criar outro worktree nem compartilhar ambientes com main.

## Compatibilidade e limites

Sem variáveis, continuam os padrões 1420/8765. A configuração Tauri não foi alterada: `devUrl` continua 1420 e o ciclo de vida/dados do backend desktop seguem sua implementação existente. Para desenvolver o desktop padrão, remova `HORUS_FRONTEND_PORT` da sessão; este guia não certifica isolamento de dados do desktop nem autoriza usar dados operacionais em testes. Uma porta diferente no Tauri exige configuração explícita correspondente do `devUrl`.

As variáveis são lidas do ambiente do processo; não são uma nova política global nem configuração de produto. Não use overrides CLI de porta em conjunto com Playwright: a origem deve vir de `HORUS_FRONTEND_PORT`. O teste de junction exige capacidade de criar junctions/symlinks; Linux ainda requer validação própria. O preflight detecta links existentes, mas não protege contra alterações concorrentes maliciosas no sistema de arquivos.

## Evidência local desta entrega

Em 2026-11-12, Windows, Python 3.12 e Node 26: instalação própria com locks congelados, preflight, build frontend, 4 testes dedicados de configuração e 84 testes Playwright na porta 1432 aprovados. Backend: 468 aprovados e 1 ignorado (symlink sem privilégio no Windows), incluindo 13 testes novos de origem/dados/processos. Smoke do launcher validou `/health`, origem 1432 e banco próprio em `backend/.cache/launcher-smoke`, mesmo com executores inválidos herdados (substituídos pelos simulados). Os ensaios de duas instâncias usaram 1432/1434 e 8772/8774 e comprovaram recusa de servidores/portas já ocupados. Não houve inferência, alteração de perfil Hermes, build Tauri, publicação ou validação Linux.
