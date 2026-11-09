import { describe, expect, it } from "vitest";
import { executar, planejar, PRAZO_VOLUMES_MS } from "../../../scripts/computador-legado.ts";
import type { Docker } from "../../../scripts/computadores-orfaos.ts";

/** NOD-96 PR 5: o legado por bot desliga sem apagar volume; `--apagar-volumes` só depois de 30 dias. */
const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DIA = 24 * 60 * 60 * 1000;
const AGORA = 100 * DIA;

function dockerFalso(falhar: (args: string[]) => string | null = () => null): { docker: Docker; chamadas: string[][] } {
  const chamadas: string[][] = [];
  return {
    chamadas,
    docker: (args) => {
      chamadas.push(args);
      const erro = falhar(args);
      if (erro) throw new Error(erro);
      return "";
    },
  };
}

describe("scripts/computador-legado.ts (NOD-96 PR 5)", () => {
  it("sem --apagar-volumes: desliga todos e não chama rm nem volume", () => {
    const plano = planejar([{ id: A, arquivadoEm: AGORA - 40 * DIA }, { id: B, arquivadoEm: AGORA }], AGORA, false);
    expect(plano).toEqual({ desligar: [A, B], apagar: [], aguardando: [] });
    const { docker, chamadas } = dockerFalso();
    expect(executar(plano, docker)).toEqual({ desligados: [A, B], apagados: [], falhas: [] });
    expect(chamadas).toEqual([["stop", `nod-computador-${A}`], ["stop", `nod-egress-${A}`], ["stop", `nod-computador-${B}`], ["stop", `nod-egress-${B}`]]);
  });

  it("--apagar-volumes: só o arquivado há 30 dias ou mais; o mais novo diz quantos dias faltam", () => {
    const plano = planejar([{ id: A, arquivadoEm: AGORA - PRAZO_VOLUMES_MS }, { id: B, arquivadoEm: AGORA - 10 * DIA }], AGORA, true);
    expect(plano.apagar).toEqual([A]);
    expect(plano.aguardando).toEqual([{ id: B, dias: 20 }]);
    const { docker, chamadas } = dockerFalso();
    executar(plano, docker);
    const volumes = chamadas.filter((c) => c[0] === "volume");
    expect(volumes).toEqual([["volume", "rm", `nod-computador-${A}-home`], ["volume", "rm", `nod-computador-${A}-workspace`]]);
    expect(chamadas.some((c) => c.join(" ").includes(`${B}-`))).toBe(false);
  });

  it("container que já não existe conta como desligado; erro de verdade vira falha sem parar os outros", () => {
    const plano = planejar([{ id: A, arquivadoEm: 0 }, { id: B, arquivadoEm: 0 }], AGORA, false);
    const { docker } = dockerFalso((args) => (args[1] === `nod-computador-${A}` ? "Error response from daemon: No such container" : args[1] === `nod-egress-${B}` ? "permission denied" : null));
    expect(executar(plano, docker)).toEqual({ desligados: [A], apagados: [], falhas: [B] });
  });
});
