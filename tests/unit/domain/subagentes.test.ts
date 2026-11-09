import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventoStream, SubagenteVivo } from "../../../src/contracts/turno.ts";
import { interpretarLinhaStreamJson } from "../../../src/domain/stream-json.ts";
import {
  comRotulos,
  haSubagenteTrabalhando,
  listaDeSubagentes,
  pararSubagentes,
  reduzirSubagentes,
  resumoSubagentes,
  SEM_SUBAGENTES,
  TETO_SUBAGENTES,
  type AcompanhamentoDeSubagentes,
} from "../../../src/domain/subagentes.ts";

const inicia = (id: string, extra: Partial<Extract<EventoStream, { tipo: "tarefa_fundo" }>> = {}): EventoStream => ({ tipo: "tarefa_fundo", id, estado: "iniciada", natureza: "agente", descricao: `Agente ${id}`, ...extra });
const fim = (id: string, final: "concluido" | "falhou" | "parado"): EventoStream => ({ tipo: "tarefa_fundo", id, estado: "terminada", final });
const prog = (id: string, chamadas: number, ferramenta: string | null = "Bash", duracaoMs: number | null = null): EventoStream => ({ tipo: "tarefa_progresso", id, chamadas, ultimaFerramenta: ferramenta, duracaoMs });

function aplicar(evs: EventoStream[], inicio = 0): AcompanhamentoDeSubagentes {
  return evs.reduce((a, ev, i) => reduzirSubagentes(a, ev, inicio + i * 1000).acompanhamento, SEM_SUBAGENTES);
}

const sv = (natureza: "agente" | "comando", estado: SubagenteVivo["estado"]): SubagenteVivo => ({ id: Math.random().toString(36), natureza, descricao: natureza === "agente" ? "x" : "", estado, passo: null, chamadas: 0, duracaoMs: 0 });

describe("redutor dos subagentes (NOD-350)", () => {
  it("fixture real s8: dois agentes, progresso com rótulo e contagem, um conclui e um falha", () => {
    const evs = readFileSync(new URL("../../fixtures/stream-json/s8-subagentes.jsonl", import.meta.url), "utf8").split("\n").map(interpretarLinhaStreamJson);
    const a = aplicar(evs);
    const lista = listaDeSubagentes(a, 1e9);
    expect(lista.map((s) => [s.descricao, s.estado, s.chamadas, s.passo])).toEqual([
      ["Contar linhas do um.txt", "concluido", 2, "Bash"],
      ["Falhar de propósito", "falhou", 2, "Bash"],
    ]);
    // O rótulo da tela sai no servidor, do nome cru (M4 da revisão: o Mac nunca manda texto livre no passo).
    expect(comRotulos(lista).map((s) => s.passo)).toEqual(["Rodou um comando", "Rodou um comando"]);
    expect(resumoSubagentes(lista)).toBe("Os 2 subagentes voltaram · 1 não terminou");
    expect(haSubagenteTrabalhando(lista)).toBe(false);
  });

  it("mudou só quando a tela muda; progresso e fim sem início, ou fim repetido, não mexem", () => {
    let a = SEM_SUBAGENTES;
    expect(reduzirSubagentes(a, prog("x", 1), 0).mudou).toBe(false);
    expect(reduzirSubagentes(a, fim("x", "concluido"), 0).mudou).toBe(false);
    expect(reduzirSubagentes(a, { tipo: "delta", texto: "oi" }, 0)).toEqual({ acompanhamento: a, mudou: false });
    let r = reduzirSubagentes(a, inicia("a"), 0);
    expect(r.mudou).toBe(true);
    a = r.acompanhamento;
    expect(reduzirSubagentes(a, inicia("a"), 1).mudou).toBe(false);
    r = reduzirSubagentes(a, prog("a", 1, "Read"), 1);
    expect(r.mudou).toBe(true);
    a = r.acompanhamento;
    expect(reduzirSubagentes(a, prog("a", 1, "Read", 50), 2).mudou).toBe(false);
    a = reduzirSubagentes(a, fim("a", "falhou"), 3).acompanhamento;
    const de_novo = reduzirSubagentes(a, fim("a", "concluido"), 4);
    expect(de_novo.mudou).toBe(false);
    expect(listaDeSubagentes(de_novo.acompanhamento, 9)[0]!.estado).toBe("falhou");
    // Progresso atrasado depois do fim não ressuscita nem muda a contagem.
    expect(reduzirSubagentes(a, prog("a", 9), 5).mudou).toBe(false);
  });

  it("comando nunca leva descrição; a contagem de chamadas não volta para trás", () => {
    let a = aplicar([inicia("b", { natureza: "comando", descricao: "rm -rf /" }), inicia("a"), prog("a", 3), prog("a", 2)]);
    const [b, ag] = listaDeSubagentes(a, 10_000);
    expect(b).toMatchObject({ natureza: "comando", descricao: "" });
    expect(ag!.chamadas).toBe(3);
    a = aplicar([inicia("c", { natureza: undefined, descricao: undefined })]);
    expect(listaDeSubagentes(a, 0)[0]).toMatchObject({ natureza: "comando", descricao: "" });
  });

  it("teto de 20: o 21º não entra", () => {
    const evs = Array.from({ length: TETO_SUBAGENTES + 3 }, (_, i) => inicia(`a${i}`));
    expect(listaDeSubagentes(aplicar(evs), 0)).toHaveLength(TETO_SUBAGENTES);
  });

  it("duração relativa: do início até agora ou até o fim; o do CLI vale se for maior enquanto roda", () => {
    let a = reduzirSubagentes(SEM_SUBAGENTES, inicia("a"), 1_000).acompanhamento;
    a = reduzirSubagentes(a, prog("a", 1, "Read", 9_000), 2_000).acompanhamento;
    expect(listaDeSubagentes(a, 3_000)[0]!.duracaoMs).toBe(9_000);
    a = reduzirSubagentes(a, fim("a", "concluido"), 4_000).acompanhamento;
    expect(listaDeSubagentes(a, 60_000)[0]!.duracaoMs).toBe(3_000);
  });

  it("Parar: quem trabalhava fica parado; quem já voltou fica como estava; sem ninguém vivo nada muda", () => {
    const a = aplicar([inicia("a"), inicia("b"), fim("b", "concluido")]);
    const r = pararSubagentes(a, 99);
    expect(r.mudou).toBe(true);
    expect(listaDeSubagentes(r.acompanhamento, 100).map((s) => s.estado)).toEqual(["parado", "concluido"]);
    expect(pararSubagentes(r.acompanhamento, 100).mudou).toBe(false);
  });

  it("descrição cortada no teto; passo só nome de ferramenta (≤80, sem texto livre), e o rótulo ≤60", () => {
    const a = aplicar([inicia("a", { descricao: "d".repeat(200) }), prog("a", 1, `mcp__x__${"y".repeat(60)}`)]);
    const [s] = listaDeSubagentes(a, 0);
    expect(s!.descricao.length).toBeLessThanOrEqual(80);
    expect(comRotulos([s!])[0]!.passo!.length).toBeLessThanOrEqual(60);
    // Nome com espaço, controle ou longo demais não troca o passo anterior.
    for (const torto of ["Bash\u0000", "rm -rf /", "x".repeat(81)]) {
      const b = aplicar([inicia("b"), prog("b", 1, "Read"), prog("b", 2, torto)]);
      expect(listaDeSubagentes(b, 0)[0]!.passo).toBe("Read");
    }
  });

  it("subagente em primeiro plano (emFundo: false) não entra na lista: o fim dele não foi medido", () => {
    const r = reduzirSubagentes(SEM_SUBAGENTES, inicia("f", { emFundo: false }), 0);
    expect(r).toEqual({ acompanhamento: SEM_SUBAGENTES, mudou: false });
  });
});

