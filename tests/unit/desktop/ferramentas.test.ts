import { mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ambienteDoBinarioDoNod, ativarPrefixo, candidatosDoNod, descartarPrefixo, escolherBinario, nomeDaVersao, pastasFerramentas, prefixoAtivo, prepararPrefixoNovo, type Candidato } from "../../../desktop/ferramentas.ts";

describe("as ferramentas do nod (revisão do PR 1, ADR-093)", () => {
  it("o Codex do nod roda o binário nativo (sem o codex.js e sem node), aninhado ou içado, com o ambiente que o codex.js daria", () => {
    const p = "/f/codex-cli/atual";
    expect(candidatosDoNod("codex-cli", p, "darwin", "x64")).toEqual([
      "/f/codex-cli/atual/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex",
      "/f/codex-cli/atual/lib/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex",
    ]);
    expect(candidatosDoNod("codex-cli", p, "darwin", "arm64")[0]).toContain("codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex");
    expect(candidatosDoNod("codex-cli", p, "win32", "x64")).toEqual([]);
    expect(candidatosDoNod("claude-cli", "/f/claude-cli/atual", "darwin", "x64")).toEqual(["/f/claude-cli/atual/bin/claude"]);
    expect(ambienteDoBinarioDoNod("codex-cli", p)).toEqual({ CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: "/f/codex-cli/atual/lib/node_modules/@openai/codex" });
    expect(ambienteDoBinarioDoNod("claude-cli", p)).toEqual({});
    // Nada do Electron como node no ambiente do binário.
    expect(Object.keys(ambienteDoBinarioDoNod("codex-cli", p))).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("a cópia do nod só ganha quando é igual ou mais nova que a primeira de fora (o `claude update` da pessoa não fica escondido)", () => {
    const nod = (versao: string | null): Candidato => ({ caminho: "/nod/claude", origem: "nod", versao });
    const fora = (versao: string | null): Candidato => ({ caminho: "/h/.local/bin/claude", origem: "extra", versao });
    expect(escolherBinario(nod("2.1.296"), fora("2.1.300"))?.origem).toBe("extra");
    expect(escolherBinario(nod("2.1.296"), fora("2.1.296"))?.origem).toBe("nod");
    expect(escolherBinario(nod("2.1.300"), fora("2.1.296"))?.origem).toBe("nod");
    // De fora sem versão (o codex.js sem node, o caso do Breno): vale o do nod que responde.
    expect(escolherBinario(nod("0.162.1"), fora(null))?.origem).toBe("nod");
    // O do nod sem versão (quebrado): vale o de fora.
    expect(escolherBinario(nod(null), fora("0.159.0"))?.origem).toBe("extra");
    expect(escolherBinario(null, fora(null))?.origem).toBe("extra");
    expect(escolherBinario(nod("1.0.0"), null)?.origem).toBe("nod");
    expect(escolherBinario(null, null)).toBeNull();
  });

  describe("troca atômica do prefixo", () => {
    let base: string;
    beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "nod-ferramentas-")); });
    afterEach(() => rm(base, { recursive: true, force: true }));

    it("o novo vira o atual por rename do link; a versão anterior fica, as mais velhas saem; descartar não toca no atual", async () => {
      const p = pastasFerramentas(base);
      const v1 = await prepararPrefixoNovo(p, "codex-cli", nomeDaVersao(1_000, "a"));
      await ativarPrefixo(p, "codex-cli", v1);
      expect(await readlink(prefixoAtivo(base, "codex-cli"))).toBe(v1.split("/").at(-1));
      const v2 = await prepararPrefixoNovo(p, "codex-cli", nomeDaVersao(2_000, "b"));
      await writeFile(join(v2, "marca"), "v2");
      await ativarPrefixo(p, "codex-cli", v2);
      expect(await readFile(join(prefixoAtivo(base, "codex-cli"), "marca"), "utf8")).toBe("v2");
      const v3 = await prepararPrefixoNovo(p, "codex-cli", nomeDaVersao(3_000, "c"));
      await ativarPrefixo(p, "codex-cli", v3);
      const nomes = (await readdir(join(base, "codex-cli"))).sort();
      // v1 saiu; v2 (a anterior, talvez rodando num bot) e v3 ficam; nenhum .tmp sobra.
      expect(nomes).toEqual(["atual", v2.split("/").at(-1)!, v3.split("/").at(-1)!].sort());
      // Uma instalação que falhou some sem tocar no atual.
      const v4 = await prepararPrefixoNovo(p, "codex-cli", nomeDaVersao(4_000, "d"));
      await descartarPrefixo(p, "codex-cli", v4);
      expect(await readlink(prefixoAtivo(base, "codex-cli"))).toBe(v3.split("/").at(-1));
      expect((await readdir(join(base, "codex-cli"))).includes(v4.split("/").at(-1)!)).toBe(false);
      // Descartar fora da pasta de versões não apaga nada.
      await mkdir(join(base, "outra"));
      await descartarPrefixo(p, "codex-cli", join(base, "outra"));
      expect(await readdir(base)).toContain("outra");
    });

    it("o npmrc do nod existe e não diz nada (a configuração vem só pelas flags)", async () => {
      const p = pastasFerramentas(base);
      await prepararPrefixoNovo(p, "claude-cli", nomeDaVersao(1, "x"));
      expect((await readFile(p.npmrcUsuario, "utf8")).split("\n").filter((l) => l && !l.startsWith("#"))).toEqual([]);
      expect((await readFile(p.npmrcGlobal, "utf8")).split("\n").filter((l) => l && !l.startsWith("#"))).toEqual([]);
    });
  });

  it("nomes de versão ordenam pelo tempo e não colidem no mesmo milissegundo", () => {
    expect(nomeDaVersao(Date.UTC(2026, 9, 9, 20, 1, 2, 3), "ab")).toBe("v-20261009200102003-ab");
    expect(nomeDaVersao(1, "a")).not.toBe(nomeDaVersao(1, "b"));
  });
});
