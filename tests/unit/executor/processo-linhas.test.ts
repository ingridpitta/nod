import { describe, expect, it } from "vitest";
import { criarDivisorDeLinhas } from "../../../src/adapters/executor/processo.ts";
import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";

/**
 * O divisor de linhas do stdout do CLI (src/adapters/executor/processo.ts): o "\n" é procurado só no pedaço que chegou,
 * então uma linha grande partida em muitos pedaços custa proporcional ao tamanho dela, não ao quadrado.
 */
function dividir(pedacos: readonly string[]): string[] {
  const linhas: string[] = [];
  const divisor = criarDivisorDeLinhas((l) => linhas.push(l));
  for (const p of pedacos) divisor.empurrar(p);
  divisor.fechar();
  return linhas;
}

describe("criarDivisorDeLinhas", () => {
  it("linha partida em qualquer ponto, várias num pedaço, linha vazia e o resto sem \\n só no fechar", () => {
    expect(dividir(['{"a":1}\n{"b"', ':2}\n\n{"c":3', '}\n{"d":4}'])).toEqual(['{"a":1}', '{"b":2}', "", '{"c":3}', '{"d":4}']);
    expect(dividir(["abc", "", "def\n", "\n"])).toEqual(["abcdef", ""]);
    // Resto só de espaço não vira linha, como antes da troca.
    expect(dividir(["   ", "\t"])).toEqual([]);
  });

  /** A linha do stream-json com `n` caracteres de texto, partida em pedaços de 512 bytes como chega do stdout. */
  const linhaGrande = (n: number) => `{"type":"user","texto":"${"x".repeat(n)}"}`;
  const emPedacos = (linha: string) => {
    const pedacos: string[] = [];
    for (let i = 0; i < linha.length; i += 512) pedacos.push(linha.slice(i, i + 512));
    pedacos[pedacos.length - 1] += "\n";
    return [...pedacos, '{"type":"result"}\n'];
  };

  it("uma linha de 8 MB em pedaços de 512 bytes sai inteira e uma vez só", () => {
    const linha = linhaGrande(8_000_000);
    const linhas = dividir(emPedacos(linha));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe(linha);
    expect(linhas[1]).toBe('{"type":"result"}');
  });

  // Com `resto += pedaco; resto.indexOf("\n")` cada pedaço relia a linha acumulada: custo quadrático no tamanho da
  // linha. NOD-194: a guarda mede o crescimento (200 mil → 800 mil caracteres) em tempo de CPU, não `< 2 s` de relógio
  // de parede (regra do AGENTS.md, "Teste sob carga"). Os pedaços são montados uma vez, fora da medida: com eles
  // dentro, o GC da montagem deu uma razão de 8,7 no código linear. medido em 2026-10-08 (load ~850), 30 rodadas:
  // razão 3,0–5,7 no divisor atual; 20,4–28,6 com o `resto += pedaco; indexOf` de antes. Prazo: PRAZO_GUARDA
  // (medido em 2026-10-08, QA: sem prazo, caiu nos 5 s padrão com 5,2 s sob duas `test:unit` em paralelo).
  it("o custo de dividir uma linha grande cresce linear com o tamanho dela (sem o custo quadrático)", PRAZO_GUARDA, () => {
    const pedacosDe = new Map<string, string[]>();
    const jaPartida = (l: string) => pedacosDe.get(l) ?? pedacosDe.set(l, emPedacos(l)).get(l)!;
    expect(razaoDeCrescimento(linhaGrande, (l) => dividir(jaPartida(l)), 200_000)).toBeLessThan(RAZAO_MAXIMA_LINEAR);
  });
});
