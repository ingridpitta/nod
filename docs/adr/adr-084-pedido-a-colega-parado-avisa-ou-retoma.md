# ADR-084 — Pedido a colega que parou: o varredor avisa quem pediu ou retoma sozinho

Status: aceito · Data: 2026-10-08 · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) (task que espera
colega) e à revisão da ADR-047 (aviso de falha da delegação). Decisão do Marlon em 2026-10-08 ("aplique as mudanças que
não são de UI"), depois do diagnóstico das tasks que levavam horas.

## Contexto

Medido no Nod diário em 08/10: 15 tasks marcadas "rodando" sem nenhum turno vivo, presas em 18 pedidos a colega. Em
quase todos, a task do colega já tinha falhado havia horas: 64 turnos caíram com as quedas do Docker e da API daquele dia
(31 `maquina_sem_contato`, 33 `executor_indisponivel`). Uma task da Cecília marcava 312 min "rodando", com 21 min de
trabalho de fato.

O aviso a quem pediu (`avisarFalhaDelegacao`) só saía por um caminho: o assentar pela ponte (`compor.ts`,
`depoisDeAssentar`). Recusa no despacho, Parar da task, cancelar, dispensar o "Retomar", a queda pelo varredor de lease
e a entrega tardia acabam a task do colega sem passar por ele. Ninguém relia o trabalho de quem pediu, e o fato
`aguardandoColega` o segurava em "rodando" para sempre. Nenhuma queda era retomada sem clique da pessoa.

## Decisão

1. **Um varredor no lugar de sete remendos.** A cada passada do varredor de expiração (30 s), numa transação própria,
   `cuidarDosPedidosParados` (`src/use-cases/pedidos-parados.ts`) lê os pedidos parados
   (`trabalhos.pedidosAColegaParados`). São handoffs com tarefa das últimas 24 h, sem `peer_ask` da mesma tarefa, cuja
   task do colega está terminada, parada, falhou ou precisa da pessoa, e cujo pedinte não está numa task parada. Pega
   todo caminho de falha, inclusive os que ainda vão existir.
2. **A regra é pura** (`src/domain/pedido-parado.ts`, `decidirPedidoParado`):
   - **terminado com fala:** entrega o resultado (`entregarRespostaPeer`). Sem fala: avisa "terminou sem resposta".
   - **parado:** avisa.
   - **queda por infraestrutura** (`maquina_sem_contato`, `executor_indisponivel`, `reinicio_servidor`), com o "Retomar"
     ainda aberto ou sem card: retoma sozinho quando as máquinas voltam. O sinal de volta é um turno da pessoa que
     concluiu, ou roda com lease vivo, depois da queda. A retomada vai até `MAX_QUEDAS_POR_PEDIDO` = 3 quedas, ou seja,
     2 retomadas, e só para quedas das últimas `RETOMAR_ATE_MS` = 2 h (depois disso o pedido já perdeu o contexto de quem
     pediu). Esgotado, mais velho, ou sem sinal em `DESISTIR_SEM_SINAL_MS` = 30 min, avisa quem pediu.
   - **"Retomar" que a pessoa já resolveu:** é dela, e o varredor não retoma por cima.
   - **precisa da pessoa por outra decisão:** espera. O vencimento de 24 h já avisa.
   - **falhou por outro motivo:** avisa com o motivo em português.
3. **A retomada automática** usa `enfileirarRetomada`, no mesmo trabalho (mesma sessão, `--resume`). Fecha o "Retomar"
   aberto por `regra:retomada_automatica`, grava a linha de sistema `retomada-automatica` ("tentativa N de 3") e não
   escreve nada em nome da pessoa.
4. **O aviso e a entrega** seguem `entregar()` de sempre: uma vez por tarefa, continuação na task de quem pediu, que
   relê o estado e sai do "rodando".

## Emendas

- **2026-10-15 (NOD-241): o que é "a queda".** O instante da queda é o **último sinal de vida do turno**
  (`turnos.ultimo_sinal_em`, migração 0076): a última renovação do lease (`lease_ate − LEASE_MS`) quando o varredor ou a
  entrega notam a máquina fora, ou a hora da recusa no despacho. Não é a criação do turno. As janelas de `RETOMAR_ATE_MS`
  (2 h), `DESISTIR_SEM_SINAL_MS` (30 min) e a janela de varredura de 24 h contam a partir dele, e o sinal de volta é um
  turno da pessoa **criado depois dele** que concluiu ou roda com lease vivo. Na janela de 24 h dos pedidos (triagem e
  task de colega), a queda só vale quando o último turno caiu por um dos `MOTIVOS_DE_QUEDA`; o pedido antigo que terminou
  de outro jeito segue contado pela hora do pedido, como antes. Turnos interrompidos antes desta emenda (coluna nula)
  seguem a régua antiga até saírem da janela de 24 h. Antes, `interromper`/`assentar` zeravam `lease_ate` e a regra media
  a idade do turno: toda frente ou pedido com mais de 30 min falhava num deploy. O varredor só interrompe o turno cujo
  lease ainda está vencido no UPDATE (`leaseVencidoEm`): a renovação que chega entre ler os vencidos e interromper vence.
  Piso: o pedido feito há mais de `IDADE_MAX_PEDIDO_RETOMAVEL_MS` (7 dias) não entra nas consultas de pedido parado,
  mesmo caindo agora — sem ele, a janela pela queda faria a cadeia recursiva da triagem varrer todo o histórico de
  handoffs a cada passada; esse pedido fica com o "Retomar" e o vencimento de 24 h.

## Alternativas rejeitadas

- **Chamar o aviso em cada um dos sete caminhos.** Cada caminho novo precisaria lembrar dele; o defeito de 08/10 foi
  justamente um caminho que não lembrava.
- **Retomar sem esperar sinal.** A recusa no despacho com as máquinas fora queimaria as tentativas em 90 s.
- **Retomar também conversa e rotina.** A conversa tem a pessoa olhando (o card "Retomar" basta). A rotina tem a
  próxima janela. Só o pedido entre bots não tinha ninguém para clicar.

## Limites

- Pedido com mais de 24 h fica de fora: nem avisa nem retoma. As tasks presas antes disso seguem como estão.
- O sinal de volta é inferido pelo banco, e não pela presença da máquina (`ultimoContato`, só no modo compartilhado).
  Sem nenhum outro turno rodando, a retomada espera até 30 min e então desiste com aviso.

## Gatilho de reversão

- Mais de 10% dos pedidos retomados caírem de novo em 2 semanas: reabrir o limite e o sinal de volta.

> Emenda (2026-10-28, NOD-377): o pedido com mais de 24 h não fica mais de fora; a [ADR-132](adr-132-toda-espera-de-colega-tem-fim.md)
> fecha toda espera de colega (prazo de 24 h, uma reentrega, Cobrar/Desistir no painel). A janela de 24 h daqui segue
> como o tempo da queda antes do aviso.
