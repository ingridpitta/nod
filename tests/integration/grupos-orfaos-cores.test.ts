import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { arquivoDeGruposDoServidor, encerrarGruposOrfaos, lerArquivoDeGrupos } from "../../src/adapters/executor/grupos-orfaos.ts";

/**
 * NOD-218 (deploy azul/verde): as duas cores dividem o NOD_HOME (/data), o banco e a porta interna. O bot de um turno
 * da azul que sobreviveu a ela (SIGKILL, como no `docker stop` que vence o prazo) não pode ser morto pelo boot da verde,
 * que roda a limpeza enquanto a azul ainda drena. Com `NOD_COR` no hash cada cor tem o próprio arquivo; o boot da azul,
 * depois, mata o que é dela. Processos de verdade (a fixture do #217), sem banco.
 */
const dir = mkdtempSync(join(tmpdir(), "nod-grupos-cores-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarAte = async (cond: () => boolean, ms = 15_000) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
  return cond();
};
const matarGrupo = (pgid: number) => {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // já saiu
  }
};

async function servidorMortoPorSigkill(arquivo: string): Promise<{ bot: number; neto: number }> {
  const script = fileURLToPath(new URL("../fixtures/servidor-com-grupos.ts", import.meta.url));
  const servidor: ChildProcess = spawn(process.execPath, [script, arquivo], { stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  servidor.stdout!.setEncoding("utf8");
  servidor.stdout!.on("data", (d: string) => (saida += d));
  expect(await esperarAte(() => /bot \d+ neto \d+/.test(saida))).toBe(true);
  const [, bot, neto] = /bot (\d+) neto (\d+)/.exec(saida)!;
  const saiu = new Promise((r) => servidor.on("exit", r));
  servidor.kill("SIGKILL");
  await saiu;
  return { bot: Number(bot), neto: Number(neto) };
}

describe("NOD-218: grupos órfãos com duas cores no mesmo NOD_HOME", () => {
  it("o boot da verde não toca o bot que a azul deixou; o boot seguinte da azul o encerra", async () => {
    const env = { DATABASE_URL: "postgres://nod_app:x@db:5432/nod", NOD_API_PORT: "8888" };
    const daAzul = arquivoDeGruposDoServidor(dir, { ...env, NOD_COR: "azul" });
    const daVerde = arquivoDeGruposDoServidor(dir, { ...env, NOD_COR: "verde" });
    expect(daAzul).not.toBe(daVerde);

    const { bot, neto } = await servidorMortoPorSigkill(daAzul);
    try {
      expect(lerArquivoDeGrupos(daAzul).grupos.map((g) => g.pid)).toEqual([bot]);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const daVerdeR = await encerrarGruposOrfaos({ arquivo: daVerde });
      expect(daVerdeR.encerrados).toEqual([]);
      await new Promise((r) => setTimeout(r, 200));
      expect(vivo(bot)).toBe(true);
      expect(vivo(neto)).toBe(true);
      expect(lerArquivoDeGrupos(daAzul).grupos.map((g) => g.pid)).toEqual([bot]);

      const daAzulR = await encerrarGruposOrfaos({ arquivo: daAzul });
      log.mockRestore();
      expect(daAzulR.encerrados).toEqual([expect.objectContaining({ pgid: bot })]);
      expect(await esperarAte(() => !vivo(bot) && !vivo(neto))).toBe(true);
    } finally {
      matarGrupo(bot);
    }
  }, 30_000);
});
