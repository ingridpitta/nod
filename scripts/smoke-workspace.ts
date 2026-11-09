import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { criarPastas } from "../src/adapters/workspace/pastas.ts";
const exec = promisify(execFile);
const raiz = await mkdtemp(join(tmpdir(), "nod-workspace-smoke-"));
const pasta = join(raiz, "projeto");
const i = { tenantId: randomUUID(), pessoaId: randomUUID(), conversaId: randomUUID() };
const p = criarPastas(join(raiz, "privado"), process.env.NOD_COMPUTADOR_IMAGEM);
try {
  await mkdir(pasta);
  const git = (...args: string[]) => exec("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: pasta });
  await git("init", "-b", "main");
  await writeFile(join(pasta, "calculo.mjs"), "export const somar = (a,b) => a+b;\n");
  await git("add", ".");
  await git("-c", "user.name=Teste", "-c", "user.email=teste@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "inicial");
  await p.escolher(i, pasta);
  const w = await p.preparar(i, { modo: "auto" });
  assert.equal(w.modo, "worktree");
  await p.executar(i, "workspace_gravar_texto", { caminho: "teste.mjs", texto: "import assert from 'node:assert/strict'; import {somar} from './calculo.mjs'; assert.equal(somar(2,3),5); console.log('teste aprovado');", revisao: "novo" });
  const r = await p.executar(i, "workspace_terminal", { comando: "node teste.mjs && git status --short" });
  assert.ok("codigoSaida" in r); assert.equal(r.codigoSaida, 0, JSON.stringify(r)); assert.match(r.saida, /teste aprovado/);
  await assert.rejects(readFile(join(pasta, "teste.mjs")));
  const controle = new AbortController();
  const cancelado = p.executar(i, "workspace_terminal", { comando: "sleep 50" }, controle.signal);
  const timer = setTimeout(() => controle.abort(), 1500);
  const fim = await cancelado; clearTimeout(timer);
  assert.ok("codigoSaida" in fim); assert.equal(fim.codigoSaida, 124);
  await p.revogar(i);
  assert.equal((await readFile(join(w.caminho, "teste.mjs"), "utf8")).includes("somar"), true);
  process.stdout.write("OK: pasta autorizada, worktree, arquivo real, teste Node, Git, cancelamento e revogação sem apagar trabalho.\n");
} finally {
  await rm(raiz, { recursive: true, force: true });
}
