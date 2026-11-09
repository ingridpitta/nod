import { describe, expect, it } from "vitest";
import { VOLTAS_SEM_NOVIDADE } from "../../../src/contracts/ferramentas-trabalho.ts";
import { alarmeDeVoltas, perguntaDoAlarme, voltaSemNovidade, type VoltaDaCadeia } from "../../../src/domain/voltas-sem-novidade.ts";

/** ADR-099 §5 (parte 1, definido em 2026-10-12): três voltas seguidas sem nada novo viram pergunta à pessoa. */

const vazia: VoltaDaCadeia = { estado: "concluido", marcouVolta: true, perguntou: false, pediuAColega: false };

describe("voltas sem novidade (ADR-099 §5)", () => {
  it("o limite é 3", () => {
    expect(VOLTAS_SEM_NOVIDADE).toBe(3);
  });

  it.each([
    ["voltou, conferiu e marcou outra", vazia, true],
    ["perguntou algo à pessoa", { ...vazia, perguntou: true }, false],
    ["pediu algo a um colega", { ...vazia, pediuAColega: true }, false],
    ["não marcou outra volta (o que esperava chegou)", { ...vazia, marcouVolta: false }, false],
    ["caiu ou foi parada", { ...vazia, estado: "interrompido" as const }, false],
    ["voltou porque a cota renovou (ADR-099 §7), não porque o bot marcou", { ...vazia, porCota: true }, false],
    ["ainda não voltou (pendente)", { ...vazia, estado: "pendente" as const, marcouVolta: false }, false],
  ])("%s", (_nome, v, esperado) => {
    expect(voltaSemNovidade(v)).toBe(esperado);
  });

  it("alarme só com as 3 mais novas sem novidade; a 4ª mais antiga não conta", () => {
    expect(alarmeDeVoltas([])).toBe(false);
    expect(alarmeDeVoltas([vazia, vazia])).toBe(false);
    expect(alarmeDeVoltas([vazia, vazia, vazia])).toBe(true);
    expect(alarmeDeVoltas([vazia, vazia, { ...vazia, perguntou: true }])).toBe(false);
    expect(alarmeDeVoltas([vazia, vazia, vazia, { ...vazia, perguntou: true }])).toBe(true);
    expect(alarmeDeVoltas([{ ...vazia, pediuAColega: true }, vazia, vazia, vazia])).toBe(false);
    expect(alarmeDeVoltas([vazia], 1)).toBe(true);
    expect(alarmeDeVoltas([vazia, vazia, vazia], 0)).toBe(false);
  });

  it("a pergunta com as respostas prontas (o texto também é a frase da decisão)", () => {
    const p = perguntaDoAlarme(3, "ver se a CI do #845 passou");
    expect(p.texto).toBe("Voltei 3 vezes para conferir e nada mudou: ver se a CI do #845 passou. Sigo esperando ou paro por aqui?");
    expect(p.opcoes).toEqual(["Pode seguir esperando", "Pode parar de esperar"]);
    // As respostas prontas cabem no botão (MAX_CARACTERES_OPCAO, 60).
    expect(p.opcoes.every((o) => o.length <= 60)).toBe(true);
  });
});
