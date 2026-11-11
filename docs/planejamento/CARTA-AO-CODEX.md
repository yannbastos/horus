# Continuidade técnica — Hórus audiovisual

> **Classificação documental — 2026-11-11:** Carta histórica de continuidade. Para regras, consulte [AGENTS.md](../../AGENTS.md); para prioridades e estado, [ROADMAP](../ROADMAP.md). As autorizações pontuais de implementação, commit e push registradas abaixo, inclusive no último parágrafo, são históricas: não são permissões permanentes nem prevalecem sobre AGENTS.md ou o escopo da tarefa atual. Os próximos passos antigos devem ser confrontados com os ensaios posteriores.

Leia primeiro [AGENTS.md](../../AGENTS.md), [visão do produto](../VISION.md), [arquitetura atual](../ARCHITECTURE.md) e [migração local](../migracao-local.md).

## Direção vigente

O usuário definiu foco exclusivo em inteligência e operação audiovisual: oportunidades, roteiros, mídia, produção, canais e resultados. Exemplos e documentos de propostas anteriores foram retirados da base atual. Preserve a identidade visual, cores, fontes, ícones e geometria das telas.

## Componentes

- React/TypeScript e Tauri 2 compõem o novo desktop.
- FastAPI e SQLite centralizam regras, tarefas e persistência.
- CLI `fabrica` e Remotion continuam independentes; não criar outro motor.
- Hermes possui diagnóstico autenticado por API externa, validado com o CLI Windows 0.23.1 e perfil exclusivo `horus`. Não modificar seu core. Veja [integração Hermes](../integracao-hermes.md).
- Avalonia mantém transcrição com Whisper, revisão e salvamento até equivalência funcional.
- Storybook é um catálogo separado de exemplos audiovisuais, sem backend operacional.

## Estado confirmado

Build release e instalador Windows foram gerados. A interface abriu, conectou ao backend empacotado e consultou um perfil real. Fila, logs e biblioteca possuem implementação parcial descrita no guia de migração. Não confundir a prévia distribuída com uma plataforma completa.

## Próximas prioridades

Atualização de validação: consulte [o relatório local de 2026-11-10](../validacao-local-2026-11-10.md) antes de repetir os testes. Render real via API em TestClient, cancelamento da árvore, persistência e seleção/reprodução de MP4 no Tauri já foram exercitados; isso não certifica todo o fluxo pela tela Produção nem instalação NSIS.

Integração posterior com a fábrica de HEAD `e19318a`: recusas por vídeo ausente e caminho fora da pasta, registro de insumos, bloqueio da fixture de teste e encerramento do backend durante render foram exercitados. O backend agora inclui o motivo do CLI no erro principal da tarefa. Passaram 67 testes backend e 5 de interface; a fábrica segue independente. O trabalho posterior de SRT/metadados/thumbnail precisa de validação própria após concluir, sem presumir cobertura pelos ensaios anteriores.

Validar diálogos e reprodução nativos, render real e cancelamento, persistência entre aberturas, encerramento e consumo de recursos. Depois evoluir produção e Radar conforme contratos validados. Diagnosticar a instalação real do Hermes antes de implementar adaptadores.

A conexão de diagnóstico já foi validada no desktop. Antes de enviar análises ao Hermes, configurar modelo/provedor no perfil exclusivo e definir orçamento. Nenhum endpoint de inferência é exposto pelo Hórus neste incremento; não usar `hermes -z` para contornar os controles.

## Controles

Preservar mídias e arquivos do operador. Não fundir repositórios ou reescrever histórico Git. Perfis editoriais ficam em `perfil.yaml`; histórico operacional contém referências às revisões, execuções, erros e decisões de produção. Não ingerir conversas automaticamente nem permitir que registros alterem licenças, permissões ou aprovações.

Chamadas pagas, cron, Telegram, publicação e geração de voz precisam de autorização específica. O comando `fc-piloto` pode enviar notificações; não usá-lo como inspeção de leitura. Não imprimir ou versionar segredos.

O usuário autorizou avanços incrementais com validação, commit e push. Documente somente resultados realmente observados e limitações. Planejamentos antigos não anulam autorizações posteriores expressas pelo usuário.
