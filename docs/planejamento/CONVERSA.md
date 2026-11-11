# Registro das decisões de produto

> **Classificação documental — 2026-11-11:** Síntese histórica preservada. [VISION](../VISION.md), [ARCHITECTURE](../ARCHITECTURE.md) e [ROADMAP](../ROADMAP.md) são as fontes atuais por assunto. As autorizações abaixo, inclusive a implementação incremental do item 4, são históricas e não são permanentes; a necessidade antiga de validar render foi parcialmente atendida por ensaios posteriores, sem concluir validação editorial.

Síntese das decisões vigentes do operador, não exportação de conversas.

1. Hórus é exclusivamente uma plataforma de inteligência e operação audiovisual.
2. React/TypeScript, Tauri 2, Rust restrito à integração nativa, FastAPI e SQLite são a stack oficial. Execução local no Windows, sem VPS; Linux posteriormente.
3. O CLI `fabrica` e o Remotion permanecem como motor independente. Hermes será integrado externamente, sem fork inicial.
4. A implementação incremental está autorizada, preservando design e transcrição Avalonia até equivalência funcional.
5. O fluxo atende descoberta de oportunidades, planejamento, produção, aprovação, entrega e análise de resultados. Um canal inicialmente, um render simultâneo e publicação manual.
6. A biblioteca contém mídia e recursos de produção. O histórico operacional registra execuções, falhas, revisões, custos e decisões editoriais. `perfil.yaml` é a fonte oficial do canal.
7. Aprovações humanas, verificação de licenças, rastreabilidade e orçamento devem ser aplicados por regras explícitas.
8. Chamadas pagas, publicação, Telegram e instalação/modificação do Hermes não estão autorizadas implicitamente por tarefas de desenvolvimento.
9. Avançar por incrementos verificáveis e registrar em Git. A prévia desktop inicial foi distribuída como pré-release; render real e funcionalidades editoriais completas ainda exigem validação.

O estado técnico detalhado está em [migração local](../migracao-local.md). A mudança de posicionamento não autoriza alterar mídias pessoais nem outros repositórios independentes sem necessidade.
