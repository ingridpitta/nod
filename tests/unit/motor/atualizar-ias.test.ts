import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";
import type { AtualizacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import { lerComando } from "../../../motor/conexao.ts";
import { pastasFerramentas } from "../../../desktop/ferramentas.ts";
import {
  arquivoDaTravaDeIa,
  arquivoDoEstadoDeIa,
  arquivoDoPedidoDeIa,
  criarLimiteDePedidos,
  fraseDoTerminal,
  lerEstadoDoPedido,
  lerFimNoTerminal,
  passoNpmLocal,
  travar,
  inicioDoProcesso,
  TRAVA_ILEGIVEL_VIVA_MS,
  vigiarPedidosDoTerminal,
  type ExecutarNpm,
  type OpcoesTrava,
} from "../../../motor/atualizar-ias.ts";

/** NOD-9 PR4 (definido em 2026-10-23): a atualização das IAs na VM, com o npm do motor no ~/.local. */
let pasta: string;
beforeEach(async () => { pasta = await mkdtemp(join(tmpdir(), "nod-atualizar-ias-")); });
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

type Chamada = { bin: string; args: readonly string[]; env: Record<string, string> };

function npmFalso(o: { versaoNpm?: string | null; installs?: { exitCode: number | null; stderr?: string; estourouTempo?: boolean }[]; aoInstalar?: () => void }) {
  const chamadas: Chamada[] = [];
  const installs = [...(o.installs ?? [{ exitCode: 0 }])];
  const executar: ExecutarNpm = async ({ bin, args, env }) => {
    chamadas.push({ bin, args, env });
    if (args[0] === "--version") return o.versaoNpm === null ? { exitCode: 127, stdout: "", stderr: "", estourouTempo: false } : { exitCode: 0, stdout: `${o.versaoNpm ?? "11.17.0"}\n`, stderr: "", estourouTempo: false };
    const r = installs.shift() ?? { exitCode: 0 };
    if (r.exitCode === 0) o.aoInstalar?.();
    return { exitCode: r.exitCode, stdout: "", stderr: r.stderr ?? "", estourouTempo: r.estourouTempo ?? false };
  };
  return { chamadas, executar };
}

function passo(o: Parameters<typeof npmFalso>[0] & { versao?: string; env?: Record<string, string> } = {}) {
  const s = { versao: o.versao ?? "2.1.200", logs: [] as [string, Record<string, unknown>][] };
  const npm = npmFalso({ ...o, aoInstalar: () => { s.versao = "2.1.300"; } });
  const p = passoNpmLocal({
    ia: "claude-cli",
    home: "/home/nod",
    pastaDoMotor: pasta,
    bin: async () => "/home/nod/.local/bin/claude",
    lerVersao: async () => s.versao,
    env: o.env ?? { PATH: "/usr/bin", HOME: "/home/nod" },
    npm: "/opt/nod-motor/node/bin/npm",
    executar: npm.executar,
    registrar: (e, c) => { s.logs.push([e, c]); },
  });
  return { s, p, chamadas: npm.chamadas };
}

describe("passo npm_local", () => {
  it("instala por cima no ~/.local com o npm do motor e a idade mínima", async () => {
    const { p, chamadas } = passo();
    const fim = await p.rodar("2.1.290");
    expect(fim).toEqual({ resultado: "ok", antes: "2.1.200", depois: "2.1.300", atende: true });
    const install = chamadas.find((c) => c.args[0] === "install")!;
    expect(install.bin).toBe("/opt/nod-motor/node/bin/npm");
    expect(install.args).toEqual(expect.arrayContaining(["--global", "--prefix", "/home/nod/.local", `@anthropic-ai/claude-code@>=${PISO_CLI["claude-cli"]}`]));
    expect(install.args.some((a) => a.startsWith("--min-release-age"))).toBe(true);
    expect((install.env.PATH ?? "").split(":")[0]).toBe("/opt/nod-motor/node/bin");
  });

  it("não leva as npm_* herdadas nem as variáveis do nod", async () => {
    const { p, chamadas } = passo({ env: { PATH: "/usr/bin", HOME: "/home/nod", npm_config_prefix: "/outro", NOD_TOKEN: "x" } });
    await p.rodar("2.1.290");
    const env = chamadas.find((c) => c.args[0] === "install")!.env;
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.NOD_TOKEN).toBeUndefined();
    expect(env.npm_config_update_notifier).toBe("false");
  });

  it("os npmrc do nod nascem 0600", async () => {
    const { p } = passo();
    await p.rodar("2.1.290");
    const pastas = pastasFerramentas(join(pasta, "npm"));
    for (const a of [pastas.npmrcUsuario, pastas.npmrcGlobal]) expect((await stat(a)).mode & 0o777).toBe(0o600);
  });

  it("npm abaixo do 11.17: instala e registra que a idade não valeu", async () => {
    const { s, p } = passo({ versaoNpm: "10.9.0" });
    expect((await p.rodar("2.1.290")).resultado).toBe("ok");
    expect(s.logs.some(([e]) => e === "ia_atualizacao_npm_sem_idade")).toBe(true);
  });

  it("pacote indisponível com a idade: tenta de novo sem ela", async () => {
    const { p, chamadas } = passo({ installs: [{ exitCode: 1, stderr: "npm error code ETARGET\nnpm error notarget No matching version found" }, { exitCode: 0 }] });
    const fim = await p.rodar("2.1.290");
    const installs = chamadas.filter((c) => c.args[0] === "install");
    expect(installs).toHaveLength(2);
    expect(installs[1]!.args.some((a) => a.startsWith("--min-release-age"))).toBe(false);
    expect(fim.resultado).toBe("ok");
  });

  it("sem npm: sem_npm, sem install", async () => {
    const { p, chamadas } = passo({ versaoNpm: null });
    expect(await p.rodar("2.1.290")).toMatchObject({ resultado: "sem_npm", atende: false });
    expect(chamadas.some((c) => c.args[0] === "install")).toBe(false);
  });

  it("classifica as falhas do npm (sem internet, sem permissão, tempo)", async () => {
    expect((await passo({ installs: [{ exitCode: 1, stderr: "npm error code ENOTFOUND\nnpm error network request failed" }] }).p.rodar("2.1.290")).resultado).toBe("sem_internet");
    expect((await passo({ installs: [{ exitCode: 1, stderr: "npm error code EACCES\nnpm error permission denied" }] }).p.rodar("2.1.290")).resultado).toBe("sem_permissao");
    expect((await passo({ installs: [{ exitCode: null, estourouTempo: true }] }).p.rodar("2.1.290")).resultado).toBe("tempo_esgotado");
  });

  it("solta a trava no fim", async () => {
    const { p } = passo();
    await p.rodar("2.1.290");
    expect(await readFile(arquivoDaTravaDeIa(pasta), "utf8").catch(() => null)).toBeNull();
  });

  it("com a trava de outro processo vivo: falhou, sem rodar o npm", async () => {
    await writeFile(arquivoDaTravaDeIa(pasta), `${JSON.stringify({ pid: 4242, boot: "b1", id: "outro" })}\n`);
    const chamadas: Chamada[] = [];
    const p = passoNpmLocal({ ia: "claude-cli", home: "/h", pastaDoMotor: pasta, bin: async () => "/b", lerVersao: async () => "2.1.200", env: {}, executar: async (c) => { chamadas.push(c); return { exitCode: 0, stdout: "", stderr: "", estourouTempo: false }; }, registrar: () => undefined, trava: { vivo: () => true, boot: async () => "b1" } });
    expect(await p.rodar("2.1.290")).toMatchObject({ resultado: "falhou", atende: false });
    expect(chamadas).toEqual([]);
  });
});

