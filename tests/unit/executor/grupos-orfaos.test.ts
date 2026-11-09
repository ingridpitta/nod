import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ambientesDosProcessos,
  arquivoDeGruposDoServidor,
  candidatosDoRegistro,
  encerrarGruposOrfaos,
  gravarArquivoDeGrupos,
  lerArquivoDeGrupos,
  lerSaidaDoPs,
  temAMarca,
  type GrupoRegistrado,
  type ProcessoDoSistema,
} from "../../../src/adapters/executor/grupos-orfaos.ts";

/**
 * ADR-089 (#217): os grupos dos turnos que sobreviveram ao nod (SIGKILL, queda) morrem no boot seguinte — só os provados
 * nossos pela marca NOD_GRUPO num processo vivo do grupo. medido em 2026-10-08 (processo-grupo.test.ts): filho e neto de
 * verdade custam 0,8–1,9 s por caso com o Mac carregado; as esperas vão a 20 s, abaixo dos 300 s de vida do neto.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 6 * ESPERA_MS });

const dir = mkdtempSync(join(tmpdir(), "nod-grupos-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
const matarGrupo = (pgid: number) => {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // já saiu
  }
};

const T0 = new Date(2026, 9, 9, 2, 34, 24).getTime();
const BOOT = T0 - 86_400_000;
const grupo = (pid: number, extra: Partial<GrupoRegistrado> = {}): GrupoRegistrado => ({ pid, desdeMs: T0 + 300, ateMs: T0 + 900, programa: "claude", marca: "ab12cd34-0011aa", ...extra });
const proc = (pid: number, pgid: number, inicioMs: number, comando: string, ppid = 1): ProcessoDoSistema => ({ pid, ppid, pgid, inicioMs, comando });
/** O próprio servidor que faz a limpeza, fora dos grupos anotados (sem ele no `ps`, nada morre). */
const EU = 4_242;
const euNoPs = proc(EU, EU, T0 - 1_000, "node src/adapters/http/server.ts");

