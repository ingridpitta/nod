import { describe, expect, it } from "vitest";
import {
  acharOcorrencias, andar, anuncioDaContagem, esquecerNormalizados, normalizar, reposicionar, tamanhoDoCache, termoValido, textoDaContagem, type Segmento,
} from "../../../web/lib/buscar-na-conversa.ts";

/** NOD-42: a parte pura da busca na conversa (⌘F). */
const seg = (bloco: string, texto: string): Segmento => ({ bloco, texto });
/** O trecho original de cada ocorrência, na ordem da contagem (mais recente primeiro). */
function trechos(segs: Segmento[], termo: string): string[] {
  return acharOcorrencias(segs, termo).map((o) => {
    if (o.inicio.segmento === o.fim.segmento) return segs[o.inicio.segmento]!.texto.slice(o.inicio.offset, o.fim.offset);
    let t = segs[o.inicio.segmento]!.texto.slice(o.inicio.offset);
    for (let s = o.inicio.segmento + 1; s < o.fim.segmento; s++) t += segs[s]!.texto;
    return t + segs[o.fim.segmento]!.texto.slice(0, o.fim.offset);
  });
}

describe("normalizar", () => {
  it("tira acento e caixa e mapeia cada unidade de volta ao original", () => {
    const n = normalizar("AÇÃO");
    expect(n.texto).toBe("acao");
    expect(n.inicio).toEqual([0, 1, 2, 3]);
    expect(n.fim).toEqual([1, 2, 3, 4]);
  });
  it("acento combinado (NFD no original) cai fora sem desalinhar", () => {
    const n = normalizar("água");
    expect(n.texto).toBe("agua");
    expect(n.fim[0]).toBe(1);
    expect(n.inicio[1]).toBe(2);
  });
  it("emoji (par substituto) fica inteiro no mapa", () => {
    const n = normalizar("😀ab");
    expect(n.texto).toBe("😀ab");
    expect(n.inicio.slice(0, 3)).toEqual([0, 0, 2]);
    expect(n.fim.slice(0, 3)).toEqual([2, 2, 3]);
  });
});

describe("normalizar (ASCII e cache)", () => {
  it("o caminho rápido do ASCII dá o mesmo mapa", () => {
    const n = normalizar("AbC d");
    expect(n.texto).toBe("abc d");
    expect(n.inicio).toEqual([0, 1, 2, 3, 4]);
    expect(n.fim).toEqual([1, 2, 3, 4, 5]);
  });
  it("o cache é por bloco: o texto novo do mesmo bloco substitui o velho (o bot escrevendo não acumula versões)", () => {
    esquecerNormalizados();
    for (let k = 1; k <= 50; k++) acharOcorrencias([seg("vivo", "ação ".repeat(k)), seg("outro", "acao")], "acao");
    expect(tamanhoDoCache()).toBe(2);
    expect(acharOcorrencias([seg("vivo", "Ação")], "acao")).toHaveLength(1);
    expect(acharOcorrencias([seg("vivo", "nada aqui")], "acao")).toHaveLength(0);
    esquecerNormalizados();
    expect(tamanhoDoCache()).toBe(0);
  });
});

describe("termoValido", () => {
  it("pede 2 caracteres depois de normalizar e aparar", () => {
    expect(termoValido("")).toBe(false);
    expect(termoValido("a")).toBe(false);
    expect(termoValido("  a  ")).toBe(false);
    expect(termoValido("́́")).toBe(false);
    expect(termoValido("ab")).toBe(true);
    expect(termoValido("é!")).toBe(true);
  });
});

