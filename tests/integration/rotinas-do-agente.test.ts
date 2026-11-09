import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
// quarta 16/09/2026 12:00 em São Paulo; a rotina padrão é "0 8 * * 1-5" (dias úteis às 08:00).
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

/**
 * Cria a rotina JÁ ATIVA (origem pessoa: ela própria é a confirmação) para exercitar o ciclo.
 * criarRotinaPelaPessoa recebe EntradaRotina (camelCase) e acha a conversa própria do agente
 * sozinha — rotinaValida() devolve a forma snake_case da FERRAMENTA, então traduz aqui.
 */
async function rotinaAtiva(trx: Parameters<Parameters<typeof withRollback>[1]>[0], nome: string) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const a = rotinaValida();
  const { data } = await criarRotinaPelaPessoa(deps, {
    agenteId,
    cron: a.cron,
    fusoIana: a.fuso_iana,
    instrucao: a.instrucao,
    fonte: a.fonte,
    entregavel: a.entregavel,
    limitesAprovacao: a.limites_aprovacao,
    politicaSemDado: a.politica_sem_dado,
  });
  // Turno REAL: decisoes tem FK para turnos, então um turnoId inventado viola a constraint.
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "mexe na rotina", entradaConfianca: "confiavel", modelo: "m" });
  return { agenteId, conversaId, deps, repos, rotinaId: data.rotina.id, turnoId: turno?.id };
}

