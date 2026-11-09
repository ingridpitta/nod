import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { erroPerfilMudou, TEXTO_PERFIL_MUDOU } from "../../src/use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-190: a proposta de perfil guarda a revisão (nome, título, descrição) de quando nasceu. Se a pessoa editou o
 * perfil pela tela enquanto o card esperava, confirmar falha fechada: nada é aplicado, a proposta e as rotinas do
 * card saem recusadas, a decisão fecha e a conversa ganha UM aviso. Tudo isso persiste — o caso não lança, quem
 * chama traduz `obsoleta` em erroPerfilMudou() depois do commit.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-07T12:00:00-03:00");
const RESUMO_DA_MANHA = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "Resumo da manhã: e-mails novos e ToDos do dia", fonte: "Gmail e ClickUp do Marlon", entregavel: "mensagem nesta conversa", limites_aprovacao: "sem ações externas", politica_sem_dado: "dizer que não há novidade" };

async function cenario(trx: Tx) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "vire minha revisora", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  await repos.turnos.assentar(turno.id, { estado: "concluido" });
  const ctx = { agenteId, conversaId, turnoId: turno.id };
  /** O card de perfil como o modelo propõe, com uma rotina junto e a decisão de mesmo id em "Sua vez". */
  async function propor(extra: { rotinas?: (typeof RESUMO_DA_MANHA)[] } = {}) {
    const { data } = await atualizarPerfil(deps, { ...ctx, nome: "Revisora", titulo: "Revisa PRs", descricao: "Revisa os PRs do nod", ...extra });
    if ("erro" in data) throw new Error(data.erro);
    await repos.decisoes.criar({ id: data.proposta_id, tipo: "perfil", agenteId, conversaId, prazoDecisaoEm: AGORA + 3_600_000, frase: "perfil" });
    const p = await repos.propostas.buscar(data.proposta_id);
    if (p?.payload.kind !== "perfil") throw new Error("perfil");
    return { id: data.proposta_id, rotinas: p.payload.rotinas ?? [], revisao: p.payload.revisao };
  }
  const avisos = async () => (await repos.mensagens.listarDaConversa(conversaId, 100)).filter((m) => m.texto === TEXTO_PERFIL_MUDOU);
  return { deps, repos, agenteId, conversaId, ctx, propor, avisos };
}