describe("acharOcorrencias", () => {
  it("'acao' acha 'Ação' e 'AÇÃO' (sem acento, sem caixa), devolvendo o trecho original", () => {
    expect(trechos([seg("m1", "Uma Ação aqui"), seg("m2", "OUTRA AÇÃO")], "acao")).toEqual(["AÇÃO", "Ação"]);
  });
  it("3 ocorrências em 2 mensagens, a mais recente primeiro, com chave por bloco e ordem", () => {
    const r = acharOcorrencias([seg("m1", "deploy e deploy"), seg("m2", "o deploy saiu")], "deploy");
    expect(r.map((o) => o.chave)).toEqual(["m2#0", "m1#1", "m1#0"]);
  });
  it("o mesmo bloco em dois grupos (texto em volta de outra mensagem) não repete chave", () => {
    const r = acharOcorrencias([seg("b:0", "deploy"), seg("m:x", "deploy"), seg("b:0", "deploy")], "deploy");
    expect(new Set(r.map((o) => o.chave)).size).toBe(3);
    expect(r.map((o) => o.chave)).toEqual(["b:0#1", "m:x#0", "b:0#0"]);
  });
  it("várias por mensagem, sem sobreposição", () => {
    expect(trechos([seg("m", "aaaa")], "aa")).toEqual(["aa", "aa"]);
  });
  it("atravessa nós de texto do mesmo bloco (negrito no meio)", () => {
    const segs = [seg("m", "fala com a A"), seg("m", "da"), seg("m", " amanhã")];
    expect(trechos(segs, "ada")).toEqual(["Ada"]);
    const [o] = acharOcorrencias(segs, "ada");
    expect(o!.inicio).toEqual({ segmento: 0, offset: 11 });
    expect(o!.fim).toEqual({ segmento: 1, offset: 2 });
  });
  it("não casa entre blocos vizinhos", () => {
    expect(acharOcorrencias([seg("m1", "termina em ab"), seg("m2", "cd começa")], "abcd")).toEqual([]);
  });
  it("o fim que cai no corte entre dois nós fica no fim do primeiro", () => {
    const [o] = acharOcorrencias([seg("m", "xx ab"), seg("m", "cd")], "ab");
    expect(o!.fim).toEqual({ segmento: 0, offset: 5 });
  });
  it("espaço do termo casa com quebra de linha e espaços repetidos do DOM", () => {
    expect(trechos([seg("m", "bom\n   dia")], "bom dia")).toEqual(["bom\n   dia"]);
  });
  it("termo curto, vazio ou sem segmentos: nada", () => {
    expect(acharOcorrencias([seg("m", "abc")], "a")).toEqual([]);
    expect(acharOcorrencias([seg("m", "abc")], "")).toEqual([]);
    expect(acharOcorrencias([], "abc")).toEqual([]);
  });
  it("caracteres de regex no termo são literais", () => {
    expect(trechos([seg("m", "custo (x) e (y)")], "(y)")).toEqual(["(y)"]);
    expect(trechos([seg("m", "a.b axb")], "a. b")).toEqual([]);
  });
  it("acento no texto e no termo continuam casando", () => {
    expect(trechos([seg("m", "acao e ação")], "AÇÃO")).toEqual(["ação", "acao"]);
  });
});

describe("andar", () => {
  it("dá a volta nos dois sentidos", () => {
    expect(andar(0, 3, 1)).toBe(1);
    expect(andar(2, 3, 1)).toBe(0);
    expect(andar(0, 3, -1)).toBe(2);
    expect(andar(1, 3, -1)).toBe(0);
  });
  it("sem ocorrências: -1; sem atual: começa na ponta do sentido", () => {
    expect(andar(0, 0, 1)).toBe(-1);
    expect(andar(-1, 4, 1)).toBe(0);
    expect(andar(-1, 4, -1)).toBe(3);
  });
});

describe("reposicionar", () => {
  it("mantém a mesma ocorrência quando chega uma mensagem nova (que entra no começo da lista)", () => {
    expect(reposicionar("m1#0", 1, ["m3#0", "m2#0", "m1#0"])).toBe(2);
  });
  it("se a atual sumiu, fica na mais próxima da posição antiga", () => {
    expect(reposicionar("m9#0", 5, ["a#0", "b#0"])).toBe(1);
    expect(reposicionar(null, 0, ["a#0"])).toBe(0);
  });
  it("lista vazia: -1", () => {
    expect(reposicionar("a#0", 0, [])).toBe(-1);
  });
});

describe("contagem", () => {
  const desde = new Date(2026, 9, 24, 10, 0);
  it("mostra posição, total e desde", () => {
    expect(textoDaContagem({ atual: 2, total: 6, desde })).toBe("3/6 · desde 24/10");
    expect(textoDaContagem({ atual: 0, total: 0, desde })).toBe("Nada desde 24/10");
    expect(textoDaContagem({ atual: 0, total: 3, desde: null })).toBe("1/3");
    expect(textoDaContagem({ atual: 0, total: 0, desde: null })).toBe("Nada");
  });
  it("dia e mês com dois dígitos", () => {
    expect(textoDaContagem({ atual: 0, total: 2, desde: new Date(2026, 2, 5) })).toBe("1/2 · desde 05/03");
  });
  it("anuncia por extenso para o leitor de tela", () => {
    expect(anuncioDaContagem({ atual: 2, total: 6, desde })).toBe("3 de 6, desde 24 de outubro");
    expect(anuncioDaContagem({ atual: 0, total: 0, desde })).toBe("Nada desde 24 de outubro");
    expect(anuncioDaContagem({ atual: 0, total: 1, desde: new Date(2026, 2, 5) })).toBe("1 de 1, desde 5 de março");
  });
});
