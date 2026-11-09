import { expect, it } from "vitest";
import { ativarRotina } from "../../src/use-cases/ativar-rotina.ts";
import { criarRotina, criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { pausarRotina } from "../../src/use-cases/pausar-rotina.ts";
import { listarExecucoes, listarRotinas } from "../../src/use-cases/listar-rotinas.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
// quarta 16/09/2026 12:00 em São Paulo; o processo roda com TZ=UTC (abaixo) e o resultado não muda.
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

describeIntegracao("rotinas: proposta tipada, confirmação, fuso nomeado, pausar/ativar (E7.1, E7.2)", () => {
  it("proposta via agente → ZERO rotinas; payload normalizado persistido; decisão 'rotina' com o mesmo id", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia útil às 8", entradaConfianca: "confiavel", modelo: "m" });
      const r = await criarRotina(deps, { ...contexto(agenteId, conversaId, turno?.id), ...rotinaValida() });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect(new Date(r.data.proxima_execucao).toISOString()).toBe("2026-09-17T11:00:00.000Z");
      expect(await repos.rotinas.listar()).toEqual([]);
      const proposta = await repos.propostas.buscar(r.data.proposta_id);
      expect(proposta).toMatchObject({ kind: "rotina", estado: "pendente" });
      expect(proposta?.payload).toMatchObject({ kind: "rotina", cron: "0 8 * * 1-5", fusoIana: TZ, proximaExecucao: r.data.proxima_execucao });
      const decisao = await repos.decisoes.buscar(r.data.proposta_id);
      expect(decisao).toMatchObject({ tipo: "rotina", estado: "pendente", agenteId, conversaId });
      await repos.events.gravarComOutbox(r.events ?? []);
      // medido em 2026-09-16: dois eventos da MESMA transação compartilham created_at (now() é transacional),
      // então nenhuma ordem é garantida entre eles — compara-se como CONJUNTO. Falhou 2x em 3 execuções dos 4 projetos juntos.
      const kinds = await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId}`;
      expect(kinds.map((k) => k.kind).sort()).toEqual(["decisao_criada", "proposta_criada"]);
    });
  });

  it("confirmar → rotina ativa (exige_aprovacao true pelo DEFAULT) com mensagem de sistema que nomeia o fuso; a decisão fecha; idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia útil às 8", entradaConfianca: "confiavel", modelo: "m" });
      const r = await criarRotina(deps, { ...contexto(agenteId, conversaId, turno?.id), ...rotinaValida() });
      if ("erro" in r.data) throw new Error("proposta");
      // pelo contrato Services.rotinas.ativar, como a L6 chama em confirmarProposta
      const rotina = await deps.services.rotinas.ativar(trx, r.data.proposta_id);
      expect(rotina).toMatchObject({ id: r.data.proposta_id, estado: "ativa", exigeAprovacao: true, fusoIana: TZ, proximaExecucao: r.data.proxima_execucao, ownerId: PESSOA_MARLON });
      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      expect(mensagens.map((m) => [m.kind, m.texto])).toEqual([["sistema", `Rotina ativa: dias úteis às 08:00 (${TZ}) · próxima execução: 17/09/2026, 08:00.`]]);
      expect((await repos.propostas.buscar(r.data.proposta_id))?.estado).toBe("confirmada");
      expect((await repos.decisoes.buscar(r.data.proposta_id))?.estado).toBe("decidida");
      const de_novo = await ativarRotina(deps, { propostaId: r.data.proposta_id });
      expect(de_novo.data.jaExistia).toBe(true);
      expect(await repos.rotinas.listar()).toHaveLength(1);
      expect((await listarRotinas(deps, {})).data.rotinas.map((x) => x.proximaExecucao)).toEqual([r.data.proxima_execucao]);
    });
  });

  it("criada em São Paulo, disparo no horário de parede certo mesmo com o processo em UTC (E7.2.2); pausar/ativar recalcula a próxima", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { rotina } = (await criarRotinaPelaPessoa(deps, { agenteId, cron: "30 7 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" })).data;
      // 07:30 de São Paulo = 10:30Z (sem horário de verão em 2026)
      expect(new Date(rotina.proximaExecucao).toISOString()).toBe("2026-09-17T10:30:00.000Z");
      const pausada = await pausarRotina(deps, { rotinaId: rotina.id, estado: "pausada" });
      expect(pausada.data.rotina.estado).toBe("pausada");
      expect(await repos.rotinas.ativasVencidas(AGORA + 7 * 24 * 60 * 60 * 1000)).toEqual([]);
      const depois = depsSobre(trx, MARLON, { agora: () => AGORA + 3 * 24 * 60 * 60 * 1000 }).deps; // sábado 19/09 12:00 SP
      const ativa = await pausarRotina(depois, { rotinaId: rotina.id, estado: "ativa" });
      expect(ativa.data.rotina.estado).toBe("ativa");
      expect(new Date(ativa.data.rotina.proximaExecucao).toISOString()).toBe("2026-09-20T10:30:00.000Z");
      expect((await listarExecucoes(deps, { rotinaId: rotina.id })).data.execucoes).toEqual([]);
      await expect(listarExecucoes(deps, { rotinaId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });
});
