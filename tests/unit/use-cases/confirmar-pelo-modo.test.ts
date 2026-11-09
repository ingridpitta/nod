import { describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import type { ModoTurno, PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { criarRotina } from "../../../src/use-cases/criar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

/**
 * Emenda de 2026-09-30 da ADR-059. Em 30/09, com a Clarice em aprovação automática, dois pedidos de "mudança de
 * rotina proposta" (08:20) e o pedido de acesso para excluir 50 tasks do ClickUp (08:37) viraram card: só
 * pedir_aprovacao, o terminal e o computador consultavam o modo. Agora criar/mudar/excluir rotina e pedir_acesso
 * também passam por ele, e o que o modo confirma nasce fechado pela regra.
 */
const AGORA = Date.parse("2026-09-30T08:37:00-03:00");

async function cenario(modo: ModoAprovacao) {
  const d = depsMemoria({ agora: () => AGORA });
  const repos = d.deps.repos;
  const agente = await repos.agentes.criar({ nome: "Clarice", dono: "pessoa", forma: "shape-hex", cor: "c-red", modelo: "m", confirmado: true });
  const conversa = await repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const clickup = await repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!agente || !conversa || !clickup) throw new Error("cenário");
  await repos.conectores.registrarSonda(clickup.id, {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "CLICKUP_GET_TASKS", descricao: "lista", schema: { type: "object" }, readOnlyHint: true },
      { nome: "CLICKUP_CREATE_TASK", descricao: "cria", schema: { type: "object" }, readOnlyHint: false },
      { nome: "CLICKUP_DELETE_TASK", descricao: "apaga", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  await repos.conectores.habilitar(clickup.id, true);
  // NOD-316: o bot nasce em Automático; o modo do caso é sempre explícito, o Manual também.
  await repos.agentes.definirModoAprovacao(agente.id, modo);
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa.id, agenteId: agente.id, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "exclui as tasks de Tech Checkpoint e Tech Weekly", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno");
  const plano = (modoTurno: ModoTurno = "conversa", extra: Partial<PlanoTurno> = {}) => planoDeTeste({ turnoId: turno.id, agenteId: agente.id, conversaId: conversa.id, modoTurno, ...extra });
  const ctx = (p: PlanoTurno = plano()) => ({ turnoId: turno.id, agenteId: agente.id, conversaId: conversa.id, plano: p });
  return { ...d, agenteId: agente.id, conversaId: conversa.id, turnoId: turno.id, plano, ctx };
}

describe("rotina pelo modo do bot", () => {
  it("automático: criar nasce ativa e mudar já vale, sem card — a proposta fica fechada pela regra (versão 2 desde a ADR-066)", async () => {
    const c = await cenario("automatico");
    const criada = (await criarRotina(c.deps, { ...c.ctx(), ...rotinaValida() })).data;
    if ("erro" in criada) throw new Error(criada.erro);
    expect(criada.aplicada).toBe(true);
    expect(c.banco.rotinas.find((r) => r.id === criada.proposta_id)?.estado).toBe("ativa");

    const r = await atualizarRotinaPeloAgente(c.deps, { ...c.ctx(), rotina_id: criada.proposta_id, cron: "0 12 * * 1-5" });
    const mudanca = r.data;
    if ("erro" in mudanca) throw new Error(mudanca.erro);
    expect(mudanca.aplicada).toBe(true);
    expect(c.banco.rotinas.find((x) => x.id === criada.proposta_id)?.cron).toBe("0 12 * * 1-5");
    const decisao = c.banco.decisoes.find((d) => d.id === mudanca.proposta_id);
    expect(decisao).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:modo_automatico", regraVersao: 2 } });
    expect(c.banco.propostas.find((p) => p.id === mudanca.proposta_id)?.estado).toBe("confirmada");
    // Nenhum frame de card: a decisão nunca esteve pendente para a pessoa.
    expect(r.events?.map((e) => e.kind)).not.toContain("decisao_criada");
    // ADR-042 claim 4: quem agiu foi o agente, sob a regra.
    const linha = c.banco.mensagens.filter((m) => m.kind === "sistema" && m.texto.startsWith("Rotina atualizada")).at(-1);
    expect(linha?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: c.agenteId, decidido_por: "regra:modo_automatico" });
  });

  it("manual continua propondo: a mudança espera o card", async () => {
    const c = await cenario("manual");
    const criada = (await criarRotina(c.deps, { ...c.ctx(), ...rotinaValida() })).data;
    if ("erro" in criada) throw new Error(criada.erro);
    expect(criada.aplicada).toBeUndefined();
    expect(c.banco.rotinas).toHaveLength(0);
    expect(c.banco.decisoes[0]?.estado).toBe("pendente");
  });

  it("ADR-066: conteúdo de fora não para mais o automático — entrada não confiável ou turno que leu algo de fora, a rotina nasce ativa", async () => {
    const c = await cenario("automatico");
    const r = (await criarRotina(c.deps, { ...c.ctx(c.plano("conversa", { confiancaEntrada: "nao_confiavel" })), ...rotinaValida() })).data;
    if ("erro" in r) throw new Error(r.erro);
    expect(r.aplicada).toBe(true);
    expect(c.banco.decisoes[0]).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:modo_automatico", regraVersao: 2 } });
    await c.deps.repos.turnos.contaminar(c.turnoId, AGORA);
    const depoisDaWeb = (await criarRotina(c.deps, { ...c.ctx(), ...rotinaValida() })).data;
    if ("erro" in depoisDaWeb) throw new Error(depoisDaWeb.erro);
    expect(depoisDaWeb.aplicada).toBe(true);
  });

  it("ADR-066: no manual, conteúdo de fora continua propondo — o modo é quem decide, e o manual pede", async () => {
    const c = await cenario("manual");
    await c.deps.repos.turnos.contaminar(c.turnoId, AGORA);
    const r = (await criarRotina(c.deps, { ...c.ctx(c.plano("conversa", { confiancaEntrada: "nao_confiavel" })), ...rotinaValida() })).data;
    if ("erro" in r) throw new Error(r.erro);
    expect(r.aplicada).toBeUndefined();
    expect(c.banco.decisoes[0]?.estado).toBe("pendente");
  });

  it("excluir é o 'apagar' da rotina: sai sozinho na conversa, para numa rotina ou pedido de colega", async () => {
    const c = await cenario("automatico");
    const criar = async () => {
      const r = (await criarRotina(c.deps, { ...c.ctx(), ...rotinaValida() })).data;
      if ("erro" in r) throw new Error(r.erro);
      return r.proposta_id;
    };
    const naRotina = await excluirRotinaPeloAgente(c.deps, { ...c.ctx(c.plano("rotina")), rotina_id: await criar() });
    if ("erro" in naRotina.data) throw new Error(naRotina.data.erro);
    expect(naRotina.data.aplicada).toBeUndefined();
    const naConversa = await excluirRotinaPeloAgente(c.deps, { ...c.ctx(), rotina_id: await criar() });
    if ("erro" in naConversa.data) throw new Error(naConversa.data.erro);
    expect(naConversa.data.aplicada).toBe(true);
    expect(c.banco.rotinas.filter((r) => r.excluidoEm !== null)).toHaveLength(1);
  });

  it("NOD-159, critério 7: no 'Ignorar todas as aprovações', a proposta com revisão nasce e aplica no mesmo turno", async () => {
    const c = await cenario("total");
    const criada = (await criarRotina(c.deps, { ...c.ctx(), ...rotinaValida() })).data;
    if ("erro" in criada) throw new Error(criada.erro);
    const mudar = (await atualizarRotinaPeloAgente(c.deps, { ...c.ctx(), rotina_id: criada.proposta_id, cron: "0 12 * * 1-5" })).data;
    if ("erro" in mudar) throw new Error(mudar.erro);
    expect(mudar.aplicada).toBe(true);
    expect(c.banco.rotinas.find((r) => r.id === criada.proposta_id)?.cron).toBe("0 12 * * 1-5");
    expect(c.banco.propostas.find((p) => p.id === mudar.proposta_id)).toMatchObject({ estado: "confirmada", payload: { revisao: expect.stringMatching(/^[0-9a-f]{64}$/) } });

    const excluir = (await excluirRotinaPeloAgente(c.deps, { ...c.ctx(), rotina_id: criada.proposta_id })).data;
    if ("erro" in excluir) throw new Error(excluir.erro);
    expect(excluir.aplicada).toBe(true);
    expect(c.banco.rotinas.find((r) => r.id === criada.proposta_id)?.excluidoEm).not.toBeNull();
    expect(c.banco.propostas.find((p) => p.id === excluir.proposta_id)).toMatchObject({ estado: "confirmada", payload: { revisao: expect.any(String) } });
    expect(c.banco.mensagens.some((m) => m.texto.startsWith("Esta mudança não foi aplicada"))).toBe(false);
  });
});

describe("pedir_acesso pelo modo do bot", () => {
  const excluir = { conector: "clickup", capacidades: ["CLICKUP_DELETE_TASK"], nivel: "escrita" as const, nao_pedido: ["Excluir tasks de outras listas"], para: "Excluir as 50 tasks da lista Reuniões" };

  it("automático na conversa: o acesso de excluir é concedido na hora e a tarefa retoma sozinha (o caso da Clarice)", async () => {
    const c = await cenario("automatico");
    const r = await pedirAcesso(c.deps, { ...c.ctx(), ...excluir });
    expect(r.data).toMatchObject({ estado: "concedido" });
    expect(c.banco.concessoes.map((x) => x.capacidade)).toEqual(["CLICKUP_DELETE_TASK"]);
    expect(c.banco.decisoes[0]).toMatchObject({ tipo: "acesso", estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:modo_automatico" } });
    const consentimento = c.banco.mensagens.find((m) => m.kind === "consentimento");
    expect(consentimento?.texto).toContain("Pela aprovação automática deste bot, sem clique neste pedido.");
    expect(consentimento?.autoria).toMatchObject({ autor_tipo: "pessoa", decidido_por: "regra:modo_automatico" });
    const retomada = c.banco.turnos.find((t) => t.origem === "retomada");
    expect(retomada?.entradaTexto).toContain("A aprovação automática deste bot concedeu acesso a clickup: CLICKUP_DELETE_TASK.");
    expect(r.events?.map((e) => e.kind)).not.toContain("decisao_criada");
  });

  it("automático num pedido de colega: excluir para no card; criar é concedido", async () => {
    const c = await cenario("automatico");
    expect((await pedirAcesso(c.deps, { ...c.ctx(c.plano("delegacao")), ...excluir })).data).toMatchObject({ estado: "aguardando_pessoa" });
    expect((await pedirAcesso(c.deps, { ...c.ctx(c.plano("delegacao")), conector: "clickup", capacidades: ["CLICKUP_CREATE_TASK"], nivel: "escrita", nao_pedido: [] })).data).toMatchObject({ estado: "concedido" });
  });

  it("manual e sem plano: o card de sempre, nada concedido", async () => {
    const c = await cenario("manual");
    expect((await pedirAcesso(c.deps, { ...c.ctx(), ...excluir })).data).toMatchObject({ estado: "aguardando_pessoa" });
    const t = await cenario("total");
    expect((await pedirAcesso(t.deps, { turnoId: t.turnoId, agenteId: t.agenteId, conversaId: t.conversaId, ...excluir })).data).toMatchObject({ estado: "aguardando_pessoa" });
    expect([...c.banco.concessoes, ...t.banco.concessoes]).toHaveLength(0);
  });

  it("total concede até depois de conteúdo de fora", async () => {
    const c = await cenario("total");
    expect((await pedirAcesso(c.deps, { ...c.ctx(c.plano("conversa", { confiancaEntrada: "nao_confiavel" })), ...excluir })).data).toMatchObject({ estado: "concedido" });
  });

  it("ADR-066: o automático também concede depois de conteúdo de fora; o arriscado fora da conversa continua parando", async () => {
    const c = await cenario("automatico");
    await c.deps.repos.turnos.contaminar(c.turnoId, AGORA);
    const naoConfiavel = c.plano("conversa", { confiancaEntrada: "nao_confiavel" });
    expect((await pedirAcesso(c.deps, { ...c.ctx(naoConfiavel), conector: "clickup", capacidades: ["CLICKUP_CREATE_TASK"], nivel: "escrita", nao_pedido: [] })).data).toMatchObject({ estado: "concedido" });
    expect((await pedirAcesso(c.deps, { ...c.ctx(c.plano("delegacao", { confiancaEntrada: "nao_confiavel" })), ...excluir })).data).toMatchObject({ estado: "aguardando_pessoa" });
  });
});
