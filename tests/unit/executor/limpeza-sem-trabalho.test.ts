import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../../src/contracts/ponte.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, limparPastas, type ExecutarComando, type OpcoesLimpeza } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

/**
 * ADR-099 item 9 (definido em 2026-10-12, I5): a pasta da frente que terminou sai na hora só com prova afirmativa de que
 * não há trabalho nela. Repositórios git de verdade (um remoto nu, um clone e worktrees em `~/nod/<bot>/<slug>`).
 */
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
let clone: string;

/** O git de verdade; `falhar` faz um comando git (pelo texto dos argumentos) sair com erro. Docker ausente. */
function executor(falhar?: (args: readonly string[]) => boolean): ExecutarComando {
  const real = criarExecutarComando(ENV_GIT, home, []);
  return async (bin, args, op) => {
    if (bin === "docker") return { codigo: -1, stdout: "", stderr: "" };
    if (bin === "git" && falhar?.(args)) return { codigo: 128, stdout: "", stderr: "fatal: falha de teste" };
    return real(bin, args, op);
  };
}

const opcoes = (o: Partial<OpcoesLimpeza> = {}): OpcoesLimpeza => ({ home, executar: executor(), montagens: async () => [], livre: async () => 100 * 1024 ** 3, ...o });
const semTrabalho = (pasta: string, trabalhoId = "t-1"): PastaParaLimpar => ({ trabalhoId, pasta, quando: "sem_trabalho" });

/** Uma worktree da frente, numa branch nova a partir de origin/main, com node_modules e dist (que se refazem). */
async function worktree(rel: string, branch: string): Promise<string> {
  const destino = join(home, "nod", rel);
  await mkdir(join(destino, ".."), { recursive: true });
  git(clone, "worktree", "add", destino, "-b", branch, "origin/main");
  await mkdir(join(destino, "node_modules", "pacote"), { recursive: true });
  await writeFile(join(destino, "node_modules", "pacote", "index.js"), "x".repeat(10_000));
  await mkdir(join(destino, "dist"), { recursive: true });
  await writeFile(join(destino, "dist", "app.js"), "x");
  return destino;
}

