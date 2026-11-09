import { describe, expect, it } from "vitest";
import { motivoDependeDaMaquina, motivoNaMaquina, redigir } from "../../../src/domain/redacao.ts";

/** ADA-243 (jornada B): o caso de 05/11 — no Windows novo sem IA o aviso dizia "a IA não está instalada neste Mac". */
describe("motivoNaMaquina (ADA-243)", () => {
  it("Windows e Linux nomeiam a máquina e dizem onde resolver", () => {
    expect(motivoNaMaquina("motor_ausente", { nome: "DESKTOP-7Q2", plataforma: "win32" })).toBe("a IA não está instalada no DESKTOP-7Q2; instale e entre na conta em Configurações › Computadores");
    expect(motivoNaMaquina("nao_autenticado", { nome: "vm-1", plataforma: "linux" })).toContain("não está conectada no vm-1");
    expect(motivoNaMaquina("lancamento_falhou", { nome: "PC", plataforma: "win32" })).toBe("a IA não conseguiu abrir no PC");
    expect(redigir("turno-interrompido", 0, { motivo: motivoNaMaquina("motor_ausente", { nome: "PC", plataforma: "win32" }) })).not.toMatch(/\bMac\b/);
  });
  it("Mac, chave sem sistema e modo local ficam com a frase genérica (neste computador, ADA-244); outros motivos não mudam", () => {
    expect(motivoNaMaquina("motor_ausente", { nome: "MacBook", plataforma: "darwin" })).toBe("a IA não está instalada neste computador");
    expect(motivoNaMaquina("motor_ausente", { nome: "x", plataforma: null })).toBe("a IA não está instalada neste computador");
    expect(motivoNaMaquina("motor_ausente", null)).toBe("a IA não está instalada neste computador");
    expect(motivoNaMaquina("turno_travado", { nome: "PC", plataforma: "win32" })).toBe("o agente ficou sem responder");
    expect(motivoDependeDaMaquina("turno_travado")).toBe(false);
    expect(motivoDependeDaMaquina("nao_autenticado")).toBe(true);
  });
});
