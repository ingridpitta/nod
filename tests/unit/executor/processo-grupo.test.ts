import { describe, expect, it, vi } from "vitest";
import { gruposDeProcessoVivos, iniciarProcesso } from "../../../src/adapters/executor/processo.ts";

/**
 * NOD-194 (QA): filho e neto de verdade (node -e, sleep). medido em 2026-10-08 (Mac, duas `test:unit` em paralelo,
 * load ~500): 0,8–1,9 s por caso, no padrão de 5 s do unit e com esperas internas de 5 s e 2 s, sem folga para o
 * load 600–950 do AGENTS.md. Cada espera vai a 20 s (~10x o pior medido), que fica ABAIXO dos 60 s do `sleep 60`
 * do X6: um neto órfão ainda está vivo quando a espera acaba, e o teste falha. O prazo cobre as três esperas do
 * primeiro caso e o Parar.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 3 * ESPERA_MS + 10_000 });

/**
 * #194 (ADR-083 §4): o CLI nasce líder de um grupo de processos (`detached: true`), o grupo é o que o amostrador mede e
 * o que o Parar encerra — o neto (servidor MCP, Bash do modelo) vai junto. stdin/stdout continuam pipes.
 */
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarAte = async (cond: () => boolean, ms = ESPERA_MS) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

// O filho abre um neto que ignora o stdin e escreve o pid dele; depois ecoa o que chegar pelo stdin.
const FILHO = `
const { spawn } = require("node:child_process");
const neto = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.stdout.write("neto " + neto.pid + "\\n");
process.stdin.on("data", (d) => process.stdout.write("eco " + d));
setInterval(() => {}, 1000);
`;

describe("grupo de processos do turno", () => {
  it("o filho é líder do próprio grupo; o Parar leva o neto junto e solta o grupo", async () => {
    const linhas: string[] = [];
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", FILHO], env: { PATH: process.env.PATH ?? "" }, cwd: process.cwd(), aoLinha: (l) => linhas.push(l), sigtermParaSigkillMs: 500 });
    expect(await esperarAte(() => linhas.some((l) => l.startsWith("neto ")))).toBe(true);
    const pid = p.pid!;
    const neto = Number(linhas.find((l) => l.startsWith("neto "))!.slice(5));
    // O grupo existe com o pid do líder (kill(-pid, 0) só funciona para um grupo vivo).
    expect(() => process.kill(-pid, 0)).not.toThrow();
    expect(gruposDeProcessoVivos()).toContain(pid);
    // stdin e stdout seguem pipes.
    p.escrever("oi\n");
    expect(await esperarAte(() => linhas.includes("eco oi"))).toBe(true);

    await p.interromper();
    expect(await esperarAte(() => !vivo(neto))).toBe(true);
    expect(vivo(pid)).toBe(false);
    expect(gruposDeProcessoVivos()).not.toContain(pid);
  });

  it("X6: o líder que sai sozinho leva o neto que deixou no grupo (`sleep 60 &`), em vez de deixá-lo órfão", async () => {
    // O neto não segura o stdout (stdio ignore), como um `sleep 60 &` com a saída redirecionada: o `close` chega na hora.
    const SAI_E_DEIXA = `
const { spawn } = require("node:child_process");
const neto = spawn("sleep", ["60"], { stdio: "ignore" });
neto.unref();
process.stdout.write("neto " + neto.pid + "\\n");
`;
    const linhas: string[] = [];
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", SAI_E_DEIXA], env: { PATH: process.env.PATH ?? "" }, cwd: process.cwd(), aoLinha: (l) => linhas.push(l) });
    const pid = p.pid!;
    await p.fim;
    const neto = Number(linhas.find((l) => l.startsWith("neto "))!.slice(5));
    expect(neto).toBeGreaterThan(0);
    expect(await esperarAte(() => !vivo(neto))).toBe(true);
    expect(gruposDeProcessoVivos()).not.toContain(pid);
  });

  it("o processo que termina sozinho sai da lista de grupos (o encerramento do app não mataria um pid reusado)", async () => {
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "process.stdout.write('ok\\n')"], env: { PATH: process.env.PATH ?? "" }, cwd: process.cwd(), aoLinha: () => {} });
    const pid = p.pid!;
    await p.fim;
    expect(gruposDeProcessoVivos()).not.toContain(pid);
  });
});
