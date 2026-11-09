import { describe, expect, it } from "vitest";
import { MAX_LEITURAS_DESFAZER } from "../../../src/contracts/nao-lidos.ts";
import { fraseDoDesfeito, fraseDoRecibo, lerLeituras } from "../../../src/domain/nao-lidos.ts";
import { fraseDoAviso } from "../../../web/lib/frase-leitura.ts";

const C = "11111111-1111-4111-8111-111111111111";
const T = "2026-11-01T10:00:00.123456";

describe("NOD-449: as leituras do Desfazer", () => {
  it("aceita o que marcarLida devolve (antes null = nunca lida)", () => {
    expect(lerLeituras([{ conversaId: C, antes: null, depois: T }])).toEqual([{ conversaId: C, antes: null, depois: T }]);
  });

  it("aceita antes igual ou anterior ao depois", () => {
    expect(lerLeituras([{ conversaId: C, antes: "2026-11-01T09:00:00.000000", depois: T }])).toHaveLength(1);
    expect(lerLeituras([{ conversaId: C, antes: T, depois: T }])).toHaveLength(1);
  });

  it.each([
    ["não é lista", { conversaId: C }],
    ["vazia", []],
    ["id que não é uuid", [{ conversaId: "x", antes: null, depois: T }]],
    ["instante com fuso", [{ conversaId: C, antes: null, depois: "2026-11-01T10:00:00.123456Z" }]],
    ["lixo antes do instante", [{ conversaId: C, antes: null, depois: `x${T}` }]],
    ["lixo depois do instante", [{ conversaId: C, antes: null, depois: `${T}x` }]],
    ["instante sem µs", [{ conversaId: C, antes: null, depois: "2026-11-01T10:00:00" }]],
    ["injeção no instante", [{ conversaId: C, antes: "'; drop table leituras; --", depois: T }]],
    ["antes depois do depois (empurraria o lido até para o futuro)", [{ conversaId: C, antes: "2026-11-01T11:00:00.000000", depois: T }]],
    ["antes com depois nulo", [{ conversaId: C, antes: T, depois: null }]],
    ["grande demais", Array.from({ length: MAX_LEITURAS_DESFAZER + 1 }, () => ({ conversaId: C, antes: null, depois: T }))],
  ])("recusa %s", (_, bruto) => {
    expect(lerLeituras(bruto)).toBeNull();
  });
});

describe("NOD-449: as frases do recibo", () => {
  it("uma, duas, três e muitas", () => {
    expect(fraseDoRecibo(["Bia"])).toBe("Bia marcada como lida");
    expect(fraseDoRecibo(["Bia", "Lia"])).toBe("Bia e Lia marcadas como lidas");
    expect(fraseDoRecibo(["Ada", "Bia", "Lia"])).toBe("Ada, Bia e Lia marcadas como lidas");
    expect(fraseDoRecibo(["Ada", "Bia", "Lia", "Nod"])).toBe("4 conversas marcadas como lidas");
    expect(fraseDoRecibo([])).toBe("Nada para marcar: tudo em dia");
    expect(fraseDoDesfeito(["Bia"])).toBe("Bia voltou para Não lidos");
    expect(fraseDoDesfeito(["Bia", "Lia"])).toBe("Bia e Lia voltaram para Não lidos");
  });

  it("o aviso da tela diz o mesmo que o recibo do chat", () => {
    for (const nomes of [[], ["Bia"], ["Bia", "Lia"], ["Ada", "Bia", "Lia"], ["a", "b", "c", "d", "e"]]) expect(fraseDoAviso(nomes)).toBe(fraseDoRecibo(nomes));
  });
});
