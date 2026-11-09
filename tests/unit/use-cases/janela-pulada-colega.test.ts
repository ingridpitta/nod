import { describe, expect, it } from "vitest";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { prazoDoColega } from "../../../src/use-cases/janela-pulada.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/**
 * NOD-274 C9: a frente da rotina sem turno vivo que só espera um colega há mais de 2 períodos do cron (mín. 2 h) não
 * segura a rotina; as janelas puladas antes disso ficam no histórico — revisto em 2026-10-16 (integração no #335): como
 * a 'adiada'/'frente_aberta' da NOD-243 (antes 'nao_rodou'/'execucao_anterior_aberta').
 */
const TZ = "America/Sao_Paulo";
const H = 60 * 60_000;
const T0 = Date.parse("2026-10-16T09:00:00-03:00");
type D = ReturnType<typeof depsMemoria>;

async function cenario(d: D, opcoes: { decisao?: boolean } = {}) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron: "0 * * * *", fusoIana: TZ, instrucao: "acompanhe", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: T0 });
  if (!rotina) throw new Error("rotina");
  const frente = await d.deps.repos.trabalhos.criar({ agenteId: rotina.agenteId, conversaId: rotina.conversaId, titulo: "Orquestrar", origem: "rotina", rotinaId: rotina.id, forma: "frente" });
  if (!frente) throw new Error("frente");
  await d.deps.repos.trabalhos.mudarEstado(frente.id, "rodando", T0);
  const turno = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "conversa", prazoEm: T0 + H, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId: frente.id });
  if (!turno) throw new Error("turno");
  await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
  await d.deps.repos.mensagens.criar({ conversaId: rotina.conversaId, turnoId: turno.id, autoria: { tipo: "agente", agenteId: rotina.agenteId } as never, kind: "handoff", texto: "Ada pediu a Eng 1", payload: { kind: "handoff", de: rotina.agenteId, para: "eng-1", motivo: "faça", tarefaId: "tarefa-1" }, confianca: "nao_confiavel" });
  // O repositório em memória carimba com o relógio real: o pedido ao colega é de T0.
  for (const m of d.banco.mensagens) if (m.kind === "handoff") Object.assign(m, { criadoEm: T0 });
  if (opcoes.decisao) await d.deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId: turno.id, prazoDecisaoEm: T0 + 48 * H, frase: "e agora?" });
  return { rotina, frente };
}

const disparar = (d: D, rotina: Awaited<ReturnType<typeof cenario>>["rotina"], instanteAgendado: number) => dispararRotina(d.deps, { rotina, instanteAgendado, machineId: "m1", executor: "catcher" });

describe("NOD-274 C9: frente esperando colega não segura a rotina para sempre", () => {
  it("o prazo é 2 períodos do cron, no mínimo 2 h", () => {
    expect(prazoDoColega({ cron: "0 * * * *", fusoIana: TZ }, T0)).toBe(2 * H);
    expect(prazoDoColega({ cron: "*/10 * * * *", fusoIana: TZ }, T0)).toBe(2 * H);
    expect(prazoDoColega({ cron: "0 9 * * *", fusoIana: TZ }, T0)).toBe(48 * H);
  });

  it("dentro do prazo a janela é pulada e registrada; passado o prazo, a rotina volta a disparar", async () => {
    let agora = T0;
    const d = depsMemoria({ agora: () => agora });
    const { rotina, frente } = await cenario(d);

    agora = T0 + H;
    const pulada = await disparar(d, rotina, T0 + H);
    expect(pulada.data).toMatchObject({ adiada: "frente_aberta", trabalhoAbertoId: frente.id });
    expect(d.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo, e.turnoId])).toEqual([[T0 + H, "adiada", "frente_aberta", null]]);
    expect(pulada.events?.map((e) => e.kind)).toEqual(["rotina_executou"]);
    expect(d.banco.mensagens.filter((m) => m.kind === "rotina_execucao")).toHaveLength(0);
    // A mesma janela de novo (outra máquina) não registra duas vezes.
    await disparar(d, rotina, T0 + H);
    expect(d.banco.execucoes).toHaveLength(1);

    agora = T0 + 2 * H + 60_000;
    const rodou = await disparar(d, rotina, T0 + 2 * H);
    expect("turno" in rodou.data).toBe(true);
    // Não devolve a frente: ela segue esperando o colega.
    expect((await d.deps.repos.trabalhos.buscar(frente.id))?.estado).toBe("rodando");
  });

  it("frente com outro fato aberto (pergunta à pessoa) segue segurando a rotina mesmo depois do prazo", async () => {
    let agora = T0;
    const d = depsMemoria({ agora: () => agora });
    const { rotina } = await cenario(d, { decisao: true });
    agora = T0 + 5 * H;
    expect((await disparar(d, rotina, T0 + 5 * H)).data).toMatchObject({ adiada: "frente_aberta" });
  });
});
