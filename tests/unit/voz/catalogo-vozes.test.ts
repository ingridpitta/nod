import { describe, expect, it, vi } from "vitest";
import { VOZES_NOD } from "../../../src/contracts/vozes.ts";
import { vozDoProvedor, vozPadraoDoAgente } from "../../../src/adapters/voz/catalogo-vozes.ts";

const FEMININAS_GOOGLE = ["Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore", "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr"];
const MASCULINAS_GOOGLE = ["Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus", "Orus", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi"];
const FEMININAS_LOCAL = ["Luciana", "Flo", "Sandy", "Shelley", "Grandma"];
const MASCULINAS_LOCAL = ["Eddy", "Reed", "Rocko", "Grandpa"];

describe("voz: catálogo de vozes", () => {
  it("toda voz do catálogo tem uma Chirp 3 HD pt-BR do mesmo gênero, sem repetir", () => {
    const nomes = VOZES_NOD.map((v) => {
      const nome = vozDoProvedor("google", v.id);
      expect(nome).toMatch(/^pt-BR-Chirp3-HD-[A-Z][a-z]+$/);
      const estrela = nome.replace("pt-BR-Chirp3-HD-", "");
      expect(v.genero === "feminina" ? FEMININAS_GOOGLE : MASCULINAS_GOOGLE).toContain(estrela);
      return nome;
    });
    expect(new Set(nomes).size).toBe(VOZES_NOD.length);
  });

  it("toda voz do catálogo tem uma voz do say do mesmo gênero, sem repetir", () => {
    const nomes = VOZES_NOD.map((v) => {
      const nome = vozDoProvedor("local", v.id);
      expect(v.genero === "feminina" ? FEMININAS_LOCAL : MASCULINAS_LOCAL).toContain(nome);
      return nome;
    });
    expect(new Set(nomes).size).toBe(VOZES_NOD.length);
    expect(vozDoProvedor("local", "clara")).toBe("Luciana");
    expect(vozDoProvedor("local", "rui")).toBe("Grandpa");
  });

  it("falso devolve o próprio id; id desconhecido cai na primeira voz", () => {
    const saida = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(vozDoProvedor("falso", "theo")).toBe("theo");
    expect(vozDoProvedor("local", "voz-que-saiu")).toBe("Luciana");
    expect(saida.mock.calls.some((c) => String(c[0]).includes("voz_id_desconhecido"))).toBe(true);
    saida.mockRestore();
  });

  it("vozPadraoDoAgente: a escolhida vale; nula ou inválida vira um hash estável do id", () => {
    expect(vozPadraoDoAgente("a1", "bento")).toBe("bento");
    const ids = VOZES_NOD.map((v) => v.id) as readonly string[];
    const v1 = vozPadraoDoAgente("8c1f2a6e-1d3b-4b8a-9a55-0f0c3e1f7b21", null);
    expect(ids).toContain(v1);
    expect(vozPadraoDoAgente("8c1f2a6e-1d3b-4b8a-9a55-0f0c3e1f7b21", "inexistente")).toBe(v1);
    expect(vozPadraoDoAgente("8c1f2a6e-1d3b-4b8a-9a55-0f0c3e1f7b21", null)).toBe(v1);
    // espalha: 200 ids diferentes usam mais da metade do catálogo
    const usadas = new Set(Array.from({ length: 200 }, (_, i) => vozPadraoDoAgente(`agente-${i}`, null)));
    expect(usadas.size).toBeGreaterThan(VOZES_NOD.length / 2);
  });
});
