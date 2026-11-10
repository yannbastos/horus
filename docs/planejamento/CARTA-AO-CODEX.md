# Continuidade técnica — Hórus audiovisual

Leia primeiro [AGENTS.md](../../AGENTS.md), [visão do produto](../vision.md), [arquitetura atual](../architecture.md) e [migração local](../migracao-local.md).

## Direção vigente

O usuário definiu foco exclusivo em inteligência e operação audiovisual: oportunidades, roteiros, mídia, produção, canais e resultados. Exemplos e documentos de propostas anteriores foram retirados da base atual. Preserve a identidade visual, cores, fontes, ícones e geometria das telas.

## Componentes

- React/TypeScript e Tauri 2 compõem o novo desktop.
- FastAPI e SQLite centralizam regras, tarefas e persistência.
- CLI `fabrica` e Remotion continuam independentes; não criar outro motor.
- Hermes será integrado por interfaces externas; não baixar, instalar ou modificar seu core sem autorização.
- Avalonia mantém transcrição com Whisper, revisão e salvamento até equivalência funcional.
- Storybook é um catálogo separado de exemplos audiovisuais, sem backend operacional.

## Estado confirmado

Build release e instalador Windows foram gerados. A interface abriu, conectou ao backend empacotado e consultou um perfil real. Fila, logs e biblioteca possuem implementação parcial descrita no guia de migração. Não confundir a prévia distribuída com uma plataforma completa.

## Próximas prioridades

Validar diálogos e reprodução nativos, render real e cancelamento, persistência entre aberturas, encerramento e consumo de recursos. Depois evoluir produção e Radar conforme contratos validados. Diagnosticar a instalação real do Hermes antes de implementar adaptadores.

## Controles

Preservar mídias e arquivos do operador. Não fundir repositórios ou reescrever histórico Git. Perfis editoriais ficam em `perfil.yaml`; histórico operacional contém referências às revisões, execuções, erros e decisões de produção. Não ingerir conversas automaticamente nem permitir que registros alterem licenças, permissões ou aprovações.

Chamadas pagas, cron, Telegram, publicação e geração de voz precisam de autorização específica. O comando `fc-piloto` pode enviar notificações; não usá-lo como inspeção de leitura. Não imprimir ou versionar segredos.

O usuário autorizou avanços incrementais com validação, commit e push. Documente somente resultados realmente observados e limitações. Planejamentos antigos não anulam autorizações posteriores expressas pelo usuário.
