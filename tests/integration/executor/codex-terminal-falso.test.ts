import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AVISO_SEM_TERMINAL } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL_CODEX } from "../../../src/domain/nativas.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

/**
 * ADR-103 (paridade do Codex): o kit do terminal no chat do Codex, contra o app-server falso (tests/fixtures/codex-falso.mjs,
 * que imita o 0.147.0 medido em 14/10: hook de `-c` só roda confiado, permitir = stdout vazio, negar = JSON deny) e o hook
 * do nod de verdade (hook-nativas.ts), que pergunta a um servidor do nod falso nesta mesma porta.
 */
let dir: string;
let cfg: ConfigDriver;
let servidor: Server;
let urlNod: string;
let pedidos: Record<string, unknown>[];
vi.setConfig({ testTimeout: PRAZO_TESTE_FALSO_MS });

const proxyPath = fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url));
const hookPath = fileURLToPath(new URL("../../../src/adapters/executor/hook-nativas.ts", import.meta.url));
type Registro = { args: string[]; cwd: string; thread: Record<string, unknown> | null; turnos: { texto: string; imagens?: string[] }[]; comandos: { command?: string; patch?: string; roda: boolean }[]; configEscritas: { keyPath: string; value: unknown }[] };
const registro = async (): Promise<Registro> => JSON.parse(await readFile(join(dir, "registro.json"), "utf8")) as Registro;
const ligDoTeste = (extra: Record<string, unknown> = {}) => ({ urlNod, proxyPath, hookPath, nodePath: process.execPath, filaDoForno: false, sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste(), ...extra });
const comTerminal = (texto: string, extra: Partial<PlanoTurno> = {}, entrada: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno => ({ ...planoHarness({ texto, ...entrada }), nativas: NATIVAS_DO_TERMINAL_CODEX, pastaDoBot: "Dev", ...extra });
const sinks = { sinal: async () => {}, delta: () => {}, evento: () => {} };
/** Só o que o hook e o driver mandam à rota das nativas (o proxy MCP também pede o plano ao subir). */
const pedidosDoHook = () => pedidos.filter((p) => p.caminho === "/api/interno/nativas");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-codex-terminal-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`);
  await chmod(bin, 0o700);
  cfg = { bins: { "codex-cli": bin }, env: { HOME: dir, PATH: process.env.PATH ?? "", TESTE_NOD_REGISTRO: join(dir, "registro.json") }, cwdBase: join(dir, "turnos") };
  // O servidor do nod, no papel da rota /api/interno/nativas: nega o comando com NEGAR, libera o resto.
  pedidos = [];
  servidor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (v) => { corpo += v; });
    req.on("end", () => {
      const c = JSON.parse(corpo || "{}") as Record<string, unknown>;
      pedidos.push({ caminho: req.url, autorizacao: req.headers.authorization, ...c });
      const negar = typeof c.comando === "string" && c.comando.includes("NEGAR");
      res.writeHead(negar ? 403 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(negar ? { codigo: "nao_permitido", mensagem: "negado no teste" } : { ok: true }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const endereco = servidor.address();
  urlNod = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
});
afterEach(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

it("com o hook: sem sandbox, na pasta do bot, hook confiado; o servidor decide cada comando e o patch; a web contamina", async () => {
  const instance = await criarCodexCliDriver(ligDoTeste()).create(cfg);
  const r = await instance.adapter(comTerminal("[[comando:git status]] [[comando:echo NEGAR]] [[patch:nota.txt]] [[web]] pronto")).rodarTurno(sinks);
  expect(r).toMatchObject({ desfecho: "sucesso", sessaoCli: "thr_falso" });
  const reg = await registro();
  expect(reg.args).toContain('sandbox_mode="danger-full-access"');
  expect(reg.args.some((a) => a.startsWith("hooks={PreToolUse="))).toBe(true);
  expect(reg.args).not.toContain("features.shell_tool=false");
  // O app-server vê o caminho real (no macOS o tmpdir é um link para /private/var).
  const pastaBot = await realpath(join(dir, "nod", "Dev"));
  expect(reg.cwd).toBe(pastaBot);
  expect(reg.thread).toMatchObject({ sandbox: "danger-full-access", ephemeral: false, cwd: pastaBot });
  // A confiança do hook, gravada pelo app-server; e a entrada [projects] que a thread criou sai no fim.
  expect(reg.configEscritas).toEqual([
    { keyPath: 'hooks.state."/<session-flags>/config.toml:pre_tool_use:0:0".trusted_hash', value: "sha256:falso", mergeStrategy: "replace" },
    { keyPath: `projects.${JSON.stringify(pastaBot)}`, value: null, mergeStrategy: "replace" },
  ]);
  expect(reg.comandos).toEqual([
    { command: "git status", roda: true },
    { command: "echo NEGAR", roda: false },
    { patch: "nota.txt", roda: true },
  ]);
  // O hook perguntou ao servidor com o token do turno; o patch dentro da pasta do bot vai sem `arquivo` (não pede o modo).
  expect(pedidosDoHook().map(({ caminho, ferramenta, comando, arquivo, contamina, autorizacao }) => ({ caminho, ferramenta, comando, arquivo, contamina, autorizacao }))).toEqual([
    { caminho: "/api/interno/nativas", ferramenta: "Bash", comando: "git status", arquivo: undefined, contamina: false, autorizacao: "Bearer tok" },
    { caminho: "/api/interno/nativas", ferramenta: "Bash", comando: "echo NEGAR", arquivo: undefined, contamina: false, autorizacao: "Bearer tok" },
    { caminho: "/api/interno/nativas", ferramenta: "apply_patch", comando: undefined, arquivo: undefined, contamina: false, autorizacao: "Bearer tok" },
    { caminho: "/api/interno/nativas", ferramenta: "web_search", comando: undefined, arquivo: undefined, contamina: true, autorizacao: "Bearer tok" },
  ]);
  // O comando barrado não vira item no Codex; a causa vem do arquivo que o hook anotou.
  expect(r.negacoesDoNod).toEqual([{ nome: "Bash", motivo: "nod: negado no teste" }]);
  expect(r.ferramentasChamadas).toEqual(expect.arrayContaining(["Bash", "apply_patch", "web_search"]));
});

it("hook que não fica confiado: o turno roda de novo, isolado, e o modelo lê que não há terminal", async () => {
  const instance = await criarCodexCliDriver(ligDoTeste()).create({ ...cfg, env: { ...cfg.env, TESTE_NOD_HOOK_NAO_CONFIA: "1" } });
  const r = await instance.adapter(comTerminal("[[comando:git status]] oi")).rodarTurno(sinks);
  expect(r.desfecho).toBe("sucesso");
  const reg = await registro();
  expect(reg.args).toContain("features.shell_tool=false");
  expect(reg.args).not.toContain('sandbox_mode="danger-full-access"');
  expect(String(reg.thread?.developerInstructions)).toContain(AVISO_SEM_TERMINAL);
  expect(pedidosDoHook()).toEqual([]);
});

it("máquina sem o script do hook: isolado e com o aviso, sem tentar confiar nada", async () => {
  const instance = await criarCodexCliDriver(ligDoTeste({ hookPath: undefined })).create(cfg);
  await instance.adapter(comTerminal("oi")).rodarTurno(sinks);
  const reg = await registro();
  expect(reg.args).toContain("features.shell_tool=false");
  expect(String(reg.thread?.developerInstructions)).toContain(AVISO_SEM_TERMINAL);
  expect(reg.configEscritas).toEqual([]);
});

it("a sessão continua (thread/resume), bifurca (thread/fork) e, se a thread não existe nesta conta, abre outra", async () => {
  const instance = await criarCodexCliDriver(ligDoTeste()).create(cfg);
  const continua = await instance.adapter(comTerminal("oi", {}, { sessaoCli: "thr_antiga" })).rodarTurno(sinks);
  expect(continua.sessaoCli).toBe("thr_antiga");
  expect((await registro()).thread).toMatchObject({ metodo: "thread/resume", threadId: "thr_antiga", sandbox: "danger-full-access" });
  const copia = await instance.adapter(comTerminal("oi", {}, { sessaoCli: "thr_antiga", bifurcar: true })).rodarTurno(sinks);
  expect(copia.sessaoCli).toBe("thr_copia");
  expect((await registro()).thread).toMatchObject({ metodo: "thread/fork", threadId: "thr_antiga" });
  const perdida = await instance.adapter(comTerminal("oi", {}, { sessaoCli: "thr_inexistente" })).rodarTurno(sinks);
  expect(perdida).toMatchObject({ desfecho: "sucesso", sessaoCli: "thr_falso" });
});

it("o MCP da pessoa só junta com o do nod quando o plano o traz (modo da dona)", async () => {
  const instance = await criarCodexCliDriver(ligDoTeste()).create(cfg);
  await instance.adapter(comTerminal("oi", { nativas: [...NATIVAS_DO_TERMINAL_CODEX, "mcp_da_pessoa"] })).rodarTurno(sinks);
  let reg = await registro();
  expect(reg.args.some((a) => a.startsWith("mcp_servers.nod={"))).toBe(true);
  expect(reg.args).not.toContain("features.apps=false");
  await instance.adapter(comTerminal("oi")).rodarTurno(sinks);
  reg = await registro();
  expect(reg.args.some((a) => a.startsWith("mcp_servers={ nod = {"))).toBe(true);
  expect(reg.args).toContain("features.apps=false");
});
