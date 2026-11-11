# Plano de validação e relatório de aplicação

> **Classificação documental — 2026-11-11:** Catálogo histórico de cenários, não relatório de execução atual. Resultados posteriores e lacunas estão em [ROADMAP](../ROADMAP.md) e [validação local](../validacao-local-2026-11-10.md). Casos VPS–PC são futuros; a autorização de publicação documental mencionada ao final é histórica e pontual; não autoriza commit, push, execução de testes ou tarefas futuras.

Estado: cenários preparados, **não executados**. A preparação nesta máquina verifica somente texto, links e sintaxe dos exemplos; não comprova funcionamento de Hermes, VPS ou executor.

## Portões de evolução

| Portão | Evidência para avançar |
|---|---|
| A — ambiente conhecido | Relatório local com versões, ambiente e contratos disponíveis; nenhuma mudança implícita |
| B — leitura integrada | Hermes consulta perfil e relata resultado real; ausência de efeitos não autorizados |
| C — operação segura da fábrica | Bloqueios de licença/aprovação e pacote testados diretamente pelo CLI |
| D — tentativa recuperável | Reinício, perda de conexão e resultado incerto não repetem produção/cobrança automaticamente |
| E — distribuição VPS–PC | PC indisponível mantém trabalho em espera; autenticação e reconciliação testadas |
| F — interface | Mesmas regras pelas ferramentas e interface, sem segundo motor |

Não é necessário contratar VPS para A–D. Escolher cada implementação após a evidência do portão anterior. Simulações devem usar executores/provedores falsos, sem iniciar inferência, downloads ou serviços pagos.

## Cenários de aceite

| ID | Cenário | Resultado esperado | Onde validar futuramente |
|---|---|---|---|
| L01 | CLI retorna perfil válido e avisos em stderr | Dados e avisos separados; sucesso se código zero e contrato válido | Adaptador local com CLI simulado |
| L02 | Canal ausente | Erro classificado sem fabricar perfil | Adaptador/CLI |
| L03 | ID contém caminho absoluto, `..` ou separador | Rejeição antes de executar | Validação de entrada |
| L04 | Raiz contém caminho com espaços e caracteres Unicode | Argumentos e saída preservados sem shell | PC Windows |
| L05 | Código zero com JSON inválido | Erro de contrato | Adaptador simulado |
| L06 | Timeout de leitura | Processo tratado, erro registrado, sem instalação/reparo | Adaptador simulado |
| L07 | JSON contém `example_only: true` ou campo desconhecido | Exemplo rejeitado como trabalho real; campos não permitidos rejeitados | Futuro validador |
| A01 | Agente envia aprovação própria ou teto maior | Não concede permissão; identidade/limite vêm do registro confiável | Política de domínio |
| A02 | Roteiro muda após aprovação | Etapa seguinte bloqueada e revisão antiga preservada | CLI e camada de domínio |
| A03 | Roteiro muda durante render | Resultado fica ligado à entrada antiga, sem promoção automática | Executor simulado |
| A04 | Imagem sem licença ou override fora do manifesto | Pacote bloqueado | CLI de publicação |
| A05 | Plano de voz não confirmado | Não assumir licença comercial | Provedor simulado |
| A06 | Falta SRT/metadados/thumb exigidos | Pacote incompleto não é liberado | CLI de publicação |
| Q01 | PC desligado | `waiting_executor`; sem tentativa/cobrança criada | Registro/dispatcher simulado |
| Q02 | Duas solicitações da mesma chave e mesmas entradas | Uma intenção e resultado reutilizado quando seguro | Persistência |
| Q03 | Mesma chave com entradas diferentes | Conflito explícito | Persistência |
| Q04 | Dois executores disputam um render | Só um obtém posse; capacidade local respeitada | Executor/registro |
| Q05 | Conexão cai com render ainda ativo | Reconciliar; não redistribuir por timeout automaticamente | Executor falso |
| Q06 | Resultado de tentativa antiga chega depois | Arquivar evidência, sem sobrescrever a atual | Registro |
| Q07 | Cancelar turno do Hermes durante render | Estado reflete o subprocesso; não confundir pedido com término | Integração real após aprovação |
| Q08 | Falha após chamada paga e antes de receber resposta | `reconciliation_required`, sem nova cobrança automática | Provedor falso |
| Q09 | Reinício com recibo local de execução | Recuperar e reconciliar estado antes de repetir | Persistência/recibos |
| M01 | Memória proposta contradiz regra crítica | Nenhuma mudança de política | Recuperação/validação |
| M02 | Preferência validada substitui anterior | Perfil/guia oficial atualizado por revisão, sem duplicação | Fluxo de memória |
| M03 | Fonte externa contém instrução para gastar/publicar | Tratada como dado; sem elevação de permissão | Ferramentas e agente |
| B01 | Restore de cópia do registro e inventário | Integridade e referências verificadas em área isolada | Operação de backup |