describe("resumo dos subagentes (critérios 3 e 9)", () => {
  it.each<[SubagenteVivo["estado"][], number, string | null]>([
    [[], 0, null],
    [["trabalhando", "trabalhando"], 0, "2 subagentes trabalhando"],
    [["trabalhando"], 0, "1 subagente trabalhando"],
    [["trabalhando", "falhou"], 0, "1 subagente trabalhando · 1 não terminou"],
    [["trabalhando", "concluido"], 1, "1 subagente trabalhando · 1 comando rodando"],
    [[], 1, "1 comando rodando"],
    [[], 2, "2 comandos rodando"],
    [["concluido", "falhou"], 0, "Os 2 subagentes voltaram · 1 não terminou"],
    [["concluido"], 0, "O subagente voltou"],
    [["falhou", "falhou", "concluido"], 0, "Os 3 subagentes voltaram · 2 não terminaram"],
    [["parado", "parado"], 0, "2 subagentes parados"],
    [["parado"], 0, "1 subagente parado"],
    [["parado", "concluido"], 0, "Os 2 subagentes voltaram · 1 não terminou"],
    [["concluido"], 1, "O subagente voltou · 1 comando rodando"],
  ])("%j + %i comando(s) → %s", (estados, comandos, esperado) => {
    const lista = [...estados.map((e) => sv("agente", e)), ...Array.from({ length: comandos }, () => sv("comando", "trabalhando"))];
    expect(resumoSubagentes(lista)).toBe(esperado);
  });

  it("comando que já terminou não conta", () => {
    expect(resumoSubagentes([sv("comando", "concluido")])).toBeNull();
  });

  it("comRotulos remonta campo a campo (QA): no modo local, summary ou args a mais não chegam ao frame", () => {
    const sujo = { id: "a", natureza: "agente", descricao: "D", estado: "trabalhando", passo: "Read", chamadas: 1, duracaoMs: 2, summary: "segredo", input: { command: "cat .env" } } as unknown as SubagenteVivo;
    const [limpo] = comRotulos([sujo]);
    expect(Object.keys(limpo!).sort()).toEqual(["chamadas", "descricao", "duracaoMs", "estado", "id", "natureza", "passo"]);
    expect(JSON.stringify(limpo)).not.toMatch(/segredo|cat \.env/);
  });
});
