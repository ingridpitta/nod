import { describe, expect, it, vi } from "vitest";
import { tentarFrotaAgora } from "../../../web/lib/tentar-frota.ts";

/** NOD-379 (QA 2): o "Tentar de novo" da inicial relê a frota na hora, inclusive com a rede caída. */
function montar(buscar: () => Promise<string | null>) {
  const fila = new Set(["frota"]);
  const t = {
    buscar: vi.fn(buscar),
    aplicar: vi.fn(),
    tirarDaFila: vi.fn(() => fila.delete("frota")),
    voltarParaFila: vi.fn(() => fila.add("frota")),
    ehRede: (e: unknown) => e instanceof Error && e.message === "rede",
    redesenhar: vi.fn(),
  };
  return { t, fila };
}

describe("Tentar de novo da frota", () => {
  it("pede na hora e aplica o que veio; a frota sai da fila da sonda", async () => {
    const { t, fila } = montar(async () => "hidratar");
    await tentarFrotaAgora(t);
    expect(t.buscar).toHaveBeenCalledTimes(1);
    expect(t.aplicar).toHaveBeenCalledWith("hidratar");
    expect(fila.has("frota")).toBe(false);
  });

  it("a rede caiu de novo: volta para a fila e redesenha (o aviso continua)", async () => {
    const { t, fila } = montar(async () => { throw new Error("rede"); });
    await tentarFrotaAgora(t);
    expect(t.voltarParaFila).toHaveBeenCalledTimes(1);
    expect(fila.has("frota")).toBe(true);
    expect(t.redesenhar).toHaveBeenCalledTimes(1);
    expect(t.aplicar).not.toHaveBeenCalled();
  });

  it("erro do servidor: não volta para a fila da rede, só redesenha", async () => {
    const { t, fila } = montar(async () => { throw new Error("500"); });
    await tentarFrotaAgora(t);
    expect(t.voltarParaFila).not.toHaveBeenCalled();
    expect(fila.has("frota")).toBe(false);
    expect(t.redesenhar).toHaveBeenCalledTimes(1);
  });

  it("uma leitura mais nova passou na frente: nada a aplicar", async () => {
    const { t } = montar(async () => null);
    await tentarFrotaAgora(t);
    expect(t.aplicar).not.toHaveBeenCalled();
  });
});
