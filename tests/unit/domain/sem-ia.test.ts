import { describe, expect, it } from "vitest";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO } from "../../../src/contracts/motivos.ts";
import { motivoEmPortugues } from "../../../src/domain/redacao.ts";
import { aguardaIa, falaSemIa, FALA_SEM_IA_PRIMEIRA, FALA_SEM_IA_SEGUINTE, PRAZO_SEM_IA_MS } from "../../../src/domain/sem-ia.ts";

describe("jornada C: sem IA neste computador", () => {
  it("a primeira fala é a da tela C; as seguintes são uma linha que aponta o card acima", () => {
    expect(falaSemIa({ jaHaGuardada: false })).toBe(FALA_SEM_IA_PRIMEIRA);
    expect(FALA_SEM_IA_PRIMEIRA).toContain("Estou sem IA neste computador");
    expect(FALA_SEM_IA_PRIMEIRA).toContain("a mensagem fica guardada");
    expect(falaSemIa({ jaHaGuardada: true })).toBe(FALA_SEM_IA_SEGUINTE);
    expect(FALA_SEM_IA_SEGUINTE).toContain("card acima");
    for (const f of [FALA_SEM_IA_PRIMEIRA, FALA_SEM_IA_SEGUINTE]) expect(f).not.toMatch(/Turno interrompido|Mac/);
  });

  it("só a fala da pessoa numa conversa própria espera a IA, e só com a flag", () => {
    const base = { ligado: true, origem: "conversa" as const, daPessoa: true, trabalho: false };
    expect(aguardaIa(base)).toBe(true);
    expect(aguardaIa({ ...base, ligado: false })).toBe(false);
    for (const origem of ["sala", "rotina", "retomada", "peer", "delegacao", "ligacao"] as const) expect(aguardaIa({ ...base, origem }), origem).toBe(false);
    expect(aguardaIa({ ...base, daPessoa: false })).toBe(false);
    expect(aguardaIa({ ...base, trabalho: true })).toBe(false);
  });

  it("a mensagem guardada vale 7 dias", () => {
    expect(PRAZO_SEM_IA_MS).toBe(604_800_000);
  });

  it("critério 7: nenhuma frase de motivo cita o Mac (a queda da máquina tem a frase própria, ADR-045)", () => {
    for (const m of [...MOTIVOS_FALHA, ...MOTIVOS_INTERRUPCAO].filter((x) => x !== "maquina_sem_contato")) expect(motivoEmPortugues(m), m).not.toMatch(/\bMac\b/);
    expect(motivoEmPortugues("lancamento_falhou")).toBe("a IA não conseguiu abrir neste computador");
    expect(motivoEmPortugues("motor_ausente")).toBe("a IA não está instalada neste computador");
    expect(motivoEmPortugues("nao_autenticado")).toBe("a conta da IA não está conectada neste computador");
  });
});
