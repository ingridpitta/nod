import { describe, expect, it } from "vitest";
import { estadoDoGit, GIT_INDISPONIVEL, PRAZO_GIT_MS } from "../../../src/adapters/executor/estado-do-git.ts";
import type { ExecutarComando } from "../../../src/adapters/executor/limpeza-das-tasks.ts";
import { TITULO_DO_GIT } from "../../../src/domain/passagem-de-bastao.ts";

type Resposta = { codigo: number; stdout?: string };

function falso(respostas: (bin: string, args: readonly string[]) => Resposta | undefined) {
  const chamadas: { bin: string; args: readonly string[]; o?: { prazoMs?: number; fundo?: boolean } }[] = [];
  const executar: ExecutarComando = async (bin, args, o) => {
    chamadas.push({ bin, args, o });
    const r = respostas(bin, args) ?? { codigo: 0, stdout: "" };
    return { codigo: r.codigo, stdout: r.stdout ?? "", stderr: "" } as never;
  };
  return { executar, chamadas };
}

const wt = async () => ["/home/nod/nod/Eng 1/task-x/nod"];

describe("NOD-310: estadoDoGit", () => {
  it("branch, SHA, commits, arquivos e o PR que já existe", async () => {
    const { executar, chamadas } = falso((bin, args) => {
      if (bin === "gh") return { codigo: 0, stdout: JSON.stringify([{ number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN" }]) };
      const a = args.join(" ");
      if (a === "rev-parse HEAD") return { codigo: 0, stdout: "abc1234\n" };
      if (a === "symbolic-ref --short HEAD") return { codigo: 0, stdout: "eng1/nod-310\n" };
      if (a.startsWith("log --oneline")) return { codigo: 0, stdout: "abc1234 NOD-310: passagem\n" };
      if (a.startsWith("diff --stat")) return { codigo: 0, stdout: " src/a.ts | 3 +\n 1 file changed\n" };
      if (a === "status --porcelain") return { codigo: 0, stdout: " M src/b.ts\n" };
      return undefined;
    });
    const t = await estadoDoGit("/p", executar, { worktrees: wt });
    expect(t.startsWith(TITULO_DO_GIT)).toBe(true);
    expect(t).toMatch(/branch eng1\/nod-310, último SHA abc1234/);
    expect(t).toMatch(/Commits desde origin\/main:\n {4}abc1234 NOD-310: passagem/);
    expect(t).toMatch(/src\/a\.ts \| 3 \+/);
    expect(t).toMatch(/1 arquivo por commitar/);
    expect(t).toMatch(/PR #42 já existe \(OPEN\) — não abra outro: https:\/\/github.com\/o\/r\/pull\/42/);
    expect(chamadas.every((c) => c.o?.prazoMs === PRAZO_GIT_MS && c.o?.fundo === true)).toBe(true);
  });

  it("git falha: diz que está indisponível, sem lançar", async () => {
    const { executar } = falso(() => ({ codigo: 128 }));
    expect(await estadoDoGit("/p", executar, { worktrees: wt })).toMatch(new RegExp(GIT_INDISPONIVEL.slice(0, 30)));
  });

  it("sem worktree, ou a busca lança: indisponível", async () => {
    const { executar } = falso(() => undefined);
    expect(await estadoDoGit("/p", executar, { worktrees: async () => [] })).toMatch(/nenhuma worktree/);
    expect(await estadoDoGit("/p", executar, { worktrees: async () => { throw new Error("x"); } })).toMatch(/indisponível/);
  });

  it("sem o gh (-1): nenhuma linha de PR", async () => {
    const { executar } = falso((bin, args) => (bin === "gh" ? { codigo: -1 } : args[0] === "symbolic-ref" ? { codigo: 0, stdout: "b\n" } : { codigo: 0, stdout: args[0] === "rev-parse" ? "s\n" : "" }));
    const t = await estadoDoGit("/p", executar, { worktrees: wt });
    expect(t).not.toMatch(/PR/);
    expect(t).toMatch(/Nada por commitar/);
  });

  it("achado 1 do QA (#432): saída grande — branch, SHA, PR e status de todas as worktrees antes do log e do stat, dentro do teto", async () => {
    const comprido = "x".repeat(90);
    const { executar } = falso((bin, args) => {
      if (bin === "gh") return { codigo: 0, stdout: JSON.stringify([{ number: 432, url: "https://github.com/gamefik/nod/pull/432", state: "OPEN" }]) };
      const a = args.join(" ");
      if (a === "rev-parse HEAD") return { codigo: 0, stdout: "bae5afe0\n" };
      if (a === "symbolic-ref --short HEAD") return { codigo: 0, stdout: "eng1/nod-310\n" };
      if (a.startsWith("log --oneline")) return { codigo: 0, stdout: Array.from({ length: 10 }, (_, i) => `c${i} ${comprido}`).join("\n") };
      if (a.startsWith("diff --stat")) return { codigo: 0, stdout: Array.from({ length: 60 }, (_, i) => ` src/${comprido}/arquivo-${i}.ts | 120 ++++++++++`).join("\n") };
      if (a === "status --porcelain") return { codigo: 0, stdout: "" };
      return undefined;
    });
    const tres = async () => ["/t/a", "/t/b", "/t/c"];
    const t = await estadoDoGit("/p", executar, { worktrees: tres });
    expect(t.length).toBeLessThanOrEqual(3_000);
    expect(t.match(/PR #432 já existe \(OPEN\) — não abra outro/g)).toHaveLength(3);
    expect(t.match(/branch eng1\/nod-310, último SHA bae5afe0/g)).toHaveLength(3);
    expect(t.match(/Nada por commitar/g)).toHaveLength(3);
    // O PR vem antes dos commits e dos arquivos; o detalhe que não coube saiu.
    expect(t.indexOf("PR #432")).toBeLessThan(t.indexOf("Commits desde"));
    expect(t).toMatch(/Commits desde origin\/main/);
  });
});
