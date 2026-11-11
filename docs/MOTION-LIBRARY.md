# Biblioteca Inteligente de Motion Design e Edição

Fonte canônica deste módulo **planejado**. Não há biblioteca inteligente operacional na implementação inspecionada. A [Biblioteca atual](../frontend/src/features/Library.tsx) registra/reproduz arquivos de mídia local; isso não implementa análise de edição, catálogo de técnicas ou recomendação.

## Objetivo

Transformar análises audiovisuais em uma biblioteca crescente de conhecimento e componentes práticos, reduzindo retrabalho e aumentando qualidade e consistência das produções.

Quando o usuário solicitar que a IA “desmonte” a edição de um vídeo, o sistema deverá estudar seus elementos audiovisuais, identificar técnicas relevantes e produzir registros estruturados reutilizáveis. Observações e parâmetros inferidos devem ser diferenciados do que foi efetivamente verificado.

## Registro de uma técnica — requisito, não schema implementado

Cada técnica deverá conter:

- Nome, descrição, categoria e tags.
- Referência de origem e intervalo temporal correspondente.
- Parâmetros conhecidos, com limites e incertezas identificados.
- Quando disponíveis, demonstração visual e implementação reutilizável em Remotion.
- Evidência que permita distinguir análise, implementação e validação.

A referência de origem deve ser rastreável; analisar uma técnica não comprova licença para reutilizar imagens, áudio ou outros materiais do vídeo.

## Conhecimento, implementação e validação

| Situação conceitual | Significado |
|---|---|
| Técnica analisada | Registro descritivo fundamentado em uma referência; não implica código reutilizável |
| Modelo implementado | Existe componente/composição identificável; isso não comprova sua validação |
| Modelo validado | Há evidências de comportamento e resultado no contexto declarado |

Essas classificações são requisitos documentais, não enumerações de banco ou API existentes. Não anunciar modelo como validado apenas por haver código, demonstração ou um render isolado.

A fábrica já possui componentes Remotion como KenBurns e LegendaPalavra e a composição Short9x16. Sua existência não equivale ao catálogo inteligente e não constitui uma certificação de todos os usos. Os componentes permanecem na fábrica; esta reorganização não os altera.

## Uso e integração previstos

O usuário deverá poder pesquisar, filtrar, visualizar, organizar e selecionar modelos para novas produções. O maestro deverá consultar a biblioteca durante o planejamento e recomendar técnicas compatíveis com o objetivo editorial e a identidade visual de cada canal.

Registrar utilização e feedback do usuário, vinculados às versões pertinentes, para que a [memória operacional](AI-SYSTEM.md#fontes-oficiais-e-memória-ativa) contribua para recomendações futuras. Evitar duplicar o perfil editorial ou tratar preferência proposta como configuração aprovada.

Implementações reutilizáveis deverão usar o motor Remotion existente, respeitando as [fronteiras arquiteturais](ARCHITECTURE.md). Não criar um segundo motor de produção ou modificar a interface atual para antecipar o módulo.

## Evolução e limites

Integrar progressivamente após os marcos do [roadmap](ROADMAP.md), com escopo de implementação aprovado separadamente. Preservar a distinção entre biblioteca de mídia e biblioteca de técnicas; não excluir a capacidade atual nem renomear telas por iniciativa documental.

A biblioteca deve respeitar as [diretrizes de identidade visual](ARCHITECTURE.md#identidade-visual-e-equivalência), aprovações, licenças e orçamento. O [contexto original](historico/contexto-original/README.md) permanece como referência histórica integral.
