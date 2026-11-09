import { describe, expect, it } from "vitest";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { criarRotinaPelaPessoa } from "../../../src/use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA, TENANT_PADRAO } from "../../helpers/ids.ts";

const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

/**
 * NOD-182: a confirmação trava a rotina com FOR UPDATE, que só enxerga a linha da dona (policy de UPDATE). Rotina de
 * outra pessoa do tenant existe, mas confirmar por ela é nao_permitido — antes de gravar qualquer coisa. Rotina que
 * não existe continua nao_encontrado.
 */
describe("confirmar proposta de rotina: só a dona trava a linha (NOD-182)", () => {
  async function cenario() {
    const d = depsMemoria({ agora: () => AGORA });
    const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
    const ctx = contexto(agente?.id ?? "", conversa?.id ?? "");
    const a = rotinaValida();
    const { data } = await criarRotinaPelaPessoa(d.deps, { agenteId: agente?.id ?? "", cron: a.cron, fusoIana: a.fuso_iana, instrucao: a.instrucao, fonte: a.fonte, entregavel: a.entregavel, limitesAprovacao: a.limites_aprovacao, politicaSemDado: a.politica_sem_dado });
    return { d, ctx, rotinaId: data.rotina.id };
  }

  it("outra pessoa do tenant confirmando: nao_permitido, sem mexer na rotina nem na proposta", async () => {
    const { d, ctx, rotinaId } = await cenario();
    const up = await atualizarRotinaPeloAgente(d.deps, { ...ctx, rotina_id: rotinaId, cron: "0 9 * * 1-5" });
    const ex = await excluirRotinaPeloAgente(d.deps, { ...ctx, rotina_id: rotinaId });
    if ("erro" in up.data || "erro" in ex.data) throw new Error("proposta");
    const ana = d.comEscopo({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA });
    await expect(aplicarAtualizacaoRotina(ana, { propostaId: up.data.proposta_id })).rejects.toMatchObject({ codigo: "nao_permitido" });
    await expect(aplicarExclusaoRotina(ana, { propostaId: ex.data.proposta_id })).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(await d.deps.repos.rotinas.buscar(rotinaId)).toMatchObject({ cron: rotinaValida().cron, excluidoEm: null });
    expect((await d.deps.repos.propostas.buscar(up.data.proposta_id))?.estado).toBe("pendente");
    expect((await d.deps.repos.propostas.buscar(ex.data.proposta_id))?.estado).toBe("pendente");
  });
});
