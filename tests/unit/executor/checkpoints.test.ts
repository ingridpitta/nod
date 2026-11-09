import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETEM_NA_MAQUINA, abrirCheckpoint, binarioDoGit, aplicarRetencao, desfazerTurno, esquecerCoordenacao, guardarOriginal, modoAoVoltar, retencaoTerminou, sombraDoBot } from "../../../src/adapters/executor/checkpoints.ts";
import { MAX_BYTES_NO_CHECKPOINT, RETEM_CHECKPOINTS } from "../../../src/domain/checkpoints.ts";

// NOD-54 (ADR-134): git de verdade em pasta temporária (vários processos por teste). Medido em ~9 s o arquivo inteiro
// nesta máquina; o teto folgado é para a CI dividida com outros jobs.
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();
const hash = async (f: string) => createHash("sha256").update(await readFile(f)).digest("hex");

let home: string;
let task: string;
const PASTA = "Leo/nod-54-tarefa-abc123";

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-ck-")));
  task = join(home, "nod", PASTA);
  await mkdir(task, { recursive: true });
  git(task, "init", "-q", "-b", "main");
  for (const n of ["a.ts", "b.ts", "c.ts"]) await writeFile(join(task, n), `linha 1 de ${n}\nlinha 2\nlinha 3\nlinha 4\nlinha 5\n`);
  git(task, "add", ".");
  git(task, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await retencaoTerminou();
  esquecerCoordenacao();
  await rm(home, { recursive: true, force: true });
});

/** O estado do `.git` da pessoa: HEAD, index e todas as refs. */
const estadoDoGit = async (pasta: string) => ({ head: git(pasta, "rev-parse", "HEAD"), refs: git(pasta, "for-each-ref"), index: await hash(join(pasta, ".git", "index")), status: git(pasta, "status", "--porcelain") });