const commit = async (wt: string, arquivo: string) => {
  await writeFile(join(wt, arquivo), "trabalho\n");
  git(wt, "add", arquivo);
  git(wt, "commit", "-q", "-m", arquivo);
};

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-sem-trabalho-")));
  const remoto = join(home, "remoto", "acme.git");
  await mkdir(remoto, { recursive: true });
  git(remoto, "init", "-q", "--bare", "-b", "main");
  clone = join(home, "code", "acme");
  await mkdir(clone, { recursive: true });
  git(clone, "init", "-q", "-b", "main");
  await writeFile(join(clone, ".gitignore"), "node_modules/\ndist/\n.env\n");
  await writeFile(join(clone, "README.md"), "acme\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "inicio");
  git(clone, "remote", "add", "origin", remoto);
  git(clone, "push", "-q", "origin", "main");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const pastaDe = (rel: string) => join(home, "nod", rel);

describe("frente sem trabalho sai na hora (ADR-099, I5)", () => {
  it("limpa e sem commit fora do remoto: a worktree sai, a pasta sai, a branch fica no clone e nada é guardado", async () => {
    const wt = await worktree("Dev 1/frente-a-aaaaaa/acme", "frente/a");
    const r = await limparPastas([semTrabalho("Dev 1/frente-a-aaaaaa")], opcoes());
    expect(r).toMatchObject({ pastas: 1, removidas: 1, pastasApagadas: 1, puladas: {} });
    expect(r.guardadas).toBeUndefined();
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(pastaDe("Dev 1/frente-a-aaaaaa"))).toBe(false);
    expect(existsSync(join(home, "nod", ".guardado"))).toBe(false);
    expect(git(clone, "branch", "--list", "frente/a")).toContain("frente/a");
  });

  it("o commit já enviado ao remoto não segura: o que está num remoto não se perde", async () => {
    const wt = await worktree("Dev 1/frente-b-bbbbbb/acme", "frente/b");
    await commit(wt, "feito.txt");
    git(wt, "push", "-q", "origin", "frente/b");
    const r = await limparPastas([semTrabalho("Dev 1/frente-b-bbbbbb")], opcoes());
    expect(r).toMatchObject({ removidas: 1, pastasApagadas: 1, puladas: {} });
    expect(existsSync(wt)).toBe(false);
  });

  it("commit local não enviado: nada sai, nem guardado (fica para o caminho da ADR-088/096)", async () => {
    const wt = await worktree("Dev 1/frente-c-cccccc/acme", "frente/c");
    await commit(wt, "local.txt");
    const r = await limparPastas([semTrabalho("Dev 1/frente-c-cccccc")], opcoes());
    expect(r).toMatchObject({ pastas: 1, removidas: 0, pastasApagadas: 0, puladas: { sem_prova: 1 } });
    expect(r.guardadas).toBeUndefined();
    expect(existsSync(join(wt, "local.txt"))).toBe(true);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
    expect(existsSync(join(home, "nod", ".guardado"))).toBe(false);
  });

  it("arquivo novo não ignorado, arquivo rastreado alterado ou ignorado que não se refaz (.env): nada sai", async () => {
    const nova = await worktree("Dev 1/frente-d-dddddd/acme", "frente/d");
    await writeFile(join(nova, "rascunho.txt"), "não commitado\n");
    const alterada = await worktree("Dev 1/frente-e-eeeeee/acme", "frente/e");
    await writeFile(join(alterada, "README.md"), "mudou\n");
    const comEnv = await worktree("Dev 1/frente-f-ffffff/acme", "frente/f");
    await writeFile(join(comEnv, ".env"), "SEGREDO=1\n");
    const r = await limparPastas([semTrabalho("Dev 1/frente-d-dddddd", "d"), semTrabalho("Dev 1/frente-e-eeeeee", "e"), semTrabalho("Dev 1/frente-f-ffffff", "f")], opcoes());
    expect(r).toMatchObject({ pastas: 3, removidas: 0, pastasApagadas: 0, puladas: { sem_prova: 3 } });
    expect(existsSync(join(nova, "rascunho.txt"))).toBe(true);
    expect(existsSync(join(alterada, "README.md"))).toBe(true);
    expect(existsSync(join(comEnv, ".env"))).toBe(true);
  });

  it("erro de git (no rev-list ou no status) não é prova: nada sai", async () => {
    await worktree("Dev 1/frente-g-gggggg/acme", "frente/g");
    const semRevList = await limparPastas([semTrabalho("Dev 1/frente-g-gggggg")], opcoes({ executar: executor((a) => a.includes("rev-list") && a.includes("--remotes") && !a.includes("--branches")) }));
    expect(semRevList).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { sem_prova: 1 } });
    const semStatus = await limparPastas([semTrabalho("Dev 1/frente-g-gggggg")], opcoes({ executar: executor((a) => a.includes("status")) }));
    expect(semStatus).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(pastaDe("Dev 1/frente-g-gggggg/acme/node_modules"))).toBe(true);
  });

  it("repositório sem remoto nenhum: nada está num remoto, nada sai", async () => {
    git(clone, "remote", "remove", "origin");
    const destino = pastaDe("Dev 1/frente-h-hhhhhh/acme");
    await mkdir(join(destino, ".."), { recursive: true });
    git(clone, "worktree", "add", destino, "-b", "frente/h", "main");
    const r = await limparPastas([semTrabalho("Dev 1/frente-h-hhhhhh")], opcoes());
    expect(r).toMatchObject({ removidas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(destino)).toBe(true);
  });

  it("algo na pasta além das worktrees (arquivo solto ou um clone): nada sai, nem a worktree limpa", async () => {
    const wt = await worktree("Dev 1/frente-i-iiiiii/acme", "frente/i");
    await writeFile(pastaDe("Dev 1/frente-i-iiiiii/notas.md"), "anotação\n");
    const wt2 = await worktree("Dev 1/frente-j-jjjjjj/acme", "frente/j");
    const outroClone = pastaDe("Dev 1/frente-j-jjjjjj/outro");
    await mkdir(outroClone, { recursive: true });
    git(outroClone, "init", "-q", "-b", "main");
    const r = await limparPastas([semTrabalho("Dev 1/frente-i-iiiiii", "i"), semTrabalho("Dev 1/frente-j-jjjjjj", "j")], opcoes());
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { sem_prova: 2 } });
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(wt2)).toBe(true);
  });

  it("tudo ou nada: com uma worktree com trabalho, a outra worktree limpa da mesma pasta também fica", async () => {
    const limpa = await worktree("Dev 1/frente-k-kkkkkk/acme", "frente/k1");
    const comTrabalho = await worktree("Dev 1/frente-k-kkkkkk/acme-2", "frente/k2");
    await commit(comTrabalho, "local.txt");
    const r = await limparPastas([semTrabalho("Dev 1/frente-k-kkkkkk")], opcoes());
    expect(r).toMatchObject({ removidas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(limpa)).toBe(true);
  });

  it("pasta em uso por um turno deste Mac, ou o servidor não reconfirma: nada sai", async () => {
    const wt = await worktree("Dev 1/frente-l-llllll/acme", "frente/l");
    expect(await limparPastas([semTrabalho("Dev 1/frente-l-llllll")], opcoes({ emUso: (p) => p === "Dev 1/frente-l-llllll" }))).toMatchObject({ removidas: 0, puladas: { em_uso: 1 } });
    expect(await limparPastas([semTrabalho("Dev 1/frente-l-llllll")], opcoes({ reconfirmar: async () => false }))).toMatchObject({ removidas: 0, puladas: { nao_reconfirmada: 1 } });
    expect(existsSync(wt)).toBe(true);
  });

  it("simulação: conta o que sairia e não apaga", async () => {
    const wt = await worktree("Dev 1/frente-m-mmmmmm/acme", "frente/m");
    const r = await limparPastas([semTrabalho("Dev 1/frente-m-mmmmmm")], opcoes({ simular: true }));
    expect(r).toMatchObject({ simulada: true, removidas: 1, puladas: {} });
    expect(existsSync(wt)).toBe(true);
  });
});

