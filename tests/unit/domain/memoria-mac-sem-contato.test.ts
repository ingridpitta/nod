import { describe, expect, it } from "vitest";
import { esperaNaMaquina, type PortaoDoMac } from "../../../src/domain/memoria-mac.ts";

/** NOD-276 (definido em 2026-10-15, G12): na fila com o alvo sem contato, o trabalho espera essa máquina. */
const AGORA = Date.UTC(2026, 9, 15, 15, 0);
const t = (estado: "na_fila" | "rodando") => ({ estado, origem: "rotina" as const, iniciadoEm: null, criadoEm: AGORA - 60_000, pessoaEsperando: false });
const aberto: PortaoDoMac = { fundo: null, tudoNovo: null, semPrazo: false };
const cheio: PortaoDoMac = { fundo: "memoria", tudoNovo: null, semPrazo: false };
const semContato = (id: string) => (id === "vm" ? AGORA - 10 * 60_000 : null);

describe("esperaNaMaquina com máquina sem contato (G12)", () => {
  it("na fila, com o alvo sem contato: 'sem_contato', antes do portão (a leitura dela é velha)", () => {
    expect(esperaNaMaquina(t("na_fila"), "vm", new Map([["vm", cheio]]), AGORA, semContato)).toEqual({ motivo: "sem_contato", maquinaId: "vm" });
    expect(esperaNaMaquina(t("na_fila"), "vm", new Map(), AGORA, semContato)).toEqual({ motivo: "sem_contato", maquinaId: "vm" });
  });

  it("alvo conectado: o portão de sempre", () => {
    expect(esperaNaMaquina(t("na_fila"), "mac", new Map([["mac", aberto]]), AGORA, semContato)).toBeNull();
    expect(esperaNaMaquina(t("na_fila"), "mac", new Map([["mac", cheio]]), AGORA, semContato)).toEqual({ motivo: "memoria", maquinaId: "mac" });
  });

  it("sem alvo, ou já rodando, não é espera de contato aqui (o despachando a tela trata pela máquina do trabalho)", () => {
    expect(esperaNaMaquina(t("na_fila"), null, new Map([["vm", aberto]]), AGORA, semContato)).toBeNull();
    expect(esperaNaMaquina(t("rodando"), "vm", new Map(), AGORA, semContato)).toBeNull();
  });

  it("sem o 5º parâmetro (quem chama de antes), nada muda", () => {
    expect(esperaNaMaquina(t("na_fila"), "vm", new Map([["vm", aberto]]), AGORA)).toBeNull();
  });
});
