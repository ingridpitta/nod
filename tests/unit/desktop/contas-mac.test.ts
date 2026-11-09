import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ambienteDaConta,
  ambienteNaConta,
  COMPARTILHADOS_CLAUDE,
  contasIniciaisDoMac,
  diretorioPadrao,
  gravarContasDoMac,
  lerContasDoMac,
  novoIdDeConta,
  pastaDaConta,
  prepararPastaDaConta,
  removerPastaDaConta,
} from "../../../desktop/contas-mac.ts";
import { idDeContaValido } from "../../../src/domain/contas-da-ia.ts";

/**
 * ADR-101 no Linux: as pastas, os symlinks, o ambiente da conta e o logout antes de apagar. O Keychain do macOS não
 * existe aqui — o roteiro manual do PR (#286) confere no Mac que cada CLAUDE_CONFIG_DIR tem a própria entrada.
 */
let raiz: string;
let base: string;
let padrao: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nod-contas-"));
  base = join(raiz, "userData", "contas");
  padrao = join(raiz, "home", ".claude");
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

describe("pastaDaConta e ambienteDaConta", () => {
  it("a conta 1 não tem pasta nem variável; a extra tem a variável da IA", () => {
    expect(pastaDaConta(base, "claude-cli", "padrao")).toBeNull();
    expect(ambienteDaConta(base, "claude-cli", "padrao")).toEqual({});
    expect(ambienteDaConta(base, "claude-cli", "c-1")).toEqual({ CLAUDE_CONFIG_DIR: join(base, "claude-cli", "c-1") });
    expect(ambienteDaConta(base, "codex-cli", "c-1")).toEqual({ CODEX_HOME: join(base, "codex-cli", "c-1") });
  });

  it("id que sairia da base é recusado (defesa além de idDeContaValido)", () => {
    for (const id of ["../x", "a/b", ".."]) expect(() => pastaDaConta(base, "claude-cli", id)).toThrow();
    for (const id of ["../x", "padrao", "A", "", "a b"]) expect(idDeContaValido(id)).toBe(false);
    expect(idDeContaValido(novoIdDeConta())).toBe(true);
  });

  it("o diretório padrão respeita a variável que a pessoa já usa no shell", () => {
    expect(diretorioPadrao("claude-cli", {}, "/Users/a")).toBe("/Users/a/.claude");
    expect(diretorioPadrao("codex-cli", { CODEX_HOME: "/x/codex" }, "/Users/a")).toBe("/x/codex");
  });
});

// QA do NOD-211 (2026-10-12): a config montada com a conta 2 em uso deixava CLAUDE_CONFIG_DIR/CODEX_HOME dela no login,
// no status e na leitura da conta 1 — o cartão da conta 1 mostrava a conta 2.
describe("ambienteNaConta", () => {
  const daConfig = { PATH: "/bin", CLAUDE_CONFIG_DIR: "/u/contas/claude-cli/c-2", CODEX_HOME: "/u/contas/codex-cli/c-9" };
  it("a conta 1 não herda a variável da conta que estava em uso", () => {
    expect(ambienteNaConta("claude-cli", {}, daConfig, {})).toEqual({ PATH: "/bin", CODEX_HOME: "/u/contas/codex-cli/c-9" });
    expect(ambienteNaConta("codex-cli", {}, daConfig, {})).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/u/contas/claude-cli/c-2" });
  });
  it("na conta 1 vale a pasta que a pessoa já tinha no shell", () => {
    expect(ambienteNaConta("claude-cli", { CLAUDE_CONFIG_DIR: "/h/minha" }, daConfig, {}).CLAUDE_CONFIG_DIR).toBe("/h/minha");
  });
  it("nas outras contas vale a pasta da conta", () => {
    expect(ambienteNaConta("claude-cli", { CLAUDE_CONFIG_DIR: "/h/minha" }, daConfig, { CLAUDE_CONFIG_DIR: "/u/contas/claude-cli/c-3" }).CLAUDE_CONFIG_DIR).toBe("/u/contas/claude-cli/c-3");
  });
});

