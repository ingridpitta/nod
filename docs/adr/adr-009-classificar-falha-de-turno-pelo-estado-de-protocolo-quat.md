# ADR-009 — Classificar falha de turno pelo ESTADO DE PROTOCOLO, quatro sinais booleanos

**Status** revisado

## Decisão

Mantidos os quatro sinais (attempted, rejected, promptSubmitted, producedOutput) como colunas write-ahead obrigatórias, com promptSubmitted gravado ANTES do envio ao provedor. Acréscimo exigido pela ponte: os sinais são gravados na MÁQUINA e viajam ao servidor junto com cada renovação de lease, não só no fim do turno — porque agora o turno roda noutro processo, e sinal que não viajou é sinal perdido. Morte por lease vencido é mais uma causa de morte de turno, não um caminho paralelo: com promptSubmitted=true classifica 'after-accept' e nunca reenvia; com tudo falso é 'before-accept' e mesmo assim NÃO reenvia sozinho — vira item na fila com botão.

## O que mudou

O transporte dos sinais. Antes o turno rodava no mesmo processo que escrevia no banco; agora atravessa a ponte.

## Por quê

O ADR já resolvia 'morte de turno'; laptop fechado é morte de turno com outra causa. O que muda é só o transporte. E o openmausbot chegou à mesma regra pelo lado da mensagem de erro: 'An in-flight action may have completed; inspect before retrying' — desfecho desconhecido tratado como perigoso é o 'unknown vira after-accept' que este ADR já tinha.


## Emenda de 2026-10-05 — nova tentativa nos conectores HTTP (NOD-157)

A mesma regra, aplicada às chamadas do servidor a provedores por HTTP (Composio MCP e REST, MCP remoto): **desfecho desconhecido nunca reenvia efeito**, e a classificação sai do status HTTP e do erro de transporte, nunca de texto. Política única em `src/domain/nova-tentativa.ts`:

- **Leitura** (`initialize`, `tools/list`, sonda, GET do REST, ferramenta com `readOnlyHint`) repete em 429, 5xx e corte de rede. **Escrita** (ferramenta sem `readOnlyHint` — a ausência do campo conta como escrita —, POST e PATCH do REST) repete **só em 429**: é a recusa do limitador antes de executar; em 5xx ou rede o servidor pode ter executado.
- **Nunca repete:** 401/403, 400/404/409/422 e demais 4xx, timeout (já esperou 15 s, desfecho desconhecido) e `Retry-After` acima de 5 s.
- No máximo 3 tentativas; espera de ~1 s e ~3 s com jitter de ±25%, ou o `Retry-After` quando cabe. Tudo em 30 s (`ORCAMENTO_CONECTOR_MS`), abaixo dos 35 s que o proxy do Mac espera: a próxima tentativa só vale se a espera mais 15 s cabem no que sobra, e o prazo de cada requisição (MCP e REST) é cortado ao que sobra do orçamento — também nas páginas do `tools/list`. Cada tentativa usa um id JSON-RPC novo.
- **Redirecionamento** recusado pelo `redirect: "error"` não é corte de rede: não repete.
- **Limitação conhecida:** 403 com `Retry-After` (limite de taxa de alguns provedores, como o limite secundário do GitHub) conta como autenticação e não repete; o modelo lê "acesso recusado".
- O conector só é marcado "Fora do ar" (`marcarFalha`) e o cliente só é descartado **depois** de esgotar as tentativas. `chamarComArquivos` (prazo de 600 s, `orcamentoMs: null`) e o stdio ficam sem nova tentativa e sem o corte de 30 s.
- 401/403 do MCP não é "servidor fora": a negação leva `causa: "acesso_recusado"` (motivo `falha_tecnica`, sem enum novo nem migração) e o modelo lê que o app recusou o acesso.
- Medida: `conector_nova_tentativa` (conector, ferramenta, status, tentativa, espera, desfecho `recuperou`/`repetindo`/`esgotou`) e o status no `conector_chamada_falhou`.

Fora desta emenda: relançar o turno ou o CLI (continua proibido), re-handshake de sessão MCP expirada (404), limpar "Fora do ar" quando a chamada seguinte dá certo.


## Emenda de 2026-10-05 — classe do erro do fornecedor (NOD-174)

O estado e o motivo do turno continuam vindo do protocolo (`desfecho`, `motivoFalha`); ao lado deles, o erro cru do Claude Code ou do Codex ganha uma **classe fechada** que só escolhe a frase do aviso. `src/domain/erro-fornecedor.ts`: `login_expirado`, `contexto_cheio`, `sobrecarga` e `desconhecido`, por regex sobre o `erroCru` já redigido (ADR-041 / NOD-158), na ordem fixa login > contexto > sobrecarga.

- A classificação roda no servidor, em `assentar-turno`, a partir do `resultado.erroCru` que já atravessa a ponte. O protocolo da ponte não muda.
- `desconhecido` não tem frase: o aviso fica com `motivoEmPortugues`, que agora é total sobre `MotivoFalha | MotivoInterrupcao` (motivo novo sem frase quebra o typecheck).
- O `result` de falha do CLI e o `assistant` sintético (`model: "<synthetic>"`) não viram fala do bot. O texto em inglês do fornecedor fica só no diagnóstico e no relato.
- Sem classe para crédito e rede: sem fixture confiável; caem em `desconhecido`.
