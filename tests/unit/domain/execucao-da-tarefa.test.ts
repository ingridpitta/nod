import { describe, expect, it } from "vitest";
import { execucaoDoTurno } from "../../../src/domain/quadro.ts";

describe("execucaoDoTurno (ADA-16: esperando)", () => {
  it("o turno que acabou com o trabalho da tarefa aberto à espera vira esperando; fila e rodando vêm antes", () => {
    expect(execucaoDoTurno("concluido", true)).toBe("esperando");
    expect(execucaoDoTurno("interrompido", true)).toBe("esperando");
    expect(execucaoDoTurno("pendente", true)).toBe("esperando"); // a volta marcada
    expect(execucaoDoTurno("pendente")).toBe("fila");
    expect(execucaoDoTurno("despachando", true)).toBe("rodando");
    expect(execucaoDoTurno("concluido")).toBeNull();
    expect(execucaoDoTurno("interrompido")).toBe("falhou");
  });
});
