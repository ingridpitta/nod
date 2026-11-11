import { describe, expect, it, vi } from "vitest";
import type { DesfechoRotina } from "../../../src/contracts/motivos.ts";
import { DESFECHOS_ROTINA } from "../../../src/contracts/motivos.ts";
import type { ExecucaoRotina } from "../../../src/contracts/rotina.ts";
import { diaNoFuso, projetarAgenda, temProblema, TETO_JANELAS_POR_PEDIDO, TETO_PROJECOES_POR_PEDIDO, type RotinaParaAgenda } from "../../../src/domain/agenda-rotinas.ts";

const H = 3_600_000;
const DIA = 24 * H;
const de = Date.parse("2026-10-26T03:00Z"); // 26/10 00:00 em São Paulo
const ate = de + 7 * DIA;
const agora = Date.parse("2026-10-29T13:40Z"); // 29/10 10:40 em SP
const FUSO = "America/Sao_Paulo";

const rotina = (id: string, cron: string, estado: RotinaParaAgenda["estado"] = "ativa"): RotinaParaAgenda => ({ id, cron, fusoIana: FUSO, estado });
let seq = 0;
const exec = (rotinaId: string, instante: number, desfecho: DesfechoRotina = "executou"): ExecucaoRotina => ({
  tenantId: "t" as ExecucaoRotina["tenantId"], id: `e${++seq}`, rotinaId, instanteAgendado: instante, turnoId: null, desfecho, motivo: null, em: instante + 60_000,
});
const projetar = (rotinas: RotinaParaAgenda[], execucoes: ExecucaoRotina[] = [], guardadas = 20) =>
  projetarAgenda({ rotinas, execucoes, de, ate, agora, fuso: FUSO, guardadas });

