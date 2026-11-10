# Instruções para agentes de IA

Estas regras valem para todos os agentes que trabalham no HORUS.

## Contexto de continuidade — Hórus audiovisual

**Direção tecnológica vigente:** leia [docs/planejamento/STACK-LOCAL.md](docs/planejamento/STACK-LOCAL.md) e [a prova de conceito](docs/migracao-local.md). O usuário autorizou iniciar a troca de linguagens em 2026-11-10. React/TypeScript e Python/FastAPI/SQLite estão em implementação; o shell Tauri 2 usa Rust somente para integração nativa. Preservar fábrica/Remotion, Hermes externo e o Avalonia até validar equivalência funcional. A primeira etapa é local no Windows, **sem VPS e sem redesign**. A compilação nativa depende da disponibilidade do toolchain; não apresentar código Tauri não compilado como aplicativo validado.

Antes de planejar a evolução do produto, leia [a carta ao próximo Codex](docs/planejamento/CARTA-AO-CODEX.md). O usuário escolheu Hermes Agent como motor de inteligência e orquestração, sem fork inicial, preservando a fábrica independente. A primeira entrega na máquina principal é um diagnóstico de integração, sem implementação. Os documentos em `docs/planejamento/` registram a nova direção; `docs/architecture.md` continua descrevendo o código existente.

O usuário posteriormente autorizou adiantar o layout desktop Avalonia: veja [docs/layout-desktop.md](docs/layout-desktop.md). Essa evolução visual não implementa nem autoriza integrações com Hermes/fábrica, chamadas pagas ou instalação de dependências. Preserve a transcrição e identifique áreas futuras como prévias.

**Princípio fundamental:** o HORUS deve ser desenvolvido para funcionar bem, não apenas para parecer bem programado.

O idealizador é o responsável pelo produto e principal usuário. Os agentes assumem a implementação, a arquitetura, os testes, a correção de bugs e a manutenção da documentação.

## Antes de alterar

- Leia este arquivo e [docs/architecture.md](docs/architecture.md).
- Inspecione os arquivos relevantes antes de implementar.
- Respeite a arquitetura existente.

## Implementação

- Não implemente funcionalidades que não foram solicitadas.
- Escreva código simples e compreensível, seguindo as convenções oficiais de C# e .NET.
- Não adicione camadas ou abstrações sem uma necessidade concreta.
- Não adicione dependências sem necessidade.
- Não exclua nem sobrescreva arquivos sem justificativa.
- Não exponha credenciais ou informações sensíveis.
- Preserve a compatibilidade futura com Linux: evite APIs exclusivas do Windows e caminhos fixos.
- Nas telas, use os tokens de `src/Horus/Theme/Tokens.axaml` em vez de cores fixas.

## Prioridades

1. Funcionalidade e confiabilidade
2. Experiência do usuário
3. Manutenibilidade
4. Simplicidade da arquitetura
5. Qualidade e cobertura adequada dos testes
6. Documentação útil e atualizada
7. Facilidade para estudar e compreender o código no futuro

## Testes e verificação

- Crie testes pertinentes e evite testes artificiais.
- Execute a compilação e os testes sempre que possível:

  ```powershell
  dotnet build Horus.slnx
  dotnet test Horus.slnx
  ```

- Nunca invente resultados de testes. Informe claramente o que não pôde ser verificado.

## Documentação

- Mantenha a documentação sincronizada com as mudanças reais.
- Escreva a documentação em português brasileiro.
- Não apresente funcionalidades planejadas como se já estivessem implementadas.
- `docs/architecture.md` descreve apenas o que está implementado.

## Git

- Não execute commit, push, merge ou operações destrutivas sem autorização.
- Não crie repositórios remotos sem autorização.
- Sugira mensagens de commit no padrão Conventional Commits.

## Peça aprovação antes de

- Fazer mudanças significativas na arquitetura.
- Alterar de forma importante a experiência do usuário.
- Incluir dependências com impacto relevante.
- Fazer alterações que possam causar perda de dados.
- Mudar o escopo ou os objetivos do produto.
- Escolher a licença do projeto.

Decisões técnicas rotineiras que respeitem estas regras não precisam de aprovação.

## Comunicação

Seja objetivo e não explique conceitos básicos de programação sem que isso seja pedido. Explique as decisões técnicas relevantes e sinalize problemas e riscos encontrados.

Ao concluir uma implementação, informe:

- O que foi desenvolvido.
- Como utilizar ou testar.
- Quais verificações foram realizadas.
- Se existem problemas conhecidos.
- Se alguma decisão importante precisa de aprovação.