describe("checkpoint do turno (NOD-54)", () => {
  it("edita 3 e cria 1: desfazer devolve os 3 com o mesmo hash e apaga o criado; o .git da pessoa fica igual", async () => {
    const hashes = { a: await hash(join(task, "a.ts")), b: await hash(join(task, "b.ts")), c: await hash(join(task, "c.ts")) };
    const gitAntes = await estadoDoGit(task);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    expect(ck).not.toBeNull();
    for (const n of ["a.ts", "b.ts", "c.ts"]) await writeFile(join(task, n), "mudou\n");
    await writeFile(join(task, "novo.md"), "novo\n");
    const resumo = await ck!.fechar();
    expect(resumo).toEqual({ total: 4, arquivos: [
      { caminho: `~/nod/${PASTA}/a.ts`, acao: "mudado" }, { caminho: `~/nod/${PASTA}/b.ts`, acao: "mudado" },
      { caminho: `~/nod/${PASTA}/c.ts`, acao: "mudado" }, { caminho: `~/nod/${PASTA}/novo.md`, acao: "criado" },
    ] });
    const gitMeio = git(task, "rev-parse", "HEAD") + git(task, "for-each-ref");
    const progresso: number[] = [];
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [], aoProgresso: (f) => { progresso.push(f); } });
    expect(r).not.toBe("sem_checkpoint");
    expect(typeof r !== "string" && r.arquivos.every((x) => x.desfecho === "voltou")).toBe(true);
    expect(progresso).toEqual([1, 2, 3, 4]);
    expect({ a: await hash(join(task, "a.ts")), b: await hash(join(task, "b.ts")), c: await hash(join(task, "c.ts")) }).toEqual(hashes);
    expect(existsSync(join(task, "novo.md"))).toBe(false);
    expect(gitMeio).toBe(gitAntes.head + gitAntes.refs);
    expect(await estadoDoGit(task)).toEqual(gitAntes);
  });

  it("desfazer de novo (caiu no meio e voltou) é idempotente", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }] });
    expect(await readFile(join(task, "a.ts"), "utf8")).toContain("linha 1 de a.ts");
  });

  it("tentar de novo (o fim se perdeu): o que já voltou e a pessoa mexeu depois não volta outra vez (revisão 16, M1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await unlink(join(task, "a.ts"));
    await writeFile(join(task, "b.ts"), "mudou\n");
    await ck!.fechar();
    await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(existsSync(join(task, "a.ts"))).toBe(true);
    // A pessoa vê o a.ts de volta e o apaga de novo; o b.ts ela volta para o que o turno deixou.
    await unlink(join(task, "a.ts"));
    await writeFile(join(task, "b.ts"), "mudou\n");
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }, { caminho: `~/nod/${PASTA}/b.ts`, desfecho: "voltou" }] });
    expect(existsSync(join(task, "a.ts"))).toBe(false);
    expect(await readFile(join(task, "b.ts"), "utf8")).toBe("mudou\n");
  });

  it("o conflito da passada anterior é decidido de novo na nova tentativa (só o que voltou fica no diário)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "do turno\n");
    await ck!.fechar();
    await writeFile(join(task, "a.ts"), "da pessoa\n");
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "conflito" }] });
    await writeFile(join(task, "a.ts"), "do turno\n");
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }] });
    expect(await readFile(join(task, "a.ts"), "utf8")).toContain("linha 1 de a.ts");
  });

  it("a pessoa apagou a sombra: o cache velho não derruba os turnos seguintes (revisão 17, B1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    await retencaoTerminou();
    // O primeiro gc já apaga o cache; o segundo turno o regrava (o gc só volta em 24 h).
    const ck2 = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2" });
    await writeFile(join(task, "c.ts"), "mudou\n");
    await ck2!.fechar();
    await retencaoTerminou();
    await rm(sombraDoBot(home, PASTA).repo, { recursive: true, force: true });
    const ck3 = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t3" });
    await writeFile(join(task, "b.ts"), "mudou\n");
    expect((await ck3!.fechar())?.arquivos).toEqual([{ caminho: `~/nod/${PASTA}/b.ts`, acao: "mudado" }]);
  });

  it("turno sem mudança: sem checkpoint (o item não aparece)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    expect(await ck!.fechar()).toBeNull();
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toBe("sem_checkpoint");
  });

  it("o arquivo que era grande e ficou pequeno no turno não é apagado pelo desfazer (codex, P1)", async () => {
    await writeFile(join(task, "grande.bin"), "");
    await truncate(join(task, "grande.bin"), MAX_BYTES_NO_CHECKPOINT + 1);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "grande.bin"), "pequeno\n");
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect((await ck.fechar())?.arquivos.map((a) => a.caminho)).toEqual([`~/nod/${PASTA}/a.ts`]);
    await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(await readFile(join(task, "grande.bin"), "utf8")).toBe("pequeno\n");
  });

  it("node_modules, .git e arquivo acima de 20 MB ficam fora; o grande que muda não vira apagado", async () => {
    await mkdir(join(task, "node_modules", "x"), { recursive: true });
    await writeFile(join(task, "grande.bin"), "");
    await truncate(join(task, "grande.bin"), MAX_BYTES_NO_CHECKPOINT + 1);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "node_modules", "x", "i.js"), "x");
    await truncate(join(task, "grande.bin"), MAX_BYTES_NO_CHECKPOINT + 2);
    await writeFile(join(task, "a.ts"), "mudou\n");
    const resumo = await ck!.fechar();
    expect(resumo?.arquivos.map((a) => a.caminho)).toEqual([`~/nod/${PASTA}/a.ts`]);
    const sombra = sombraDoBot(home, PASTA).repo;
    const arvore = git(home, `--git-dir=${sombra}`, "ls-tree", "-r", "--name-only", "refs/nod/turnos/t1/depois");
    expect(arvore).not.toMatch(/node_modules|grande\.bin|\.git\//);
  });

  it("mudou depois nas mesmas linhas: não sobrescreve e volta como conflito; forçar volta", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "do turno\n");
    await ck!.fechar();
    await writeFile(join(task, "a.ts"), "de outro turno depois\n");
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "conflito" }] });
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe("de outro turno depois\n");
    const forcado = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [`~/nod/${PASTA}/a.ts`] });
    expect(forcado).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }] });
    expect(await readFile(join(task, "a.ts"), "utf8")).toContain("linha 1 de a.ts");
  });

  it("\"Voltar mesmo assim\" mexe só no conflito: o apagado que a pessoa tirou de novo não volta (revisão 11, M2)", async () => {
    await writeFile(join(task, "velho.txt"), "velho\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await unlink(join(task, "velho.txt"));
    await writeFile(join(task, "a.ts"), "do turno\n");
    await ck.fechar();
    await writeFile(join(task, "a.ts"), "de outro turno depois\n");
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "conflito" }, { caminho: `~/nod/${PASTA}/velho.txt`, desfecho: "voltou" }] });
    await unlink(join(task, "velho.txt"));
    const forcado = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [`~/nod/${PASTA}/a.ts`] });
    expect(forcado).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }] });
    await expect(readFile(join(task, "velho.txt"), "utf8")).rejects.toThrow();
  });

  it("credencial num caminho com acento (~/nod/Léo/certs/server.key) não entra na sombra (revisão 11, M3)", async () => {
    const leo = join(home, "nod", "Léo");
    await mkdir(join(leo, "certs"), { recursive: true });
    const ck = await abrirCheckpoint({ home, pastaDoBot: "Léo", turnoId: "l1", prazoMs: 30_000 });
    await writeFile(join(leo, "certs", "server.key"), "segredo-do-leo\n");
    await writeFile(join(leo, "a.md"), "oi\n");
    await ck.fechar();
    const objetos = execFileSync("git", ["--git-dir", sombraDoBot(home, "Léo").repo, "cat-file", "--batch-all-objects", "--batch"], { encoding: "utf8" });
    expect(objetos).not.toContain("segredo-do-leo");
  });

  it("o Icon\\r do macOS na pasta não derruba a foto do turno; ele fica fora (revisão 14, M1)", async () => {
    await mkdir(join(task, "assets"), { recursive: true });
    await writeFile(join(task, "assets", "Icon\r"), "");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    expect(ck.comFoto).toBe(true);
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect((await ck.fechar())?.arquivos).toEqual([{ caminho: `~/nod/${PASTA}/a.ts`, acao: "mudado" }]);
  });

  it("primeiro turno de um bot sem pasta: a foto do antes é vazia e o desfazer apaga o que ele criou (revisão 15, M1)", async () => {
    const novo = join(home, "nod", "Novo");
    const ck = await abrirCheckpoint({ home, pastaDoBot: "Novo", turnoId: "t1", prazoMs: 30_000 });
    expect(ck.comFoto).toBe(true);
    await mkdir(join(novo, "src"), { recursive: true });
    await writeFile(join(novo, "package.json"), "{}\n");
    await writeFile(join(novo, "src", "index.ts"), "x\n");
    expect((await ck.fechar())?.arquivos).toEqual([
      { caminho: "~/nod/Novo/package.json", acao: "criado" }, { caminho: "~/nod/Novo/src/index.ts", acao: "criado" },
    ]);
    const r = await desfazerTurno({ home, pastaDoBot: "Novo", turnoId: "t1", forcar: [] });
    expect(typeof r !== "string" && r.arquivos.every((x) => x.desfecho === "voltou")).toBe(true);
    expect(existsSync(join(novo, "package.json")) || existsSync(join(novo, "src", "index.ts"))).toBe(false);
  });

  it("pasta ilegível na foto do antes (EACCES): o turno fica sem checkpoint, e os arquivos dela não viram criados (revisão 15, M2)", async () => {
    const docs = join(task, "docs");
    await mkdir(docs);
    await writeFile(join(docs, "da-pessoa.md"), "meu\n");
    await chmod(docs, 0o000);
    try {
      const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
      await chmod(docs, 0o755);
      await writeFile(join(task, "a.ts"), "mudou\n");
      expect(ck.comFoto).toBe(false);
      expect(await ck.fechar()).toBeNull();
    } finally {
      await chmod(docs, 0o755);
    }
    expect(await readFile(join(docs, "da-pessoa.md"), "utf8")).toBe("meu\n");
  });

  it("chave com nome incomum (Léo.key, server (1).KEY) não entra na sombra (revisão 12, M2)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "Léo.key"), "segredo-acento\n");
    await writeFile(join(task, "server (1).KEY"), "segredo-caixa\n");
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck.fechar();
    const objetos = execFileSync("git", ["--git-dir", sombraDoBot(home, PASTA).repo, "cat-file", "--batch-all-objects", "--batch"], { encoding: "utf8" });
    expect(objetos).not.toMatch(/segredo-acento|segredo-caixa/);
  });

  it("pasta fora trocada por link no meio do turno: sem checkpoint e o alvo não entra na sombra (revisão 12, A1)", async () => {
    const docs = join(home, "Docs", "t");
    await mkdir(docs, { recursive: true });
    await mkdir(join(home, "segredo"), { recursive: true });
    await writeFile(join(home, "segredo", "notas.md"), "segredo-de-fora\n");
    await writeFile(join(docs, "notas.md"), "v0\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [join(docs, "notas.md")], avisar: () => undefined });
    await rm(docs, { recursive: true });
    await symlink(join(home, "segredo"), docs);
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect(await ck.fechar()).toBeNull();
    const objetos = execFileSync("git", ["--git-dir", sombraDoBot(home, PASTA).repo, "cat-file", "--batch-all-objects", "--batch"], { encoding: "utf8" });
    expect(objetos).not.toContain("segredo-de-fora");
  });

  it("pasta do turno trocada por link antes do desfazer: erro, sem ler o alvo para a sombra (revisão 12, A1)", async () => {
    await mkdir(join(task, "x"), { recursive: true });
    await writeFile(join(task, "x", "config"), "v0\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "x", "config"), "do turno\n");
    await ck.fechar();
    await mkdir(join(home, "segredo"), { recursive: true });
    await writeFile(join(home, "segredo", "config"), "segredo-do-alvo\n");
    await rm(join(task, "x"), { recursive: true });
    await symlink(join(home, "segredo"), join(task, "x"));
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/x/config`, desfecho: "erro" }] });
    expect(await readFile(join(home, "segredo", "config"), "utf8")).toBe("segredo-do-alvo\n");
    const objetos = execFileSync("git", ["--git-dir", sombraDoBot(home, PASTA).repo, "cat-file", "--batch-all-objects", "--batch"], { encoding: "utf8" });
    expect(objetos).not.toContain("segredo-do-alvo");
  });

  it("mudou depois em outra parte: mescla — sai a parte do turno, fica a do outro", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "linha 1 de a.ts\nTURNO\nlinha 3\nlinha 4\nlinha 5\n");
    await ck!.fechar();
    await writeFile(join(task, "a.ts"), "linha 1 de a.ts\nTURNO\nlinha 3\nlinha 4\nOUTRO\n");
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "mesclado" }] });
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe("linha 1 de a.ts\nlinha 2\nlinha 3\nlinha 4\nOUTRO\n");
  });

  it("credencial não entra na sombra: o turno que grava uma fica sem checkpoint, e a da pasta fica fora da foto (revisão 8, A1)", async () => {
    const aws = join(home, ".aws", "credentials");
    await mkdir(join(home, ".aws"), { recursive: true });
    await writeFile(aws, "segredo-aws\n");
    await writeFile(join(task, ".npmrc"), "segredo-npm\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [aws], avisar: () => undefined });
    await writeFile(aws, "outro\n");
    expect(await ck.fechar()).toBeNull();
    const ck2 = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect((await ck2.fechar())?.arquivos).toEqual([{ caminho: `~/nod/${PASTA}/a.ts`, acao: "mudado" }]);
    const objetos = execFileSync("git", ["--git-dir", sombraDoBot(home, PASTA).repo, "cat-file", "--batch-all-objects", "--batch"], { encoding: "utf8" });
    expect(objetos).not.toContain("segredo");
  });

  it("credencial da pasta que muda no turno: sem checkpoint, em vez de um desfazer que deixaria ela mudada (revisão 9, B)", async () => {
    await writeFile(join(task, "dev.key"), "v0\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await writeFile(join(task, "dev.key"), "v1 maior\n");
    expect(await ck.fechar()).toBeNull();
  });

  it("a guarda da frente que falha (link) ainda tira o checkpoint da raiz que ela atingiu (revisão 9, A)", async () => {
    const raizLeo = join(home, "nod", "Leo");
    await mkdir(join(raizLeo, "docs"), { recursive: true });
    await writeFile(join(raizLeo, "docs", "real.md"), "v0\n");
    await symlink(join(raizLeo, "docs", "real.md"), join(raizLeo, "README.md"));
    const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
    const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "f1", caminhos: [join(raizLeo, "README.md")], avisar: () => undefined });
    await writeFile(join(raizLeo, "docs", "real.md"), "da frente\n");
    await writeFile(join(raizLeo, "dono.md"), "do dono\n");
    expect(await frente.fechar()).toBeNull();
    expect(await raiz.fechar()).toBeNull();
  });

  it("credencial que é pasta (.aws/credentials reescrito no turno): sem checkpoint (revisão 10, M1)", async () => {
    await mkdir(join(task, ".aws"), { recursive: true });
    await writeFile(join(task, ".aws", "credentials"), "v0\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await writeFile(join(task, ".aws", "credentials"), "v1 maior\n");
    expect(await ck.fechar()).toBeNull();
  });

  it("link numa pasta acima do arquivo (~/atalho -> ~/nod/Leo/docs) não escapa do cruzamento (revisão 10, M2)", async () => {
    const raizLeo = join(home, "nod", "Leo");
    await mkdir(join(raizLeo, "docs"), { recursive: true });
    await writeFile(join(raizLeo, "docs", "real.md"), "v0\n");
    await symlink(join(raizLeo, "docs"), join(home, "atalho"));
    const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
    const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "f1", caminhos: [join(home, "atalho", "real.md")], avisar: () => undefined });
    await writeFile(join(home, "atalho", "real.md"), "da frente\n");
    await writeFile(join(raizLeo, "dono.md"), "do dono\n");
    expect(await frente.fechar()).toBeNull();
    expect(await raiz.fechar()).toBeNull();
  });

  it("arquivo fora da pasta gravado por nativa (~/Documents/x.md) é desfeito pelo original que o hook guardou", async () => {
    const doc = join(home, "Documents", "x.md");
    await mkdir(join(home, "Documents"), { recursive: true });
    await writeFile(doc, "original\n");
    const novo = join(home, "Documents", "novo.md");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [doc] });
    await writeFile(doc, "editado pelo bot\n");
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [doc, novo] });
    await writeFile(doc, "editado de novo\n");
    await writeFile(novo, "criado\n");
    const resumo = await ck!.fechar();
    expect(resumo?.arquivos).toEqual([{ caminho: "~/Documents/novo.md", acao: "criado" }, { caminho: "~/Documents/x.md", acao: "mudado" }]);
    await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(await readFile(doc, "utf8")).toBe("original\n");
    expect(existsSync(novo)).toBe(false);
  });

  it("hook que falhou marca o turno incompleto: sem checkpoint", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    const s = sombraDoBot(home, PASTA);
    await writeFile(join(s.fora, "t1.jsonl"), `${JSON.stringify({ incompleto: true })}\n`);
    expect(await ck!.fechar()).toBeNull();
  });

  it("gravação fora da casa (/etc, caminho relativo): o desfazer não cobriria — o turno fica sem checkpoint", async () => {
    for (const caminho of ["/etc/hosts-nod-teste", "relativo/x.md"]) {
      const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
      await writeFile(join(task, "a.ts"), `mudou ${caminho}\n`);
      await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [caminho] });
      expect(await ck!.fechar(), caminho).toBeNull();
    }
  });

  it("foto acima do prazo: sem foto, e o turno segue sem checkpoint", async () => {
    for (let i = 0; i < 300; i++) await writeFile(join(task, `f${i}.txt`), `${i}`);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 1 });
    expect(ck.comFoto).toBe(false);
    expect(await ck.fechar()).toBeNull();
  });

  it("turno sem foto segura a pasta até fechar: o desfazer de outro turno não roda por cima (revisão 2, A2)", async () => {
    // Prazo folgado: sob carga os 5 s padrão estouravam e o t1 saía sem checkpoint (QA, bug 7).
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck.fechar();
    const semFoto = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2", soRegistro: true });
    expect(semFoto.comFoto).toBe(false);
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toBe("ocupado");
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe("mudou\n");
    expect(await semFoto.fechar()).toBeNull();
    expect(typeof (await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] }))).toBe("object");
  });

  it("turno aberto numa frente segura o desfazer que chega com a raiz do bot (revisão 3, A1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck.fechar();
    const aberto = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2", prazoMs: 30_000 });
    expect(await desfazerTurno({ home, pastaDoBot: "Leo", turnoId: "t1", forcar: [] })).toBe("ocupado");
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe("mudou\n");
    await aberto.fechar();
    expect(typeof (await desfazerTurno({ home, pastaDoBot: "Leo", turnoId: "t1", forcar: [] }))).toBe("object");
  });

  for (const ordem of ["a frente fecha antes", "a raiz fecha antes"] as const) {
    it(`frente que grava na raiz do bot com um turno da raiz aberto: os dois ficam sem checkpoint (revisão 4, M1; revisão 6, M1; ${ordem})`, async () => {
      const notas = join(home, "nod", "Leo", "notas.md");
      await writeFile(notas, "v0\n");
      const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
      const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
      await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "f1", caminhos: [notas], avisar: () => undefined });
      await writeFile(notas, "v0\nda raiz\n");
      await writeFile(notas, "v0\nda raiz\nda frente\n");
      await writeFile(join(home, "nod", "Leo", "dono.md"), "do dono\n");
      await writeFile(join(task, "a.ts"), "da frente\n");
      const [primeiro, segundo] = ordem === "a frente fecha antes" ? [frente, raiz] : [raiz, frente];
      const resumos = [await primeiro.fechar(), await segundo.fechar()];
      const [daFrente, daRaiz] = ordem === "a frente fecha antes" ? resumos : [resumos[1], resumos[0]];
      // A frente desfeita voltaria notas.md a v0 inteiro, levando a linha da raiz junto.
      expect(daRaiz).toBeNull();
      expect(daFrente).toBeNull();
    });
  }

  it("turno da raiz que grava dentro da frente aberta: os dois ficam sem checkpoint (revisão 5, M1; revisão 6, M1)", async () => {
    const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
    const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: "Leo", turnoId: "r1", caminhos: [join(task, "a.ts")], avisar: () => undefined });
    await writeFile(join(task, "a.ts"), "da raiz\n");
    expect(await frente.fechar()).toBeNull();
    expect(await raiz.fechar()).toBeNull();
  });

  it("o cruzamento compara sem distinguir maiúsculas (revisão 7, M2)", async () => {
    const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
    const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "f1", caminhos: [join(home, "nod", "LEO", "notas.md")], avisar: () => undefined });
    await writeFile(join(task, "a.ts"), "da frente\n");
    expect(await frente.fechar()).toBeNull();
    expect(await raiz.fechar()).toBeNull();
  });

  it("frente e raiz juntas sem se tocar: as duas guardam checkpoint", async () => {
    const raiz = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "r1", prazoMs: 30_000 });
    const frente = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "f1", prazoMs: 30_000 });
    await writeFile(join(home, "nod", "Leo", "dono.md"), "do dono\n");
    await writeFile(join(task, "a.ts"), "da frente\n");
    expect((await frente.fechar())?.arquivos).toEqual([{ caminho: `~/nod/${PASTA}/a.ts`, acao: "mudado" }]);
    expect((await raiz.fechar())?.arquivos).toEqual([{ caminho: "~/nod/Leo/dono.md", acao: "criado" }]);
  });

  it("turno da sala: sem foto, mas o desfazer do bot espera por ele (revisão 4, M3)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck.fechar();
    const sala = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "s1", soRegistro: true });
    expect(sala.comFoto).toBe(false);
    expect(await desfazerTurno({ home, pastaDoBot: "Leo", turnoId: "t1", forcar: [] })).toBe("ocupado");
    expect(await sala.fechar()).toBeNull();
    expect(typeof (await desfazerTurno({ home, pastaDoBot: "Leo", turnoId: "t1", forcar: [] }))).toBe("object");
  });

  it("~/nod num link para outro disco: o desfazer volta os arquivos (revisão 4, M2)", async () => {
    await rename(join(home, "nod"), join(home, "disco"));
    await symlink(join(home, "disco"), join(home, "nod"));
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    const original = await readFile(join(task, "a.ts"), "utf8");
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect(await ck.fechar()).not.toBeNull();
    const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect(typeof r !== "string" && r.arquivos.map((a) => a.desfecho)).toEqual(["voltou"]);
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe(original);
  });

  it("o turno que leu o cache antes do gc não o regrava (revisão 3, M1)", async () => {
    const s = sombraDoBot(home, PASTA);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    expect(existsSync(s.cache)).toBe(true);
    // Outro turno rodou o gc no meio: a marca anda e o cache some.
    await rm(s.cache, { force: true });
    await writeFile(s.gc, "");
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect(await ck.fechar()).not.toBeNull();
    expect(existsSync(s.cache)).toBe(false);
  });

  it("gravar por um link fora da pasta deixa o turno sem checkpoint, em vez de dizer que voltou (QA, bug 1)", async () => {
    await writeFile(join(home, "real.md"), "original\n");
    await symlink(join(home, "real.md"), join(home, "link.md"));
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1", prazoMs: 30_000 });
    await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: [join(home, "link.md")], avisar: () => undefined });
    await writeFile(join(home, "link.md"), "bot mudou\n");
    await writeFile(join(task, "a.ts"), "mudou\n");
    expect(await ck.fechar()).toBeNull();
  });

  it("na raiz do bot (conversa principal), as pastas de frente ficam fora", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: "Leo", turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "frente mudou\n");
    await writeFile(join(home, "nod", "Leo", "nota.md"), "dono\n");
    const resumo = await ck!.fechar();
    expect(resumo?.arquivos).toEqual([{ caminho: "~/nod/Leo/nota.md", acao: "criado" }]);
  });

  it("a máquina guarda o dobro do servidor: o 41º checkpoint com mudança apaga o mais antigo do bot (revisão 4, M4)", async () => {
    expect(RETEM_NA_MAQUINA).toBe(2 * RETEM_CHECKPOINTS);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t01", agora: () => Date.now() });
    await writeFile(join(task, "a.ts"), "versao 1\n");
    expect(await ck.fechar()).not.toBeNull();
    const s = sombraDoBot(home, PASTA);
    await retencaoTerminou();
    // Os outros 40 apontam a mesma foto (rodar 41 turnos de verdade custa ~15 s); o que conta é o número de refs.
    for (let i = 2; i <= RETEM_NA_MAQUINA + 1; i++) {
      for (const lado of ["antes", "depois"]) git(home, `--git-dir=${s.repo}`, "update-ref", `refs/nod/turnos/t${String(i).padStart(2, "0")}/${lado}`, `refs/nod/turnos/t01/${lado}`);
    }
    // Os commits de um mesmo segundo empatam na data: a retenção desempata pelo id, e o mais antigo (t01) sai.
    await aplicarRetencao(s, Date.now());
    const refs = git(home, `--git-dir=${s.repo}`, "for-each-ref", "--format=%(refname)", "refs/nod/turnos/").split("\n").filter(Boolean);
    expect(refs.filter((r) => r.endsWith("/depois"))).toHaveLength(RETEM_NA_MAQUINA);
    expect(refs.some((r) => r.includes("/t01/"))).toBe(false);
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t01", forcar: [] })).toBe("sem_checkpoint");
  });
  it("desfazer com um turno aberto na mesma pasta: ocupado, sem mexer em nada; fechado o turno, desfaz (revisão A1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    const aberto = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2" });
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toBe("ocupado");
    expect(await readFile(join(task, "a.ts"), "utf8")).toBe("mudou\n");
    expect(await aberto!.fechar()).toBeNull();
    expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/a.ts`, desfecho: "voltou" }] });
  });

  it("turno que abre durante um desfazer espera ele acabar; estourou a espera, fica sem foto mas registrado (revisão A1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    const desfazendo = desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    const t2 = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2", esperaMs: 0 });
    expect(t2.comFoto).toBe(false);
    await t2.fechar();
    const depois = abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t3" });
    expect(typeof (await desfazendo)).toBe("object");
    const t3 = await depois;
    expect(t3).not.toBeNull();
    await writeFile(join(task, "b.ts"), "do t3\n");
    expect((await t3!.fechar())?.arquivos).toEqual([{ caminho: `~/nod/${PASTA}/b.ts`, acao: "mudado" }]);
  });

  it("dois turnos ao mesmo tempo na mesma pasta: os dois ficam sem checkpoint (revisão A2)", async () => {
    const um = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    const outro = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2" });
    await writeFile(join(task, "a.ts"), "do t1\n");
    await writeFile(join(task, "b.ts"), "do t2\n");
    expect(await um!.fechar()).toBeNull();
    expect(await outro!.fechar()).toBeNull();
    const depois = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t3" });
    await writeFile(join(task, "c.ts"), "do t3\n");
    expect(await depois!.fechar()).not.toBeNull();
  });

  it("a sombra nasce só para a dona (0700) e um link no lugar dela é recusado (revisão M2 / codex P1)", async () => {
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    await retencaoTerminou();
    const s = sombraDoBot(home, PASTA);
    expect((await stat(join(home, "nod", ".checkpoints"))).mode & 0o777).toBe(0o700);
    expect((await stat(s.repo)).mode & 0o777).toBe(0o700);
    const alheio = await mkdtemp(join(tmpdir(), "nod-ck-alheio-"));
    try {
      await rm(join(home, "nod", ".checkpoints"), { recursive: true, force: true });
      await symlink(alheio, join(home, "nod", ".checkpoints"));
      const t2 = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t2" });
      expect(t2.comFoto).toBe(false);
      await t2.fechar();
      expect(await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] })).toBe("sem_checkpoint");
      expect(execFileSync("ls", ["-A", alheio]).toString()).toBe("");
    } finally {
      await rm(alheio, { recursive: true, force: true });
    }
  });

  it("uma pasta do caminho trocada por um link depois do turno: o desfazer não grava fora (erro) (revisão M4 / codex P1)", async () => {
    await mkdir(join(task, "sub"));
    await writeFile(join(task, "sub", "x.md"), "antes\n");
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "sub", "x.md"), "depois\n");
    await ck!.fechar();
    const alheio = await mkdtemp(join(tmpdir(), "nod-ck-alheio-"));
    try {
      await writeFile(join(alheio, "x.md"), "depois\n");
      await rename(join(task, "sub"), join(task, "sub-velha"));
      await symlink(alheio, join(task, "sub"));
      const r = await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
      expect(r).toEqual({ arquivos: [{ caminho: `~/nod/${PASTA}/sub/x.md`, desfecho: "erro" }] });
      expect(await readFile(join(alheio, "x.md"), "utf8")).toBe("depois\n");
    } finally {
      await rm(alheio, { recursive: true, force: true });
    }
  });

  it("o arquivo volta com o modo que tinha (0600 fica 0600) (revisão M3)", async () => {
    await chmod(join(task, "a.ts"), 0o600);
    const ck = await abrirCheckpoint({ home, pastaDoBot: PASTA, turnoId: "t1" });
    await writeFile(join(task, "a.ts"), "mudou\n");
    await ck!.fechar();
    await desfazerTurno({ home, pastaDoBot: PASTA, turnoId: "t1", forcar: [] });
    expect((await stat(join(task, "a.ts"))).mode & 0o777).toBe(0o600);
    expect(modoAoVoltar(0o100640, "100755")).toBe(0o750);
    expect(modoAoVoltar(0o100755, "100644")).toBe(0o644);
    expect(modoAoVoltar(null, "100755")).toBe(0o755);
  });

  it("a guarda que falha no hook avisa pelo `avisar`, nunca pelo stdout (o canal da decisão) (revisão B1)", async () => {
    const escrito = vi.spyOn(process.stdout, "write");
    const avisos: string[] = [];
    try {
      await guardarOriginal({ home, pastaDoBot: PASTA, turnoId: "t1", caminhos: ["/etc/hosts"], avisar: (e) => avisos.push(e) });
    } finally {
      escrito.mockRestore();
    }
    expect(avisos).toEqual(["checkpoint_guarda_saiu"]);
    expect(escrito).not.toHaveBeenCalled();
  });
});

