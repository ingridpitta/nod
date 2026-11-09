import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Chat limpo, PR 3 (plano, Parte 2 · 2C; decisão 18): a leitura da conversa própria leva `pedidosDeColega` — quem pediu
 * cada turno de delegação da janela, com o nome do payload do `peer_pedido` —, numa consulta à parte. O nome vem do
 * payload, nunca de um join com `agentes`: o bot de outra pessoa, que a RLS esconde, continua com nome.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-10-18T15:00:00Z");
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };

describeIntegracao("troca entre bots: o nome sempre vem (chat limpo, PR 3)", () => {
  it("a conversa de quem recebe leva pedidosDeColega pelo turno do pedido; o turno sem peer_pedido não entra; o pedido antigo sem nome volta com null", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: "Taga, pede ao Dev 1 para revisar o PR 466", inventario: PRONTO });
      const r = await pedirABot(deps, { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId, agente: "Dev 1", pedido: "revisar o PR 466" });
      const tarefa = tarefaDoPedido(r.data);
      // Uma fala do Dev 1 no turno do pedido: a janela tem a delegação pela origem do turno.
      await repos.mensagens.criar({ conversaId: dev1.conversaId, turnoId: tarefa, autoria: { autor_tipo: "agente", autor_id: dev1.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 }, kind: "texto", texto: "Revisado: dois comentários", confianca: "confiavel" });
      // Um turno de delegação sem peer_pedido (o pedido sumiu): não vira entrada.
      const orfao = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "delegacao", prazoEm: AGORA + 60_000, profundidade: 1, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "m" });
      await repos.mensagens.criar({ conversaId: dev1.conversaId, turnoId: orfao!.id, autoria: { autor_tipo: "agente", autor_id: dev1.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 }, kind: "texto", texto: "Feito", confianca: "confiavel" });

      const lida = (await lerConversa(deps, { conversaId: dev1.conversaId })).data;
      expect(lida.pedidosDeColega).toEqual({ [tarefa]: { agenteId: taga.agenteId, nome: "Taga" } });
      // A consulta à parte direto: sem turnos, nada; o pedido antigo (sem `nome` no payload) volta com null.
      expect(await repos.mensagens.pedidosDeColega([])).toEqual({});
      await trx`update mensagens set payload = payload - 'nome' where turno_id = ${tarefa} and payload->>'kind' = 'peer_pedido'`;
      expect(await repos.mensagens.pedidosDeColega([tarefa, tarefa, orfao!.id])).toEqual({ [tarefa]: { agenteId: taga.agenteId, nome: null } });
      // A conversa de quem pediu não tem turno de delegação na janela: o mapa vem vazio, mas vem (conversa própria).
      expect((await lerConversa(deps, { conversaId: taga.conversaId })).data.pedidosDeColega).toEqual({});
    });
  });

  // Regressão do QA do PR 3 (18/10): o lateral da raiz (ADR-099, I7) nunca entrava no select, e a retomada do pedido (quem
  // recebeu pediu a um terceiro e voltou) chegava sem `raiz` — a fala entregue saía da troca e virava balão.
  it("a retomada do turno do pedido chega com a raiz (delegacao) na leitura, e a raiz entra em pedidosDeColega", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: "Taga, pede ao Dev 1 a latência", inventario: PRONTO });
      const r = await pedirABot(deps, { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId, agente: "Dev 1", pedido: "medir a latência" });
      const tarefa = tarefaDoPedido(r.data);
      await repos.turnos.assentar(tarefa, { estado: "concluido" });
      const elo1 = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", retomaTurnoId: tarefa, prazoEm: AGORA + 60_000, profundidade: 2, entradaTexto: "a Ana respondeu", entradaConfianca: "confiavel", modelo: "m" });
      await repos.turnos.assentar(elo1!.id, { estado: "concluido" });
      const elo2 = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev1.conversaId, agenteId: dev1.agenteId, origem: "retomada", retomaTurnoId: elo1!.id, prazoEm: AGORA + 60_000, profundidade: 2, entradaTexto: "de novo", entradaConfianca: "confiavel", modelo: "m" });
      const autoria = { autor_tipo: "agente" as const, autor_id: dev1.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON, executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
      const fala = await repos.mensagens.criar({ conversaId: dev1.conversaId, turnoId: elo2!.id, autoria, kind: "texto", texto: "A latência caiu para 310 ms.", confianca: "confiavel" });

      const lida = (await lerConversa(deps, { conversaId: dev1.conversaId })).data;
      const naLeitura = lida.mensagens.find((m) => m.id === fala?.id);
      expect(naLeitura).toMatchObject({ origemTurno: "retomada", raiz: { turnoId: tarefa, origem: "delegacao" } });
      // O turno da conversa (sem retomada) não ganha raiz.
      expect(lida.mensagens.filter((m) => m.turnoId === tarefa).every((m) => m.raiz === undefined)).toBe(true);
      expect(lida.pedidosDeColega).toEqual({ [tarefa]: { agenteId: taga.agenteId, nome: "Taga" } });
    });
  });

  it("bot de outra pessoa: quem lê a conversa recebe o nome de quem pediu pelo payload, sem o bot que a RLS esconde em agentes", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      await vincularEscopo(trx, ANA);
      const dev1 = await agenteComConversa(trx, ANA, { nome: "Dev 1", dono: "empresa" });
      const procuracao = await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: dev1.agenteId, agenteBeneficiarioId: taga.agenteId, classesPermitidas: ["delegar_tarefa"], tetoDiario: 5 });
      await trx`update procuracoes set visibility = 'equipe' where id = ${procuracao?.id ?? ""}`;
      await trx`update conversas set visibility = 'equipe' where id = ${dev1.conversaId}`;
      await vincularEscopo(trx, MARLON);
      const { deps } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: "Taga, pede ao Dev 1 da Ana", inventario: PRONTO });
      const r = await pedirABot(deps, { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId, agente: "Dev 1", pedido: "revisar o PR 466" });
      const tarefa = tarefaDoPedido(r.data);

      // A linha gravada no escopo do Marlon só é lida pela Ana com visibilidade de equipe (0002); o teste a abre para provar
      // que o nome não depende de `agentes`, que continua escondendo o Taga dela.
      await trx`update mensagens set visibility = 'equipe' where turno_id = ${tarefa} and payload->>'kind' = 'peer_pedido'`;
      await vincularEscopo(trx, ANA);
      const daAna = depsSobre(trx, ANA, { agora: () => AGORA });
      expect(await daAna.repos.agentes.buscar(taga.agenteId)).toBeNull();
      const lida = (await lerConversa(daAna.deps, { conversaId: dev1.conversaId })).data;
      expect(lida.mensagens.find((m) => m.payload?.kind === "peer_pedido")?.payload).toMatchObject({ nome: "Taga" });
      expect(lida.pedidosDeColega).toEqual({ [tarefa]: { agenteId: taga.agenteId, nome: "Taga" } });
    });
  });
});