describe("prepararPastaDaConta", () => {
  it("Claude: pasta 0700 e symlinks do que é da pessoa; settings.json só se existe; nada de credencial", async () => {
    await mkdir(join(padrao, "skills"), { recursive: true });
    await writeFile(join(padrao, "settings.json"), "{}");
    await writeFile(join(padrao, ".credentials.json"), "segredo");
    const pasta = await prepararPastaDaConta({ base, ia: "claude-cli", id: "c-1", padrao });
    expect(((await stat(pasta)).mode & 0o777).toString(8)).toBe("700");
    for (const c of COMPARTILHADOS_CLAUDE) {
      expect((await lstat(join(pasta, c.nome))).isSymbolicLink(), c.nome).toBe(true);
      expect(await readlink(join(pasta, c.nome))).toBe(join(padrao, c.nome));
    }
    // projects/ que não existia foi criado no padrão (o --resume atravessa a troca de conta)
    expect((await stat(join(padrao, "projects"))).isDirectory()).toBe(true);
    await expect(lstat(join(pasta, ".credentials.json"))).rejects.toThrow(/ENOENT/);
    await expect(lstat(join(pasta, ".claude.json"))).rejects.toThrow(/ENOENT/);
  });

  it("Claude sem settings.json no padrão: não cria link quebrado", async () => {
    const pasta = await prepararPastaDaConta({ base, ia: "claude-cli", id: "c-2", padrao });
    await expect(lstat(join(pasta, "settings.json"))).rejects.toThrow(/ENOENT/);
  });

  it("de novo na mesma pasta não sobrescreve o que a conta já tem", async () => {
    const pasta = await prepararPastaDaConta({ base, ia: "claude-cli", id: "c-3", padrao });
    await writeFile(join(padrao, "settings.json"), "{}");
    await prepararPastaDaConta({ base, ia: "claude-cli", id: "c-3", padrao });
    expect((await lstat(join(pasta, "settings.json"))).isSymbolicLink()).toBe(true);
  });

  it("Codex: só a pasta, sem symlink; a conta 1 devolve o padrão sem criar nada", async () => {
    const pasta = await prepararPastaDaConta({ base, ia: "codex-cli", id: "c-1", padrao: join(raiz, "home", ".codex") });
    expect((await stat(pasta)).isDirectory()).toBe(true);
    expect(await prepararPastaDaConta({ base, ia: "codex-cli", id: "padrao", padrao: "/x" })).toBe("/x");
  });
});

describe("removerPastaDaConta", () => {
  it("faz o logout COM a variável da conta e só então apaga; o padrão e o projects/ ficam", async () => {
    await mkdir(join(padrao, "projects", "p"), { recursive: true });
    const pasta = await prepararPastaDaConta({ base, ia: "claude-cli", id: "c-1", padrao });
    const ordem: string[] = [];
    const r = await removerPastaDaConta({
      base,
      ia: "claude-cli",
      id: "c-1",
      logout: async (env) => {
        ordem.push(`logout ${env.CLAUDE_CONFIG_DIR}`);
        expect((await stat(pasta)).isDirectory()).toBe(true);
        return true;
      },
    });
    expect(r).toEqual({ logout: true });
    expect(ordem).toEqual([`logout ${pasta}`]);
    await expect(lstat(pasta)).rejects.toThrow(/ENOENT/);
    expect((await stat(join(padrao, "projects", "p"))).isDirectory()).toBe(true);
  });

  it("logout que falha não deixa a pasta para trás; a conta 1 nunca é removida", async () => {
    const pasta = await prepararPastaDaConta({ base, ia: "codex-cli", id: "c-9", padrao: "/x" });
    expect(await removerPastaDaConta({ base, ia: "codex-cli", id: "c-9", logout: () => Promise.reject(new Error("x")) })).toEqual({ logout: false });
    await expect(lstat(pasta)).rejects.toThrow(/ENOENT/);
    await expect(removerPastaDaConta({ base, ia: "codex-cli", id: "padrao", logout: async () => true })).rejects.toThrow();
  });
});

describe("contas.json", () => {
  it("ausente ou quebrado vira o padrão; gravar e ler devolve o mesmo, 0600", async () => {
    const arquivo = join(raiz, "contas.json");
    expect(await lerContasDoMac(arquivo)).toEqual(contasIniciaisDoMac());
    await writeFile(arquivo, "{quebrado");
    expect(await lerContasDoMac(arquivo)).toEqual(contasIniciaisDoMac());
    const contas = contasIniciaisDoMac();
    contas["claude-cli"].modo = "automatico";
    contas["claude-cli"].contas.push({ id: "c-1", apelido: "Lumen", plano: "team", entraNaTrocaAutomatica: false, noLimiteAte: null });
    await gravarContasDoMac(arquivo, contas);
    expect(await lerContasDoMac(arquivo)).toEqual(contas);
    expect(((await stat(arquivo)).mode & 0o777).toString(8)).toBe("600");
    expect(JSON.parse(await readFile(arquivo, "utf8"))["claude-cli"].contas[1].entraNaTrocaAutomatica).toBe(false);
  });
});
