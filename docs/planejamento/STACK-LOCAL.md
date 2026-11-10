# Stack oficial e planejamento da migração local

Decisão fornecida pelo usuário em 2026-11-10. Estado: direção tecnológica definida e planejamento para revisão; **nenhuma migração foi implementada por este documento**. O pedido posterior de commit autoriza registrar o plano, não instalar dependências, implementar a prova de conceito ou publicar em remoto.

Esta direção substitui a proposta anterior de VPS–PC e as alternativas de stack ainda abertas. A primeira etapa é local no Windows; Linux será validado depois. Não utilizar VPS, PostgreSQL/Supabase ou banco vetorial nesta etapa. O aplicativo Avalonia permanece disponível durante a transição.

## 1. Stack e responsabilidades

| Tecnologia | Responsabilidade |
|---|---|
| React + TypeScript | Interface reutilizável futuramente no navegador |
| Tauri 2 | Distribuição desktop e integrações com o sistema |
| Rust | Somente integrações nativas necessárias; sem reescrever o motor Python |
| Python + FastAPI | APIs, regras de negócio, estado das produções e gerenciamento técnico de tarefas |
| SQLite | Persistência local inicial, no SSD do computador |
| CLI `fabrica` + Remotion | Motor audiovisual independente, composição, prévia e renderização |
| Hermes Agent | Inteligência, memória contextual e coordenação por interfaces externas, sem fork |
| Claude, Codex e Antigravity | Adaptadores especializados posteriores, conforme viabilidade real |
| Armazenamento audiovisual/DAS | Arquivos e backups; não é servidor nem requisito para iniciar o app |

O usuário indicou o Yottamaster VN400C3 para armazenamento. A disponibilidade e a configuração reais ainda precisam ser conferidas. Bancos ativos ficam preferencialmente no SSD, separados da biblioteca de mídia.

FastAPI é a fonte oficial do estado das produções; Hermes coordena agentes e solicita operações autorizadas. Não criar dois motores de produção, duas fontes de aprovação ou um scheduler concorrente ao Hermes sem necessidade demonstrada. O backend funciona sem Tauri.

## 2. Auditoria e reaproveitamento

Leitura realizada sem modificar código, instalar ferramentas ou executar integração. Referências locais: Hórus `3f6a97c`, fábrica `87102ac`, Storybook `cf3cf7b`, estudos `1cecfd4`. Na auditoria, o layout estava somente em `feat/layout-desktop-audiovisual`, commit `7ce68c4`; posteriormente foi integrado à branch principal. A migração tecnológica continua apenas planejada.

| Componente | Evidência | Tratamento |
|---|---|---|
| Desktop C#/Avalonia | `src/Horus/`, serviços, ViewModels e testes | Preservar como referência funcional e aplicação utilizável |
| Layout audiovisual | `MainWindow`, `OverviewView`, prévias e capturas da branch de layout | Referência visual principal para a migração |
| Storybook | `src/horus/Horus.tsx`, `tokens.css`, `horus.css`, fontes e histórias | Reutilizar componentes compatíveis; navegação atual é anterior ao layout desktop |
| Fábrica | `scripts/fabrica/`, perfis, alinhamento e Remotion | Adaptar chamadas e observação, preservando o motor |
| Estudos | Índices, resumos e transcrições de 13 fontes | Preservar; consulta posterior, sem regenerar arquivos |
| FastAPI/Tauri/persistência de jobs | Não encontrados no código do projeto | Implementação nova, após aprovação |
| Pastas locais HORUS Web | Frontend e backend vazios | Não tratar como sistema existente nem mover repositórios para iniciar |

Lacunas concretas da fábrica: `perfil mostrar` devolve JSON com avisos em stderr; render usa `subprocess.run` sem contrato completo de cancelamento/eventos; mineração é stub; pacote, licenças e aprovações ainda têm bloqueios descritos em `DIAGNOSTICO.md`. Essas limitações não desaparecem com uma API.

## 3. Preservação do design — sem redesign

O design oficial para esta migração é o desktop audiovisual, complementado pelo Storybook. Não recuperar a navegação antiga do catálogo como se fosse a referência mais recente.