describe("trava (devolução do #501: link atômico, boot, pid reaproveitado)", () => {
  const dono = (pid: number, boot: string | null, id = "x", inicio?: string) => `${JSON.stringify({ pid, boot, ...(inicio ? { inicio } : {}), id })}\n`;
  const comBoot = (o: OpcoesTrava = {}): OpcoesTrava => ({ boot: async () => "boot-a", inicio: async () => null, ...o });

  it("QA do #501 (achado 4): pid reaproveitado por outro processo vivo no mesmo boot (starttime diferente): velha", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, dono(4242, "boot-a", "x", "1000"));
    // O mesmo processo (starttime igual) segue dono; trava antiga sem starttime cai no vivo/morto de sempre.
    expect(await travar(arquivo, comBoot({ pid: 9, vivo: () => true, inicio: async (p) => (p === 4242 ? "1000" : "77") }))).toBeNull();
    await writeFile(arquivo, dono(4242, "boot-a"));
    expect(await travar(arquivo, comBoot({ pid: 9, vivo: () => true, inicio: async (p) => (p === 4242 ? "5000" : "77") }))).toBeNull();
    await writeFile(arquivo, dono(4242, "boot-a", "x", "1000"));
    const t = await travar(arquivo, comBoot({ pid: 9, vivo: () => true, inicio: async (p) => (p === 4242 ? "5000" : "77") }));
    expect(t).not.toBeNull();
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toMatchObject({ pid: 9, boot: "boot-a", inicio: "77" });
    await t!.soltar();
  });

  it("inicioDoProcesso lê o starttime real do /proc (o deste processo é estável; pid inexistente = null)", async () => {
    const meu = await inicioDoProcesso(process.pid);
    if (process.platform === "linux") expect(meu).toMatch(/^\d+$/);
    expect(await inicioDoProcesso(process.pid)).toBe(meu);
    expect(await inicioDoProcesso(2 ** 22 + 1)).toBeNull();
  });

  it("/proc de verdade: a trava aponta para um pid vivo com o starttime de outro processo (reaproveitado): tomada", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    // Simula o reaproveitamento: a trava aponta para um pid vivo (este processo de teste) com o starttime de outro.
    await writeFile(arquivo, dono(process.pid, "boot-a", "x", "1"));
    const t = await travar(arquivo, { boot: async () => "boot-a", pid: 999_999 });
    expect(t).not.toBeNull();
    await t!.soltar();
  });

  it("dono vivo: não trava; dono morto: toma a trava, com pid, boot e id; soltar apaga", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, dono(4242, "boot-a"));
    expect(await travar(arquivo, comBoot({ pid: 1, vivo: () => true }))).toBeNull();
    const t = await travar(arquivo, comBoot({ pid: 7, vivo: () => false }));
    expect(t).not.toBeNull();
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toMatchObject({ pid: 7, boot: "boot-a", id: expect.any(String) });
    await t!.soltar();
    expect(await readFile(arquivo, "utf8").catch(() => null)).toBeNull();
    expect((await readdir(pasta)).filter((n) => n.includes(".tmp") || n.includes(".velha."))).toEqual([]);
  });

  it("20 travar ao mesmo tempo (pids diferentes, todos vivos): só um ganha", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    const r = await Promise.all(Array.from({ length: 20 }, (_, i) => travar(arquivo, comBoot({ pid: 1000 + i, vivo: () => true }))));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect((await readdir(pasta)).filter((n) => n.includes(".tmp"))).toEqual([]);
    await r.find(Boolean)!.soltar();
  });

  it("8 processos de verdade disputam a trava no mesmo instante: só um ganha", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    const modulo = pathToFileURL(join(process.cwd(), "motor/atualizar-ias.ts")).href;
    const inicio = Date.now() + 1_500;
    // Quem ganha só solta depois que os 8 tentaram (um marcador por filho): sob carga, um filho que demora a carregar
    // não pode achar a trava já solta e "ganhar" de novo, em sequência.
    const tentaram = join(pasta, "tentaram");
    await mkdir(tentaram, { recursive: true });
    const filho = `const { travar } = await import(${JSON.stringify(modulo)});
      const { readdir, writeFile } = await import("node:fs/promises");
      while (Date.now() < ${inicio}) await new Promise((r) => setTimeout(r, 1));
      const t = await travar(${JSON.stringify(arquivo)});
      await writeFile(${JSON.stringify(tentaram)} + "/" + process.pid, "");
      if (t) { const fim = Date.now() + 15000; while ((await readdir(${JSON.stringify(tentaram)})).length < 8 && Date.now() < fim) await new Promise((r) => setTimeout(r, 10)); await t.soltar(); }
      process.stdout.write(t ? "ganhou" : "perdeu");`;
    const rodar = () => new Promise<string>((resolver, rejeitar) => {
      const p = spawn(process.execPath, ["--input-type=module", "-e", filho], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      p.on("error", rejeitar);
      p.on("close", () => resolver(out));
    });
    const saidas = await Promise.all(Array.from({ length: 8 }, rodar));
    expect(saidas.filter((x) => x === "ganhou")).toHaveLength(1);
    expect(saidas.filter((x) => x === "perdeu")).toHaveLength(7);
    expect(await readFile(arquivo, "utf8").catch(() => null)).toBeNull();
  }, 30_000);

  it("trava vazia (no meio da escrita, ou de versão antiga) recente: viva; antiga: tomada", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, "");
    const mtime = (await stat(arquivo)).mtimeMs;
    expect(await travar(arquivo, comBoot({ agora: () => mtime + TRAVA_ILEGIVEL_VIVA_MS - 1 }))).toBeNull();
    const t = await travar(arquivo, comBoot({ agora: () => mtime + TRAVA_ILEGIVEL_VIVA_MS + 1 }));
    expect(t).not.toBeNull();
    await t!.soltar();
  });

  it("de outro boot (VM reiniciou): velha, mesmo com o pid vivo agora", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, dono(4242, "boot-velho"));
    const t = await travar(arquivo, comBoot({ pid: 9, vivo: () => true }));
    expect(t).not.toBeNull();
    await t!.soltar();
  });

  it("o mesmo pid deste processo, sem a trava estar com ele (SIGKILL e o pid voltou): velha; com ela: ocupada", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, dono(process.pid, "boot-a"));
    const t = await travar(arquivo, comBoot({ vivo: () => true }));
    expect(t).not.toBeNull();
    expect(await travar(arquivo, comBoot({ vivo: () => true }))).toBeNull();
    await t!.soltar();
    expect(await travar(arquivo, comBoot({ vivo: () => true }))).not.toBeNull();
  });

  it("soltar não apaga a trava que já é de outro (a minha foi julgada velha e tomada)", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    const t = await travar(arquivo, comBoot({ pid: 5 }));
    await writeFile(arquivo, dono(6, "boot-a", "de-outro"));
    await t!.soltar();
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toMatchObject({ id: "de-outro" });
  });

  it("10 processos tomam a mesma trava velha ao mesmo tempo: só um fica com ela", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, dono(4242, "boot-a"));
    const vivo = (pid: number) => pid !== 4242;
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => travar(arquivo, comBoot({ pid: 2000 + i, vivo }))));
    expect(r.filter(Boolean)).toHaveLength(1);
    const ganhou = JSON.parse(await readFile(arquivo, "utf8")) as { pid: number };
    expect(ganhou.pid).toBeGreaterThanOrEqual(2000);
    expect((await readdir(pasta)).filter((n) => n.includes(".velha.") || n.includes(".tmp"))).toEqual([]);
    await r.find(Boolean)!.soltar();
  });
});

