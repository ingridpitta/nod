# ADR-110 — A parada ativa fica visível na conversa, e mandar mensagem a desfaz

Status: proposto; revisto em 2026-10-16 contra a main (ver **Revisão 2026-10-16**): o item 2 já valia em parte desde
2026-09-16 e o item 4 foi superado pela decisão NOD-225; os itens 1 e 3 continuam não implementados · Data: 2026-10-05 ·
Complementa o Parar com parada persistida (`parar.ts`, E5.4/E8, definido em 2026-09-16; não tem ADR própria), a
ADR-067 ("só o Parar freia") e a ADR-029 (o que a conversa mostra quando nada roda). Implementação: issue
[#154](https://github.com/gamefik/nod/issues/154). Renumerada de ADR-079 para ADR-110 em 2026-10-16 (NOD-305), junto
com a [ADR-109](adr-109-comando-parado-segura-o-bot.md) (era a ADR-078 deste PR).

## Contexto

Medido no nod diário em 2026-10-05, 22:25–22:35. Na conversa com o Leonardo, o Marlon mandou "??" e "tá demorando
muito… vou pedir ela pra te passar", apertou **Parar** às 22:31:50 e, minutos depois, relatou que "o nod diário travou
de novo". O que havia:

- `paradas` com uma linha ativa para a conversa (`encerrada_em` nulo), gravada pelo Parar;
- o turno de 22:28 `interrompido` com `parado_pela_pessoa`, sem ter rodado (`attempted: false`), e sem nada na
  conversa além da linha "■" da parada, que já tinha rolado para cima;
- o botão da conversa continuava sendo "Parar" (ele só aparece com turno vivo) e o compositor aceitava mensagem nova
  como se tudo estivesse normal; a mensagem entrava na fila e era interrompida em silêncio.

A parada funcionou como desenhada (`parar.ts`: nada roda até a pessoa falar de novo). O que faltou foi a conversa
dizer isso.

## Decisão

1. **Faixa fixa enquanto a parada vale.** Com `paradas.ativa(conversa)` verdadeira, a conversa mostra, colada ao
   compositor, uma faixa de estado (design system, tom "alerta"): "**Parado por você às 22:31.** Nada roda nesta
   conversa até você retomar." com o botão **Retomar**. A faixa não rola com o histórico e some ao retomar. A parada
   geral (todas as conversas) ganha a mesma faixa com "Parado por você em todas as conversas".
2. **Mandar mensagem retoma.** Enviar texto numa conversa parada encerra a parada e enfileira o turno, numa transação
   só (`enviarMensagem` chama o `retomar` quando há parada ativa); a linha "■ retomado" entra antes da mensagem. O
   botão de enviar diz **Retomar e enviar** enquanto a faixa está lá, para não surpreender.
3. **O que foi barrado não se perde.** O turno interrompido com `parado_pela_pessoa` por mensagem da própria pessoa é
   mostrado como "esta mensagem não rodou: a conversa estava parada" (aviso de estado, tom neutro), com "Mandar de
   novo" — a mesma regra do executor indisponível (ADR-029), com outra causa.
4. **Rotina e delegação respeitam a parada em silêncio**, como hoje: só a mensagem da pessoa a desfaz.

## Alternativas descartadas

- **Só a linha "■" no histórico:** é o que existe; rolou para cima e virou "travou".
- **Bloquear o compositor enquanto parado:** obriga dois cliques para dizer "continue"; a pessoa que fala com o bot
  quer que ele volte.
- **Retomar sozinho depois de N minutos:** o Parar é o freio de emergência (ADR-067: só o Parar freia); ele não pode
  soltar sozinho.

## Gatilho de reversão

Se alguém usar a conversa parada como bloco de notas ("anote isso, mas não faça nada") e se queixar de o bot ter
voltado ao receber a mensagem, o item 2 volta a pedir confirmação ("Retomar e enviar?") em vez de retomar direto.

## Revisão 2026-10-16 (NOD-305): o que a main já faz e o que ficou superado

Conferido no código da main `61b42986` (`parar.ts`, `enviar-mensagem.ts`, `paradas.repo.ts`, `despachar-turno.ts`,
`executar-rotina-agora.ts`, `web/telas/faixa-parada.ts`) e no commit `c9bb3b75` (NOD-261/NOD-264). A decisão acima fica
como foi escrita; esta seção diz o que mudou à volta dela.

**Correção do contexto.** "A mensagem entrava na fila e era interrompida em silêncio" não descreve o código: desde
2026-09-16 (`06e53980`) `enviarMensagem` chama `paradas.encerrarAbertas` na mesma transação que grava a fala e enfileira
o turno, e `encerrarAbertas` fecha tanto a parada da conversa quanto a geral (`conversa_id is null`). O turno barrado no
caso de 05/10 é o que já estava `pendente` quando o Parar chegou: o Parar interrompe os pendentes com
`parado_pela_pessoa` (`parar.ts`). O que faltava, e ainda falta, é a conversa dizer isso.

**Item 1 (faixa fixa): não implementado.** A única faixa é a do resultado do Parar (`renderFaixaParada`: "Parado por você:
N interrompida(s)…", com ×). Ela vem da resposta do `POST conversas/:id/parar`, entra na timeline, some ao trocar de tela
e não consulta `paradas.ativa`. Nenhuma rota expõe a parada aberta à tela e não há botão **Retomar** da parada. Não
confundir com o "Retomar" do turno que caiu (decisão `retomar_turno`, ADR-045): o `c9bb3b75` passou a fechar esses cards
quando um turno posterior do mesmo trabalho conclui (`regra:retomar_superado`) ou quando a aprovação segue numa
continuação (`regra:aprovacao_continuada`). Isso não toca a parada. Do mesmo commit, a renovação do lease de um turno
parado devolve `{ ativo: false, motivo: "parado" }`, e a máquina distingue o Parar de uma renovação negada.

**Item 2 (mandar mensagem retoma): já vale em parte.** O encerramento na mesma transação já existe (acima). A NOD-156
moveu o `encerrarAbertas` para depois do insert, e o reenvio da mesma fala (`idEnvio`) não encerra uma parada aberta
depois dela. Também encerram a parada: o post da pessoa na sala, o Retomar do turno (`retomar-turno.ts`), a resposta da
pessoa a uma decisão, a coordenação da task pela pessoa e a ligação. **Ainda não existem:** a linha "■ retomado" antes da
mensagem e o rótulo **Retomar e enviar**. O que resta do item 2 é só da tela.

**Item 3 (o que foi barrado não se perde): não implementado.** O turno interrompido com `parado_pela_pessoa` não ganha
aviso na conversa nem "Mandar de novo". Na rotina, a janela barrada aparece no histórico como "interrompida · você parou"
(NOD-251/NOD-275, `#326`).

**Item 4 (rotina e delegação em silêncio): superado.** A decisão NOD-225 (15/10) trocou "em silêncio" por "a parada
segura rotinas e pedidos até a pessoa voltar, **nunca em silêncio**": a rotina barrada registra o desfecho, o pedido
barrado avisa quem pediu, "Executar agora" encerra a parada, e o aviso fica ancorado na rotina ou no pedido, sem faixa.
Na main `61b42986`:
- rotina barrada no despacho: a execução fica `interrompida` com motivo `parado_pela_pessoa` (`registrarRecusaDaRotina`
  em `despachar-turno.ts`, NOD-251) — **já vale**;
- delegação barrada no despacho ou no Parar: ainda interrompida sem aviso a quem pediu, porque `despachar-turno.ts` e
  `parar.ts` não chamam `avisarFalhaDelegacao`;
- "Executar agora" ainda não encerra a parada (`executar-rotina-agora.ts` não chama `encerrarAbertas`);
- a resposta de um colega a um bot parado ainda pode reabrir o trabalho.

Os três últimos pontos são da NOD-256 ([PR #334](https://github.com/gamefik/nod/pull/334)). A parada com a máquina fora
do ar termina hoje como "máquina sem contato"; isso é da NOD-252 ([PR #343](https://github.com/gamefik/nod/pull/343)).
Os dois PRs estavam abertos em 2026-10-16; quando entrarem, esta seção ganha uma linha com o SHA. A NOD-256 deixou
explicitamente **fora** do escopo dela a faixa desta ADR (item 1).

**Parar de uma conversa** (NOD-265, `43b08fd0`): o Parar cancela só os frames do outbox daquela conversa, e a fala final de
outro bot da pessoa não some. O Parar do chat também para as tasks do bot (ADR-083), cancela os comandos esperando
(ADR-099) e não encerra a ligação (ADR-072). Nada disso muda as decisões 1 a 3.

## Emenda (2026-10-18, ADR-114, chat limpo, PR 2)

A linha "■ Parado por você" (mensagem `parada`) sai do chat e vai para a Atividade do bot (categoria Bloqueios, "Parado
por você · N turnos interrompidos"). A faixa do Parar (`faixa-parada.ts`), enquanto a parada vale, não muda; "esta mensagem
não rodou" (item 3) fica no chat.

## Nota (2026-10-22, NOD-311)

Desde a NOD-311 o Parar do chat grava a parada e a encerra na hora (emenda da ADR-083): a parada aberta, e com ela a
faixa e o "mandar mensagem retoma" desta ADR, só vem do Parar global e do Parar da sala.
