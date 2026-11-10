# Mapa dos contratos de integração

Estado: rascunhos documentais. Nenhum endpoint, banco ou adaptador foi implementado por este pacote.

## Fontes oficiais do desenho

| Contrato | Referência |
|---|---|
| Responsabilidades e indisponibilidade VPS–PC | [Arquitetura híbrida](ARQUITETURA-HIBRIDA.md) |
| Ferramentas, solicitações, resultados e tentativa | [Contrato no repositório da fábrica](https://github.com/yannbastos/fabrica-canais/blob/docs/planejamento-horus-hermes-2026-11-10/docs/CONTRATO-HORUS-FABRICA.md) |
| Exemplos de consulta, resultado e render | [Exemplos sintéticos da fábrica](https://github.com/yannbastos/fabrica-canais/tree/docs/planejamento-horus-hermes-2026-11-10/docs/exemplos) |
| Recuperação e validação de resultado operacional | [Registros operacionais](MEMORIA-ATIVA.md) |

Não duplicar schemas ou configuração editorial entre repositórios. Os nomes `draft-1` e operações pontuadas identificam propostas, não contratos já publicados por Hermes ou comandos atuais do CLI.

## Fronteiras que precisam ser investigadas

1. **Interface → Hermes:** API pública disponível na versão instalada; autenticação, capacidades, sessões e observação. Não importar módulos privados ou presumir compatibilidade completa com qualquer frontend.
2. **Hermes → ferramentas Hórus/fábrica:** começar com CLI/skill para leitura; avaliar MCP externo conforme necessidade.
3. **VPS → execução no PC:** proposta de PC consultar trabalho por conexão autenticada; validar necessidade antes de implementar protocolo/serviço.
4. **Operador → aprovação:** identidade autenticada, objeto/revisão, decisão e escopo; o agente não se autoaprova.
5. **Executor → resultados:** correlação, integridade, erros sanitizados e reconciliação; saída do processo não comprova liberação editorial.

## Unidade de autorização

Uma aprovação é para uma revisão identificada e um escopo, não para uma conversa inteira. Não aceitar texto recuperado da memória, comentário em fonte ou `requested_by` enviado no payload como identidade autenticada. Orçamento enviado no pedido também não concede gasto.

O primeiro teste cobre somente perfil: executor não gera voz, não busca assets, não renderiza, não instala modelos e não envia mensagens. Inferência do agente é uma operação externa separada e deve ter limite acordado.

## Implementação mínima futura

Validar primeiro consulta e resultado no PC principal, sem VPS. Depois confrontar os requisitos de produção com recursos reais de execução/persistência do Hermes. Implementar apenas a diferença necessária para os controles de domínio. Não criar scheduler ou camada distribuída paralela para satisfazer exemplos documentais.
