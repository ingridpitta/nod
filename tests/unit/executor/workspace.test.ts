import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { criarPreparadorWorkspace } from "../../../src/adapters/workspace/preparar.ts";

const executar = promisify(execFile);
/**
 * NOD-194: cada teste roda de 5 a 15 `git` de verdade (init, commit, worktree) — o processo é o que está sendo testado.
 * medido em 2026-10-07: com o Mac em load ~950 (duas `test:unit` em paralelo), 8 dos 9 testes estouravam os 5 s padrão
 * do projeto unit, todos parados no meio de um `git`. 30 s por teste (e no afterEach, que apaga as pastas) dá folga
 * a essa fila sem esconder um `git` travado, que segue falhando. Só este arquivo; o padrão do unit não muda.
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const temporarios: string[] = [];
afterEach(async () => { for (const dir of temporarios.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(comGit = true) {
  const raiz = await mkdtemp(join(tmpdir(), "nod-workspace-test-"));
  temporarios.push(raiz);
  const origem = join(raiz, "origem");
  await mkdir(origem);
  const git = async (...args: string[]) => (await executar("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: origem })).stdout.trim();
  if (comGit) {
    await git("init", "-b", "main");
    await git("config", "user.name", "Teste Nod");
    await git("config", "user.email", "teste@example.invalid");
    await writeFile(join(origem, "arquivo.txt"), "original\n");
    await writeFile(join(origem, ".gitignore"), "ignorado\n");
    await git("add", ".");
    await git("-c", "commit.gpgsign=false", "commit", "-m", "inicial");
  }
  return { origem, git, preparar: criarPreparadorWorkspace(join(raiz, "workspaces")), id: randomUUID() };
}

it("pasta sem Git funciona diretamente sem classificar área de conhecimento", async () => {
  const f = await fixture(false);
  const w = await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "auto" });
  expect(w).toMatchObject({ modo: "direto", git: null });
  expect(w.caminho).toBe(w.origem);
});

it("auto isola Git e preserva arquivos alterados e novos sem mexer na origem", async () => {
  const f = await fixture();
  await writeFile(join(f.origem, "arquivo.txt"), "alterado\n");
  await writeFile(join(f.origem, "novo.txt"), "novo\n");
  await writeFile(join(f.origem, "ignorado"), "não copiar\n");
  const antes = await f.git("status", "--porcelain");
  const w = await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "auto" });
  expect(w.modo).toBe("worktree");
  expect(await readFile(join(w.caminho, "arquivo.txt"), "utf8")).toBe("alterado\n");
  expect(await readFile(join(w.caminho, "novo.txt"), "utf8")).toBe("novo\n");
  await expect(readFile(join(w.caminho, "ignorado"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.git("status", "--porcelain")).toBe(antes);
  expect(await f.git("branch", "--show-current")).toBe("main");
});

it("escolha explícita de pasta direta prevalece sobre padrão Git", async () => {
  const f = await fixture();
  const w = await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "direto" });
  expect(w.modo).toBe("direto");
  expect(w.caminho).toBe(w.origem);
});

it("continuação preserva o mesmo workspace e edições realizadas nele", async () => {
  const f = await fixture();
  const pedido = { id: f.id, pastaAutorizada: f.origem, modo: "auto" as const };
  const w = await f.preparar(pedido);
  await writeFile(join(w.caminho, "arquivo.txt"), "trabalho do agente\n");
  expect(await f.preparar(pedido)).toEqual(w);
  expect(await readFile(join(w.caminho, "arquivo.txt"), "utf8")).toBe("trabalho do agente\n");
  await expect(f.preparar({ ...pedido, modo: "direto" })).rejects.toThrow();
});

it("referência explícita não carrega alterações locais de outra base", async () => {
  const f = await fixture();
  await writeFile(join(f.origem, "arquivo.txt"), "alterado\n");
  const w = await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "worktree", referencia: "main" });
  expect(await readFile(join(w.caminho, "arquivo.txt"), "utf8")).toBe("original\n");
});

it("concessão de subpasta não se amplia para o repositório inteiro", async () => {
  const f = await fixture();
  const sub = join(f.origem, "sub");
  await mkdir(sub);
  const w = await f.preparar({ id: f.id, pastaAutorizada: sub, modo: "auto" });
  expect(w.modo).toBe("direto");
  await expect(f.preparar({ id: randomUUID(), pastaAutorizada: sub, modo: "worktree" })).rejects.toThrow();
});

it("recusa identificador que escaparia da raiz privada", async () => {
  const f = await fixture(false);
  await expect(f.preparar({ id: "../fora", pastaAutorizada: f.origem, modo: "auto" })).rejects.toThrow();
});

it("Git recém-inicializado sem commit continua utilizável em modo direto", async () => {
  const f = await fixture(false);
  await f.git("init", "-b", "main");
  const w = await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "auto" });
  expect(w).toMatchObject({ modo: "direto", git: { commitInicial: null } });
  await f.git("-c", "user.name=Teste", "-c", "user.email=teste@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "primeiro");
  expect(await f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "auto" })).toEqual(w);
});

it("referência inexistente não impede repetir o id com uma referência válida", async () => {
  const f = await fixture();
  const pedido = { id: f.id, pastaAutorizada: f.origem, modo: "worktree" as const };
  await expect(f.preparar({ ...pedido, referencia: "inexistente" })).rejects.toThrow();
  expect((await f.preparar({ ...pedido, referencia: "main" })).modo).toBe("worktree");
});

it("não segue links não versionados ao transferir arquivos", async () => {
  const f = await fixture();
  await symlink(join(f.origem, "arquivo.txt"), join(f.origem, "link.txt"));
  await expect(f.preparar({ id: f.id, pastaAutorizada: f.origem, modo: "auto" })).rejects.toThrow();
  expect(await readFile(join(f.origem, "arquivo.txt"), "utf8")).toBe("original\n");
});
