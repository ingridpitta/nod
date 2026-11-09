import { describe, expect, it } from "vitest";
import type { CapacidadeConector } from "../../../src/contracts/conector.ts";
import { REGRA_VOLTAS_SEM_NOVIDADE } from "../../../src/contracts/pedido.ts";
import { conceder, concederLote, REGRA_ACESSO_JA_CONCEDIDO } from "../../../src/use-cases/conceder.ts";
import { vencerPedidoDaRotina } from "../../../src/use-cases/decidir-acesso.ts";
import { dispararRotina, REGRA_JANELA_SEGUINTE, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { executarRotinaAgora } from "../../../src/use-cases/executar-rotina-agora.ts";
import { listarRotinas } from "../../../src/use-cases/listar-rotinas.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/**
 * NOD-255 (I1, I3) e NOD-270 (C10, I4, a linha "parada: pergunta sem resposta"): o pré-voo da rotina segura a janela
 * pela aprovação pendente, solta a pergunta das voltas sem novidade, fecha o card já atendido e a execução que espera
 * uma volta só "executou" uma vez.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-17T08:00:30-03:00");
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");
const SEXTA = Date.parse("2026-09-18T08:00:00-03:00");
const SEGUNDA = Date.parse("2026-09-21T08:00:00-03:00");

type D = ReturnType<typeof depsMemoria>;

async function rotinaAtiva(d: D, fonte = "PRs abertos") {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  // NOD-316: o bot nasce em Automático; estes casos partem do Manual, explícito.
  await d.deps.repos.agentes.definirModoAprovacao(agente?.id ?? "", "manual");
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({
    agenteId: agente?.id ?? "",
    conversaId: conversa?.id ?? "",
    cron: "0 8 * * 1-5",
    fusoIana: TZ,
    instrucao: "poste o resumo",
    fonte,
    entregavel: "resumo",
    limitesAprovacao: "nada sai sem aprovação",
    politicaSemDado: "diga que não houve",
    proximaExecucao: JANELA,
  });
  if (!rotina) throw new Error("rotina não criada");
  return rotina;
}

const atual = async (d: D, id: string) => {
  const r = await d.deps.repos.rotinas.buscar(id);
  if (!r) throw new Error("rotina");
  return r;
};

async function primeiraJanela(d: D, rotina: Awaited<ReturnType<typeof rotinaAtiva>>) {
  const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("deveria ter disparado");
  return r.data.turno;
}

/** A pergunta que me_chame_as abre no lugar da quarta volta sem novidade (ADR-099 §5): decisão + balão com a regra. */
async function perguntaDasVoltas(d: D, rotina: Awaited<ReturnType<typeof rotinaAtiva>>, turnoId: string) {
  const decisao = await d.deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId, prazoDecisaoEm: AGORA + 86_400_000, frase: "três voltas sem novidade" });
  if (!decisao) throw new Error("decisão");
  await d.deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    turnoId,
    autoria: { autor_tipo: "agente", autor_id: rotina.agenteId, conta_de_execucao: d.deps.escopo.pessoaId, executor: "catcher", decidido_por: REGRA_VOLTAS_SEM_NOVIDADE } as never,
    kind: "texto",
    texto: "Três voltas sem novidade. Sigo esperando?",
    payload: { kind: "pedido_a_pessoa", decisaoId: decisao.id, opcoes: [] } as never,
    confianca: "confiavel",
  });
  return decisao;
}

