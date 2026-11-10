# Visão do produto

## Propósito

O Hórus é uma plataforma de inteligência audiovisual em desenvolvimento. Seu propósito é reunir pesquisa, análise de referências, planejamento editorial, produção assistida por IA e acompanhamento de resultados, mantendo o operador no controle das decisões.

O projeto surgiu como aplicativo de estudos. A transcrição e o trabalho com materiais de referência continuam úteis; a direção atual amplia o foco para criação audiovisual original e operação de canais.

## Problema

Hoje referências, transcrições, roteiros, produção, revisões e decisões ficam espalhados entre ferramentas. O Hórus pretende conectar essas etapas com rastreabilidade, sem exigir que o operador reconstrua o contexto de cada vídeo a cada sessão.

O objetivo é reduzir trabalho repetitivo e preservar qualidade, não gerar o maior volume possível de conteúdo.

## Público e validação inicial

O uso inicial é a operação de um canal no YouTube pelo idealizador do projeto, com uma rotina compatível com trabalho e estudos. A expansão para outros canais, TikTok e Reels depende da validação do primeiro fluxo.

Um segundo canal só deve ser considerado depois de validar Shorts e vídeos longos do primeiro, incluindo tempo de produção, custos e revisão humana.

## Áreas do produto

- **Radar:** organizar oportunidades e referências com dados acessíveis e origem identificada.
- **Análise audiovisual:** estudar formatos, narrativa, títulos, thumbnails e recursos de comunicação.
- **Planejamento:** transformar pesquisa em propostas originais, briefings e roteiros aprovados.
- **Produção:** acionar e acompanhar a fábrica independente, suas revisões e entregas.
- **Canais:** manter identidade, público, formatos e preferências editoriais.
- **Resultados:** acompanhar métricas autorizadas, custos e experimentos.
- **Memória operacional:** preservar decisões e aprendizados validados, associados a evidências.

Essas áreas são visão de produto. O estado implementado deve ser conferido no [README](../README.md) e na [arquitetura atual](architecture.md).

## Responsabilidades escolhidas

| Componente | Responsabilidade |
|---|---|
| Hórus | Plataforma, interface, regras de negócio, aprovações e organização da operação |
| Hermes Agent | Motor de inteligência e orquestração previsto, integrado externamente sem fork inicial |
| Fábrica Python | Execução técnica independente pelo CLI, preservando voz, alinhamento e render existentes |
| Base de estudos | Referências atribuídas, transcrições e resumos para consulta |
| Storybook | Referências e componentes de design |

As integrações ainda precisam ser validadas na instalação real. A proposta híbrida de VPS e PC não implica contratação, conexão ou serviço já disponível.

## Princípios

1. **Originalidade:** referências ajudam a compreender estruturas e assuntos; não autorizam cópia de roteiros ou vídeos.
2. **Controle editorial:** aprovações humanas identificam a versão revisada.
3. **Rastreabilidade:** registrar fontes, entradas, resultados, licenças e consumo.
4. **Evidência:** separar fato observado, estimativa, hipótese e alegação de terceiros.
5. **Privacidade:** manter credenciais protegidas e enviar a serviços externos apenas o necessário para operações autorizadas.
6. **Independência:** a fábrica deve funcionar sem interface, Hermes ou agente de desenvolvimento permanentemente aberto.
7. **Simplicidade:** reutilizar componentes e adicionar infraestrutura quando sua necessidade for demonstrada.
8. **Sustentabilidade:** acompanhar tempo e custo antes de ampliar a operação.

## Limites atuais

- O código desktop permanece em C#/.NET e Avalonia; não houve migração para outra stack.
- Transcrição e download existem; a plataforma integrada ainda não está pronta.
- O layout audiovisual tem uma branch própria, identificada no README.
- Publicação inicialmente manual; sem promessa de receita ou monetização.
- Sem alegação de acesso à retenção privada de concorrentes.
- Coleta, indicadores e históricos dependem das capacidades e permissões vigentes das APIs.
- Foco atual em Windows; Linux precisa de validação própria.
- A licença geral do projeto ainda não foi definida.

## Desenvolvimento

As próximas entregas e critérios estão no [roadmap](roadmap.md). A especificação detalhada e o contexto de continuidade estão no [planejamento técnico](planejamento/README.md). Requisitos de longo prazo não devem ser apresentados como funcionalidades implementadas.