| Elemento | Critério de preservação |
|---|---|
| Navegação | Visão geral, Radar, Biblioteca, Produção, Canais, Memória, Transcrição e Ajustes |
| Geometria | Barra lateral de 216 px; cabeçalho, conteúdo e rodapé equivalentes |
| Referências de tamanho | 1320 × 840 e 1040 × 680, nos dois temas |
| Cores | Tokens existentes convertidos fielmente para CSS, incluindo ordem do alfa AXAML/CSS |
| Tipografia | Archivo Expanded, Inter e Geist Mono locais, preservando pesos e hierarquia |
| Marca | Mesmo olho orbital e mesma geometria em SVG; sem trocar ícones ou estilo |
| Superfícies | Cantos retos, bordas finas e destaque índigo |
| Comportamento | Seleção, foco por teclado, hover, rolagem, temas e atalhos equivalentes |
| Estados futuros | Prévia explícita; sem estatísticas fictícias ou integração simulada como real |

Os arquivos Archivo Expanded e Geist Mono do desktop e do Storybook foram comparados por SHA-256 e são idênticos. A comparação visual deverá usar escala e fontes fixas. Diferenças de rasterização entre Avalonia e WebView podem exigir ajuste de equivalência, sem mudança deliberada de design. Melhorias visuais além da equivalência exigem aprovação separada.

## 4. Estrutura proposta

```text
horus/
  src/Horus/                  # legado preservado
  tests/Horus.Tests/          # contratos funcionais existentes
  frontend/
    src/
      app/                    # estrutura e navegação
      components/             # componentes reutilizados/adaptados
      features/               # telas e fluxos
      platform/               # adaptação desktop/navegador
      services/               # cliente da API
      styles/                 # tokens e fontes
    src-tauri/                # configuração e Rust mínimo
  backend/
    pyproject.toml
    src/horus_backend/
      api/
      jobs/
      integrations/
      storage/
      main.py
    tests/
  docs/
```

Fábrica, estudos e Storybook continuam nos repositórios existentes. Não há migração de monorepo ou remoção do C# autorizada. Caminhos da fábrica e das bibliotecas serão configuráveis.

## 5. Dependências e fronteiras

- Interface: React, React DOM, TypeScript e Vite, aproveitando as escolhas existentes quando compatíveis.
- Desktop: Tauri 2, ferramentas Rust e plugin de diálogo. No Windows, conferir Build Tools C++ e WebView2 antes de propor instalação.
- Backend: Python 3.12 inicialmente, FastAPI, Uvicorn e Pydantic; SQLite pela biblioteca padrão, sem ORM obrigatório na prova inicial.
- Testes: pytest/HTTPX e testes de interface conforme o incremento. Fixar versões compatíveis e lockfiles ao implementar, sem atualização em massa.
- Render: CLI, Node/Remotion e recursos locais já preparados. Conferir navegador de render antes de executar para evitar download implícito.
- Distribuição: avaliar backend empacotado como sidecar. Não instalar empacotador antes do incremento correspondente.

A fábrica exige Python 3.12. Hermes deve ter ambiente próprio conforme sua versão; não forçar todas as ferramentas a um único ambiente Python.

Tauri controla somente o backend que iniciou e integrações nativas necessárias. Backend escuta em loopback, com autenticação e origens controladas; CORS não é autorização. Operações são enumeradas e entradas/caminhos validados, sem shell arbitrário. Credenciais ficam fora do frontend e do repositório.

O primeiro modelo de execução tem um processo FastAPI/Uvicorn e executor sequencial; tarefas pesadas rodam em subprocessos sob demanda. Não usar somente `BackgroundTasks` como fila recuperável, nem importar Whisper/torch/Remotion na inicialização básica.

## 6. Prova de conceito incremental

| Incremento | Entrega | Aceite |
|---|---|---|
| A | Equivalência visual em React | Navegação, temas, fontes e organização preservados |
| B | Tauri e backend mínimo | Desktop inicia backend, detecta prontidão/falha; backend também funciona sozinho |
| C | Arquivos e vídeo local | Seleção de arquivo/diretório, autorização, reprodução, pausa e busca no vídeo |
| D | CLI real | Executar `fabrica perfil mostrar --canal canal01 --formato json`; preservar dados, avisos e falhas |
| E | Tarefa longa real | Render de rascunho com fixture local aprovada; estágio, logs e cancelamento real |
| F | Persistência e recuperação | Histórico/estados restaurados, sem repetição automática de execução incerta |
| G | Build otimizado e medição | Relatório de inicialização e árvore de processos em produção |

A consulta de perfil é curta demais para provar cancelamento. O render de teste não usa ElevenLabs, inferência ou download de assets. Progresso sem percentual confiável será indeterminado, com estágio real; não fabricar porcentagens.

Eventos têm identificação e sequência; assinaturas terminam com a tarefa. Logs são limitados e paginados. Não manter polling ou processamento contínuo em repouso.

