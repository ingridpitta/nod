import { describe, expect, it } from "vitest";
import type { ContasIaDto } from "../../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { outraMaquinaDestaVez } from "../../../web/lib/rodar-desta-vez.ts";

const AGORA = 1_000_000;
const maq = (id: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({
  id, nome: id, prefixo: "nod_", criadaEm: 0, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o,
});
const contas = (ids: string[]) => ({
  disponivel: true, modo: "compartilhado",
  contas: [{ id: "c1", ia: "claude-cli", noLimiteAte: null, maquinas: ids.map((maquinaId) => ({ maquinaId, estado: "pronta" })) }],
}) as unknown as ContasIaDto;

describe("outraMaquinaDestaVez", () => {
  // NOD-94 (QA): a "só computador" não pega turno (o servidor a exclui); o botão não pode oferecê-la.
  it("não oferece a máquina só computador, mesmo conectada, com IA e conta prontas", () => {
    const estado = { maquinas: { maquinas: [maq("mac"), maq("vm-computador", { papel: "computador" })] }, contasIa: contas(["mac", "vm-computador"]), agora: AGORA };
    expect(outraMaquinaDestaVez(estado, "mac")).toBeNull();
    const comMotor = { ...estado, maquinas: { maquinas: [...estado.maquinas.maquinas, maq("vm-bots", { papel: "motor" })] }, contasIa: contas(["mac", "vm-computador", "vm-bots"]) };
    expect(outraMaquinaDestaVez(comMotor, "mac")?.id).toBe("vm-bots");
  });
});
