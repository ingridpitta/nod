import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ouvirSinaisDeEncerramento } from "../../../src/adapters/http/server.ts";

/**
 * X7 (revisão do épico #188): o segundo sinal sai por `process.exit(130)`, que roda o `exit` — é ele que mata os
 * grupos `detached` dos turnos (processo.ts). Antes o segundo sinal caía no padrão do Node, que mata sem o `exit`.
 */
/**
 * NOD-194 (QA): o filho importa `server.ts` inteiro antes do "pronto"; com carga, a subida é a fila, não o código.
 * medido em 2026-10-08 (Mac, duas `test:unit` em paralelo, load ~500): 8–11 s no teste inteiro, e numa rodada da
 * main passou dos 15 s da espera antiga e caiu sem regressão nenhuma. 60 s por espera dá ~5x o pior medido; o
 * prazo do teste cobre as duas esperas e a saída. Um filho que trava ou não sai com 130 ainda falha.
 */
const ESPERA_MS = 60_000;
it("primeiro sinal drena; o segundo sai com 130 passando pelo gancho `exit`", { timeout: 2 * ESPERA_MS + 10_000 }, async () => {
  const script = fileURLToPath(new URL("../../fixtures/sinais-servidor.ts", import.meta.url));
  const filho = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  filho.stdout.setEncoding("utf8");
  filho.stdout.on("data", (d: string) => (saida += d));
  const esperar = async (cond: () => boolean) => {
    const fim = Date.now() + ESPERA_MS;
    while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
    return cond();
  };
  const fim = new Promise<{ codigo: number | null; sinal: string | null }>((r) => filho.on("exit", (codigo, sinal) => r({ codigo, sinal })));
  expect(await esperar(() => saida.includes("pronto"))).toBe(true);
  filho.kill("SIGTERM");
  expect(await esperar(() => saida.includes("drenando SIGTERM"))).toBe(true);
  filho.kill("SIGINT");
  expect(await fim).toEqual({ codigo: 130, sinal: null });
  expect(saida).toContain("exit 130");
});

/**
 * ADR-089 (#217): o SIGHUP (terminal fechado) entra no mesmo caminho — antes ele matava sem o `exit` e os grupos dos bots
 * ficavam órfãos. O mesmo sinal repetido em menos de 3 s é eco do repasse (dev.mjs → npm → tsx) e não pula a drenagem.
 * Em processo: `process.emit` chama os ouvintes sem mandar sinal de verdade. Só o SIGHUP — o SIGINT/SIGTERM emitido aqui
 * acordaria os ouvintes do próprio vitest; o segundo sinal DIFERENTE já está no teste com o filho de verdade, acima.
 */
describe("SIGHUP e eco do repasse (ADR-089)", () => {
  const emitirSighup = () => (process.emit as (s: string, ...a: unknown[]) => boolean)("SIGHUP", "SIGHUP");

  it("SIGHUP drena como o SIGTERM; o eco em menos de 3 s não conta; depois disso é o segundo sinal e sai com 130", () => {
    let agora = 0;
    const drenagens: string[] = [];
    const saidas: number[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const tirar = ouvirSinaisDeEncerramento((s) => drenagens.push(s), (c) => saidas.push(c), () => agora);
    try {
      emitirSighup();
      agora = 50;
      emitirSighup();
      agora = 2_900;
      emitirSighup();
      expect(drenagens).toEqual(["SIGHUP"]);
      expect(saidas).toEqual([]);
      agora = 3_500;
      emitirSighup();
      expect(saidas).toEqual([130]);
    } finally {
      tirar();
      log.mockRestore();
    }
  });
});
