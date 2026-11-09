import { describe, expect, it } from "vitest";
import { portaoDoDespacho } from "../../../src/use-cases/despachar-turno.ts";

// NOD-301: o portão repassa ao `reivindicar` o que esta máquina deixa passar; `harnessesAuto` não muda (sem fome).
describe("portaoDoDespacho: declínio do turno sem alvo (NOD-301)", () => {
  it("sem a lista, nenhum declínio (o de antes)", () => {
    expect(portaoDoDespacho({ harnessesProntos: ["claude-cli"] }).declinio).toBeNull();
    expect(portaoDoDespacho({ harnessesProntos: ["claude-cli"], soNoutraMaquina: [] }).declinio).toBeNull();
  });

  it("o Automático declina só quando todas as IAs dele nesta máquina estão na lista", () => {
    expect(portaoDoDespacho({ harnessesProntos: ["claude-cli"], soNoutraMaquina: ["claude-cli"] }).declinio).toEqual({ ias: ["claude-cli"], auto: true });
    // Mac com o Codex livre: o Automático pega aqui com o Codex (suposição S2 do plano).
    expect(portaoDoDespacho({ harnessesProntos: ["claude-cli", "codex-cli"], soNoutraMaquina: ["claude-cli"] }).declinio).toEqual({ ias: ["claude-cli"], auto: false });
  });

  it("o Codex no limite global sai do Automático daqui (harnessesAuto); o Claude declinado então leva o Automático junto", () => {
    const r = portaoDoDespacho({ harnessesProntos: ["claude-cli", "codex-cli"], harnessesDaPessoa: { "claude-cli": { estado: "pronto", em: 0 } as never }, noLimite: ["codex-cli"], soNoutraMaquina: ["claude-cli"] });
    expect(r.harnessesAuto).toEqual(["claude-cli"]);
    expect(r.declinio).toEqual({ ias: ["claude-cli"], auto: true });
  });

  it("sem IAs prontas anunciadas, o Automático não declina", () => {
    expect(portaoDoDespacho({ soNoutraMaquina: ["claude-cli"] }).declinio).toEqual({ ias: ["claude-cli"], auto: false });
  });
});
