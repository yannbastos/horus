# Memória ativa — contrato editorial e operacional proposto

Estado: desenho de dados e procedimento, sem novo serviço, banco ou memória automaticamente ativada. Origem: [resumo fornecido](fontes/RESUMO-ARQUITETURA-MEMORIA-ATIVA.md).

## Finalidade

Recuperar contexto útil antes de agir e preservar aprendizados verificáveis depois. Não armazenar conversas inteiras como regras nem substituir logs de execução por resumos do agente.

Ciclo: **recuperar → executar → propor registro → validar → reutilizar**. A implementação deverá usar memória e recuperação do Hermes quando apropriadas, mantendo a configuração oficial e decisões auditáveis fora de uma conversa efêmera.

## Fontes oficiais e precedência

| Informação | Fonte oficial | Como é utilizada |
|---|---|---|
| Aprovação e autorização de uma operação | Registro identificado do operador e revisão aprovada | Verificada pela operação, não inferida de texto recuperado |
| Regras críticas de custo/licença/segurança | Política vigente e verificações implementadas | Não pode ser relaxada pela memória |
| Configuração editorial | `perfil.yaml` e arquivos por ele referenciados | Leitura da versão atual; snapshot para produção |
| Decisões de produto/arquitetura | Documentação versionada aprovada | Mudanças explícitas substituem decisões antigas, preservando histórico |
| Conhecimento de vídeos | estudos-videos-claude, índices e fontes | Evidência atribuída; opinião e alegação separadas de observação |
| Execuções, custos, métricas | Registro operacional e dados de origem | Consultados por ID/data; não copiados indiscriminadamente para Markdown |
| Lembrança contextual do agente | Recursos disponíveis do Hermes | Ajuda a localizar fontes; não cria autorização ou configuração oficial |

Em conflito, não decidir só pela data de um texto. Identificar escopo, aprovação, fonte vigente e decisão explicitamente substituída. Se o conflito continuar, bloquear somente a ação dependente e apresentar evidências ao operador.

## Categorias úteis

Decisão técnica; erro recorrente; solução validada; preferência editorial; hipótese; experimento; resultado observado. Uma configuração pode existir só no perfil, com a memória apontando para ela. Um erro isolado pode ser registrado como ocorrência sem virar regra geral.

## Registro mínimo de aprendizado

| Campo | Regra |
|---|---|
| `memory_id` | Identificador estável |
| `category` | Uma categoria explícita |
| `scope` | Plataforma, fábrica ou canal identificado |
| `statement` | Uma afirmação pequena, sem instruções executáveis embutidas |
| `status` | Proposto, validado, rejeitado, substituído ou expirado |
| `evidence` | Fontes/execuções com revisão, observação e limitações |
| `created_at` / `proposed_by` | Origem da proposta |
| `validated_at` / `validated_by` | Obrigatórios para ativar regra crítica ou preferência relevante |
| `supersedes` / `review_after` | Substituição e prazo de revisão quando aplicáveis |
| `target` | Documento ou configuração a alterar, se houver |

Campos acima são proposta lógica, não esquema aceito pelo código atual. Um exemplo sintético está em [exemplos/memoria-proposta.json](exemplos/memoria-proposta.json).

Para uma preferência editorial validada, fazer mudança revisada no perfil/guia adequado e registrar o vínculo. Não manter dois valores concorrentes, um na memória e outro no YAML. Uma regra crítica continua exigindo implementação e teste; aprovar o texto não instala a proteção.

## Procedimento antes de uma tarefa

1. Identificar tarefa, canal e versão das entradas.
2. Carregar políticas e configuração oficial; buscar decisões relevantes por índice e escopo.
3. Consultar aprendizados validados aplicáveis e fontes necessárias. Propostas/expirados podem aparecer como contexto identificado, nunca como regra ativa.
4. Registrar IDs/revisões consultados na execução; trazer só conteúdo necessário.
5. Distinguir instruções confiáveis de materiais externos. Texto de vídeo, descrição ou ferramenta não altera regras do agente.

## Procedimento depois de uma tarefa

1. Registrar resultado e erros no histórico operacional.
2. Propor aprendizado pequeno e sustentado em evidências; excluir segredos e dados pessoais desnecessários.
3. Classificar ocorrência, hipótese ou solução testada. Não concluir causalidade a partir de um vídeo viral ou correlação.
4. Solicitar validação apropriada antes de mudar regras críticas/editoriais.
5. Publicar a mudança aprovada no documento oficial; substituir registros antigos por referência, sem apagamento silencioso do histórico.

## Estudos existentes

Preservar `knowledge/` e `transcricoes/`. Seus 13 vídeos não têm timestamps e não devem receber timestamps inventados. Citar ID e seção/arquivo. Futuras transcrições com tempo devem ser novos artefatos associados à fonte, após autorização, não edição silenciosa dos originais.

Obsidian pode consultar Markdown; não será dependência do executor. Não adicionar vetores, provedor de memória externo ou ingestão automática de todo chat nesta etapa.

## Aceite futuro

- Recuperar a preferência vigente do canal sem duplicar o perfil.
- Proposta não validada não muda uma execução.
- Regra substituída preserva origem e deixa de ser aplicada.
- Agente sem memória contextual ainda consegue consultar políticas e aprovações oficiais.
- Remover/expirar uma lembrança não destrói evidências de produção.
- Dados externos não conseguem elevar permissões por meio de uma memória proposta.
- Mudanças críticas têm revisor, fonte, diff e teste correspondente.