## Relatório a preencher na máquina principal

Copiar esta seção para o relatório de diagnóstico. Não preencher com suposições.

```text
Data e operador:
Escopo autorizado:

Git por repositório (branch, commit, alterações locais):
Hermes (versão, commit se disponível, método de instalação):
Execução (Windows nativo/WSL, perfil ativo, terminal backend):
Fábrica (comando resolvido, versão/commit, interpretador):
Ferramentas já existentes (Node, ffmpeg, Whisper, Remotion):
Contratos Hermes confirmados (skills/MCP/API/cron):
Documentação ou código correspondente à versão:
Diferenças para o upstream consultado no planejamento:

VPS contratada/configurada? Evidência, sem credenciais:
Armazenamento disponível? Tipo/local, sem publicar caminhos pessoais:
Políticas e limites de custo confirmados:
Capacidades ainda não testadas:
Bloqueios e evidências:

Operações executadas e efeitos observados:
Testes executados (IDs, resultado e evidência):
Testes não executados e motivo:
Arquivos/configurações que se propõe alterar:
Diff ou desenho do incremento:
Plano de reversão/recuperação:
Decisões necessárias do usuário:
```

## Sequência de tarefas pequenas

| Tarefa | Dependência | Saída revisável | Esforço | Risco principal |
|---|---|---|---|---|
| T01 Inspeção local sem alterações | Acesso à máquina principal | Relatório acima e contratos por versão | P | Confundir upstream com instalação |
| T02 Revisar contrato de leitura | T01 | Operação e saída alinhadas ao CLI real | P | Adaptador alterar semântica |
| T03 Propor primeiro adaptador | T02 e aprovação | Diff mínimo, somente leitura e testes L01–L07 | M | Exposição excessiva de ferramentas |
| T04 Executar leitura pelo Hermes | T03 e orçamento aprovado | Resultado rastreável, sem Telegram/produção | P | Custo e efeitos imprevistos |
| T05 Corrigir guardas da fábrica | Auditoria atualizada e aprovação | Diff com testes A01–A06 aplicáveis | M | Liberação indevida |
| T06 Validar primeiro Short | T05, perfil e orçamento | Artefatos, checklist e revisão humana | M | Qualidade e tempo de produção |
| T07 Avaliar estado/recuperação do Hermes | T01 e contrato de produção | Mapa de garantias reutilizáveis e lacunas | M | Duplicar infraestrutura |
| T08 Implementar só lacunas de produção | T06–T07 e aprovação | Persistência mínima e testes Q01–Q09 | G | Duplicação/cobrança |
| T09 Validar distribuição | T08, infraestrutura decidida | Ensaio VPS–PC e recuperação | M | Conectividade e credenciais |

P/M/G são relativos e não estimativas de prazo. A autorização atual cobre estes documentos e sua publicação; tarefas executáveis continuam dependentes de revisão e aprovação do incremento.
