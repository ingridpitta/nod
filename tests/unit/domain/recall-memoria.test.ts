import { describe, expect, it } from "vitest";
import type { Memoria, TipoMemoria } from "../../../src/contracts/memoria.ts";
import {
  ACHADAS_POR_BUSCA, CHARS_DE_MEMORIA, CHARS_POR_MEMORIA, CONSULTA_MAX, consultaDoTurno, escolherMemoriasDoTurno, linhaDaMemoria, memoriaCabeInteira,
  MEMORIAS_NO_PROMPT, RECALL_POR_TURNO, RECENTES_NO_NUCLEO,
} from "../../../src/domain/recall-memoria.ts";

const m = (i: number, tipo: TipoMemoria = "fato", texto = `fato número ${i}`): Memoria => ({
  tenantId: "t", id: `m${String(i).padStart(3, "0")}`, agenteId: "a", tipo, texto, origem: "pessoa", criadoEm: 1_000 + i,
});
const serie = (n: number, tipo: TipoMemoria = "fato") => Array.from({ length: n }, (_, i) => m(i, tipo));
const ids = (ms: readonly Memoria[]) => ms.map((x) => x.id);
const chars = (ms: readonly Memoria[]) => ms.reduce((s, x) => s + linhaDaMemoria(x).length + 1, 0);

