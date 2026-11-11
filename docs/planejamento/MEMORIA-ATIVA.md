# Registros operacionais da produção audiovisual

> **Classificação documental — 2026-11-11:** Rascunho histórico do registro operacional, preservado com seu exemplo. A fonte canônica de responsabilidades, fontes oficiais e controles é [AI-SYSTEM](../AI-SYSTEM.md#fontes-oficiais-e-memória-ativa). Campos e custos descritos abaixo são requisitos propostos, não um schema completo já implementado.

## Finalidade

Rastrear decisões editoriais, falhas recorrentes, soluções técnicas verificadas, revisões e resultados da produção. Este documento descreve um contrato futuro; a tela consolidada ainda é uma prévia. Tarefas técnicas e eventos já persistem no SQLite do backend.

## Fontes oficiais

| Informação | Fonte |
|---|---|
| Configuração editorial do canal | `perfil.yaml` e guias vinculados |
| Estado de tarefas e eventos | SQLite do Hórus |
| Roteiros, mídia, renders e créditos | Artefatos versionados ou identificados da produção |
| Decisões técnicas duráveis | Markdown revisado em Git |
| Métricas e custos | Banco com origem e data de coleta |

Não duplicar valores de configuração. O registro aponta para a versão do perfil e do artefato correspondente.

## Registro proposto

`memory_id` é o identificador previsto no exemplo documental; `category`, `scope`, `statement`, `status`, `evidence`, `created_at`, `proposed_by`, `validated_at`, `validated_by`, `supersedes`, `review_after` e `target` identificam origem, revisão e escopo. Esses campos ainda não são um schema implementado. Veja [exemplo sintético](exemplos/memoria-proposta.json).

## Controles

- Eventos de execução não substituem aprovações editoriais por versão.
- Sugestões de agentes não modificam regras críticas automaticamente.
- Preferências aprovadas são aplicadas no perfil oficial e vinculadas ao registro.
- Um resultado isolado não comprova causalidade ou rentabilidade.
- Alterações preservam origem e evidências anteriores.
- Texto de vídeo e materiais externos não concedem permissões.
- Excluir segredos e dados pessoais desnecessários dos registros.

Não adicionar banco vetorial, indexação de conversas ou infraestrutura externa sem necessidade comprovada.