describe("projetarAgenda (NOD-85)", () => {
  it("problema só em falhou, interrompida, bloqueada e nao_rodou", () => {
    const com = DESFECHOS_ROTINA.filter(temProblema);
    expect([...com].sort()).toEqual(["bloqueada", "falhou", "interrompida", "nao_rodou"]);
    for (const d of ["executou", "sem_novidade", "passou_em_branco", "adiada"] as const) expect(temProblema(d)).toBe(false);
  });

  it("NOD-84: a rotina webhook entra com o histórico e o registroDesde, sem nenhuma prevista (Codex, revisão)", () => {
    const w: RotinaParaAgenda = { id: "w", cron: "0 0 31 2 *", fusoIana: FUSO, estado: "ativa", gatilho: "webhook" };
    const ontem = Date.parse("2026-10-28T15:00Z");
    const execs = [exec("w", ontem), ...Array.from({ length: 19 }, (_, i) => exec("w", ontem - (i + 1) * DIA))];
    const p = projetar([w], execs);
    expect(p.itens.filter((i) => i.tipo === "prevista")).toHaveLength(0);
    expect(p.itens.some((i) => i.tipo === "execucao" && i.instante === ontem)).toBe(true);
    expect(p.registroDesde.get("w")).toBe(ontem - 19 * DIA);
  });

  it("passado vem das execuções guardadas e futuro das janelas do cron, por dia no fuso da pessoa", () => {
    const r = rotina("a", "0 9 * * *"); // 9h SP = 12:00Z
    const ontem = Date.parse("2026-10-28T12:00Z");
    const hoje = Date.parse("2026-10-29T12:00Z");
    const { itens } = projetar([r], [exec("a", ontem), exec("a", hoje, "falhou")]);
    const passado = itens.filter((i) => i.tipo === "execucao");
    expect(passado.map((i) => [i.dia, i.tipo === "execucao" && i.problema])).toEqual([["2026-10-28", false], ["2026-10-29", true]]);
    const previstas = itens.filter((i) => i.tipo === "prevista");
    expect(previstas[0]?.dia).toBe("2026-10-30");
    expect(previstas).toHaveLength(3); // 30, 31 e 1º
    expect(previstas.every((i) => i.instante >= agora)).toBe(true);
  });

  it("pausada não tem previstas, mas mostra o passado", () => {
    const { itens } = projetar([rotina("p", "0 9 * * *", "pausada")], [exec("p", Date.parse("2026-10-28T12:00Z"))]);
    expect(itens.map((i) => i.tipo)).toEqual(["execucao"]);
  });

  it("a janela que já tem execução não vira prevista de novo", () => {
    const t = Date.parse("2026-10-29T14:00Z"); // 11h SP, depois do agora, já reivindicada
    const { itens } = projetar([rotina("x", "0 11 * * *")], [exec("x", t)]);
    expect(itens.filter((i) => i.instante === t).map((i) => i.tipo)).toEqual(["execucao"]);
  });

  it("mais de 24 por dia vira uma faixa 'a cada N min' com previstas e problemas", () => {
    const r = rotina("f", "*/10 * * * *");
    const execs = [exec("f", Date.parse("2026-10-29T13:00Z"), "falhou"), exec("f", Date.parse("2026-10-29T13:10Z"), "interrompida"), exec("f", Date.parse("2026-10-29T13:20Z"))];
    const { itens } = projetar([r], execs);
    expect(itens.every((i) => i.tipo === "faixa")).toBe(true);
    const hoje = itens.find((i) => i.dia === "2026-10-29");
    expect(hoje).toMatchObject({ tipo: "faixa", intervaloMin: 10, execucoes: 3, problemas: 2 });
    // 29/10 em SP vai até 03:00Z do dia 30: das 13:40Z (o agora, inclusive) em diante, de 10 em 10.
    expect(hoje?.tipo === "faixa" && hoje.previstas).toBe(Math.round((Date.parse("2026-10-30T03:00Z") - Date.parse("2026-10-29T13:40Z")) / 600_000));
  });

  it("com exatamente 24 por dia continua uma linha por janela", () => {
    const { itens } = projetar([rotina("h", "0 * * * *")]);
    expect(itens.some((i) => i.tipo === "faixa")).toBe(false);
  });

  it("registroDesde: a mais antiga quando a poda já cortou (20 guardadas); null com registro inteiro", () => {
    const execs = Array.from({ length: 20 }, (_, i) => exec("g", Date.parse("2026-10-29T07:30Z") + i * 10 * 60_000));
    const p = projetar([rotina("g", "*/10 * * * *"), rotina("n", "0 9 * * *")], [...execs, exec("n", Date.parse("2026-10-28T12:00Z"))]);
    expect(p.registroDesde.get("g")).toBe(Date.parse("2026-10-29T07:30Z"));
    expect(p.registroDesde.get("n")).toBeNull();
  });

  it("cron que o parser recusa não derruba a agenda; a de minuto em minuto vira faixa em todos os dias, sem corte", () => {
    const p = projetar([rotina("ruim", "0 8 * *"), rotina("min", "* * * * *")]);
    expect(p.itens.filter((i) => i.rotinaId === "ruim")).toEqual([]);
    expect(p.cortado.size).toBe(0);
    const faixas = p.itens.filter((i) => i.rotinaId === "min");
    // Revisão 1 do PR #595: com o teto antigo (500) a rotina sumia depois do 1º dia; agora vai até o fim da janela.
    expect(faixas.map((f) => f.dia)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(faixas.slice(1).map((f) => (f.tipo === "faixa" ? f.previstas : 0))).toEqual([1440, 1440, 1440]);
  });

  it("teto por pedido: 50 rotinas de minuto em minuto não listam milhões de janelas; a diária, mesmo depois delas, sai inteira (revisão 3 do PR 595)", () => {
    const longe = agora + 42 * DIA;
    const rotinas = [...Array.from({ length: 50 }, (_, i) => rotina(`min${i}`, "* * * * *")), rotina("diaria", "0 9 * * *")];
    const p = projetarAgenda({ rotinas, execucoes: [], de: agora, ate: longe, agora, fuso: FUSO, guardadas: 20 });
    const listadas = p.itens.reduce((n, i) => n + (i.tipo === "faixa" ? i.previstas : i.tipo === "prevista" ? 1 : 0), 0);
    expect(listadas).toBeLessThanOrEqual(TETO_JANELAS_POR_PEDIDO);
    expect(p.cortado.has("diaria")).toBe(false);
    expect(p.itens.filter((i) => i.rotinaId === "diaria")).toHaveLength(42);
    expect(p.cortado.size).toBeGreaterThan(0);
  });

  // Revisão 4 do PR 595: o trabalho, não só as janelas. Mil rotinas diárias iguais custam o mesmo que uma; pares (cron,
  // fuso) diferentes acima do teto saem cortados em vez de segurar o event loop.
  it("mil rotinas com o mesmo cron projetam uma vez; crons diferentes acima do teto saem cortados", () => {
    const longe = agora + 42 * DIA;
    const contar = (rotinas: RotinaParaAgenda[]) => {
      const espia = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
      try { return { p: projetarAgenda({ rotinas, execucoes: [], de: agora, ate: longe, agora, fuso: FUSO, guardadas: 20 }), chamadas: espia.mock.calls.length }; } finally { espia.mockRestore(); }
    };
    const uma = contar([rotina("d0", "0 9 * * *")]);
    const mil = contar(Array.from({ length: 1000 }, (_, i) => rotina(`d${i}`, "0 9 * * *")));
    expect(mil.chamadas).toBe(uma.chamadas);
    expect(mil.p.itens.filter((i) => i.rotinaId === "d999")).toHaveLength(42);
    const n = TETO_PROJECOES_POR_PEDIDO + 50;
    const variadas = contar(Array.from({ length: n }, (_, i) => rotina(`v${i}`, `${i % 60} ${Math.floor(i / 60) % 24} * * *`)));
    expect(variadas.p.cortado.size).toBe(50);
    expect(variadas.chamadas).toBeLessThanOrEqual(uma.chamadas * TETO_PROJECOES_POR_PEDIDO * 2);
    // O teste mede chamadas, não tempo: ~1,3 s local, 4,5–6,8 s no runner sob carga (main 41441244385, PR 625).
  }, 30_000);

  it("diaNoFuso usa o fuso pedido", () => {
    expect(diaNoFuso(Date.parse("2026-10-30T02:00Z"), FUSO)).toBe("2026-10-29");
    expect(diaNoFuso(Date.parse("2026-10-30T02:00Z"), "UTC")).toBe("2026-10-30");
  });
});

describe("pausada com data (NOD-412)", () => {
  const previstas = (p: ReturnType<typeof projetar>, id: string) => p.itens.filter((i) => i.tipo === "prevista" && i.rotinaId === id).map((i) => i.instante);

  it("prevê as janelas só a partir da retomada; sem data, nenhuma; ativa, a partir de agora", () => {
    const retomarEm = Date.parse("2026-10-31T03:00Z"); // sáb 31/10 00:00 em SP
    const comData: RotinaParaAgenda = { ...rotina("p", "0 9 * * *", "pausada"), retomarEm };
    const p = projetar([comData, rotina("s", "0 9 * * *", "pausada"), rotina("a", "0 9 * * *")]);
    expect(previstas(p, "p")).toEqual([Date.parse("2026-10-31T12:00Z"), Date.parse("2026-11-01T12:00Z")]);
    expect(previstas(p, "s")).toEqual([]);
    expect(previstas(p, "a")[0]).toBe(Date.parse("2026-10-29T12:00Z") + DIA);
  });

  it("retomada que já passou (o tick ainda não rodou) prevê a partir de agora", () => {
    const p = projetar([{ ...rotina("p", "0 9 * * *", "pausada"), retomarEm: agora - H }]);
    expect(previstas(p, "p")[0]).toBe(Date.parse("2026-10-30T12:00Z"));
  });
});
