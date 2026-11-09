import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../../src/adapters/http/rotas/decisoes.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsEmMemoria, MARLON } from "../../helpers/deps-l6.ts";

/** Um clique na decisão de acesso, pela MESMA rota que a web chama (POST decisoes/:id/decidir). */
function decidirPelaRota(deps: Deps, decisaoId: string) {
  const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services })[0]!;
  return async (recusar = false) => {
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await rota.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: decisaoId }, corpo: async () => ({ recusar }), json });
    return json.mock.calls[0]?.[1] as { ok: true; ids: Record<string, string> } | undefined;
  };
}

async function preparar() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const conector = await deps.repos.conectores.criar({ nome: "Slack", slug: "slack", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  conector.habilitado = true;
  conector.catalogo = [{ nome: "enviar", descricao: "Enviar mensagem", schema: { type: "object" }, readOnlyHint: false }];
  const original = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10000, profundidade: 0, entradaTexto: "mande uma msg de teste para Helenad", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  if (!original) throw new Error("turno");
  const pedido = await pedirAcesso(deps, { turnoId: original.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector: "slack", capacidades: ["enviar"], nivel: "escrita", nao_pedido: [] });
  // ADR-044: sem passo de confirmar — o pedido já nasce com a decisão de mesmo id, ligada ao turno.
  expect(banco.decisoes.find((d) => d.id === pedido.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: original.id });
  return { banco, original, propostaId: pedido.data.proposta_id, decidir: decidirPelaRota(deps, pedido.data.proposta_id) };
}

it("conceder o acesso retoma o pedido original uma única vez, sem executar o envio na aprovação", async () => {
  const { banco, original, propostaId, decidir } = await preparar();
  const r = await decidir();
  expect(banco.concessoes).toHaveLength(1);
  expect(r?.ids).toMatchObject({ decisao: propostaId, concessoes: "1", consentimento: expect.any(String), turnoRetomada: expect.any(String) });
  // A proposta sai da conversa no MESMO clique (antes era o confirmar quem a fechava).
  expect(banco.propostas.find((p) => p.id === propostaId)?.estado).toBe("confirmada");
  const retomadas = banco.turnos.filter((t) => t.retomaTurnoId === original.id);
  expect(retomadas).toHaveLength(1);
  expect(retomadas[0]).toMatchObject({ origem: "retomada", harness: original.harness, modelo: original.modelo, entradaConfianca: original.entradaConfianca });
  expect(retomadas[0]?.entradaTexto).toContain(original.entradaTexto);
  expect(retomadas[0]?.entradaTexto).toContain("slack: enviar");
  expect(retomadas[0]?.entradaTexto).toContain("Preserve as regras de aprovação");
  await expect(decidir()).rejects.toMatchObject({ codigo: "estado_invalido" });
  expect(banco.turnos.filter((t) => t.retomaTurnoId === original.id)).toHaveLength(1);
});

it("recusar o acesso não retoma nem concede capacidades", async () => {
  const { banco, original, propostaId, decidir } = await preparar();
  await decidir(true);
  expect(banco.concessoes).toHaveLength(0);
  expect(banco.turnos.filter((t) => t.retomaTurnoId === original.id)).toHaveLength(0);
  expect(banco.propostas.find((p) => p.id === propostaId)?.estado).toBe("recusada");
});

it("preserva a classificação de confiança ao retomar uma entrada externa", async () => {
  const { banco, original, decidir } = await preparar();
  original.entradaConfianca = "nao_confiavel";
  await decidir();
  expect(banco.turnos.find((t) => t.retomaTurnoId === original.id)?.entradaConfianca).toBe("nao_confiavel");
});

describe("pedido que veio de uma rotina (ADR-044)", () => {
  const JANELA = Date.parse("2026-09-24T08:00:00-03:00");

  async function prepararRotina() {
    let agora = JANELA + 30_000;
    const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => agora });
    const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
    const conector = await deps.repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!conector) throw new Error("conector");
    conector.habilitado = true;
    conector.catalogo = [
      { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_LIST_LABELS", descricao: "Lista rótulos", schema: { type: "object" }, readOnlyHint: true },
      { nome: "GMAIL_SEND_EMAIL", descricao: "Envia e-mail", schema: { type: "object" }, readOnlyHint: false },
    ];
    // A fonte não cita o app: o turno roda e pede no meio (com "Gmail" o pré-voo pararia a janela antes).
    const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao: "E-mails às 8h, 13h e 18h", fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: JANELA });
    if (!rotina) throw new Error("rotina");
    const disparo = await dispararRotina(deps, { rotina, instanteAgendado: JANELA, machineId: "m", executor: "catcher" });
    if (!("turno" in disparo.data)) throw new Error("sem turno");
    const turno = disparo.data.turno;
    const pedido = await pedirAcesso(deps, { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    // A pessoa clica fora do minuto cheio da janela que o scheduler reivindicaria.
    agora = JANELA + 3 * 60_000 + 417;
    return { deps, banco, rotina, turno, propostaId: pedido.data.proposta_id, decidir: decidirPelaRota(deps, pedido.data.proposta_id), agora: () => agora };
  }

  it("permitir concede o lote com UM consentimento e roda a rotina de novo AGORA, em modo rotina — não uma retomada", async () => {
    const c = await prepararRotina();
    const r = await c.decidir();
    expect(c.banco.concessoes.map((g) => g.capacidade)).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
    expect(new Set(c.banco.concessoes.map((g) => g.mensagemId)).size).toBe(1);
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
    expect(r?.ids).toMatchObject({ concessoes: "2", rotina: c.rotina.id, turnoRotina: expect.any(String) });
    const novo = c.banco.turnos.find((t) => t.id === r?.ids.turnoRotina);
    expect(novo).toMatchObject({ origem: "rotina", conversaId: c.rotina.conversaId, retomaTurnoId: null });
    expect(c.banco.turnos.filter((t) => t.retomaTurnoId === c.turno.id)).toHaveLength(0);
    // A janela é o instante do clique em ms (não o minuto cheio) e a agenda da rotina não muda.
    expect(c.banco.janelas.find((j) => j.turnoId === novo?.id)?.instanteAgendado).toBe(c.agora());
    expect(c.banco.rotinas.find((x) => x.id === c.rotina.id)?.estado).toBe("ativa");
    expect(c.banco.propostas.find((p) => p.id === c.propostaId)?.estado).toBe("confirmada");
  });

  it("rotina pausada enquanto a pessoa decidia: permitir reativa antes de rodar", async () => {
    const c = await prepararRotina();
    await c.deps.repos.rotinas.atualizarEstado(c.rotina.id, "pausada");
    const r = await c.decidir();
    expect(c.banco.rotinas.find((x) => x.id === c.rotina.id)?.estado).toBe("ativa");
    expect(c.banco.turnos.find((t) => t.id === r?.ids.turnoRotina)?.origem).toBe("rotina");
  });

  it("recusar pausa a rotina — sem o acesso ela pediria de novo a cada disparo — e não concede nada", async () => {
    const c = await prepararRotina();
    const r = await c.decidir(true);
    expect(c.banco.rotinas.find((x) => x.id === c.rotina.id)?.estado).toBe("pausada");
    expect(c.banco.concessoes).toHaveLength(0);
    expect(c.banco.propostas.find((p) => p.id === c.propostaId)?.estado).toBe("recusada");
    expect(r?.ids.turnoRotina).toBeUndefined();
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("rotina excluída depois do pedido: permitir concede e cai na retomada do turno, como pedido da conversa", async () => {
    const c = await prepararRotina();
    await c.deps.repos.rotinas.excluir(c.rotina.id, c.agora());
    const r = await c.decidir();
    expect(c.banco.concessoes).toHaveLength(2);
    expect(r?.ids.turnoRetomada).toBeTruthy();
    expect(c.banco.turnos.find((t) => t.id === r?.ids.turnoRetomada)).toMatchObject({ origem: "retomada", retomaTurnoId: c.turno.id });
  });
});
