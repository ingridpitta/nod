import { describe, expect, it } from "vitest";
import { ehMaquinaDoMotor, noSistemaDaMaquina } from "../../../src/domain/plataforma-maquina.ts";
import { motivoDaQuedaEmPortugues } from "../../../src/domain/redacao.ts";
import { PLATAFORMAS_MAQUINA } from "../../../src/contracts/maquina.ts";

/** ADA-11 (ADR-147): a plataforma win32 no contrato e nos textos. */
describe("plataforma da máquina", () => {
  it("win32 está no contrato; o resto continua fora", () => {
    expect(PLATAFORMAS_MAQUINA).toEqual(["darwin", "linux", "win32"]);
  });

  it("Linux e Windows são máquinas do motor; Mac e a chave sem sistema não", () => {
    expect([ehMaquinaDoMotor("linux"), ehMaquinaDoMotor("win32"), ehMaquinaDoMotor("darwin"), ehMaquinaDoMotor(null), ehMaquinaDoMotor(undefined)]).toEqual([true, true, false, false, false]);
  });

  it("o texto do terminal diz PC com Windows só no win32", () => {
    const t = "Você trabalha na máquina pc de Bia, um Linux sempre ligado, e não no Mac dela.";
    expect(noSistemaDaMaquina(t, "win32")).toBe("Você trabalha na máquina pc de Bia, um PC com Windows, e não no Mac dela.");
    expect(noSistemaDaMaquina(t, "linux")).toBe(t);
  });

  it("a queda de um PC com Windows nomeia a máquina, como a VM", () => {
    expect(motivoDaQuedaEmPortugues({ nome: "PC da Bia", plataforma: "win32" })).toContain("a máquina PC da Bia parou de responder");
  });
});