Cancelamento: pedir término, aguardar prazo, encerrar somente a árvore de subprocessos da tarefa quando necessário e confirmar o resultado. Desconectar a interface não cancela a tarefa. Testar Windows e depois Linux.

Recuperação: concluídos permanecem concluídos; pendentes voltam à fila; execuções interrompidas são identificadas e reconciliadas. Retomar estado não significa checkpoint de qualquer processo: render pode precisar reiniciar uma etapa. Chamadas pagas de resultado desconhecido não são repetidas automaticamente.

## 7. Vídeo, dados e migração funcional

Começar reprodução de arquivo final com `<video>`. Integrar `@remotion/player` depois, sob demanda, reutilizando a composição existente; não carregar editor/renderer na tela inicial. Testar codecs e busca: aceitar um formato na transcrição não garante reprodução na WebView.

Autorizar somente arquivos selecionados e escopos necessários; não expor o disco inteiro. SQLite é acessado pelo backend no SSD local. Mídia pode ficar no DAS; indisponibilidade deve ser um estado tratável. Backups do banco devem ser consistentes, sem cópia arbitrária durante escrita ou banco ativo em compartilhamento de rede.

Preservar o Avalonia até validar as funções equivalentes. A migração da transcrição não integra a primeira prova e deve reproduzir depois: limite de 20 arquivos, FIFO, texto parcial em cancelamento, revisão, salvamento, bloqueio de avanço até salvar a revisão atual e download sem sobrescrever resultado em edição.

Memória operacional começa em Markdown versionado e SQLite; aprendizados propostos não alteram regras críticas ou perfil editorial automaticamente. `perfil.yaml` continua oficial. Não regenerar fontes de estudo.

## 8. Desempenho e testes

Metas de avaliação do usuário, não garantias: aproximadamente 250 MB de RAM em repouso para interface e serviços mínimos, CPU próxima de zero e inicialização em aproximadamente 3 segundos.

Medir Tauri, processos WebView e backend juntos, explicando a métrica e evitando contagem duplicada de memória compartilhada. Medir Whisper, Remotion e Hermes em cenários separados quando ativados; não excluir silenciosamente processos do baseline.

Protocolo proposto: build de produção sem Vite/debug/reload, registrar hardware/Windows/WebView/build; 20 inicializações com ambiente preparado; medir primeira interface utilizável e backend pronto separadamente; repouso por 60 segundos após estabilização. Inicializações frias têm ensaio separado com definição explícita de frio. Referência operacional inicial: CPU média abaixo de 1% no repouso na máquina avaliada, com contexto registrado.

Testes críticos: CLI inválido/JSON malformado/timeout; caminhos não autorizados; tarefas repetidas; cancelamento da árvore de processos; reinício app/backend; storage ausente; estado de cobrança incerta; foco/temas/navegação; comparação visual; recursos em produção. Nenhum desses testes da nova stack foi executado nesta auditoria.

## 9. Riscos e limites de aprovação

| Risco | Tratamento proposto |
|---|---|
| Empacotamento Python pesado | Backend mínimo; dependências audiovisuais sob demanda |
| UI bloqueada ou subprocessos órfãos | Processos isolados e ciclo de vida testado |
| Divergência visual | Referência desktop congelada, capturas e revisão nos dois temas |
| Perda de transcrição funcional | Legado preservado e migração por contratos/testes |
| Estado duplicado entre agentes | Backend oficial para produções; IDs Hermes referenciados |
| APIs de agentes não disponíveis | Adaptadores isolados após confirmar interfaces, permissões e custo |
| Falhas de licença/pacote existentes | Consolidar fábrica antes de liberar produção real |

Primeiro incremento recomendado para aprovação: equivalência visual em React, Tauri iniciando FastAPI mínimo e consulta de perfil real. Player, tarefa longa e recuperação vêm em seguida. Não iniciar a implementação apenas porque este documento foi commitado.

## Fontes técnicas consultadas

- [Tauri: pré-requisitos](https://v2.tauri.app/start/prerequisites/), [sidecars](https://v2.tauri.app/develop/sidecar/), [capabilities](https://v2.tauri.app/security/capabilities/) e [assets locais](https://v2.tauri.app/reference/javascript/api/namespacecore/).
- [FastAPI: tarefas de background](https://fastapi.tiangolo.com/tutorial/background-tasks/) e [lifespan](https://fastapi.tiangolo.com/advanced/events/).
- [SQLite: WAL](https://www.sqlite.org/wal.html).
- [Remotion Player](https://www.remotion.dev/docs/player/).
- [Hermes: MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) e [API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).

As fontes públicas são mutáveis; validar versões antes de implementar. Não presumir que recursos documentados existam na instalação local.
