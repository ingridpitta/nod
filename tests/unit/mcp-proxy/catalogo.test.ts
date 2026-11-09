import { describe, expect, it } from "vitest";
import { ferramentaDoPlano, ferramentasMcp, validadeDoPlano } from "../../../src/adapters/mcp-proxy/catalogo.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

const agora = 1_000_000;

describe("catalogo do plano (ADR-024: único insumo; ADR-029: sem cache)", () => {
  it("plano ausente, expirado e catálogo vazio são três motivos distintos e fail-closed", () => {
    expect(validadeDoPlano(null, agora)).toEqual({ ok: false, motivo: "plano_ausente" });
    expect(validadeDoPlano(undefined, agora)).toEqual({ ok: false, motivo: "plano_ausente" });
    expect(validadeDoPlano(planoDeTeste({ expiraEm: agora }), agora)).toEqual({ ok: false, motivo: "plano_expirado" });
    expect(validadeDoPlano(planoDeTeste({ catalogo: { ferramentas: [], servidores: [] } }), agora)).toEqual({ ok: false, motivo: "catalogo_vazio" });
    expect(validadeDoPlano(planoDeTeste(), agora).ok).toBe(true);
  });

  it("tools/list expõe name/description/inputSchema e readOnlyHint capturado na sonda", () => {
    const tools = ferramentasMcp(planoDeTeste());
    expect(tools.map((t) => t.name)).toEqual(["lembrar", "exemplo__somar"]);
    expect(tools[0]?.inputSchema).toBe(FERRAMENTAS_NOD.lembrar);
    expect(tools[0]?.description).toBe(FERRAMENTAS_NOD.lembrar.description);
    expect(tools[0]?.annotations).toEqual({ readOnlyHint: false });
    expect(tools[1]?.annotations).toEqual({ readOnlyHint: true });
    expect(tools[1]?.description).toContain("exemplo__somar");
  });

  it("ferramentaDoPlano casa pelo nome exato (slug__tool), nunca por prefixo", () => {
    const p = planoDeTeste();
    expect(ferramentaDoPlano(p, "exemplo__somar")?.conectorId).toBe("k1");
    expect(ferramentaDoPlano(p, "somar")).toBeNull();
    expect(ferramentaDoPlano(p, "mcp__nod__lembrar")).toBeNull();
  });
});