describe("NOD-60: escolherMemoriasDoTurno", () => {
  it("30 memórias: todas, na ordem de criação de hoje; núcleo = total, recall 0", () => {
    const todas = serie(30).reverse();
    const e = escolherMemoriasDoTurno({ todas, achadas: [m(3)] });
    expect(ids(e.memorias)).toEqual(ids(serie(30)));
    expect(e).toMatchObject({ total: 30, nucleo: 30, recall: 0 });
  });

  it("60 memórias: a criada por último entra (antes só as 40 mais antigas)", () => {
    const e = escolherMemoriasDoTurno({ todas: serie(60) });
    expect(ids(e.memorias)).toContain("m059");
    expect(ids(e.memorias)).not.toContain("m000");
    // Sem busca, as vagas que sobram vão para as próximas mais recentes: as 40 mais novas.
    expect(ids(e.memorias)).toEqual(ids(serie(60).slice(-MEMORIAS_NO_PROMPT)));
    expect(e).toMatchObject({ total: 60, nucleo: MEMORIAS_NO_PROMPT, recall: 0 });
  });

  it("60 memórias: a antiga achada pela busca entra como recall", () => {
    const todas = serie(60);
    todas[2] = m(2, "fato", "o CNPJ da Lumen é 12.345.678/0001-90");
    const e = escolherMemoriasDoTurno({ todas, achadas: [todas[2]!] });
    expect(ids(e.memorias)).toContain("m002");
    expect(e.recall).toBe(1);
  });

  it("todas as preferências (até 15) entram, mesmo antigas; acima de 15, as 15 mais recentes", () => {
    const todas = [...serie(20, "preferencia"), ...serie(60).map((x) => ({ ...x, id: `f${x.id}`, criadoEm: x.criadoEm + 100 }))];
    const e = escolherMemoriasDoTurno({ todas });
    const prefs = e.memorias.filter((x) => x.tipo === "preferencia");
    expect(prefs).toHaveLength(15);
    expect(ids(prefs)).toEqual(ids(serie(20, "preferencia").slice(-15)));
    // E as 10 mais recentes vêm além delas; o resto das 40 vagas, as próximas mais recentes.
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(todas.slice(-RECENTES_NO_NUCLEO))));
    expect(e.nucleo).toBe(MEMORIAS_NO_PROMPT);
  });

  it("o recall para em 15 mesmo com vagas sobrando: as achadas além disso não tomam o lugar das recentes", () => {
    const todas = serie(100);
    const achadas = todas.slice(0, 40);
    const e = escolherMemoriasDoTurno({ todas, achadas });
    expect(e.recall).toBe(RECALL_POR_TURNO);
    expect(ids(e.memorias).filter((id) => Number(id.slice(1)) < 40)).toEqual(ids(achadas.slice(0, RECALL_POR_TURNO)));
    expect(e.nucleo).toBe(MEMORIAS_NO_PROMPT - RECALL_POR_TURNO);
  });

  it("a achada vem antes do preenchimento: com o núcleo cheio, a antiga achada entra no lugar de uma recente", () => {
    const todas = serie(60);
    const e = escolherMemoriasDoTurno({ todas, achadas: [todas[0]!] });
    expect(ids(e.memorias)).toContain("m000");
    expect(ids(e.memorias)).not.toContain("m020");
    expect(e).toMatchObject({ nucleo: MEMORIAS_NO_PROMPT - 1, recall: 1 });
  });

  it("nunca mais de 40 linhas: o recall para em 15 e o total em 40", () => {
    const todas = [...serie(15, "preferencia"), ...serie(100).map((x) => ({ ...x, id: `f${x.id}`, criadoEm: x.criadoEm + 100 }))];
    const achadas = todas.slice(15, 15 + ACHADAS_POR_BUSCA);
    const e = escolherMemoriasDoTurno({ todas, achadas });
    expect(e.memorias.length).toBeLessThanOrEqual(MEMORIAS_NO_PROMPT);
    expect(e.recall).toBe(RECALL_POR_TURNO);
    expect(e.memorias).toHaveLength(MEMORIAS_NO_PROMPT);
  });

  it("nunca mais de ~6 mil caracteres: a longa que estouraria é pulada e a curta seguinte ainda entra", () => {
    const longa = (i: number) => m(i, "fato", "x".repeat(1_400));
    const todas = [...serie(50), longa(100), longa(101), longa(102), longa(103), longa(104)];
    const curtaAntiga = todas[1]!;
    const e = escolherMemoriasDoTurno({ todas, achadas: [curtaAntiga] });
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
    expect(ids(e.memorias).filter((id) => ["m100", "m101", "m102", "m103", "m104"].includes(id))).toHaveLength(4);
    expect(ids(e.memorias)).toContain(curtaAntiga.id);
  });

  it("poucas memórias mas longas demais também passam pela escolha (o teto de caracteres vale sempre)", () => {
    const todas = Array.from({ length: 10 }, (_, i) => m(i, "fato", "y".repeat(900)));
    expect(memoriaCabeInteira(todas)).toBe(false);
    const e = escolherMemoriasDoTurno({ todas });
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
    expect(ids(e.memorias)).toContain("m009");
  });

  it("memória maior que o teto entra cortada, nunca some", () => {
    const todas = [...serie(5), m(50, "resumo", "z".repeat(CHARS_DE_MEMORIA + 100))];
    const e = escolherMemoriasDoTurno({ todas });
    const resumo = e.memorias.find((x) => x.id === "m050");
    expect(resumo?.texto).toHaveLength(CHARS_POR_MEMORIA);
    expect(resumo?.texto.endsWith("…")).toBe(true);
    expect(e.memorias).toHaveLength(6);
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
  });

  it("o corte não parte um emoji ao meio", () => {
    const todas = [...serie(5), m(50, "resumo", `${"a".repeat(CHARS_POR_MEMORIA - 2)}😀${"b".repeat(CHARS_DE_MEMORIA)}`)];
    const texto = escolherMemoriasDoTurno({ todas }).memorias.find((x) => x.id === "m050")?.texto ?? "";
    expect(texto.length).toBeLessThanOrEqual(CHARS_POR_MEMORIA);
    expect(texto).toBe(`${"a".repeat(CHARS_POR_MEMORIA - 2)}…`);
  });

  it("as 10 recentes vêm antes do recall: achadas antigas que gastam o orçamento não tiram a mais nova", () => {
    const antigas = Array.from({ length: 15 }, (_, i) => m(i, "fato", `antiga ${i} ${"x".repeat(400)}`));
    const novas = Array.from({ length: 60 }, (_, i) => ({ ...m(100 + i, "fato", `nova ${i} ${"y".repeat(300)}`) }));
    const e = escolherMemoriasDoTurno({ todas: [...antigas, ...novas], achadas: antigas });
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(novas.slice(-RECENTES_NO_NUCLEO))));
    expect(e.recall).toBeGreaterThan(0);
    expect(e.recall).toBeLessThan(antigas.length);
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
  });

  it("o núcleo não gasta o teto inteiro: com preferências longas, a antiga achada ainda entra (e a mais recente também)", () => {
    // 14 preferências de 400 caracteres + 10 fatos curtos quase enchem o teto; a achada (300) só cabe com a reserva.
    const pref = (i: number) => {
      const base = m(i, "preferencia", "");
      return { ...base, texto: `preferência ${i} `.padEnd(400 - linhaDaMemoria(base).length, "p") };
    };
    const prefs = Array.from({ length: 14 }, (_, i) => pref(i));
    const fatos = Array.from({ length: 50 }, (_, i) => m(100 + i));
    const cnpj = m(99, "fato", `o CNPJ da Lumen é 12.345.678/0001-90 ${"c".repeat(260)}`);
    const e = escolherMemoriasDoTurno({ todas: [cnpj, ...prefs, ...fatos], achadas: [cnpj] });
    expect(ids(e.memorias)).toContain(cnpj.id);
    expect(ids(e.memorias)).toContain("m149");
    expect(e.recall).toBeGreaterThanOrEqual(1);
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
  });

  it("preferências longas não tiram as recentes: a mais nova e a achada entram", () => {
    const prefs = Array.from({ length: 4 }, (_, i) => m(i, "preferencia", `preferência ${i} ${"p".repeat(1_100)}`));
    const fatos = Array.from({ length: 45 }, (_, i) => m(50 + i, "fato", `fato ${i} ${"f".repeat(200)}`));
    const achada = m(20, "fato", `o CNPJ da Lumen ${"c".repeat(1_400)}`);
    const e = escolherMemoriasDoTurno({ todas: [...prefs, achada, ...fatos], achadas: [achada] });
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(prefs)));
    expect(ids(e.memorias)).toContain("m094");
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(fatos.slice(-5))));
    expect(ids(e.memorias)).toContain(achada.id);
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
  });

  it("as 15 preferências entram quando longas, cortadas para também preservar as recentes", () => {
    const prefs = Array.from({ length: 15 }, (_, i) => m(i, "preferencia", `preferência ${i} ${"p".repeat(300)}`));
    const fatos = Array.from({ length: 45 }, (_, i) => m(50 + i));
    const e = escolherMemoriasDoTurno({ todas: [...prefs, ...fatos] });
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(prefs)));
    expect(ids(e.memorias)).toEqual(expect.arrayContaining(ids(fatos.slice(-RECENTES_NO_NUCLEO))));
    expect(e.memorias.filter((x) => x.tipo === "preferencia")).toHaveLength(15);
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
  });

  it("borda: 40 memórias curtas cabem inteiras; 41 não", () => {
    expect(memoriaCabeInteira(serie(MEMORIAS_NO_PROMPT))).toBe(true);
    expect(memoriaCabeInteira(serie(MEMORIAS_NO_PROMPT + 1))).toBe(false);
  });

  it("borda: exatamente 6 mil caracteres cabem; um a mais não", () => {
    const exata = (extra: number) => [m(0, "fato", "q".repeat(CHARS_DE_MEMORIA - linhaDaMemoria(m(0, "fato", "")).length - 1 + extra))];
    expect(memoriaCabeInteira(exata(0))).toBe(true);
    expect(memoriaCabeInteira(exata(1))).toBe(false);
  });

  it("até 40 memórias passando de 6 mil caracteres: entram as que cabem, das mais recentes, sem cair no núcleo de 25", () => {
    const todas = Array.from({ length: 35 }, (_, i) => m(i, "fato", `${i} ${"w".repeat(190)}`));
    const e = escolherMemoriasDoTurno({ todas });
    expect(chars(e.memorias)).toBeLessThanOrEqual(CHARS_DE_MEMORIA);
    expect(e.memorias.length).toBeGreaterThan(25);
    expect(ids(e.memorias)).toEqual(ids(todas.slice(-e.memorias.length)));
  });

  it("achada já no núcleo não conta como recall; achada que não é do bot é ignorada", () => {
    const todas = serie(60);
    const e = escolherMemoriasDoTurno({ todas, achadas: [todas[59]!, m(999), todas[5]!] });
    expect(e.recall).toBe(1);
    expect(ids(e.memorias)).not.toContain("m999");
    expect(ids(e.memorias)).toContain("m005");
  });

  it("a escolha é idempotente: reaplicada (a guarda do prompt), volta igual", () => {
    const todas = serie(80);
    const primeira = escolherMemoriasDoTurno({ todas, achadas: [todas[1]!, todas[2]!] });
    expect(ids(escolherMemoriasDoTurno({ todas: primeira.memorias }).memorias)).toEqual(ids(primeira.memorias));
  });

  it("saída sempre na ordem de criação", () => {
    const todas = serie(70);
    const e = escolherMemoriasDoTurno({ todas, achadas: [todas[40]!, todas[3]!, todas[20]!] });
    const criados = e.memorias.map((x) => x.criadoEm);
    expect(criados).toEqual([...criados].sort((a, b) => a - b));
  });
});

describe("NOD-60: consultaDoTurno", () => {
  it("vazio ou só espaço: sem busca", () => {
    expect(consultaDoTurno("")).toBeNull();
    expect(consultaDoTurno("   \n ")).toBeNull();
    expect(consultaDoTurno(null)).toBeNull();
  });
  it("corta a mensagem longa", () => {
    expect(consultaDoTurno("a".repeat(CONSULTA_MAX + 500))).toHaveLength(CONSULTA_MAX);
    expect(consultaDoTurno("  qual o CNPJ da Lumen?  ")).toBe("qual o CNPJ da Lumen?");
  });
});
