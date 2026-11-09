import { describe, expect, it } from "vitest";
import { algumCwdDentro, caminhoDoRemotoLocal, lerLsRemote, prerequisitosDoBundle, saiDoGuardado, temArquivoEscondidoDoStatus, temTagSoLocal } from "../../../src/domain/clone-refazivel.ts";

describe("NOD-295 A: as regras puras do clone refazível", () => {
  it("remoto de rede não tem caminho local; o local (caminho, file://) tem", () => {
    for (const rede of ["https://github.com/gamefik/nod.git", "ssh://git@github.com/gamefik/nod", "git@github.com:gamefik/nod.git", "github.com:gamefik/nod", "git://host/x", ""]) expect(caminhoDoRemotoLocal(rede)).toBeNull();
    expect(caminhoDoRemotoLocal("/home/nod/code/acme")).toBe("/home/nod/code/acme");
    expect(caminhoDoRemotoLocal("../acme")).toBe("../acme");
    expect(caminhoDoRemotoLocal("./a:b")).toBe("./a:b");
    expect(caminhoDoRemotoLocal("file:///home/nod/a%20b")).toBe("/home/nod/a b");
  });

  it("assume-unchanged (minúscula) e skip-worktree (S) escondem alteração do status", () => {
    expect(temArquivoEscondidoDoStatus("H README.md\nH src/a.ts\n")).toBe(false);
    expect(temArquivoEscondidoDoStatus("H README.md\nh src/a.ts\n")).toBe(true);
    expect(temArquivoEscondidoDoStatus("S pacote/x\n")).toBe(true);
    expect(temArquivoEscondidoDoStatus("")).toBe(false);
  });

  it("sai do guardado só o ignorado que se refaz; caractere de padrão do tar nunca", () => {
    expect(saiDoGuardado("coverage/", true)).toBe(true);
    expect(saiDoGuardado(".env", true)).toBe(false);
    expect(saiDoGuardado("backups/", true)).toBe(false);
    expect(saiDoGuardado("apps/[id]/.next/", true)).toBe(false);
    expect(saiDoGuardado("x*.log", true)).toBe(false);
  });

  it("a pasta que pode ter .env dentro (dist/) só sai quando quem chama conferiu que não tem", () => {
    expect(saiDoGuardado("dist/", true)).toBe(true);
    expect(saiDoGuardado("dist/", false)).toBe(false);
  });
});

describe("QA #413: leitura do remoto, do bundle e do cwd", () => {
  it("ls-remote: branch, tag anotada descascada e tag leve viram commits; todo id anunciado é objeto", () => {
    const r = lerLsRemote("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\ncccccccccccccccccccccccccccccccccccccccc\trefs/tags/v1\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1^{}\ndddddddddddddddddddddddddddddddddddddddd\trefs/tags/leve\nlixo\n");
    expect(new Set(r.commits)).toEqual(new Set(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "dddddddddddddddddddddddddddddddddddddddd"]));
    expect(r.objetos.has("cccccccccccccccccccccccccccccccccccccccc")).toBe(true);
    expect(lerLsRemote("").commits).toEqual([]);
  });

  it("NOD-319: ls-remote devolve as tags pelo nome, com o objeto da ref (o da anotada, não o descascado)", () => {
    const r = lerLsRemote("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\ncccccccccccccccccccccccccccccccccccccccc\trefs/tags/v1\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1^{}\ndddddddddddddddddddddddddddddddddddddddd\trefs/tags/leve\n");
    expect([...r.tags]).toEqual([["refs/tags/v1", "cccccccccccccccccccccccccccccccccccccccc"], ["refs/tags/leve", "dddddddddddddddddddddddddddddddddddddddd"]]);
  });

  it("NOD-319: tag só local = nenhum remoto com o mesmo nome e o mesmo objeto; linha ilegível é dúvida", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const origin = new Map([["refs/tags/v1", a]]);
    const espelho = new Map([["refs/tags/v2", b]]);
    expect(temTagSoLocal("", [origin])).toBe(false);
    expect(temTagSoLocal(`refs/tags/v1 ${a}\n`, [origin])).toBe(false);
    expect(temTagSoLocal(`refs/tags/v1 ${a}\nrefs/tags/v2 ${b}`, [origin, espelho])).toBe(false);
    expect(temTagSoLocal(`refs/tags/v1 ${b}`, [origin])).toBe(true); // mesmo nome, outro objeto
    expect(temTagSoLocal(`refs/tags/local ${a}`, [origin])).toBe(true); // mesmo objeto, outro nome (a leve)
    expect(temTagSoLocal(`refs/tags/v1 ${a}`, [])).toBe(true);
    expect(temTagSoLocal("lixo", [origin])).toBe(true);
    expect(temTagSoLocal(`refs/heads/v1 ${a}`, [origin])).toBe(true);
  });

  it("bundle: os pré-requisitos são as linhas '-' do cabeçalho", () => {
    expect(prerequisitosDoBundle("# v2 git bundle\n-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa msg\n-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\ncccccccccccccccccccccccccccccccccccccccc refs/heads/x\n")).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
    expect(prerequisitosDoBundle("# v3 git bundle\n@object-format=sha1\ncccccccccccccccccccccccccccccccccccccccc refs/heads/x\n")).toEqual([]);
  });

  it("cwd: a própria pasta e o que está dentro contam; o vizinho de nome parecido não", () => {
    expect(algumCwdDentro(["/a/b"], "/a/b")).toBe(true);
    expect(algumCwdDentro(["/a/b/c (deleted)"], "/a/b")).toBe(true);
    expect(algumCwdDentro(["/a/bc", "/a"], "/a/b")).toBe(false);
  });
});
