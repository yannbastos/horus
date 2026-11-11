# Visão do produto

O Hórus é uma plataforma de inteligência e operação audiovisual: pesquisar oportunidades, analisar vídeos e canais, planejar conteúdo original, coordenar produções e acompanhar resultados.

## Escopo

- Radar de vídeos, canais e oportunidades com fontes e métricas verificáveis.
- Análise narrativa e visual para orientar abordagens originais.
- Briefings, roteiros, títulos e thumbnails com aprovação humana.
- Produção pela fábrica Python independente e Remotion.
- Biblioteca de mídia, narração, transcrições, legendas e arquivos finais.
- Gestão de canais, custos e resultados próprios autorizados.
- Histórico operacional de execuções, falhas, revisões e decisões editoriais.

O foco inicial é um canal no YouTube, com publicação manual. A expansão depende da validação de Shorts e vídeos longos, qualidade, tempo de produção e orçamento.

## Arquitetura

| Componente | Responsabilidade |
|---|---|
| React/TypeScript e Tauri 2 | Interface desktop, preservando identidade visual e compatibilidade futura com web |
| Rust | Integrações nativas necessárias ao desktop |
| Python/FastAPI e SQLite | Regras de negócio, tarefas, persistência e APIs locais |
| Fábrica Python/CLI e Remotion | Motor independente de execução audiovisual |
| Hermes Agent | Inteligência e orquestração por integração externa futura, sem fork inicial |
| Storybook | Catálogo visual com exemplos audiovisuais |

A transcrição Avalonia continua preservada até equivalência funcional na nova stack. O estado implementado e os limites estão em [migracao-local.md](migracao-local.md).

## Princípios

Originalidade, aprovação humana por versão, rastreabilidade de fontes/licenças, limites de custo e recuperação de falhas. O histórico operacional não substitui `perfil.yaml`: esse arquivo continua sendo a fonte oficial das preferências editoriais.

Nenhuma métrica privada de concorrentes será presumida disponível. Observações, estimativas e hipóteses devem ser identificadas. Não há promessa de receita, monetização ou publicação automática.

Windows local é a plataforma inicial; Linux exige validação própria. Não utilizar VPS nesta etapa. Não modificar o core do Hermes nem criar um segundo motor de produção.

Veja o [roadmap](roadmap.md), a [arquitetura implementada](architecture.md) e o [planejamento técnico](planejamento/README.md).
