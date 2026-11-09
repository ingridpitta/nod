import { describe, expect, it } from "vitest";
import type { Time } from "../../../src/contracts/time.ts";
import { acharTime, chaveDoTime, emOrdem, listaFalada, nomeLimpo, posicaoFalada, problemaDoNome, reconciliarTimes, reordenar } from "../../../src/domain/times.ts";

const t = (id: string, nome: string, posicao: number): Time => ({ id, nome, posicao, recolhido: false });

describe("times (NOD-437)", () => {
  it("a chave ignora caixa, acentos e espaços", () => {
    expect(chaveDoTime(" PRODUÇÃO ")).toBe("producao");
    expect(chaveDoTime("Produção  Nova")).toBe(chaveDoTime("producao nova"));
    expect(nomeLimpo("  Eng   1 ")).toBe("Eng 1");
  });

  it("nome repetido (sem caixa e acento), vazio, longo e reservado não criam time; renomear para o próprio nome serve", () => {
    const times = [t("s", "", 0), t("a", "Engenharia", 1)];
    expect(problemaDoNome("engenharía", times)).toEqual({ problema: "nome_repetido", existente: times[1] });
    expect(problemaDoNome("  ", times)?.problema).toBe("nome_vazio");
    expect(problemaDoNome("x".repeat(61), times)?.problema).toBe("nome_longo");
    expect(problemaDoNome("sem TIME", times)?.problema).toBe("nome_reservado");
    expect(problemaDoNome("ENGENHARIA", times, "a")).toBeNull();
    expect(problemaDoNome("Produto", times)).toBeNull();
  });

  it("acharTime: exato pela chave, Sem time pelo nome ou vazio, parecidos quando ambíguo", () => {
    const times = [t("s", "", 0), t("a", "Produto", 1), t("b", "Produção", 2), t("c", "Vendas", 3)];
    expect(acharTime("produção", times)).toEqual({ time: times[2] });
    expect(acharTime("Sem time", times)).toEqual({ time: times[0] });
    expect(acharTime("", times)).toEqual({ time: times[0] });
    expect("parecidos" in acharTime("Produ", times) && acharTime("Produ", times)).toEqual({ parecidos: [times[1], times[2]] });
    expect(acharTime("Marketing", times)).toEqual({ parecidos: [] });
  });

  it("reconciliar: sem linhas, o Sem time nasce no topo e as seções no fim em ordem alfabética, sem repetir", () => {
    expect(reconciliarTimes([], ["Vendas", "", "engenharia", "Engenharia", "Ágil"]).faltam).toEqual([
      { nome: "", posicao: 0 },
      { nome: "Ágil", posicao: 1 },
      { nome: "engenharia", posicao: 2 },
      { nome: "Vendas", posicao: 3 },
    ]);
    expect(reconciliarTimes([t("s", "", 0), t("a", "Vendas", 1)], ["vendas", "Novo"]).faltam).toEqual([{ nome: "Novo", posicao: 2 }]);
    // Revisão 2: a seção antiga "Sem time" é o Sem time, não um time comum que se renomeia e exclui.
    expect(reconciliarTimes([t("s", "", 0)], ["Sem time", " sem  TIME "]).faltam).toEqual([]);
    expect(reconciliarTimes([t("s", "", 0)], []).faltam).toEqual([]);
  });

  it("reordenar põe o id no destino (limitado) e emOrdem ordena por posição", () => {
    expect(reordenar(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(reordenar(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(reordenar(["a", "b"], "x", 0)).toEqual(["a", "b"]);
    expect(emOrdem([t("b", "B", 2), t("a", "A", 0), t("c", "C", 2)]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("o leitor de tela fala a posição e as listas viram frase", () => {
    expect(posicaoFalada("Produto", 1, 4)).toBe("Produto, time 2 de 4");
    expect(posicaoFalada("", 0, 2)).toBe("Sem time, time 1 de 2");
    expect(listaFalada(["Nara", "Otto"])).toBe("Nara e Otto");
    expect(listaFalada(["A", "B", "C"])).toBe("A, B e C");
    expect(listaFalada([])).toBe("");
  });
});