describe("quais grupos anotados são candidatos (puro)", () => {
  it("lê o ps com LC_ALL=C", () => {
    const saida = "  501     1   501 Fri Oct  9 02:34:24 2026     /Users/m/.local/bin/claude -p --output-format stream-json\n  77  501  1 Thu Oct  8 21:40:01 2026 sleep 30\nlixo\n";
    expect(lerSaidaDoPs(saida)).toEqual([
      { pid: 501, ppid: 1, pgid: 501, inicioMs: T0, comando: "/Users/m/.local/bin/claude -p --output-format stream-json" },
      { pid: 77, ppid: 501, pgid: 1, inicioMs: new Date(2026, 9, 8, 21, 40, 1).getTime(), comando: "sleep 30" },
    ]);
  });

  it("a marca é a palavra exata NOD_GRUPO=<marca> no ambiente", () => {
    expect(temAMarca("node x PATH=/bin NOD_GRUPO=ab12cd34-0011aa HOME=/h", "ab12cd34-0011aa")).toBe(true);
    expect(temAMarca("node x NOD_GRUPO=ab12cd34-0011aabb", "ab12cd34-0011aa")).toBe(false);
    expect(temAMarca(undefined, "ab12cd34-0011aa")).toBe(false);
    expect(temAMarca("NOD_GRUPO=", "")).toBe(false);
  });

  it("líder vivo que bate com o spawn anotado: candidato, com o líder a conferir", () => {
    const ps = [proc(501, 501, T0, "node /Users/m/.local/bin/claude -p"), proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do gh run list; sleep 30; done")];
    expect(candidatosDoRegistro([grupo(501)], ps, BOOT)).toEqual([{ pgid: 501, programa: "claude", marca: "ab12cd34-0011aa", membros: 2, lider: true, desdeMs: T0 + 300, verificar: [501] }]);
  });

  it("CI do #223: no Linux o lstart é derivado do btime truncado e sai até 1 s antes — o líder e o resto continuam candidatos", () => {
    // desdeMs = T0 + 300 → piso do segundo = T0; o procps pode mostrar T0 - 1 s.
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0 - 1_000, "claude -p")], BOOT)).toHaveLength(1);
    expect(candidatosDoRegistro([grupo(501)], [proc(502, 501, T0 - 1_000, "node mcp-proxy")], BOOT)).toHaveLength(1);
  });

  it("pid reaproveitado não é candidato: início fora do spawn, outro programa, ou não é mais líder do grupo", () => {
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0 + 3_600_000, "node /Users/m/.local/bin/claude -p")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0, "/Applications/Safari.app/Contents/MacOS/Safari")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 77, T0, "claude -p")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0 + 60_000, "claude")], BOOT)).toEqual([]);
  });

  it("revisão do #223: anotação de antes do boot da máquina, ou sem marca, é descartada", () => {
    const ps = [proc(501, 501, T0, "claude -p")];
    expect(candidatosDoRegistro([grupo(501)], ps, T0 + 1_000)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501, { marca: "" })], ps, BOOT)).toEqual([]);
  });

  it("líder morto: candidato só com o boot conhecido e todos os membros nascidos depois do spawn", () => {
    const resto = [proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do sleep 30; done"), proc(503, 501, T0 + 2_500, "node mcp-proxy")];
    expect(candidatosDoRegistro([grupo(501)], resto, BOOT)).toEqual([{ pgid: 501, programa: "claude", marca: "ab12cd34-0011aa", membros: 2, lider: false, desdeMs: T0 + 300, verificar: [502, 503] }]);
    expect(candidatosDoRegistro([grupo(501)], resto, null)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(502, 501, T0 - 60_000, "bash")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [], BOOT)).toEqual([]);
  });

  it("revisão do #223: um grupo alheio com líder morto e sem a marca nunca é morto", async () => {
    const arquivo = join(dir, "alheio.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({
      arquivo,
      matar: (g) => mortos.push(g),
      boot: async () => BOOT,
      listar: async () => [proc(502, 501, T0 + 2_000, "/usr/bin/some-daemon"), proc(503, 501, T0 + 2_500, "node outro")],
      // um legível sem a marca, o outro ilegível (binário da Apple)
      ambientes: async () => new Map([[503, "node outro PATH=/bin"]]),
    });
    expect(r).toEqual({ assumiu: true, encerrados: [] });
    expect(mortos).toEqual([]);
  });

  it("com a marca num membro vivo, o grupo do líder morto é morto inteiro", async () => {
    const arquivo = join(dir, "resto.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({
      arquivo,
      matar: (g) => mortos.push(g),
      boot: async () => BOOT,
      pidAtual: EU,
      listar: async () => [euNoPs, proc(502, 501, T0 + 2_000, "/bin/zsh -c while :; do sleep 30; done"), proc(503, 501, T0 + 2_500, "node mcp-proxy")],
      ambientes: async () => new Map([[503, "node mcp-proxy NOD_GRUPO=ab12cd34-0011aa"]]),
    });
    expect(r.encerrados.map((s) => [s.pgid, s.lider])).toEqual([[501, false]]);
    expect(mortos).toEqual([501]);
  });

  it("revisão do #223: o servidor que nasceu dentro do grupo anotado (subido por um bot) não mata o próprio grupo nem o de um ancestral", async () => {
    const arquivo = join(dir, "meu-grupo.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501), grupo(601)] });
    const mortos: number[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const r = await encerrarGruposOrfaos({
      arquivo,
      pidAtual: EU,
      boot: async () => BOOT,
      // 501: o bot (líder vivo) que subiu o servidor; o servidor (EU) está no grupo dele. 601: um bot mais acima na
      // cadeia (o npm que subiu o servidor nasceu no grupo 601).
      listar: async () => [
        proc(501, 501, T0, "claude -p"),
        proc(601, 601, T0, "claude -p"),
        proc(700, 601, T0 + 3_000, "npm run dev", 601),
        proc(EU, 501, T0 + 5_000, "node src/adapters/http/server.ts", 700),
      ],
      ambientes: async () => new Map([[501, "NOD_GRUPO=ab12cd34-0011aa"], [601, "NOD_GRUPO=ab12cd34-0011aa"]]),
      matar: (g) => mortos.push(g),
    });
    const linhas = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    expect(r.encerrados).toEqual([]);
    expect(mortos).toEqual([]);
    expect(linhas.filter((l) => l.includes('"evento":"orfao_e_meu_grupo"'))).toHaveLength(2);
  });

  it("sem o próprio pid no ps, nada morre", async () => {
    const arquivo = join(dir, "sem-mim.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await encerrarGruposOrfaos({ arquivo, pidAtual: EU, boot: async () => BOOT, listar: async () => [proc(501, 501, T0, "claude -p")], ambientes: async () => new Map([[501, "NOD_GRUPO=ab12cd34-0011aa"]]), matar: (g) => mortos.push(g) });
    log.mockRestore();
    expect(mortos).toEqual([]);
  });

  it("o dono anotado ainda vivo (até 60 s de diferença no início): nada é morto e o arquivo fica com ele", async () => {
    const arquivo = join(dir, "dono-vivo.json");
    gravarArquivoDeGrupos(arquivo, { dono: { pid: 900, inicioMs: T0 }, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({ arquivo, pidAtual: 1_000, boot: async () => BOOT, ambientes: async () => new Map([[501, "NOD_GRUPO=ab12cd34-0011aa"]]), matar: (g) => mortos.push(g), listar: async () => [proc(900, 900, T0 + 5_000, "node server.ts"), proc(501, 501, T0, "claude -p")] });
    expect(r).toEqual({ assumiu: false, encerrados: [] });
    expect(mortos).toEqual([]);
  });

  it("sem ps, nada é morto e os grupos anotados voltam como herdados (revisão 14b, M2)", async () => {
    const arquivo = join(dir, "sem-ps.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    expect(await encerrarGruposOrfaos({ arquivo, matar: (g) => mortos.push(g), listar: async () => null })).toEqual({ assumiu: true, encerrados: [], herdados: [grupo(501)] });
    expect(mortos).toEqual([]);
  });

  it("um arquivo por instância: banco ou porta diferentes, arquivos diferentes; a senha não aparece no nome", () => {
    const diario = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5434/nod", NOD_API_PORT: "8888" });
    const temporaria = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5435/nod", NOD_API_PORT: "8889" });
    const outraPorta = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5434/nod", NOD_API_PORT: "8897" });
    expect(new Set([diario, temporaria, outraPorta]).size).toBe(3);
    expect(diario).toMatch(/^\/h\/\.nod\/grupos-vivos\/servidor-[0-9a-f]{16}\.json$/);
    expect(diario).not.toContain("segredo");
  });

  it("NOD-218: NOD_COR entra no hash só quando definida — azul e verde não dividem o arquivo; sem cor, o nome de antes", () => {
    const base = { DATABASE_URL: "postgres://nod_app:segredo@db:5432/nod", NOD_API_PORT: "8888" };
    const semCor = arquivoDeGruposDoServidor("/data", base);
    const azul = arquivoDeGruposDoServidor("/data", { ...base, NOD_COR: "azul" });
    const verde = arquivoDeGruposDoServidor("/data", { ...base, NOD_COR: "verde" });
    expect(new Set([semCor, azul, verde]).size).toBe(3);
    // A chave sem cor é a mesma de antes da NOD-218 (sha256 de "url|porta"): quem já roda não perde o arquivo.
    const antes = createHash("sha256").update(`${base.DATABASE_URL}|${base.NOD_API_PORT}`).digest("hex").slice(0, 16);
    expect(semCor).toBe(`/data/grupos-vivos/servidor-${antes}.json`);
    expect(arquivoDeGruposDoServidor("/data", { ...base, NOD_COR: "" })).toBe(semCor);
  });
});

/** Sobe o "servidor" da fixture, espera o bot e o neto, e o mata com SIGKILL (o `exit` não roda). */
async function servidorMortoPorSigkill(arquivo: string): Promise<{ bot: number; neto: number }> {
  const script = fileURLToPath(new URL("../../fixtures/servidor-com-grupos.ts", import.meta.url));
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

describe("religar o servidor por SIGKILL (de verdade)", () => {
  it("o boot seguinte mata o grupo registrado (marca lida no líder), e um processo de outro programa não é tocado", async () => {
    const arquivo = join(dir, "servidor.json");
    const { bot, neto } = await servidorMortoPorSigkill(arquivo);
    expect(vivo(bot)).toBe(true);
    expect(vivo(neto)).toBe(true);
    expect(lerArquivoDeGrupos(arquivo).grupos.map((g) => g.pid)).toEqual([bot]);

    // Um programa qualquer, vivo e líder do próprio grupo, anotado com início e programa que BATEM (o pior caso de pid
    // reaproveitado): sem a marca no ambiente, não morre.
    const desdeMs = Date.now();
    const alheio = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore", detached: true });
    const alheioPid = alheio.pid!;
    try {
      const anotado = lerArquivoDeGrupos(arquivo);
      gravarArquivoDeGrupos(arquivo, { ...anotado, grupos: [...anotado.grupos, { pid: alheioPid, desdeMs, ateMs: Date.now(), programa: "node", marca: "ab12cd34-ffffff" }] });

      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const r = await encerrarGruposOrfaos({ arquivo });
      const linhas = log.mock.calls.map((c) => String(c[0]));
      log.mockRestore();

      expect(r.assumiu).toBe(true);
      expect(r.encerrados).toEqual([expect.objectContaining({ pgid: bot, lider: true, membros: 2, programa: "node" })]);
      expect(linhas.some((l) => l.includes('"evento":"orfao_encerrado"') && l.includes(`"pgid":${bot}`))).toBe(true);
      expect(linhas.some((l) => l.includes('"evento":"orfao_sem_prova"') && l.includes(`"pgid":${alheioPid}`))).toBe(true);
      expect(await esperarAte(() => !vivo(bot) && !vivo(neto))).toBe(true);
      expect(vivo(alheioPid)).toBe(true);
    } finally {
      matarGrupo(alheioPid);
      matarGrupo(bot);
    }
  });

  it("revisão do #223: o servidor subido por um bot da instância (no grupo dele, com a marca) roda a limpeza e não se mata", async () => {
    const arquivo = join(dir, "servidor-no-bot.json");
    const fixture = fileURLToPath(new URL("../../fixtures/limpeza-no-proprio-grupo.ts", import.meta.url));
    // O "bot": líder do próprio grupo, com a marca, que depois de 1,5 s sobe o "servidor" sem setsid (mesmo grupo).
    const BOT = `const { spawn } = require("node:child_process"); setTimeout(() => spawn(process.execPath, [${JSON.stringify(fixture)}, ${JSON.stringify(arquivo)}], { stdio: "inherit" }), 1500); setInterval(() => {}, 1000);`;
    const desdeMs = Date.now();
    const bot = spawn(process.execPath, ["-e", BOT], { detached: true, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, NOD_GRUPO: "cafe0000-meu" } });
    const botPid = bot.pid!;
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [{ pid: botPid, desdeMs, ateMs: Date.now(), programa: "node", marca: "cafe0000-meu" }] });
    let saida = "";
    bot.stdout!.setEncoding("utf8");
    bot.stdout!.on("data", (d: string) => (saida += d));
    try {
      expect(await esperarAte(() => saida.includes("limpeza "))).toBe(true);
      expect(saida).toContain('"evento":"orfao_e_meu_grupo"');
      expect(saida).toContain('limpeza {"assumiu":true,"encerrados":[]}');
      expect(vivo(botPid)).toBe(true);
    } finally {
      matarGrupo(botPid);
    }
  });

  it("líder morto depois do SIGKILL: o neto que ficou carrega a marca, e o grupo morre", async () => {
    const arquivo = join(dir, "servidor-resto.json");
    const { bot, neto } = await servidorMortoPorSigkill(arquivo);
    try {
      process.kill(bot, "SIGKILL");
      expect(await esperarAte(() => !vivo(bot))).toBe(true);
      expect(vivo(neto)).toBe(true);
      const ambiente = (await ambientesDosProcessos([neto])).get(neto);
      expect(ambiente).toContain("NOD_GRUPO=");

      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const r = await encerrarGruposOrfaos({ arquivo });
      log.mockRestore();
      expect(r.encerrados).toEqual([expect.objectContaining({ pgid: bot, lider: false, membros: 1 })]);
      expect(await esperarAte(() => !vivo(neto))).toBe(true);
    } finally {
      matarGrupo(bot);
    }
  });
});
