# Fontes de assets licenciados (HOR-055)

Estado: **arquitetura implementada e testada offline** em `backend/src/horus_backend/asset_sources/`. **Não há** chamada de rede, cliente HTTP, leitura de chave, download, API HTTP, interface nem integração ao worker. Nenhuma fonte real está ativa.

## O que existe

| Peça | Função |
|---|---|
| `AssetSource` (`base.py`) | Interface: `search`, `parse_response`, `obtain`. |
| `AssetCandidate` | Candidato com a proveniência declarada pela fonte: origem, URL da página, autor e URL do autor, licença (id, nome, URL dos termos), `commercial_use`, atribuição, data da consulta (UTC), dimensões/duração, URL de download (informativa) e, quando há arquivo, caminho relativo, SHA-256 e tamanho. `status` é sempre `unverified`. |
| `PexelsSource`, `PixabaySource` | Convertem **respostas JSON já obtidas** (formato público de cada API) em candidatos. Itens inválidos vão para `rejected` com código estável, sem derrubar os demais. |
| `SourceTransport` / `FixtureTransport` | Transporte injetado. Só existe o de fixture (testes); **não há implementação de rede**. O pedido (`SourceRequest`) não carrega credencial. |
| `LocalLicensedSource` | Importa um arquivo local indicado pelo usuário (`licensed_manual`) com licença declarada: copia para a pasta da biblioteca, calcula SHA-256, valida caminho, tipo e tamanho. |
| `to_provenance_asset`, `build_provenance` | Candidato → entrada de `asset-provenance.json`, validada por `media_contracts.validate_asset_provenance` ([contrato](contratos-midia.md)). |

Fluxo: fonte → `AssetCandidate` (`unverified`) → arquivo obtido **pelo usuário** (`with_obtained_file`) ou importado (`LocalLicensedSource`) → entrada de proveniência → revisão humana de licença (HOR-097) → `apply_license_reviews`. Só a revisão humana pode produzir `verified`; `publishable=false` e `demo_only=true` permanecem.

## Termos de licença (declarados, não verificados)

Consulta feita em **2026-11-13** nas páginas oficiais. São resumos para triagem; **só o texto legal completo vale** e a decisão por asset é humana. Em ambas as fontes `commercial_use="unknown"` e `attribution_required=None`: os termos gerais permitem uso gratuito, mas não permitem afirmar `allowed` para um arquivo específico (pessoas, marcas, consentimento de terceiros).

| | Pexels | Pixabay |
|---|---|---|
| Termos | <https://www.pexels.com/license/> | <https://pixabay.com/service/license-summary/> |
| Permitido | Uso gratuito, edição; atribuição opcional (apreciada). | Uso gratuito, edição; atribuição opcional (apreciada). |
| Restrições | Não vender cópias sem alteração; não redistribuir em outras plataformas de stock; não usar como marca/nome comercial; não sugerir endosso de pessoas ou marcas; pessoas identificáveis não podem aparecer de modo ofensivo. | Não vender/distribuir sem alteração (standalone); conteúdo com marcas/logotipos não pode ser usado comercialmente; pessoas reconhecíveis não podem ser usadas de modo ilegal/imoral; uso enganoso e uso como marca proibidos; consentimento de terceiros é responsabilidade do usuário. |
| Não coberto pelo resumo | — | Content ID e limites/condições da API: ler os Termos de Serviço antes de ativar. |

As restrições são gravadas no campo `notes` de cada entrada, junto da data da consulta.

## Validações

- **URLs** (página, autor, download): `https`, host oficial (`pexels.com`/`pixabay.com` ou subdomínio), sem credencial em userinfo nem em parâmetros (`key`, `api_key`, `token`…). Reforçado pelo contrato (`invalid_url`).
- **Autor ausente/vazio**, id ausente e licença ausente: item recusado (o contrato também exige autor, URL de origem e licença completa para assets externos).
- **Licença desconhecida nunca vira permitida**: nenhum adaptador emite `allowed`; `verified` exige humano.
- **Importação local**: caminho absoluto, sem `..` nem byte nulo, sem link simbólico/junção no arquivo ou nos diretórios pai, arquivo regular, extensão aceita para o tipo, assinatura (bytes iniciais) coerente com a extensão, tamanho `1..limite` por tipo (imagem 50 MiB, vídeo 500 MiB, áudio/música/voz 100 MiB, fonte 20 MiB), conferido de novo durante a cópia. A cópia vai para um temporário na biblioteca e é movida atomicamente para `<sha12>-<nome-sanitizado>.<ext>`; conflito com conteúdo diferente é recusado. O original nunca é alterado.

A assinatura barra renomeação grosseira; não prova que o arquivo é inofensivo nem decodificável.

## Por que nada é baixado automaticamente

Baixar um arquivo é transmitir uma requisição a terceiro (e, nas APIs, gastar cota/credencial) e traz para a biblioteca conteúdo cuja licença só um humano valida. A governança exige autorização do usuário para uso de serviços externos, e os termos acima dependem de pessoas, marcas e uso pretendido. Por isso `obtain` das fontes de stock sempre falha com `download_not_enabled`, e o arquivo entra por `with_obtained_file` (obtido fora) ou pela fonte local.

## O que falta para ativar uma fonte real (fora deste incremento)

1. **Autorização expressa do usuário** para consultar a fonte (e, se houver custo ou limite, para o gasto).
2. **Chave da API** guardada no cofre de credenciais do Hórus, nunca no código, em URL, em log ou na proveniência; injetada apenas pelo gateway.
3. **Gateway de saída** com implementação de `SourceTransport`: lista de hosts permitidos (APIs e CDNs oficiais), https obrigatório, timeouts, limite de tamanho de resposta, sem redirecionamento para outro host, log sem segredo.
4. **Limites**: cota por fonte (Pexels e Pixabay impõem limites de requisições), cache das respostas respeitando os termos de cada API (ex.: não fazer hotlink permanente), tamanho máximo de download por tipo (os mesmos limites da importação local).
5. **Download** controlado por ação do usuário sobre um candidato, com hash, validação de tipo e passagem pelo mesmo caminho de importação.
6. **Integração**: API/worker/UI para busca, escolha e revisão, e releitura dos termos vigentes antes de ativar (os termos mudam).

## Testes

`backend/tests/test_asset_sources.py` (fixtures sintéticas no formato público das APIs; negativos de host, autor, https, credencial, `..`, link simbólico/junção, tamanho, tipo e assinatura). Um fixture `autouse` substitui `socket.socket.connect`, `connect_ex` e `socket.create_connection` e falha se forem chamados; outro teste confere que o pacote não importa módulos de rede nem lê variáveis de ambiente.

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_asset_sources.py -q
```
