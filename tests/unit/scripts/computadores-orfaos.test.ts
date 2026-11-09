import { describe, expect, it } from "vitest";
import { acharOrfaos, lerDocker, limpar, podeLimpar, type Docker } from "../../../scripts/computadores-orfaos.ts";

/** NOD-170: o script de órfãos lista pelo padrão de nome do driver e o `--limpar` nunca toca em volume. */
const VIVO = "11111111-2222-4333-8444-555555555555";
const ORFAO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function dockerFalso(): { docker: Docker; chamadas: string[][] } {
  const chamadas: string[][] = [];
  const docker: Docker = (args) => {
    chamadas.push(args);
    if (args[0] === "ps") return [`nod-computador-${VIVO}`, `nod-egress-${VIVO}`, `nod-computador-${ORFAO}`, `nod-egress-${ORFAO}`, "nod-computador-de-outra-coisa", ""].join("\n");
    if (args[0] === "network" && args[1] === "ls") return `nod-rede-${VIVO}\nnod-rede-${ORFAO}\n`;
    if (args[0] === "volume" && args[1] === "ls") return [`nod-computador-${VIVO}-home`, `nod-computador-${ORFAO}-home`, `nod-computador-${ORFAO}-workspace`, `nod-computador-${ORFAO}-outro`, "nod_nod_pgdata"].join("\n");
    return "";
  };
  return { docker, chamadas };
}

describe("scripts/computadores-orfaos.ts (NOD-170)", () => {
  it("órfão é o nome no padrão do driver com id fora de `computadores`; o resto não é do nod", () => {
    const { docker, chamadas } = dockerFalso();
    const orfaos = acharOrfaos(lerDocker(docker), new Set([VIVO]));
    expect(orfaos).toEqual({
      containers: [`nod-computador-${ORFAO}`, `nod-egress-${ORFAO}`],
      redes: [`nod-rede-${ORFAO}`],
      volumes: [`nod-computador-${ORFAO}-home`, `nod-computador-${ORFAO}-workspace`],
    });
    // Listar só lê.
    expect(chamadas.every((a) => a.includes("ls") || a[0] === "ps")).toBe(true);
  });

  it("--limpar remove containers e redes e NUNCA chama volume rm", () => {
    const { docker, chamadas } = dockerFalso();
    const orfaos = acharOrfaos(lerDocker(docker), new Set([VIVO]));
    chamadas.length = 0;
    expect(limpar(orfaos, docker)).toEqual({ containers: orfaos.containers, redes: orfaos.redes, falhas: [] });
    expect(chamadas).toEqual([
      ["rm", "--force", `nod-computador-${ORFAO}`],
      ["rm", "--force", `nod-egress-${ORFAO}`],
      ["network", "rm", `nod-rede-${ORFAO}`],
    ]);
    expect(chamadas.some((a) => a[0] === "volume" || a.includes("-v") || a.includes("--volumes"))).toBe(false);
  });

  it("--limpar: um rm que falha não impede os outros e volta em `falhas`", () => {
    const chamadas: string[][] = [];
    const docker: Docker = (args) => {
      chamadas.push(args);
      if (args.includes(`nod-computador-${ORFAO}`)) throw new Error("docker rm falhou");
      return "";
    };
    const orfaos = { containers: [`nod-computador-${ORFAO}`, `nod-egress-${ORFAO}`], redes: [`nod-rede-${ORFAO}`], volumes: [] };
    expect(limpar(orfaos, docker)).toEqual({ containers: [`nod-egress-${ORFAO}`], redes: [`nod-rede-${ORFAO}`], falhas: [`nod-computador-${ORFAO}`] });
    expect(chamadas).toHaveLength(3);
  });

  it("banco sem nenhum computador e Docker com containers do nod: recusa limpar (é o banco errado)", () => {
    const { docker } = dockerFalso();
    const tudo = acharOrfaos(lerDocker(docker), new Set());
    expect(tudo.containers).toHaveLength(4);
    expect(podeLimpar(new Set(), tudo)).toBe(false);
    expect(podeLimpar(new Set([VIVO]), acharOrfaos(lerDocker(docker), new Set([VIVO])))).toBe(true);
    expect(podeLimpar(new Set(), { containers: [], redes: [], volumes: ["nod-computador-x-home"] })).toBe(true);
  });
});
