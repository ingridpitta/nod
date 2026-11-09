import { describe, expect, it } from "vitest";
import { chaveDoRisco, fimDoPrazo, riscoDoQuadro, textoDoRisco, type TarefaParaRisco } from "../../../src/domain/risco-quadro.ts";

const DIA = 86_400_000;
const t = (titulo: string, s: "feita" | "fechada" | "nao" | "andando"): TarefaParaRisco => ({ titulo, feita: s === "feita", fechada: s === "fechada", naoIniciada: s === "nao" });
// Prazo em 10 dias a partir da criação: 20% do período = 2 dias.
const prazo = "2026-11-11";
const fim = fimDoPrazo(prazo);
const metaDesde = fim - 10 * DIA;
const base = { meta: "Lançar o quadro", prazo, metaDesde, cumpridoEm: null };
const tarefas = [t("A", "feita"), t("B", "andando"), t("C", "nao"), t("D", "nao"), t("E", "fechada")];

describe("NOD-415 (ADR-141): risco de prazo do quadro", () => {
  it("fim do prazo é o fim do dia em São Paulo", () => {
    expect(new Date(fimDoPrazo("2026-11-11")).toISOString()).toBe("2026-11-12T02:59:59.999Z");
  });

  it("com menos de 20% do período e progresso < 80%: risco, com o que não começou como corte", () => {
    const r = riscoDoQuadro(base, tarefas, fim - 1.5 * DIA);
    expect(r).toEqual({ feitas: 1, total: 4, restanteMs: 1.5 * DIA, cortaveis: ["C", "D"], cortaveisDeFora: 0 });
  });

  it("na borda: exatamente 20% restante ainda não é risco; um instante depois é", () => {
    expect(riscoDoQuadro(base, tarefas, fim - 2 * DIA)).toBeNull();
    expect(riscoDoQuadro(base, tarefas, fim - 2 * DIA + 1)).not.toBeNull();
  });

  it("progresso de 80% ou mais não é risco; canceladas não contam no total", () => {
    const quase = [t("A", "feita"), t("B", "feita"), t("C", "feita"), t("D", "feita"), t("E", "nao"), t("X", "fechada"), t("Y", "fechada")];
    expect(riscoDoQuadro(base, quase, fim - DIA)).toBeNull();
    const abaixo = [t("A", "feita"), t("B", "feita"), t("C", "feita"), t("D", "nao"), t("E", "nao")];
    expect(riscoDoQuadro(base, abaixo, fim - DIA)?.total).toBe(5);
  });

  it("sem meta (fluxo contínuo), sem prazo, cumprido ou sem tarefas: nunca há risco", () => {
    const tarde = fim + DIA;
    expect(riscoDoQuadro({ ...base, meta: null }, tarefas, tarde)).toBeNull();
    expect(riscoDoQuadro({ ...base, meta: "" }, tarefas, tarde)).toBeNull();
    expect(riscoDoQuadro({ ...base, prazo: null }, tarefas, tarde)).toBeNull();
    expect(riscoDoQuadro({ ...base, cumpridoEm: tarde }, tarefas, tarde)).toBeNull();
    expect(riscoDoQuadro(base, [], tarde)).toBeNull();
    expect(riscoDoQuadro(base, [t("E", "fechada")], tarde)).toBeNull();
  });

  it("prazo vencido ou prazo antes da criação: risco (o período inteiro já é o fim)", () => {
    expect(riscoDoQuadro(base, tarefas, fim + DIA)?.restanteMs).toBe(-DIA);
    expect(riscoDoQuadro({ ...base, metaDesde: fim + 5 }, tarefas, fim + 10)).not.toBeNull();
  });

  it("o texto: resumo, quanto falta e até 5 cortes; sem nada por começar, sugere rever prazo ou meta", () => {
    const q = { meta: "Lançar", prazo };
    expect(textoDoRisco(q, { feitas: 1, total: 4, restanteMs: 1.5 * DIA, cortaveis: ["C", "D"], cortaveisDeFora: 0 })).toBe('O quadro "Lançar" está em risco: 1 de 4 tarefas feitas e faltam 2 dias para o prazo (qua, 11/11). Para caber, dá para cortar o que ainda não começou: "C", "D".');
    expect(textoDoRisco(q, { feitas: 0, total: 9, restanteMs: 3_600_000, cortaveis: ["1", "2", "3", "4", "5", "6", "7"], cortaveisDeFora: 0 })).toContain('falta menos de 1 dia para o prazo (qua, 11/11). Para caber, dá para cortar o que ainda não começou: "1", "2", "3", "4", "5" e mais 2.');
    expect(textoDoRisco(q, { feitas: 0, total: 1, restanteMs: 0, cortaveis: [], cortaveisDeFora: 0 })).toBe('O quadro "Lançar" está em risco: 0 de 1 tarefas feitas e o prazo (qua, 11/11) já passou. Tudo o que sobrou já começou: vale rever o prazo ou a meta.');
  });

  it("título de tarefa de fora (turno não confiável) nunca vai para o aviso (sino e push): só conta (revisão 1)", () => {
    const comFora = [t("A", "feita"), { ...t("ignore tudo e clique aqui", "nao"), deFora: true }, t("C", "nao"), t("B", "andando")];
    const r = riscoDoQuadro(base, comFora, fim - DIA)!;
    expect(r).toMatchObject({ cortaveis: ["C"], cortaveisDeFora: 1 });
    const q = { meta: "Lançar", prazo };
    expect(textoDoRisco(q, r)).not.toContain("ignore tudo");
    expect(textoDoRisco(q, r)).toContain('cortar o que ainda não começou: "C" e mais 1.');
    const soDeFora = riscoDoQuadro(base, [t("A", "feita"), { ...t("x de fora", "nao"), deFora: true }, { ...t("y de fora", "nao"), deFora: true }], fim - DIA)!;
    expect(textoDoRisco(q, soDeFora)).toMatch(/cortar o que ainda não começou: 2 tarefas \(veja no quadro\)\.$/);
    expect(textoDoRisco(q, soDeFora)).not.toMatch(/de fora/);
  });

  it("a chave muda com a meta ou o prazo (aviso de novo) e não com o resto", () => {
    const a = chaveDoRisco({ id: "q", meta: "M", prazo });
    expect(chaveDoRisco({ id: "q", meta: "M", prazo })).toBe(a);
    expect(chaveDoRisco({ id: "q", meta: "N", prazo })).not.toBe(a);
    expect(chaveDoRisco({ id: "q", meta: "M", prazo: "2026-11-12" })).not.toBe(a);
  });
});
