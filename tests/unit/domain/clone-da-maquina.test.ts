import { describe, expect, it } from "vitest";
import { caminhoDaTrava, caminhoDoClone, repoDoGithub, trocarNoPrompt } from "../../../src/domain/clone-da-maquina.ts";

describe("repoDoGithub", () => {
  it.each([
    ["marlonwlv/nod", "marlonwlv/nod"],
    ["Gamefik/Gamefik", "gamefik/gamefik"],
    ["  gamefik/gamefik  ", "gamefik/gamefik"],
    ["https://github.com/gamefik/nod", "gamefik/nod"],
    ["https://github.com/gamefik/nod.git", "gamefik/nod"],
    ["https://github.com/gamefik/nod/", "gamefik/nod"],
    ["git@github.com:gamefik/nod.git", "gamefik/nod"],
    ["ssh://git@github.com/gamefik/nod.git", "gamefik/nod"],
    ["dono/nome.com.ponto_e-traco", "dono/nome.com.ponto_e-traco"],
  ])("%s → %s", (texto, repo) => expect(repoDoGithub(texto)).toBe(repo));

  it.each(["", "nod", "a/b/c", "../x", "dono/..", "dono/.", "dono/.oculto", "https://gitlab.com/a/b", "dono/nome com espaço", "do_no/nome", `${"a".repeat(40)}/x`, "dono/"])("%j → null", (texto) => {
    expect(repoDoGithub(texto)).toBeNull();
  });
});

describe("caminhos", () => {
  it("clone e trava", () => {
    expect(caminhoDoClone("~", "gamefik/nod")).toBe("~/nod/.clones/gamefik/nod.git");
    expect(caminhoDoClone("/home/nod", "gamefik/nod")).toBe("/home/nod/nod/.clones/gamefik/nod.git");
    expect(caminhoDaTrava("/home/nod", "gamefik/nod")).toBe("/home/nod/nod/.clones/.travas/gamefik__nod.lock");
  });
});

describe("trocarNoPrompt", () => {
  const plano = { promptSistema: "a X b", outro: 1 };
  it("troca a única ocorrência e preserva o resto", () => {
    expect(trocarNoPrompt(plano, "X", "Y")).toEqual({ promptSistema: "a Y b", outro: 1 });
  });
  it("0 ou 2 ocorrências, ou trecho vazio, é null", () => {
    expect(trocarNoPrompt(plano, "Z", "Y")).toBeNull();
    expect(trocarNoPrompt({ promptSistema: "X X" }, "X", "Y")).toBeNull();
    expect(trocarNoPrompt(plano, "", "Y")).toBeNull();
  });
  it("troca na parte estável ou na volátil, a que contém", () => {
    const est = { promptSistema: "e X\nv", promptSistemaPartes: { estavel: "e X", volatil: "v" } };
    expect(trocarNoPrompt(est, "X", "Y")).toEqual({ promptSistema: "e Y\nv", promptSistemaPartes: { estavel: "e Y", volatil: "v" } });
    const vol = { promptSistema: "e\nv X", promptSistemaPartes: { estavel: "e", volatil: "v X" } };
    expect(trocarNoPrompt(vol, "X", "Y")).toEqual({ promptSistema: "e\nv Y", promptSistemaPartes: { estavel: "e", volatil: "v Y" } });
  });
  it("partes sem o trecho, ou com ele nas duas, é null", () => {
    expect(trocarNoPrompt({ promptSistema: "X", promptSistemaPartes: { estavel: "e", volatil: "v" } }, "X", "Y")).toBeNull();
    expect(trocarNoPrompt({ promptSistema: "X", promptSistemaPartes: { estavel: "X", volatil: "X" } }, "X", "Y")).toBeNull();
  });
});
