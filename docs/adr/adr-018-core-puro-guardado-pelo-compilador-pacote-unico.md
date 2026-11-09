# ADR-018 — Core puro guardado pelo compilador, PACOTE ÚNICO

**Status** revisado

## Decisão

O pacote único sobrevive sem emenda de princípio. A árvore ganha duas pastas: desktop/ (processo principal do Electron, preload, e o cliente que puxa trabalho) e executor/ (spawn da CLI, montagem de PATH, classificação de resultado — compartilhado entre os dois executores). O mecanismo não muda: tsconfig por alvo de build. desktop/ ganha tsconfig próprio com lib sem DOM e types node+electron. TRÊS FRONTEIRAS NOVAS guardadas pelo compilador: desktop/ importa contracts/ e executor/, e NUNCA db/ nem http/; executor/ não importa db/; web/ continua só importando type de contracts/. O esqueleto commitado antes da lógica permanece.

## O que mudou

Duas pastas, um tsconfig, três regras de fronteira.

## Por quê

A pergunta 'o pacote único sobrevive?' tem resposta verificada no repo de referência e é sim: o openmausbot TEM pnpm-workspace.yaml, lista só três packages, e electron/ não é um deles — é pasta do pacote raiz. O repo que tinha a ferramenta escolheu não usá-la para o app desktop. A regra 'desktop/ nunca importa db/' é a peça mais valiosa e a mais barata: transforma a sua decisão (o app não embute o servidor) de intenção em invariante do compilador. Sem ela a erosão tem nome no openmausbot: electron/main.mjs tem 2.647 linhas e uma bifurcação de boot onde, dependendo do modo, sobe um servidor embutido ou aponta para um remoto. Foi assim que um cliente fino virou dois harnesses para versionar e auditar.


## Refinamentos (2026-09-16, fundação)

- **Guarda composta.** O `tsconfig.domain.json` (sem `@types/node`, sem lib DOM) prova a PUREZA de `src/domain/` — `scripts/prove-domain-fence.sh` é o teste negativo (node:fs não compila). Nenhum tsconfig diz "use-cases não importa repositories": a DIREÇÃO entre camadas é do `eslint.config.mjs`, por glob de diretório, com mensagem que ensina o caminho — e `tests/conformidade/fronteiras.test.ts` prova cada bloco programaticamente. A pureza é propriedade do DIRETÓRIO `src/domain/`, não do pacote.
- **Quatro peças impraticáveis de retroagir** entraram no primeiro commit: factories de repositório tipadas `Conn = Db | Tx` (zero `as unknown as`), `no-console: error` sem allow (único disable em `src/obs/log.ts`), proibição de `DELETE FROM`/`TRUNCATE` em teste fora de `tests/concurrency`, runtime pinado em `.mise.toml`.
- As pastas `desktop/` e o Electron ficaram fora desta rodada (ADR-020 invertido); `src/adapters/executor` e `src/adapters/mcp-proxy` não importam `src/db` nem `src/repositories` (recebem plano e sinks).
- `src/services` é SEM BANCO; laços de fundo que abrem transação moram em `src/adapters/fundo/`.

## Gatilho de reversão

Reabrir (workspaces) se surgir um segundo deployable com bundle de cliente próprio, ou se um terceiro repositório precisar consumir parte do nod como dependência publicada. Mover um diretório sem atualizar o eslint desliga a fronteira em silêncio — risco aceito conscientemente; `fronteiras.test.ts` reduz a janela.