describeIntegracao("revisão do perfil no card de perfil (NOD-190)", () => {
  it("critério 1: a pessoa editou o nome pela tela — confirmar não aplica, recusa proposta e rotinas, fecha a decisão e avisa uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const card = await c.propor({ rotinas: [RESUMO_DA_MANHA] });
      expect(card.rotinas).toHaveLength(1);

      await editarPerfil(c.deps, { agenteId: c.agenteId, nome: "Vera da Pessoa" });
      const r = await confirmarProposta(c.deps, { propostaId: card.id });
      expect(r.data).toMatchObject({ obsoleta: true, proposta: { estado: "recusada" } });

      expect(await c.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Vera da Pessoa" });
      expect((await c.repos.agentes.buscar(c.agenteId))?.titulo).not.toBe("Revisa PRs");
      expect((await c.repos.propostas.buscar(card.id))?.estado).toBe("recusada");
      for (const id of card.rotinas) {
        expect((await c.repos.propostas.buscar(id))?.estado).toBe("recusada");
        expect(await c.repos.rotinas.buscar(id)).toBeNull();
      }
      expect((await c.repos.decisoes.buscar(card.id))?.estado).toBe("decidida");
      const avisos = await c.avisos();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ kind: "sistema", confianca: "confiavel" });
      expect(r.events?.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada", "decisao_decidida"]);
      expect(r.events?.some((e) => e.kind === "turno_criado")).toBe(false);
      // O erro que as rotas devolvem depois do commit.
      expect(erroPerfilMudou()).toMatchObject({ codigo: "estado_invalido", cause: "perfil_mudou" });

      // Confirmar de novo o card já recusado não aplica nem avisa outra vez.
      await expect(confirmarProposta(c.deps, { propostaId: card.id })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(await c.avisos()).toHaveLength(1);
    });
  });

  it("critério 1: título ou descrição editados pela tela também invalidam o card", async () => {
    await withRollback(MARLON, async (trx) => {
      const titulo = await cenario(trx);
      const porTitulo = await titulo.propor();
      await editarPerfil(titulo.deps, { agenteId: titulo.agenteId, titulo: "Tech Lead" });
      expect((await confirmarProposta(titulo.deps, { propostaId: porTitulo.id })).data.obsoleta).toBe(true);
      expect(await titulo.repos.agentes.buscar(titulo.agenteId)).toMatchObject({ nome: "Vera", titulo: "Tech Lead" });
      expect(await titulo.avisos()).toHaveLength(1);

      const descricao = await cenario(trx);
      const porDescricao = await descricao.propor();
      await editarPerfil(descricao.deps, { agenteId: descricao.agenteId, descricao: "Outra missão" });
      expect((await confirmarProposta(descricao.deps, { propostaId: porDescricao.id })).data.obsoleta).toBe(true);
      expect(await descricao.repos.agentes.buscar(descricao.agenteId)).toMatchObject({ nome: "Vera", descricao: "Outra missão" });
      expect(await descricao.avisos()).toHaveLength(1);
    });
  });

  it("critério 2: sem edição no meio, aplica como hoje — revisão no payload, rotinas ativadas e o turno retomado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const card = await c.propor({ rotinas: [RESUMO_DA_MANHA] });
      expect(card.revisao).toMatch(/^[0-9a-f]{64}$/);

      const r = await confirmarProposta(c.deps, { propostaId: card.id });
      expect(r.data.obsoleta).toBeUndefined();
      expect(r.data.agente).toMatchObject({ nome: "Revisora", titulo: "Revisa PRs", descricao: "Revisa os PRs do nod", confirmado: true });
      for (const id of card.rotinas) expect(await c.repos.rotinas.buscar(id)).toMatchObject({ estado: "ativa" });
      expect(r.events?.filter((e) => e.kind === "turno_criado")).toHaveLength(1);
      expect(await c.avisos()).toHaveLength(0);
    });
  });

  it("critério 3: mudar modelo, forma ou cor não invalida o card", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const card = await c.propor();
      await editarPerfil(c.deps, { agenteId: c.agenteId, forma: "shape-circle", cor: "c-green" });
      await editarPerfil(c.deps, { agenteId: c.agenteId, modelo: "claude-sonnet-4-5" });

      const r = await confirmarProposta(c.deps, { propostaId: card.id });
      expect(r.data.obsoleta).toBeUndefined();
      expect(r.data.agente).toMatchObject({ nome: "Revisora", forma: "shape-circle", cor: "c-green", modelo: "claude-sonnet-4-5", confirmado: true });
      expect(await c.avisos()).toHaveLength(0);
    });
  });

  it("critério 4: proposta sem revisão (anterior à NOD-190) aplica por cima, como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const antiga = await c.repos.propostas.criar({ conversaId: c.conversaId, agenteId: c.agenteId, payload: { kind: "perfil", turnoId: c.ctx.turnoId, nome: "Antiga" } });
      if (!antiga) throw new Error("proposta");
      await editarPerfil(c.deps, { agenteId: c.agenteId, nome: "Vera da Pessoa" });

      const r = await confirmarProposta(c.deps, { propostaId: antiga.id });
      expect(r.data.obsoleta).toBeUndefined();
      expect(await c.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Antiga", confirmado: true });
      expect(await c.avisos()).toHaveLength(0);
    });
  });

  it("critério 5: o mesmo card confirmado duas vezes é idempotente — sem evento, sem mensagem e sem o aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const card = await c.propor({ rotinas: [RESUMO_DA_MANHA] });
      await confirmarProposta(c.deps, { propostaId: card.id });
      const antes = (await c.repos.mensagens.listarDaConversa(c.conversaId, 100)).length;

      const de_novo = await confirmarProposta(c.deps, { propostaId: card.id });
      expect(de_novo.data).toMatchObject({ proposta: { estado: "confirmada" }, agente: { nome: "Revisora" } });
      expect(de_novo.data.obsoleta).toBeUndefined();
      expect(de_novo.events).toEqual([]);
      expect((await c.repos.mensagens.listarDaConversa(c.conversaId, 100)).length).toBe(antes);
      expect(await c.repos.rotinas.contarDoAgente(c.agenteId)).toBe(1);
    });
  });
});
