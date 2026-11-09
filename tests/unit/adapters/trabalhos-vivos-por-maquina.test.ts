import { describe, expect, it } from "vitest";
import { criarTrabalhosVivos, VALIDADE_LEITURA_MS } from "../../../src/adapters/fundo/trabalhos-vivos.ts";

/** A tela fala por máquina (definido em 2026-10-09): a leitura de cada máquina separada, e o frame quando só uma muda. */
const comCpu = (nivel: "verde" | "amarela" | "vermelha", uso: number, totalMb = 500) => ({ nivel, totalMb, porTurno: [], processador: { nivel: "verde" as const, carga: 0.1, uso } });

describe("trabalhos vivos por máquina", () => {
  it("cada máquina viva da pessoa com a própria leitura, sem juntar", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac", comCpu("verde", 0.2, 400));
    v.registrarMemoria("p", "vm", comCpu("verde", 1, 700));
    expect(v.porMaquina("p")).toEqual([
      expect.objectContaining({ machineId: "mac", nivel: "verde", totalMb: 400, portao: "verde" }),
      expect.objectContaining({ machineId: "vm", nivel: "verde", totalMb: 700, portao: "vermelha" }),
    ]);
    expect(v.porMaquina("outra")).toEqual([]);
    agora += VALIDADE_LEITURA_MS + 1;
    expect(v.porMaquina("p")).toEqual([]);
  });

  it("a VM muda de nível com o Mac já pior: a pior não muda, mas o frame sai (a pílula e a linha da VM mudam)", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac", comCpu("vermelha", 0.2));
    v.registrarMemoria("p", "vm", comCpu("verde", 0.2));
    expect(v.registrarMemoria("p", "vm", comCpu("verde", 0.2)).mudou).toBe(false);
    expect(v.registrarMemoria("p", "vm", comCpu("amarela", 0.2)).mudou).toBe(true);
    expect(v.memoria("p")?.nivel).toBe("vermelha");
  });
});

/** ADR-096 §6: o histórico do livre por máquina vira a estimativa de quando ele acaba, e o aviso vira frame. */
describe("a tendência do disco por máquina", () => {
  const comDisco = (livreMb: number) => ({ nivel: "verde" as const, totalMb: 500, porTurno: [], disco: { livreMb, totalMb: 100 * 1024 } });

  it("a VM perdendo 2 GB por hora: a leitura dela traz a estimativa, e a do Mac parado não", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    let mudou = false;
    for (let i = 0; i <= 12; i++) {
      agora = i * 5 * 60_000;
      v.registrarMemoria("p", "mac", comDisco(200 * 1024));
      mudou = v.registrarMemoria("p", "vm", comDisco(14 * 1024 - i * 170)).mudou || mudou;
    }
    const [mac, vm] = v.porMaquina("p");
    expect(mac!.discoAcabaEmMs).toBeNull();
    expect(vm!.discoAcabaEmMs! / 3_600_000).toBeGreaterThan(4);
    expect(vm!.discoAcabaEmMs! / 3_600_000).toBeLessThan(6);
    expect(v.memoria("p")?.discoAcabaEmMs).toBe(vm!.discoAcabaEmMs);
    // A primeira vez que a VM passa a acabar em menos de 24 h, o frame sai (a linha dela muda).
    expect(mudou).toBe(true);
  });
});
