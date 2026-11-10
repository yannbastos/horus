# Direção oficial do Hórus

A especificação de produto vigente está em [visão do produto](../vision.md). O Hórus tem foco exclusivo em inteligência e operação audiovisual.

Fluxo pretendido: descoberta → análise → seleção → planejamento → aprovação → produção → controle técnico e de licenças → revisão final → publicação manual → análise de resultados.

A direção técnica é React/TypeScript, Tauri 2, Rust nativo mínimo, Python/FastAPI e SQLite. A fábrica mantém seu CLI independente e o Remotion; Hermes será integrado externamente, sem fork inicial. O Avalonia permanece para transcrição até validar sua substituição.

A biblioteca reúne mídia de produção e entregas. O histórico operacional registra execuções, erros, revisões, custos e decisões editoriais. Configurações editoriais continuam no `perfil.yaml`, sem duplicação em documentos ou banco.

A implementação incremental foi autorizada pelo usuário. Isso não autoriza chamadas pagas, publicação de vídeos, mensagens externas, alterações no Hermes ou perda de arquivos do operador. Confira o estado real em [migração local](../migracao-local.md) e os próximos marcos no [roadmap](../roadmap.md).
