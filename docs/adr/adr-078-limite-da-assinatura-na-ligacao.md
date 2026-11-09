# ADR-078 — Limite da assinatura na ligação

Status: aceito, provado só com o CLI falso · Data: 2026-10-05 · NOD-168 · Estende a
[ADR-072](adr-072-o-laco-de-voz.md) (o turno-cérebro da ligação) e a rede de segurança "sem IA" do #142.
A prova com uma assinatura esgotada de verdade fica com a NOD-171.

## Contexto

Até aqui a ligação não sabia que a assinatura da IA tinha chegado ao teto. O `rate_limit_event` do stream-json era
lido (`src/domain/stream-json.ts`) e ignorado no laço de voz: o CLI respondia a vez com um erro sem texto e a ligação
ficava muda, como se o bot estivesse pensando. O motivo `limite_da_assinatura` já existia no contrato, na CHECK da 0048
e no `textoFim` da web, mas nada o usava.

O Marlon decidiu (comentário da Ada na NOD-168, 05/10/2026) que, com o #142 na main, o limite **não encerra quando há
outra IA pronta no Mac**: oferece "Continuar com o ChatGPT" (ou a outra IA pronta), como na queda do cérebro.

## Decisão

**Sinal.** O driver de voz do Claude (`drivers/claude-ligacao.ts`) manda `{ t: "limite" }` pelo canal do cérebro
**uma vez por ligação**, no primeiro `rate_limit_event` com `rate_limit_info.status === "rejected"`. `allowed` e
`allowed_warning` não mandam nada (seguem só no evento do turno, sem texto). Depois do limite, o `fim` não pede o
resumo: só fecha a entrada, porque o CLI não responderia.

**Codex.** Fica como está. Só um campo estruturado de limite no `error` ou no `turn/completed` do app-server poderia
classificar, e não há fixture real desse campo no repo; o texto da mensagem do fornecedor nunca classifica (é o mesmo
cuidado da ADR-076 e do redator do #140). O `account/rateLimits` continua fora (ADR-076).

**Desfecho:** oferece a outra IA pronta; encerra com `limite_da_assinatura` só sem alternativa.

- **Com outra IA pronta** (`iaQuePodeAssumir(iaDoCerebro, iasDoMac)`): aviso escrito ("Sua assinatura de IA chegou ao
  limite.") e falado, e a ligação entra no fluxo "sem IA" com a causa nova `limite` em `CAUSAS_CEREBRO_CAIU`. A tela
  mostra "A assinatura do Claude Code deste Mac chegou ao limite." e os botões de continuar; a fase vai a
  `aguardando_escolha`, com o prazo de 2 min e o fim `sem_ia` de sempre. A frase fixa do "sem IA" não toca por cima do
  aviso do limite.
- **Sem alternativa:** o mesmo aviso escrito, a fala "…então vou encerrar a ligação", e o fim com
  `limite_da_assinatura` quando a fala acaba (teto de 5 s, `limiteFalaMs`). O que o cérebro ainda mandar não é falado.
- Um `limite` depois do fim, repetido, ou com a ligação já esperando a escolha não faz nada.

A causa ganhou um código próprio em vez de reaproveitar `falhou` porque a tela diria "A IA deste Mac parou de
responder" e ofereceria "Tentar de novo" como se fosse uma falha passageira.

## Alternativas descartadas

- **Encerrar sempre com `limite_da_assinatura`** (o padrão do plano). Descartada pelo Marlon: com o ChatGPT pronto no
  Mac, derrubar a ligação é pior que oferecer a troca.
- **Classificar pelo texto do erro** ("usage limit reached"). Muda com a versão do CLI e com o idioma; um falso
  positivo derruba uma ligação boa.
- **Encerrar já no `allowed_warning`.** O aviso chega antes do teto; a ligação ainda tem vez para responder.

## Consequências

- `MsgCerebroCliente` ganha `{ t: "limite" }` e `CAUSAS_CEREBRO_CAIU` ganha `limite` (o parser da web aceita a causa
  nova; um app com a web antiga em cache descarta o aviso até recarregar, e a ligação encerra com `sem_ia` no prazo).
- O Mac antigo (sem o driver novo) segue como antes: a ligação fica muda até a pessoa desligar.
- Teste: unit do orquestrador (com e sem outra IA pronta), integration do driver contra o CLI falso (`[[limite]]` e
  `[[limite-aviso]]` em `tests/fixtures/claude-falso.mjs`).

## Gatilho de revisão

- A NOD-171 mostrar o CLI real mandando o teto com outro `status` (ou sem `rate_limit_event`).
- O Codex passar a expor o limite num campo estruturado: entra no mesmo sinal.

## Emenda (2026-10-10): com outra IA pronta, a ligação continua sozinha

Decisão do Marlon no plano das IAs (PR 2), depois do teste do Breno em 09/10: no limite, com outra IA pronta, a ligação
não espera a pessoa escolher na tela. O orquestrador fala "Sua assinatura de IA chegou ao limite. Vou continuar com o
ChatGPT." (ou "o Claude"), entra no "sem IA" com causa `limite` e chama `continuarCom` (injetado pela composição), que faz
o mesmo que o `POST ligacoes/:id/continuar`: abre outro turno-cérebro para a mesma ligação e o religa com
`reabrirCerebro`. Se isso falhar (o turno novo não nasceu, a ligação acabou no meio), fica a escolha na tela, como antes;
o log `ligacao_continuar_sozinha_falhou` diz por quê, só com códigos. Sem outra IA pronta, nada muda: encerra com
`limite_da_assinatura`. Teste: `tests/unit/voz/orquestrador-sem-ia.test.ts` (segue sozinha; falha e fica a escolha).

**Gatilho de reversão.** Se trocar de voz/IA no meio da ligação sem perguntar confundir mais que a pausa, volte a frase
antiga (`FALA_LIMITE_COM_OUTRA`) tirando o `continuarCom` da composição — o caminho da escolha continua inteiro.
