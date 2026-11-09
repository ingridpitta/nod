import { describe, expect, it } from "vitest";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import { entradaDaVoltaDaCota } from "../../../src/domain/cota-da-ia.ts";
import { iaDaVoltaDaCota } from "../../../src/domain/espera-da-cota.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { listarRotinas } from "../../../src/use-cases/listar-rotinas.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderRotinas } from "../../../web/telas/rotinas.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/**
 * NOD-274 C7 (revisão do Gil): a rotina cuja execução espera a cota da IA renovar aparece na lista como "esperando a cota
 * do <IA> · volta às HH:MM" — `esperaDaCota {ia, voltaEm}` no DTO e a tag em web/telas/rotinas.ts.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-17T08:00:30-03:00");
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");
const VOLTA = Date.parse("2026-09-17T14:00:00-03:00");
type D = ReturnType<typeof depsMemoria>;

async function rotinaComJanela(d: D) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "poste o resumo", fonte: "PRs", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "diga", proximaExecucao: JANELA });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("deveria ter disparado");
  return { rotina, turno: r.data.turno };
}

async function volta(d: D, rotina: { conversaId: string; agenteId: string }, retomaTurnoId: string, entradaTexto: string, acordarEm: number) {
  const v = await d.deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "retomada", retomaTurnoId, prazoEm: acordarEm + 60_000, profundidade: 0, entradaTexto, entradaConfianca: "confiavel", modelo: "m", acordarEm });
  if (!v) throw new Error("volta");
  return v;
}

describe("NOD-274 C7: a lista de rotinas mostra a espera da cota", () => {
  it("execução aberta com a volta da cota marcada → esperaDaCota {ia, voltaEm}", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { rotina, turno } = await rotinaComJanela(d);
    await d.deps.repos.turnos.assentar(turno.id, { estado: "interrompido" });
    await volta(d, rotina, turno.id, entradaDaVoltaDaCota("Claude Code"), VOLTA);
    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(dto?.esperaDaCota).toEqual({ ia: "Claude Code", voltaEm: VOLTA });
  });

  it("volta marcada que não é da cota (me chame às 14:00) não vira espera da cota", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { rotina, turno } = await rotinaComJanela(d);
    await d.deps.repos.turnos.assentar(turno.id, { estado: "concluido" });
    await volta(d, rotina, turno.id, "[nod] Hora marcada: siga", VOLTA);
    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(dto && "esperaDaCota" in dto).toBe(false);
  });

  it("sem volta pendente, a lista não traz esperaDaCota", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { rotina } = await rotinaComJanela(d);
    const dto = (await listarRotinas(d.deps, {})).data.rotinas.find((r) => r.rotina.id === rotina.id);
    expect(dto && "esperaDaCota" in dto).toBe(false);
  });

  it("o nome da IA sai da entrada da volta; sem casar, do harness da volta", () => {
    expect(iaDaVoltaDaCota(entradaDaVoltaDaCota("Codex"), null)).toBe("Codex");
    expect(iaDaVoltaDaCota("outra coisa", "claude-cli")).toBe("Claude Code");
    expect(iaDaVoltaDaCota("outra coisa", "auto")).toBe("IA");
  });

  it("a tela mostra 'esperando a cota do Claude Code · volta às 14:00' no fuso da rotina", () => {
    const r = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "x", cron: "0 8 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: false, fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null } as const;
    const dto: RotinaDto = { rotina: { ...r }, proximaExecucao: AGORA, bloqueio: null, resumo: "todo dia", espera: null, esperaDaCota: { ia: "Claude Code", voltaEm: VOLTA } };
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto] });
    expect(html).toContain("esperando a cota do Claude Code · volta às 14:00");
    expect(html).not.toContain("rotina-parada");
    const sem = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [{ ...dto, esperaDaCota: undefined }] });
    expect(sem).not.toContain("esperando a cota");
    const generica = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [{ ...dto, esperaDaCota: { ia: "IA", voltaEm: VOLTA } }] });
    expect(generica).toContain("esperando a cota da IA · volta às 14:00");
  });

  const dtoCom = (voltaEm: number): RotinaDto => {
    const r = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "x", cron: "0 8 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: false, fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null } as const;
    return { rotina: { ...r }, proximaExecucao: AGORA, bloqueio: null, resumo: "todo dia", espera: null, esperaDaCota: { ia: "Claude Code", voltaEm } };
  };

  it("revisão do Gil no #340: a volta em outro dia diz o dia, no fuso da rotina", () => {
    const amanha = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dtoCom(Date.parse("2026-09-18T14:00:00-03:00"))] });
    expect(amanha).toContain("esperando a cota do Claude Code · volta amanhã às 14:00");
    const semanal = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dtoCom(Date.parse("2026-09-20T14:00:00-03:00"))] });
    expect(semanal).toContain("esperando a cota do Claude Code · volta em 20/09 às 14:00");
    // 23:30 em SP já é amanhã em UTC: o dia é o do fuso da rotina.
    const noite = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dtoCom(Date.parse("2026-09-17T23:30:00-03:00"))] });
    expect(noite).toContain("esperando a cota do Claude Code · volta às 23:30");
  });

  it("revisão do Gil no #340: passada a hora da volta com a tela aberta, a tag some", () => {
    expect(renderRotinas({ ...estadoInicial, agora: VOLTA, rotinas: [dtoCom(VOLTA)] })).not.toContain("esperando a cota");
    expect(renderRotinas({ ...estadoInicial, agora: VOLTA + 5 * 60_000, rotinas: [dtoCom(VOLTA)] })).not.toContain("esperando a cota");
    expect(renderRotinas({ ...estadoInicial, agora: VOLTA - 60_000, rotinas: [dtoCom(VOLTA)] })).toContain("esperando a cota do Claude Code · volta às 14:00");
  });

  it("revisão do Gil no #340: o 'nada a fazer' também em texto para o leitor de tela", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dtoCom(VOLTA)] });
    expect(html).toContain('<span class="sr-only"> (volta sozinha; nada a fazer)</span>');
  });
});
