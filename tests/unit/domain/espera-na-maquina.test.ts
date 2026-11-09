import { describe, expect, it } from "vitest";
import { esperaNaMaquina, portaoDoMac, type PortaoDoMac } from "../../../src/domain/memoria-mac.ts";

/**
 * A tela fala por máquina (definido em 2026-10-09): o trabalho espera pelo portão da máquina DELE — o alvo do turno, ou o
 * Mac do servidor no modo local —, como o `puxar` daquela máquina decide. Antes a tela usava o pior entre todas.
 */
const AGORA = 10_000_000;
const rotina = { estado: "na_fila" as const, origem: "rotina" as const, iniciadoEm: null, criadoEm: AGORA - 60_000, pessoaEsperando: false };
// ADR-097: no equilibrado o processador não segura mais; no "pouco", segura.
const cheia = portaoDoMac("pouco", { memoria: "verde", processador: "vermelha" });
const folgada = portaoDoMac("equilibrado", { memoria: "verde", processador: "verde" });
const semMemoria = portaoDoMac("equilibrado", { memoria: "amarela", processador: "verde" });

describe("esperaNaMaquina", () => {
  it("VM cheia e Mac folgado: só o trabalho da VM espera; o do Mac segue", () => {
    const portoes = new Map<string, PortaoDoMac>([["vm", cheia], ["mac", folgada]]);
    expect(esperaNaMaquina(rotina, "vm", portoes, AGORA)).toEqual({ motivo: "processador", maquinaId: "vm" });
    expect(esperaNaMaquina(rotina, "mac", portoes, AGORA)).toBeNull();
  });

  it("o inverso: Mac sem memória e VM folgada — só o do Mac espera, pelo motivo dele", () => {
    const portoes = new Map<string, PortaoDoMac>([["vm", folgada], ["mac", semMemoria]]);
    expect(esperaNaMaquina(rotina, "vm", portoes, AGORA)).toBeNull();
    expect(esperaNaMaquina(rotina, "mac", portoes, AGORA)).toEqual({ motivo: "memoria", maquinaId: "mac" });
  });

  it("máquina sem leitura não segura nada, mesmo com outra cheia", () => {
    expect(esperaNaMaquina(rotina, "vm", new Map([["mac", cheia]]), AGORA)).toBeNull();
  });

  it("sem máquina (compartilhado, qualquer uma): espera só se todas seguram; o nome só com uma", () => {
    expect(esperaNaMaquina(rotina, null, new Map([["vm", cheia], ["mac", folgada]]), AGORA)).toBeNull();
    expect(esperaNaMaquina(rotina, null, new Map([["vm", cheia], ["mac", semMemoria]]), AGORA)).toEqual({ motivo: "processador", maquinaId: null });
    expect(esperaNaMaquina(rotina, null, new Map([["vm", cheia]]), AGORA)).toEqual({ motivo: "processador", maquinaId: "vm" });
    expect(esperaNaMaquina(rotina, null, new Map(), AGORA)).toBeNull();
  });

  it("a regra do que espera é a de sempre: a task da pessoa passa pela máquina cheia", () => {
    const daPessoa = { ...rotina, origem: "pessoa" as const };
    expect(esperaNaMaquina(daPessoa, "vm", new Map([["vm", cheia]]), AGORA)).toBeNull();
  });
});