describe("NOD-255: aprovação pendente e o 'executou' de uma janela", () => {
  it("CA1/CA2: a aprovação pendente da execução anterior segura o agendador (aguardando_resposta), sem decisão nova; 'Testar agora' roda", async () => {
    let agora = AGORA;
    const d = depsMemoria({ agora: () => agora });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    await d.deps.repos.decisoes.criar({ tipo: "aprovacao", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId: turno.id, prazoDecisaoEm: AGORA + 86_400_000, frase: "enviar o resumo?" });
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
    const decisoesAntes = d.banco.decisoes.length;

    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect(sexta.data).toEqual({ bloqueada: "aguardando_resposta", propostaId: null, proximaExecucao: SEGUNDA });
    expect(d.banco.decisoes).toHaveLength(decisoesAntes);
    expect(d.banco.turnos).toHaveLength(1);
    // review de design do #342: a lista chama de aprovação o que é aprovação (o atalho abre o card de aprovação).
    const aprovacao = d.banco.decisoes.find((x) => x.tipo === "aprovacao");
    const parada = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(parada?.perguntaPendente).toEqual({ decisaoId: aprovacao?.id, desde: Date.parse(String(aprovacao?.criadoEm)), tipo: "aprovacao" });

    agora = AGORA + 5 * 60_000;
    expect((await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" })).data.turnoId).toBeTruthy();
  });

  it("CA5/I3: a execução que espera a volta não 'executou' no primeiro turno; executa UMA vez, na volta", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
    const volta = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "retomada", retomaTurnoId: turno.id, prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "volta", entradaConfianca: "confiavel", modelo: "m" });
    if (!volta) throw new Error("volta");

    expect((await registrarDesfechoRotina(d.deps, { turnoId: turno.id, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_volta" });
    expect(d.banco.execucoes).toHaveLength(0);

    await d.deps.repos.turnos.assentar(volta.id, { estado: "concluido" });
    const ok = await registrarDesfechoRotina(d.deps, { turnoId: volta.id, desfecho: "executou" });
    expect(ok.events?.map((e) => e.kind)).toEqual(["rotina_executou"]);
    expect(d.banco.mensagens.filter((m) => m.kind === "rotina_execucao")).toHaveLength(1);
  });

  it("CA6: 'executou' e depois 'sem_novidade' na mesma janela fica 'executou', sem segundo evento nem mensagem", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    await registrarDesfechoRotina(d.deps, { turnoId: turno.id, desfecho: "executou" });
    const de_novo = await registrarDesfechoRotina(d.deps, { turnoId: turno.id, desfecho: "sem_novidade" });
    expect(de_novo.data).toMatchObject({ inalterado: true, execucao: { desfecho: "executou" } });
    expect(de_novo.events).toEqual([]);
    expect(d.banco.execucoes.map((e) => e.desfecho)).toEqual(["executou"]);
    expect(d.banco.mensagens.filter((m) => m.kind === "rotina_execucao")).toHaveLength(1);
    // o mesmo 'executou' de novo também não repete
    expect((await registrarDesfechoRotina(d.deps, { turnoId: turno.id, desfecho: "executou" })).events).toEqual([]);
  });
});

describe("NOD-270: a pergunta das voltas não segura o cron", () => {
  it("CA1/CA2: a janela seguinte roda, fecha a pergunta pela regra e a execução anterior fica 'sem_novidade' (voltas_sem_novidade)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    const pergunta = await perguntaDasVoltas(d, rotina, turno.id);
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });

    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect("turno" in sexta.data).toBe(true);
    const fechada = d.banco.decisoes.find((x) => x.id === pergunta.id);
    expect(fechada?.estado).not.toBe("pendente");
    expect(sexta.events?.find((e) => e.kind === "decisao_decidida")?.autoria).toMatchObject({ decidido_por: REGRA_JANELA_SEGUINTE });
    expect(d.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo])).toEqual([[JANELA, "sem_novidade", "voltas_sem_novidade"]]);
  });

  it("'Testar agora' não fecha a pergunta das voltas", async () => {
    let agora = AGORA;
    const d = depsMemoria({ agora: () => agora });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    const pergunta = await perguntaDasVoltas(d, rotina, turno.id);
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
    agora = AGORA + 5 * 60_000;
    await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" });
    expect(d.banco.decisoes.find((x) => x.id === pergunta.id)?.estado).toBe("pendente");
  });

  it("CA3: outra pergunta da rotina continua segurando a janela, e a lista mostra desde quando (CA7)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const turno = await primeiraJanela(d, rotina);
    const pergunta = await d.deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId: turno.id, prazoDecisaoEm: AGORA + 86_400_000, frase: "qual repositório?" });
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect(sexta.data).toMatchObject({ bloqueada: "aguardando_resposta" });

    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(dto?.perguntaPendente).toEqual({ decisaoId: pergunta?.id, desde: Date.parse(String(pergunta?.criadoEm)), tipo: "pergunta" });
  });

  it("sem parada, a lista não traz perguntaPendente", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    await primeiraJanela(d, rotina);
    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(dto && "perguntaPendente" in dto).toBe(false);
  });
});

