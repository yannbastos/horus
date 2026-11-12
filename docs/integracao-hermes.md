# Integração local com Hermes Agent

## O que existe

Adaptador de diagnóstico no backend FastAPI, descoberta do CLI instalado no Windows e painel em Ajustes. O Hórus consulta a API pública do Hermes; não importa módulos privados e não modifica seu código-fonte.

Validação local: Hermes Agent 0.23.1, revisão reportada `3b4215785882`, instalado pelo CLI no Windows. Foram consultados a ajuda do executável e o código instalado de `gateway/platforms/api_server.py` e de perfis. Referências públicas: [API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) e [CLI](https://hermes-agent.nousresearch.com/docs/reference/cli-commands). Compatibilidade com outras versões exige nova verificação.

## Preparar no Windows

> **Aprovação:** os comandos abaixo criam perfil, chave e arquivos privados de conexão do Hermes e iniciam um processo externo. Agentes só devem executá-los com autorização específica da tarefa, conforme [AGENTS.md](../AGENTS.md#peça-aprovação-antes-de).

Com o Hermes CLI já instalado, execute na raiz do Hórus, pelo PowerShell:

```powershell
./scripts/Prepare-Hermes.ps1
./scripts/Prepare-Hermes.ps1 -StartGateway
```

O primeiro comando cria um perfil `horus`, sem clonar configurações, credenciais de provedor, canais, tarefas ou skills do perfil principal. A preparação da conexão não aplica o endurecimento mínimo: antes de inferência, seguir o [guia de segurança](seguranca-hermes.md); o gate bloqueia perfis inseguros. A preparação usa o modo `gateway.standalone: true` e desativa multiplexação para esse perfil. Nenhum job de cron ou canal de mensagens é adicionado.

O segundo comando inicia a API do perfil em `127.0.0.1:8643`. Não instala um serviço do Windows. O processo é externo ao Hórus, permanece ativo ao fechar a janela do aplicativo e precisa ser iniciado novamente após reinicialização. Para gerenciamento, use o CLI com escopo `-p horus`; não reinicie ou encerre o gateway principal para resolver esta integração.

O gateway principal pode levar até 30 segundos para liberar um perfil recém-criado para execução isolada. O script reconhece essa recusa específica e só repete depois de a tentativa anterior ter encerrado. Não usa `--replace`, `--force` ou bypass de aprovações.

`-HermesExecutable`, `-HermesHome` e `-Port` permitem adaptar a preparação. O padrão corresponde à instalação Windows em `%LOCALAPPDATA%/hermes`. O script recusa sobrescrever um perfil `horus` preexistente sem seu marcador de preparação e não troca chaves em novas execuções. Uma porta ocupada por outro serviço é um erro; o script não encerra seu processo.

## Arquivos privados

- `%LOCALAPPDATA%/hermes/profiles/horus/`: configuração do perfil, `.env`, identidade audiovisual e logs locais.
- `%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json`: origem HTTP e chave de conexão, consumidas pelo backend.

Esses arquivos ficam fora do repositório. Não envie `.env`, arquivo de conexão ou logs privados ao GitHub. A chave é gerada localmente com gerador criptográfico; não é impressa no terminal nem enviada à interface.

`HORUS_HERMES_CONFIG` permite selecionar outro arquivo privado de conexão. `HORUS_HERMES_EXECUTABLE` permite indicar um CLI instalado fora dos locais descobertos. O arquivo da conexão tem a forma lógica `base_url` e `token`; a origem precisa ser HTTP com endereço IP de loopback e porta explícita, sem caminho, credenciais na URL, query ou fragmento.

## Verificar pelo aplicativo

Abra Ajustes e use **Verificar conexão Hermes**. O Hórus distingue CLI localizado, conexão não preparada, API indisponível, chave recusada e API autenticada verificada. O horário da consulta é apresentado; não há polling em repouso.

| Endpoint Hórus | Comportamento |
|---|---|
| `GET /v1/hermes` | Último estado local; não envia prompts ou faz consultas ao Hermes |
| `POST /v1/hermes/probe` | Consulta `GET /health` e `GET /v1/capabilities` no Hermes |

O resultado exige identidade `hermes-agent`, capacidades públicas reconhecidas e autenticação Bearer obrigatória. A presença do executável, sozinha, não significa conexão. Uma resposta antiga deixa de representar conexão confirmada após 90 segundos no backend. Cliques repetidos em menos de dois segundos reutilizam a consulta recente.

O adaptador ignora proxies de ambiente, recusa redirecionamentos e limita tempo de rede e tamanho das respostas. As respostas ao frontend contêm somente estado, versão validada e recursos conhecidos; não incluem chave, caminho privado ou corpo bruto de erro do Hermes.

## Validação e próximo incremento

O adaptador foi testado contra a API autenticada real do perfil `horus`, sem inferência. Testes automatizados cobrem credencial recusada, identidade incorreta, autenticação desabilitada, redirects, URLs externas, resposta excessiva e navegação do painel com serviços simulados.

Após recompilar o Tauri release e o backend empacotado, a ação Verificar conexão Hermes foi executada pela interface desktop e confirmou autenticação com o serviço real. A validação deste incremento passou em 45 testes do backend, três testes de interface e no build desktop/NSIS. O instalador público anterior não é substituído automaticamente pelo novo build local.

Modelo/provedor ainda precisam ser configurados no perfil exclusivo antes de uma análise real. O reconhecimento de capacidades não autoriza chamadas ou indica que orçamento, aprovações e cancelamento de produção já estejam integrados. O executor cognitivo editorial já possui envio autenticado de runs, condicionado à autorização humana e ao gate de segurança; publicação não está integrada.

Próximo incremento: definir modelo/provedor e orçamento, validar uma análise audiovisual delimitada e só depois conectar ferramentas da fábrica com aprovações persistentes. Não usar `hermes -z` como atalho: a ajuda da versão instalada informa que esse modo ignora aprovações automaticamente.

## Isolamento e gate de segurança (M2)

O [guia de segurança Hermes](seguranca-hermes.md) registra a auditoria de leitura do perfil real, a configuração mínima sem ferramentas e o procedimento de aplicação dependente de autorização do idealizador. O perfil operacional não foi endurecido automaticamente. `GET /v1/security/status` é somente leitura, exige a autenticação local e não inicia processos nem abre rede. Configuração não verificável, ferramentas efetivas, memória ativa/externa, bind público e ausência de tetos bloqueiam autorização real com HTTP 409 `security_gate`; o adaptador repete o gate antes do envio. A simulação permanece independente do perfil.

O operador seleciona o perfil auditado por `HORUS_HERMES_PROFILE` e os tetos por `HORUS_MAX_TOKENS_PER_RUN`/`HORUS_MAX_TOKENS_PER_DAY`. Eles não são modificáveis pelo payload do agente. Há admissão conservadora, reserva diária atômica e persistência de `usage`, mas não há limite financeiro rígido comprovado no provedor nem isolamento de SO do gateway externo. A ausência desses controles permanece explícita no guia e no status.

Por compatibilidade com o CHECK da migração v3, `cognitive_runs.provider` continua `hermes`. Para distinguir simulação, juntar com `workflows.cognitive_client` através de `jobs`; o artefato de análise simulado contém `provider: hermes_simulated`. Não foi criada migração.