describe("trava: a quebra de quem morreu no meio", () => {
  it("quebra recente (outro tirando a velha agora): não trava; quebra esquecida há mais de 10 s: segue e toma a velha", async () => {
    const arquivo = arquivoDaTravaDeIa(pasta);
    await writeFile(arquivo, `${JSON.stringify({ pid: 4242, boot: "boot-a", id: "x" })}\n`);
    await writeFile(`${arquivo}.quebra`, "");
    const mtime = (await stat(`${arquivo}.quebra`)).mtimeMs;
    const o = (agora: number): OpcoesTrava => ({ pid: 9, vivo: () => false, boot: async () => "boot-a", agora: () => agora });
    expect(await travar(arquivo, o(mtime + 1_000))).toBeNull();
    const t = await travar(arquivo, o(mtime + 11_000));
    expect(t).not.toBeNull();
    expect((await readdir(pasta)).filter((n) => n.endsWith(".quebra"))).toEqual([]);
    await t!.soltar();
  });
});

describe("passo npm_local: o binário que o nod usa fora do ~/.local", () => {
  it("o npm instalou no ~/.local, mas o nod usa outro (vem antes no PATH): falhou com o log ia_binario", async () => {
    const logs: [string, Record<string, unknown>][] = [];
    const versoes: Record<string, string> = { "/usr/local/bin/claude": "2.1.200", "/home/nod/.local/bin/claude": "2.1.300" };
    const p = passoNpmLocal({
      ia: "claude-cli", home: "/home/nod", pastaDoMotor: pasta,
      bin: async () => "/usr/local/bin/claude",
      lerVersao: async (b) => versoes[b] ?? null,
      env: { PATH: "/usr/bin" }, executar: npmFalso({}).executar, registrar: (e, c) => { logs.push([e, c]); },
    });
    expect(await p.rodar("2.1.290")).toMatchObject({ resultado: "falhou", antes: "2.1.200", depois: "2.1.200", atende: false });
    expect(logs).toContainEqual(["ia_binario", { ia: "claude-cli", fora_do_local: true, pasta: "/usr/local/bin", versao: "2.1.200", versao_no_local: "2.1.300" }]);
  });

  it("não leva NODE_OPTIONS nem ELECTRON_RUN_AS_NODE ao npm", async () => {
    const { p, chamadas } = passo({ env: { PATH: "/usr/bin", HOME: "/home/nod", NODE_OPTIONS: "--require /tmp/x.js", ELECTRON_RUN_AS_NODE: "1" } });
    await p.rodar("2.1.290");
    for (const c of chamadas) {
      expect(c.env.NODE_OPTIONS).toBeUndefined();
      expect(c.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    }
  });
});

describe("limite de pedidos", () => {
  it("3 por hora por IA; a janela anda", () => {
    let t = 0;
    const l = criarLimiteDePedidos(() => t);
    expect([l.cabe("claude-cli"), l.cabe("claude-cli"), l.cabe("claude-cli"), l.cabe("claude-cli")]).toEqual([true, true, true, false]);
    expect(l.cabe("codex-cli")).toBe(true);
    t += 60 * 60_000;
    expect(l.cabe("claude-cli")).toBe(true);
  });
});

describe("pedido do terminal", () => {
  const a = (fase: AtualizacaoDaIa["fase"], em: number, extra: Partial<AtualizacaoDaIa> = {}): AtualizacaoDaIa => ({ fase, em, alvo: "2.1.290", ...extra });

  it("lerFimNoTerminal: limite, em dia, sucesso, falhou e esperar", () => {
    const base = { ia: "claude-cli" as const, pedidoEm: 100, atendido: false, atualizacao: null };
    expect(lerFimNoTerminal({ ...base, atendido: true, recusado: "limite" })).toBe("limite");
    expect(lerFimNoTerminal({ ...base, atendido: true })).toBe("em_dia");
    expect(lerFimNoTerminal({ ...base, atendido: true, atualizacao: a("sucesso", 50) })).toBe("em_dia");
    expect(lerFimNoTerminal({ ...base, atendido: true, atualizacao: a("sucesso", 150) })).toBe("sucesso");
    expect(lerFimNoTerminal({ ...base, atualizacao: a("falhou", 150, { motivo: "sem_internet" }) })).toBe("falhou");
    expect(lerFimNoTerminal({ ...base, atualizacao: a("atualizando", 150) })).toBe("esperar");
    expect(lerFimNoTerminal({ ...base, atendido: true, atualizacao: a("esperando", 150) })).toBe("esperar");
  });

  it("o serviço pega o pedido, apaga, publica o estado e marca atendido quando a decisão termina", async () => {
    let fase: AtualizacaoDaIa | null = null;
    let resolver: () => void = () => undefined;
    const pedidos: string[] = [];
    const v = vigiarPedidosDoTerminal({
      pastaDoMotor: pasta,
      pedir: (ia) => { pedidos.push(ia); return new Promise<void>((r) => { resolver = r; }); },
      estado: () => fase,
      agendar: () => ({ cancelar: () => undefined }),
      registrar: () => undefined,
    });
    await writeFile(arquivoDoPedidoDeIa(pasta), JSON.stringify({ ia: "claude-cli", em: 100, pid: 1 }));
    await v.olhar();
    expect(pedidos).toEqual(["claude-cli"]);
    expect(await readFile(arquivoDoPedidoDeIa(pasta), "utf8").catch(() => null)).toBeNull();
    const ler = async () => lerEstadoDoPedido(await readFile(arquivoDoEstadoDeIa(pasta), "utf8"));
    expect(await ler()).toMatchObject({ ia: "claude-cli", pedidoEm: 100, atendido: false, atualizacao: null });
    fase = a("sucesso", 200, { depois: "2.1.300" });
    resolver();
    let e = (await ler())!;
    for (let i = 0; i < 200 && !e.atendido; i++) { await new Promise((r) => setTimeout(r, 10)); e = (await ler().catch(() => null)) ?? e; }
    expect(e.atendido).toBe(true);
    expect(lerFimNoTerminal(e)).toBe("sucesso");
    expect(fraseDoTerminal("Claude Code", e.atualizacao)).toBe("✓ Claude Code atualizado para 2.1.300.");
    v.parar();
  });

  it("acima do limite: recusa sem atualizar", async () => {
    const v = vigiarPedidosDoTerminal({ pastaDoMotor: pasta, pedir: () => "limite", estado: () => null, agendar: () => ({ cancelar: () => undefined }), registrar: () => undefined });
    await writeFile(arquivoDoPedidoDeIa(pasta), JSON.stringify({ ia: "codex-cli", em: 5, pid: 1 }));
    await v.olhar();
    const e = lerEstadoDoPedido(await readFile(arquivoDoEstadoDeIa(pasta), "utf8"))!;
    expect(lerFimNoTerminal(e)).toBe("limite");
    v.parar();
  });

  it("pedido ilegível é descartado", async () => {
    const pedidos: string[] = [];
    const v = vigiarPedidosDoTerminal({ pastaDoMotor: pasta, pedir: (ia) => { pedidos.push(ia); return Promise.resolve(); }, estado: () => null, agendar: () => ({ cancelar: () => undefined }), registrar: () => undefined });
    await writeFile(arquivoDoPedidoDeIa(pasta), "lixo");
    await v.olhar();
    expect(pedidos).toEqual([]);
    expect(await readFile(arquivoDoPedidoDeIa(pasta), "utf8").catch(() => null)).toBeNull();
    v.parar();
  });
});

describe("nod-motor atualizar-ia", () => {
  it("lê a IA; sem ela, a ajuda", () => {
    expect(lerComando(["atualizar-ia", "claude"])).toEqual({ tipo: "atualizar-ia", ia: "claude" });
    expect(lerComando(["atualizar-ia", "codex"])).toEqual({ tipo: "atualizar-ia", ia: "codex" });
    expect(lerComando(["atualizar-ia"])).toMatchObject({ tipo: "ajuda", erro: expect.stringContaining("atualizar-ia claude") });
    expect(lerComando(["atualizar-ia", "github"])).toMatchObject({ tipo: "ajuda" });
  });
});
