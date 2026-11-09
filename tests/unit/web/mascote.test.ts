import { describe, expect, it } from "vitest";
import { CORES_AGENTE, FORMAS_AGENTE } from "../../../src/contracts/agente.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, estadoMascoteNaConversa, htmlMascote } from "../../../web/lib/mascote.ts";

describe("mascote temporário", () => {
  it("mantém as opções da web alinhadas ao contrato aceito pelo servidor", () => {
    expect(FORMAS_MASCOTE).toEqual(FORMAS_AGENTE);
    expect(CORES_MASCOTE).toEqual(CORES_AGENTE);
  });

  it("renderiza forma, cor e estado sem interpolar o nome como HTML", () => {
    const html = htmlMascote({ nome: '<bot "novo">', forma: "shape-cloud", cor: "c-amber" }, "xl", "aguardando");
    expect(html).toContain('class="icon mascote c-amber shape-cloud xl"');
    expect(html).toContain('data-estado="aguardando"');
    expect(html).toContain("aguardando você");
    expect(html).toContain("&lt;bot &quot;novo&quot;&gt;");
    expect(html).toContain('state="notify"');
  });

  it("traduz fila e execução para estados visuais usando a conversa", () => {
    const base = { ...estadoInicial, turnosVivos: { t1: { turnoId: "t1", conversaId: "c1", estado: "na_fila" as const, executor: null, machineId: null, desde: 0 } } };
    expect(estadoMascoteNaConversa(base, "c1")).toBe("pensando");
    expect(estadoMascoteNaConversa({ ...base, turnosVivos: { t1: { ...base.turnosVivos.t1!, estado: "rodando" } } }, "c1")).toBe("trabalhando");
    expect(estadoMascoteNaConversa(base, "outra")).toBe("disponivel");
    expect(estadoMascoteNaConversa({ ...base, turnosVivos: {
      ...base.turnosVivos, t2: { ...base.turnosVivos.t1!, turnoId: "t2", estado: "rodando" },
    } }, "c1")).toBe("trabalhando");
  });
});
