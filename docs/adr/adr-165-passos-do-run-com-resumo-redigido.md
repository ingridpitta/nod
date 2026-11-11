# ADR-165 — Passos do run persistidos, com um resumo redigido do argumento

Status: proposta · Data: 2026-11-10 (tarefa aberta como o Multica, Passo 2) · Desvio da regra "nunca input/resultado"
de `TrechoVivo` (`src/contracts/ponte.ts`, NOD-353) e do comentário de `turno.atividade` (`src/contracts/frame.ts`).

## Contexto

Os passos do run (o texto do modelo, cada ferramenta e o fim dela) eram frames SSE efêmeros: `turno.delta`,
`turno.atividade` e `turno.acao_fim`. Reabrir a tarefa no meio do run voltava a "Começando…", e o run concluído só tinha
os passos se ainda estivessem na memória da aba. O rótulo era genérico ("Rodando um comando", "Leu um arquivo"), porque o
servidor só recebia o NOME da ferramenta. O Multica mostra, por passo, o argumento mais informativo (a busca, o arquivo,
o comando) e guarda a lista (`task-messages`).

## Decisão

1. **Tabela `turno_passos` (migração 0170, só adição).** Um passo por linha: `seq` (identity global: ordem e cursor
   `depois`), `raiz_id` (o turno raiz da cadeia; a tela lê por run = raiz), `turno_id` (o turno real, a retomada),
   `tipo`, `classe`, `ferramenta`, `rotulo`, `resumo` (até 160), `acao_id`, `falhou`. Escopada (`nod_escopar_tabela`),
   da dona do turno. Teto de `PASSOS_POR_TURNO_MAX` (2000) por raiz, podando os mais antigos na gravação; retenção de
   90 dias pela dona no varredor de expiração (o mesmo critério de `acoes_pelo_modo`, texto derivado da conversa);
   apagável por `nod_poda`, como o `turno_raio_x`. O texto do modelo vira UM passo por bloco de fala (os pedaços
   seguidos até a próxima ferramenta ou o fim do turno), com os primeiros 160 caracteres.
2. **O executor manda um `resumo` do ARGUMENTO junto do nome.** `TrechoVivo` ganha `resumo?: string` (opcional: o app
   antigo não manda). Ele é montado no executor (app do Mac, motor e laço local) com a prioridade do Multica
   (`trace-event-presenter.ts`): busca (`query`) → arquivo (só o nome, sem diretório) → padrão → descrição → comando
   (sem o `bash -lc`), até **120** caracteres (`resumoDaFerramenta` em `src/domain/resumo-do-passo.ts`).
3. **Redigido duas vezes.** `redigirResumo` (domínio puro) tira chaves conhecidas (`sk-`, `ghp_`, `github_pat_`, `xox`,
   `AKIA`, `glpat-`), `Bearer`/`token`/`senha`/`password`/`secret`, URLs com `usuário:senha@`, `CHAVE=valor` de env e
   trechos longos de base64/hex, ANTES de cortar. O executor redige antes de mandar; o servidor corta em **160** e redige
   de novo antes de gravar e de publicar (`turno.atividade` passa a levar `seq`, `resumo`, `classe`, `ferramenta`). O
   banco tem o `CHECK (length(resumo) <= 160)` como segunda camada.
4. **Nunca a saída.** O resultado da ferramenta continua no Mac: o fim leva só `falhou` (`tool_result.isError`). O
   argumento inteiro (o corpo de um Write, o patch, o prompt de um subagente) também não sai: só o resumo de uma linha.

## Alternativas rejeitadas

- **Manter só o nome:** a lista persistida diria "Rodou um comando" vinte vezes; é o que o Multica faz melhor.
- **Mandar o input inteiro e resumir no servidor:** o argumento de um Write ou de um Edit é o conteúdo do arquivo; o
  servidor passaria a receber código e texto da pessoa que hoje nunca sai da máquina.
- **Guardar a saída (como o Multica):** a saída de um comando ou de uma leitura é o dado mais sensível do turno.
- **Um passo por pedaço de texto:** milhares de linhas por turno, sem valor para quem lê.

## Compatibilidade

O app antigo manda `{ferramenta, id}` sem resumo: o passo grava `resumo = null`. O servidor antigo descarta o trecho de
três chaves `{ferramenta, id, resumo}` (validação estrita por número de chaves): a ordem de release continua a da casa,
o servidor sobe antes do app que manda o campo novo.

## Gatilho de reversão

Se um segredo aparecer num `turno_passos.resumo` (relato, auditoria ou varredura do banco diário) que as regras de
`redigirResumo` deveriam ter pego: o executor para de mandar o `resumo` (volta ao nome só) até a regra nova entrar com
teste. Se a tabela passar de 2 GB no banco de produção, a retenção cai de 90 para 14 dias.