describe("NOD-270 (I4): o card de acesso já atendido", () => {
  const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });
  async function gmail(d: D) {
    const c = await d.deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    await d.deps.repos.conectores.registrarSonda(c.id, { ok: true, agora: AGORA, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)] });
    return c;
  }
  async function cardDoPreVoo(d: D) {
    const conector = await gmail(d);
    const rotina = await rotinaAtiva(d, "E-mails do Gmail");
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in r.data) || !r.data.propostaId) throw new Error("deveria ter bloqueado com card");
    return { conector, rotina, cardId: r.data.propostaId };
  }

  it("CA4: concederLote pela tela Conectores fecha o card do pré-voo pela regra e confirma a proposta", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { conector, rotina, cardId } = await cardDoPreVoo(d);
    const r = await concederLote(d.deps, { agenteId: rotina.agenteId, conectorId: conector.id, capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], autorTipo: "pessoa" });
    expect(d.banco.decisoes.find((x) => x.id === cardId)?.estado).not.toBe("pendente");
    expect(d.banco.propostas.find((p) => p.id === cardId)?.estado).toBe("confirmada");
    expect(r.events?.find((e) => e.kind === "decisao_decidida")?.autoria).toMatchObject({ decidido_por: REGRA_ACESSO_JA_CONCEDIDO });
  });

  it("concessão parcial não fecha o card", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { conector, rotina, cardId } = await cardDoPreVoo(d);
    await concederLote(d.deps, { agenteId: rotina.agenteId, conectorId: conector.id, capacidades: ["GMAIL_FETCH_EMAILS"], autorTipo: "pessoa" });
    expect(d.banco.decisoes.find((x) => x.id === cardId)?.estado).toBe("pendente");
  });

  it("CA5: o card vence com o acesso já dado → fechado como atendido; a rotina segue ativa e nada vai à conversa", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { conector, rotina, cardId } = await cardDoPreVoo(d);
    // concessão uma a uma (o card só fecha quando a última chega): simula o acesso dado sem passar pelo fecho
    await conceder(d.deps, { agenteId: rotina.agenteId, conectorId: conector.id, capacidade: "GMAIL_FETCH_EMAILS", autorTipo: "pessoa" });
    const decisao = d.banco.decisoes.find((x) => x.id === cardId);
    if (!decisao) throw new Error("decisão");
    // a segunda entra direto no repositório, como a concessão feita por outro caminho
    await d.deps.repos.concessoes.conceder({ agenteId: rotina.agenteId, conectorId: conector.id, capacidade: "GMAIL_LIST_LABELS", mensagemId: d.banco.concessoes[0]?.mensagemId ?? "" } as never);
    const r = await vencerPedidoDaRotina(d.deps, { ...decisao });
    expect(r).toMatchObject({ pausada: null, atendido: true });
    expect((await atual(d, rotina.id)).estado).toBe("ativa");
    expect(d.banco.propostas.find((p) => p.id === cardId)?.estado).toBe("confirmada");
  });

  it("CA6: o card vence sem o acesso → a rotina pausa como antes", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { cardId } = await cardDoPreVoo(d);
    const decisao = d.banco.decisoes.find((x) => x.id === cardId);
    if (!decisao) throw new Error("decisão");
    const r = await vencerPedidoDaRotina(d.deps, { ...decisao });
    expect(r.pausada?.estado).toBe("pausada");
    expect(r.atendido).toBeUndefined();
  });
});