describe("limparAgora: a passada só da frente que acabou de terminar (ADR-099, I5)", () => {
  function iniciar(oferecidas: PastaParaLimpar[]) {
    const relatos: RelatoLimpeza[] = [];
    const ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza"> = {
      pastasParaLimpar: async () => oferecidas,
      relatarLimpeza: async (_p, r) => { relatos.push(r); },
    };
    const limpeza = iniciarLimpezaDasTasks({ ...opcoes(), ponte, pessoaId: "p", primeiraMs: 3_600_000, vigiaDoDiscoMs: 3_600_000 });
    return { limpeza, relatos };
  }

  it("limpa só a `sem_trabalho` mandada, reconfirma com o servidor e relata marcada como imediata", async () => {
    const wt = await worktree("Dev 1/frente-n-nnnnnn/acme", "frente/n");
    const encerrada = await worktree("Dev 1/task-o-oooooo/acme", "task/o");
    const pasta = semTrabalho("Dev 1/frente-n-nnnnnn");
    const { limpeza, relatos } = iniciar([pasta]);
    try {
      const r = await limpeza.limparAgora([pasta, { trabalhoId: "o", pasta: "Dev 1/task-o-oooooo", quando: "encerrada" }]);
      expect(r).toMatchObject({ imediata: true, pastas: 1, removidas: 1, pastasApagadas: 1 });
      expect(relatos).toEqual([expect.objectContaining({ imediata: true, removidas: 1 })]);
      expect(existsSync(wt)).toBe(false);
      expect(existsSync(encerrada)).toBe(true);
      expect(await limpeza.limparAgora([])).toBeNull();
    } finally {
      limpeza.parar();
    }
  });

  it("o servidor já não oferece a pasta (a frente reabriu): nada sai", async () => {
    const wt = await worktree("Dev 1/frente-p-pppppp/acme", "frente/p");
    const { limpeza } = iniciar([]);
    try {
      expect(await limpeza.limparAgora([semTrabalho("Dev 1/frente-p-pppppp")])).toMatchObject({ removidas: 0, puladas: { nao_reconfirmada: 1 } });
      expect(existsSync(wt)).toBe(true);
    } finally {
      limpeza.parar();
    }
  });

  it("parada, não faz nada", async () => {
    const { limpeza } = iniciar([]);
    limpeza.parar();
    expect(await limpeza.limparAgora([semTrabalho("Dev 1/x-qqqqqq")])).toBeNull();
  });

  it("ADR-106: a frente com a worktree cujo clone dentro de ~/nod foi apagado não prova e fica (`sem_prova`)", async () => {
    const clone = pastaDe("Ada/outra-555555/nod");
    await mkdir(clone, { recursive: true });
    git(clone, "init", "-q", "-b", "main");
    await writeFile(join(clone, "README.md"), "x\n");
    git(clone, "add", ".");
    git(clone, "commit", "-q", "-m", "inicio");
    const wt = pastaDe("Ada/frente-666666/nod");
    await mkdir(join(wt, ".."), { recursive: true });
    git(clone, "worktree", "add", wt, "-b", "frente/z");
    await rm(join(clone, ".."), { recursive: true, force: true });
    const r = await limparPastas([semTrabalho("Ada/frente-666666")], opcoes());
    expect(r).toMatchObject({ removidas: 0, puladas: { sem_prova: 1 } });
    expect(existsSync(wt)).toBe(true);
  });
});
