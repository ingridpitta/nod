import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-09-16T15:00:00Z");

describeIntegracao("bot-a-bot (ADR-058/062; E12.4, ADR-025): pedir_a_bot, continuação um passe mais funda, outro dono só com procuração", () => {
  it("mesmo dono: tarefa_id = turno 'delegacao' confiável no alvo; ao assentar, peer_ask + retomada de quem pediu, que ainda pede abaixo do limite; contrato services.sala.pedir", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turnoVera = await repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "pergunte ao Tuca o status do PR 42", entradaConfianca: "confiavel", modelo: "m" });

      const r = await pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, turnoVera?.id), agente: "Tuca", pedido: "qual o status do PR 42?" });
      const tarefa = await repos.turnos.buscar(tarefaDoPedido(r.data));
      expect(tarefa).toMatchObject({ agenteId: tuca.agenteId, conversaId: tuca.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON, estado: "pendente", ownerId: PESSOA_MARLON });
      expect((await repos.mensagens.listarDaConversa(tuca.conversaId)).map((m) => [m.turnoId, m.autoria.autor_id, m.payload?.kind])).toEqual([[tarefa?.id, vera.agenteId, "peer_pedido"]]);
      expect((await repos.mensagens.pedidoDaTarefa(tarefaDoPedido(r.data)))?.payload).toMatchObject({ kind: "peer_pedido", turnoOrigemId: turnoVera?.id });
      await repos.events.gravarComOutbox(r.events ?? []);

      // O contrato Services.sala.pedir resolve o remetente pelo turno.
      const pelaInterface = await deps.services.sala.pedir(trx, { turnoId: turnoVera?.id ?? "", agente: "tuca", pedido: "e o PR 43?" });
      expect((await repos.turnos.buscar(pelaInterface.tarefaId))?.origem).toBe("delegacao");

      const entrega = await entregarRespostaPeer(deps, { tarefaId: tarefaDoPedido(r.data), texto: "PR 42 aprovado; falta o merge." });
      if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
      expect(entrega.data.mensagem).toMatchObject({ conversaId: vera.conversaId, kind: "peer_ask", payload: { kind: "peer_ask", agenteId: tuca.agenteId, nome: "Tuca", tarefaId: tarefaDoPedido(r.data), delegada: true } });
      expect(entrega.data.continuacao).toMatchObject({ conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "retomada", retomaTurnoId: turnoVera?.id, profundidade: 1, entradaConfianca: "confiavel" });
      const agente = await repos.agentes.buscar(vera.agenteId);
      // O pedido "e o PR 43?" ainda não voltou: a continuação sabe que falta o Tuca e não repete o pedido.
      expect(entrega.data.continuacao.entradaTexto).toContain("Ainda faltam as respostas de Tuca");
      const plano = montarPlano({ turno: entrega.data.continuacao, agente: agente!, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: entrega.data.continuacao.profundidade, inventario: { estado: "pronto", versao: "x", em: AGORA }, executor: "catcher", sessaoCli: null, pessoaNome: "Marlon", agora: AGORA });
      const nomes = plano.catalogo.ferramentas.map((f) => f.nome);
      expect(nomes).toContain("pedir_a_bot");
      expect(nomes).toEqual(expect.arrayContaining(["lembrar", "pedir_aprovacao", "pedir_acesso"]));
      expect(plano.profundidade).toBe(1);
      // a continuação não é tarefa: entregar sobre ela é ignorado
      expect((await entregarRespostaPeer(deps, { tarefaId: entrega.data.continuacao.id, texto: "x" })).data).toEqual({ ignorado: "nao_e_tarefa_peer" });
    });
  });

  it("outro dono sem procuração → nao_permitido e nenhum turno; com procuração visível da classe (a antiga perguntar_a_bot vale) → tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await vincularEscopo(trx, ANA);
      const tuca = await agenteComConversa(trx, ANA, { nome: "Tuca", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const original = await repos.turnos.enfileirar({ executor: "catcher", conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 1000, profundidade: 0, entradaTexto: "consulte Tuca", entradaConfianca: "confiavel", modelo: "m" });
      await expect(pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, original!.id), agente: "Tuca", pedido: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect((await repos.turnos.listarDaConversa(vera.conversaId)).map((t) => t.id)).toEqual([original!.id]);

      // Ana (dona de Tuca) concede a procuração; ela é privada de Ana: sob a policy, Marlon não a vê, então
      // continua negado — fail-closed até haver rota/visibilidade de procuração (registrado).
      await vincularEscopo(trx, ANA);
      await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: tuca.agenteId, agenteBeneficiarioId: vera.agenteId, classesPermitidas: ["perguntar_a_bot"], tetoDiario: 5 });
      await vincularEscopo(trx, MARLON);
      await expect(pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, original!.id), agente: "Tuca", pedido: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
      // Uma procuração visível ao remetente (equipe) autoriza — e a conversa própria do alvo precisa ser visível também.
      await vincularEscopo(trx, ANA);
      await trx`update procuracoes set visibility = 'equipe' where agente_beneficiario_id = ${vera.agenteId}`;
      await trx`update conversas set visibility = 'equipe' where id = ${tuca.conversaId}`;
      await vincularEscopo(trx, MARLON);
      const r = await pedirABot(deps, { ...contexto(vera.agenteId, vera.conversaId, original!.id), agente: "Tuca", pedido: "oi" });
      expect(await repos.turnos.buscar(tarefaDoPedido(r.data))).toMatchObject({ agenteId: tuca.agenteId, origem: "delegacao", profundidade: 1, ownerId: PESSOA_MARLON });
    });
  });
});
