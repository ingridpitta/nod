import { expect, it } from "vitest";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina, erroRotinaMudou, TEXTO_ROTINA_MUDOU } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { criarRotinaPelaPessoa } from "../../src/use-cases/criar-rotina.ts";
import { pausarRotinaPeloAgente, atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-159: a proposta de mudar ou excluir uma rotina guarda a revisão de quando nasceu. Se a rotina mudou por
 * outro caminho enquanto o card esperava, confirmar falha fechada: nada é aplicado, a proposta sai recusada, a
 * decisão fecha e a conversa ganha o aviso. Tudo isso PERSISTE — o caso não lança, quem chama traduz o erro.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

async function rotinaAtiva(trx: Parameters<Parameters<typeof withRollback>[1]>[0]) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const a = rotinaValida();
  const { data } = await criarRotinaPelaPessoa(deps, { agenteId, cron: a.cron, fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "mexe na rotina", entradaConfianca: "confiavel", modelo: "m" });
  const ctx = contexto(agenteId, conversaId, turno?.id);
  return { agenteId, conversaId, deps, repos, ctx, rotinaId: data.rotina.id, rotinaConversaId: data.rotina.conversaId };
}

describeIntegracao("revisão da rotina nas propostas de mudar e excluir (NOD-159)", () => {
  it("critério 2: atualização com a rotina mudada no meio não aplica, recusa a proposta, fecha a decisão e avisa uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId, rotinaConversaId } = await rotinaAtiva(trx);
      const velha = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId, cron: "0 10 * * 1-5" });
      if ("erro" in velha.data) throw new Error(velha.data.erro);
      expect((await repos.propostas.buscar(velha.data.proposta_id))?.payload).toMatchObject({ revisao: expect.stringMatching(/^[0-9a-f]{64}$/) });

      // Outro caminho muda a instrução enquanto o primeiro card espera.
      const outra = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId, instrucao: "resumir só os PRs meus" });
      if ("erro" in outra.data) throw new Error(outra.data.erro);
      await aplicarAtualizacaoRotina(deps, { propostaId: outra.data.proposta_id });
      const antes = await repos.rotinas.buscar(rotinaId);
      const avisosAntes = (await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU).length;

      const r = await aplicarAtualizacaoRotina(deps, { propostaId: velha.data.proposta_id });
      expect(r.data).toMatchObject({ obsoleta: true, jaAplicada: false });
      expect(await repos.rotinas.buscar(rotinaId)).toEqual(antes);
      expect((await repos.rotinas.buscar(rotinaId))?.instrucao).toBe("resumir só os PRs meus");
      expect((await repos.propostas.buscar(velha.data.proposta_id))?.estado).toBe("recusada");
      expect((await repos.decisoes.buscar(velha.data.proposta_id))?.estado).toBe("decidida");
      const avisos = (await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU);
      expect(avisos.length - avisosAntes).toBe(1);
      expect(avisos[0]).toMatchObject({ kind: "sistema", confianca: "confiavel" });
      expect(r.events?.map((e) => e.kind)).toContain("decisao_decidida");
      // O erro que a rota e a ferramenta devolvem depois do commit.
      expect(erroRotinaMudou()).toMatchObject({ codigo: "estado_invalido", cause: "rotina_mudou" });

      // Confirmar de novo o card já recusado não reaplica nem avisa outra vez.
      await expect(aplicarAtualizacaoRotina(deps, { propostaId: velha.data.proposta_id })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU)).toHaveLength(avisos.length);
    });
  });

  it("critério 3: exclusão com a rotina mudada no meio não carimba excluidoEm e falha fechada do mesmo jeito", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId, rotinaConversaId } = await rotinaAtiva(trx);
      const exclusao = await excluirRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId });
      if ("erro" in exclusao.data) throw new Error(exclusao.data.erro);
      await repos.rotinas.atualizar(rotinaId, { instrucao: "outra instrução, mudada pela tela" });

      const r = await aplicarExclusaoRotina(deps, { propostaId: exclusao.data.proposta_id });
      expect(r.data).toMatchObject({ obsoleta: true, jaAplicada: false });
      expect((await repos.rotinas.buscar(rotinaId))?.excluidoEm).toBeNull();
      expect((await repos.propostas.buscar(exclusao.data.proposta_id))?.estado).toBe("recusada");
      expect((await repos.decisoes.buscar(exclusao.data.proposta_id))?.estado).toBe("decidida");
      expect((await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU)).toHaveLength(1);
    });
  });

  it("critério 4: sem mudança no meio, atualizar e excluir aplicam como hoje", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId } = await rotinaAtiva(trx);
      const p = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId, cron: "0 9 * * 1-5" });
      if ("erro" in p.data) throw new Error(p.data.erro);
      const a = await aplicarAtualizacaoRotina(deps, { propostaId: p.data.proposta_id });
      expect(a.data).toMatchObject({ jaAplicada: false, rotina: { cron: "0 9 * * 1-5" } });
      expect(a.data.obsoleta).toBeUndefined();

      const e = await excluirRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId });
      if ("erro" in e.data) throw new Error(e.data.erro);
      const x = await aplicarExclusaoRotina(deps, { propostaId: e.data.proposta_id });
      expect(x.data.obsoleta).toBeUndefined();
      expect((await repos.rotinas.buscar(rotinaId))?.excluidoEm).not.toBeNull();
    });
  });

  it("critério 5: pausar no meio não invalida o card — confirmar aplica normalmente", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId } = await rotinaAtiva(trx);
      const p = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId, cron: "0 9 * * 1-5" });
      if ("erro" in p.data) throw new Error(p.data.erro);
      await pausarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId });
      const a = await aplicarAtualizacaoRotina(deps, { propostaId: p.data.proposta_id });
      expect(a.data.obsoleta).toBeUndefined();
      expect((await repos.rotinas.buscar(rotinaId))?.cron).toBe("0 9 * * 1-5");

      const e = await excluirRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId });
      if ("erro" in e.data) throw new Error(e.data.erro);
      await pausarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId });
      expect((await aplicarExclusaoRotina(deps, { propostaId: e.data.proposta_id })).data.obsoleta).toBeUndefined();
      expect((await repos.rotinas.buscar(rotinaId))?.excluidoEm).not.toBeNull();
    });
  });

  it("critério 6: proposta antiga, sem revisao no payload, aplica como hoje mesmo com a rotina mudada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId, conversaId, agenteId } = await rotinaAtiva(trx);
      const atual = await repos.rotinas.buscar(rotinaId);
      if (!atual) throw new Error("rotina");
      // Payload como era gravado antes do deploy: sem `revisao`.
      const proposta = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "rotina_atualizacao", rotinaId, cron: "0 9 * * 1-5", proximaExecucao: AGORA, resumo: "dias úteis às 09:00", antes: { resumo: "dias úteis às 08:00", instrucao: atual.instrucao } } });
      if (!proposta) throw new Error("proposta");
      await repos.decisoes.criar({ id: proposta.id, tipo: "rotina_atualizacao", agenteId, conversaId, turnoId: ctx.turnoId, prazoDecisaoEm: AGORA + 1_000, frase: "mudança" });
      await repos.rotinas.atualizar(rotinaId, { instrucao: "mudada pela tela" });

      const a = await aplicarAtualizacaoRotina(deps, { propostaId: proposta.id });
      expect(a.data.obsoleta).toBeUndefined();
      expect((await repos.rotinas.buscar(rotinaId))?.cron).toBe("0 9 * * 1-5");

      const ex = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "rotina_exclusao", rotinaId, resumo: "x", instrucao: "y" } });
      if (!ex) throw new Error("proposta");
      await repos.rotinas.atualizar(rotinaId, { instrucao: "mudada de novo" });
      expect((await aplicarExclusaoRotina(deps, { propostaId: ex.id })).data.obsoleta).toBeUndefined();
      expect((await repos.rotinas.buscar(rotinaId))?.excluidoEm).not.toBeNull();
    });
  });
  it("NOD-182: atualização com a rotina já excluída sai obsoleta e a recusa persiste; sem revisao mantém o erro antigo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, ctx, rotinaId, rotinaConversaId, conversaId, agenteId } = await rotinaAtiva(trx);
      const atual = await repos.rotinas.buscar(rotinaId);
      if (!atual) throw new Error("rotina");
      const up = await atualizarRotinaPeloAgente(deps, { ...ctx, rotina_id: rotinaId, cron: "0 9 * * 1-5" });
      if ("erro" in up.data) throw new Error(up.data.erro);
      // Payload como era gravado antes da NOD-159: sem `revisao`.
      const legado = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "rotina_atualizacao", rotinaId, cron: "0 10 * * 1-5", proximaExecucao: AGORA, resumo: "dias úteis às 10:00", antes: { resumo: "dias úteis às 08:00", instrucao: atual.instrucao } } });
      if (!legado) throw new Error("proposta");
      await repos.rotinas.excluir(rotinaId, AGORA);

      const r = await aplicarAtualizacaoRotina(deps, { propostaId: up.data.proposta_id });
      expect(r.data).toMatchObject({ obsoleta: true, jaAplicada: false });
      expect((await repos.propostas.buscar(up.data.proposta_id))?.estado).toBe("recusada");
      expect((await repos.decisoes.buscar(up.data.proposta_id))?.estado).toBe("decidida");
      expect((await repos.mensagens.listarDaConversa(rotinaConversaId)).filter((m) => m.texto === TEXTO_ROTINA_MUDOU)).toHaveLength(1);
      expect((await repos.rotinas.buscar(rotinaId))?.cron).toBe(atual.cron);

      await expect(aplicarAtualizacaoRotina(deps, { propostaId: legado.id })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "rotina excluída" });
      expect((await repos.propostas.buscar(legado.id))?.estado).toBe("pendente");
    });
  });
});
