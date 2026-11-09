// NOD-298: os scripts de entrada rodam o `main` quando chamados por um caminho com link simbólico (no macOS o
// $TMPDIR fica em /var, link para /private/var). Antes, a guarda comparava o caminho cru e o processo saía 0 mudo.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { escreverLauncherProxy } from "../../../src/adapters/executor/drivers/codex-comum.ts";

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "nod-entrada-link-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Link para o diretório do script, como o /var → /private/var do macOS. */
function porLink(relativo: string): string {
  const real = join(RAIZ, relativo);
  const link = join(tmp, `d${Math.random().toString(36).slice(2)}`);
  symlinkSync(dirname(real), link);
  return join(link, real.slice(dirname(real).length + 1));
}

function rodar(args: string[], stdin: string, env: Record<string, string> = {}): Promise<{ codigo: number | null; saida: string; erro: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: tmp, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let saida = "", erro = "";
    p.stdout.on("data", (c: Buffer) => { saida += c.toString("utf8"); });
    p.stderr.on("data", (c: Buffer) => { erro += c.toString("utf8"); });
    p.once("error", reject);
    p.once("exit", (codigo) => resolve({ codigo, saida, erro }));
    p.stdin.end(stdin);
  });
}

const INITIALIZE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } }) + "\n";

describe("scripts de entrada chamados por link (NOD-298)", () => {
  it("proxy MCP por link responde exatamente uma vez ao initialize", async () => {
    const r = await rodar([porLink("src/adapters/mcp-proxy/proxy.ts")], INITIALIZE);
    expect(r.erro).toBe("");
    expect(r.codigo).toBe(0);
    const respostas = r.saida.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: number; result?: { protocolVersion?: string } });
    expect(respostas).toHaveLength(1);
    expect(respostas[0]?.id).toBe(1);
    expect(respostas[0]?.result?.protocolVersion).toBe("2024-11-05");
  }, 30_000); // medido em 2026-10-28: ~1 s cada no Linux de CI dos bots; 30 s cobre máquina sob carga

  it("hook das nativas por link decide (sem config, nega) em vez de sair mudo e liberar", async () => {
    const r = await rodar([porLink("src/adapters/executor/hook-nativas.ts"), join(tmp, "config-que-nao-existe.json")], "{}");
    expect(r.codigo).toBe(0);
    expect(r.saida).not.toBe("");
    expect(r.saida).toContain("não foi possível decidir esta chamada");
  }, 30_000); // medido em 2026-10-28: ~1 s cada no Linux de CI dos bots; 30 s cobre máquina sob carga

  it("launcher do Codex (proxy.mjs que importa o proxy e chama main), por link: uma resposta só, sem main em dobro", async () => {
    const dir = join(tmp, "turno");
    mkdirSync(dir);
    const launcher = await escreverLauncherProxy(dir, { urlNod: "http://127.0.0.1:9", tokenDeTurno: "t", proxyPath: porLink("src/adapters/mcp-proxy/proxy.ts") });
    const r = await rodar([launcher], INITIALIZE);
    expect(r.codigo).toBe(0);
    expect(r.saida.trim().split("\n").filter(Boolean)).toHaveLength(1);
  }, 30_000); // medido em 2026-10-28: ~1 s no Linux dos bots; 30 s cobre máquina sob carga

  it("conector GitHub local por link responde ao initialize", async () => {
    const r = await rodar([porLink("src/adapters/conectores-locais/github/servidor.ts")], INITIALIZE);
    expect(r.codigo).toBe(0);
    const respostas = r.saida.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: number; result?: { serverInfo?: { name?: string } } });
    expect(respostas).toHaveLength(1);
    expect(respostas[0]?.result?.serverInfo?.name).toBe("nod-github");
  }, 30_000); // medido em 2026-10-28: ~1 s no Linux dos bots; 30 s cobre máquina sob carga

  it("servidor HTTP por link roda o main (sem banco, falha no boot em vez de sair 0 mudo)", async () => {
    const r = await rodar([porLink("src/adapters/http/server.ts")], "", { NOD_LOGIN: "stub" });
    expect(r.codigo).not.toBe(0);
    expect(r.erro).toContain("DATABASE_URL");
  }, 30_000); // medido em 2026-10-28: ~1 s no Linux dos bots; 30 s cobre máquina sob carga

  it("smoke-proxy.mjs passa com o proxy chamado por link em $TMPDIR", async () => {
    const r = await rodar([join(RAIZ, "scripts/desktop/smoke-proxy.mjs"), process.execPath, porLink("src/adapters/mcp-proxy/proxy.ts")], "", { NOD_SMOKE_PROXY_PRAZO_MS: "20000" });
    expect(r.erro).toBe("");
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("initialize passou");
  }, 30_000); // medido em 2026-10-28: ~1 s cada no Linux de CI dos bots; 30 s cobre máquina sob carga
});