describe("git sombra no Windows (ADA-11, ADR-147, revisão do PR #642 M3)", () => {
  const disco = (arquivos: string[]) => ({ existe: (p: string) => arquivos.some((a) => a.toLowerCase() === p.toLowerCase()), ler: () => "" });
  it("roda pelo git.exe absoluto do PATH, nunca o da pasta atual; fora do Windows segue `git`", () => {
    const env = { Path: "C:\\Program Files\\Git\\cmd", PATHEXT: ".EXE" };
    expect(binarioDoGit({ plataforma: "win32", env, disco: disco(["C:\\Program Files\\Git\\cmd\\git.exe", ".\\git.exe", "git.exe"]) })).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(binarioDoGit({ plataforma: "linux" })).toBe("git");
    expect(binarioDoGit({ plataforma: "win32", env, disco: disco([]) })).toBe("git");
  });
  it("revisão 7 do PR #642 (médio 11): um git.ps1 antes no PATH não vira o git dos checkpoints", () => {
    const env = { Path: "C:\\Users\\Bia\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd", PATHEXT: ".EXE;.CMD" };
    expect(binarioDoGit({ plataforma: "win32", env, disco: disco(["C:\\Users\\Bia\\AppData\\Roaming\\npm\\git.ps1", "C:\\Program Files\\Git\\cmd\\git.exe"]) })).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
  });
});