describeIntegracao("ferramentas de ciclo de vida de rotina (listar/pausar/reativar/atualizar/excluir pelo agente)", () => {
  it("lista as rotinas do agente com id, horário legível e estado — na mesma forma do inventário do prompt", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, rotinaId } = await rotinaAtiva(trx, "Vera");
      const { data } = await listarRotinasDoAgente(deps, contexto(agenteId, conversaId));
      expect(data.rotinas).toEqual([{ id: rotinaId, quando: "dias úteis às 08:00 (America/Sao_Paulo)", estado: "ativa", instrucao: "poste aqui um resumo dos PRs abertos" }]);
    });
  });

  it("pausa e reativa; reativar recalcula a próxima execução a partir de agora (janela perdida não é reposta)", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, repos, rotinaId } = await rotinaAtiva(trx, "Vera");
      const pausa = await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId });
      expect(pausa.data).toEqual({ rotina_id: rotinaId, estado: "pausada", ja_estava: false, proxima_execucao: null });
      expect((await repos.rotinas.buscar(rotinaId))?.estado).toBe("pausada");
      // Pausada não entra no tick do scheduler.
      expect(await repos.rotinas.ativasVencidas(AGORA + 7 * 24 * 3600_000)).toEqual([]);

      const volta = await reativarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId });
      if ("erro" in volta.data) throw new Error(`erro inesperado: ${volta.data.erro}`);
      expect(volta.data.estado).toBe("ativa");
      // quinta 17/09 às 08:00 em São Paulo = 11:00Z — recalculado de AGORA, não a janela perdida.
      expect(new Date(volta.data.proxima_execucao ?? 0).toISOString()).toBe("2026-09-17T11:00:00.000Z");
    });
  });

  it("pausar o que já está pausado devolve ja_estava=true, sem fingir que mudou algo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, rotinaId } = await rotinaAtiva(trx, "Vera");
      await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId });
      const de_novo = await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId });
      expect(de_novo.data).toMatchObject({ estado: "pausada", ja_estava: true });
    });
  });

  it("um agente NÃO mexe na rotina de outro: id de fora do próprio agente volta nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const alheia = await rotinaAtiva(trx, "Tuca");
      const { agenteId, conversaId, deps } = await rotinaAtiva(trx, "Vera");
      const r = await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: alheia.rotinaId });
      expect(r.data).toEqual({ erro: "nao_encontrado" });
      // e a rotina da Tuca continua ativa
      expect((await alheia.repos.rotinas.buscar(alheia.rotinaId))?.estado).toBe("ativa");
    });
  });

  it("atualizar NÃO aplica nada: nasce proposta com o de→para, e confirmar aplica o payload normalizado", async () => {
    process.env.TZ = "UTC";
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, repos, rotinaId, turnoId } = await rotinaAtiva(trx, "Vera");
      const r = await atualizarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId, turnoId), rotina_id: rotinaId, cron: "0 9 * * 1-5", instrucao: "resumir só os PRs meus" });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);

      // Nada mudou ainda.
      expect((await repos.rotinas.buscar(rotinaId))?.cron).toBe("0 8 * * 1-5");
      const proposta = await repos.propostas.buscar(r.data.proposta_id);
      expect(proposta).toMatchObject({ kind: "rotina_atualizacao", estado: "pendente" });
      expect(proposta?.payload).toMatchObject({ rotinaId, cron: "0 9 * * 1-5", antes: { resumo: "dias úteis às 08:00 (America/Sao_Paulo)" } });
      expect(await repos.decisoes.buscar(r.data.proposta_id)).toMatchObject({ tipo: "rotina_atualizacao", estado: "pendente" });

      const aplicada = await aplicarAtualizacaoRotina(deps, { propostaId: r.data.proposta_id });
      expect(aplicada.data.rotina).toMatchObject({ cron: "0 9 * * 1-5", instrucao: "resumir só os PRs meus" });
      // campo não enviado fica como estava
      expect(aplicada.data.rotina.fonte).toBe("PRs abertos do time nod");
      // quinta 17/09 às 09:00 em São Paulo = 12:00Z, recalculado de AGORA
      expect(new Date(aplicada.data.rotina.proximaExecucao).toISOString()).toBe("2026-09-17T12:00:00.000Z");
      // idempotente: confirmar de novo não aplica duas vezes
      expect((await aplicarAtualizacaoRotina(deps, { propostaId: r.data.proposta_id })).data.jaAplicada).toBe(true);
    });
  });

  it("atualizar que não muda nada é entrada_invalida, em vez de gastar a confirmação da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, rotinaId, turnoId } = await rotinaAtiva(trx, "Vera");
      const r = await atualizarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId, turnoId), rotina_id: rotinaId, cron: "0 8 * * 1-5" });
      expect(r.data).toEqual({ erro: "entrada_invalida" });
    });
  });

  it("excluir é recuperável: some da listagem, do teto e do tick, sem apagar linha nem trilha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, repos, rotinaId, turnoId } = await rotinaAtiva(trx, "Vera");
      const r = await excluirRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId, turnoId), rotina_id: rotinaId });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(1); // ainda não excluída

      await aplicarExclusaoRotina(deps, { propostaId: r.data.proposta_id });
      expect((await repos.rotinas.buscar(rotinaId))?.excluidoEm).not.toBeNull(); // a linha continua
      expect(await repos.rotinas.listarDoAgente(agenteId)).toEqual([]);
      expect(await repos.rotinas.contarDoAgente(agenteId)).toBe(0); // não consome o teto de 50
      expect(await repos.rotinas.ativasVencidas(AGORA + 7 * 24 * 3600_000)).toEqual([]);
    });
  });

  it("rotina excluída não aceita mais ferramenta nenhuma: pausar e atualizar voltam nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps, rotinaId, turnoId } = await rotinaAtiva(trx, "Vera");
      const r = await excluirRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId, turnoId), rotina_id: rotinaId });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      await aplicarExclusaoRotina(deps, { propostaId: r.data.proposta_id });
      expect((await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId })).data).toEqual({ erro: "nao_encontrado" });
      expect((await atualizarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: rotinaId, instrucao: "outra" })).data).toEqual({ erro: "nao_encontrado" });
    });
  });

  it("erro de domínio volta TIPADO para o modelo corrigir, nunca vira exceção: id inexistente e id malformado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId, deps } = await rotinaAtiva(trx, "Vera");
      expect((await pausarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: randomUUID() })).data).toEqual({ erro: "nao_encontrado" });
      expect((await reativarRotinaPeloAgente(deps, { ...contexto(agenteId, conversaId), rotina_id: "nao-e-uuid" })).data).toEqual({ erro: "entrada_invalida" });
    });
  });
});
