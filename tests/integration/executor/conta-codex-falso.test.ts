import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contaDoCodex } from "../../../desktop/conta-codex.ts";
import { PRAZO_TESTE_FALSO_MS } from "../../helpers/prazo-falso.ts";

/**
 * NOD-209 (revisão do PR #266, 2026-10-12): a conta do Codex vem do `account/read` de um `codex app-server` curto. O
 * processo tem prazo e morre SEMPRE — respondeu, deu erro ou ficou calado —, e "não respondeu" (undefined) é diferente
 * de "respondeu sem conta" (null), para a impressão do login não mudar por uma falha passageira.
 */
vi.setConfig({ testTimeout: PRAZO_TESTE_FALSO_MS });

let dir: string;
let bin: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-conta-codex-"));
  bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`);
  await chmod(bin, 0o700);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function morreu(pid: number, ms = 3_000): Promise<boolean> {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    if (!vivo(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !vivo(pid);
}
const ler = (conta: string, prazoMs = 5_000) =>
  contaDoCodex({ bin, env: { HOME: dir, PATH: process.env.PATH ?? "", TESTE_NOD_CONTA_CODEX: conta, TESTE_NOD_PID: join(dir, "pid") }, cwd: dir, versao: "teste", prazoMs, sigtermParaSigkillMs: 50 });
const pid = async () => Number(await readFile(join(dir, "pid"), "utf8"));

describe("contaDoCodex", () => {
  it("lê e-mail e plano; o e-mail trocado na conta vira outra conta; o processo morre", async () => {
    expect(await ler("pessoa@exemplo.com")).toEqual({ email: "pessoa@exemplo.com", organizacao: null, plano: "Pro" });
    expect(await morreu(await pid())).toBe(true);
    expect(await ler("outra@exemplo.com")).toEqual({ email: "outra@exemplo.com", organizacao: null, plano: "Pro" });
    expect(await morreu(await pid())).toBe(true);
  });

  it("login por chave (sem e-mail) responde null: é resposta, não falha", async () => {
    expect(await ler("chave")).toBeNull();
    expect(await morreu(await pid())).toBe(true);
  });

  it("erro do protocolo: undefined (não sei), e o processo morre", async () => {
    expect(await ler("erro")).toBeUndefined();
    expect(await morreu(await pid())).toBe(true);
  });

  it("app-server calado (nem sai com o stdin fechado): o prazo devolve undefined e o processo é morto", async () => {
    const inicio = Date.now();
    expect(await ler("calado", 2_500)).toBeUndefined();
    expect(Date.now() - inicio).toBeLessThan(6_000);
    expect(await morreu(await pid())).toBe(true);
  });

  it("binário que não abre: undefined, sem lançar", async () => {
    expect(await contaDoCodex({ bin: join(dir, "nao-existe"), env: { PATH: "" }, cwd: dir, versao: "teste", prazoMs: 2_000 })).toBeUndefined();
  });
});
