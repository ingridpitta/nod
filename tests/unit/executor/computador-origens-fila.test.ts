/**
 * NOD-97 PR 6 (revisão do #515): o nod-origens.json era gravado com writeFile solto a cada origem nova e no Sair de
 * todos; gravações concorrentes intercalavam e deixavam um JSON inválido, que ao reabrir a tela vira [] e esquece as
 * origens. gravadorEmFila serializa as gravações e grava por temporário + rename.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aplicarGeracaoNoPerfil, apagarTemporariosDasOrigens, gravadorEmFila } from "../../../infra/computador/tela.mjs";

const pastas: string[] = [];
afterEach(async () => {
  await Promise.all(pastas.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("gravadorEmFila (nod-origens.json)", () => {
  // 60 rodadas × 44 gravações por temporário + rename: no runner carregado do CI passava dos 5 s padrão do projeto
  // `unit` (timeout duas vezes seguidas em 26/10, sem regressão). O prazo não esconde defeito: o teste confere o JSON.
  it("gravações concorrentes deixam o JSON válido e com o estado final, sem perder origens", { timeout: 30_000 }, async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-origens-"));
    pastas.push(pasta);
    const arquivo = join(pasta, "nod-origens.json");
    for (let rodada = 0; rodada < 60; rodada++) {
      // Como em anotarOrigem + limparStorage: o conjunto cresce, encolhe a zero e volta a crescer, com gravações sem await.
      let visitadas = new Set<string>();
      const gravar = gravadorEmFila(arquivo, () => JSON.stringify([...visitadas]));
      const gravando: Promise<void>[] = [];
      for (let i = 0; i < 40; i++) {
        visitadas.add(`https://site-${rodada}-${i}-${"x".repeat(200)}.example`);
        gravando.push(gravar());
      }
      visitadas = new Set();
      gravando.push(gravar());
      for (let i = 0; i < 3; i++) {
        visitadas.add(`https://volta-${i}.example`);
        gravando.push(gravar());
      }
      await Promise.all(gravando);
      const lidas = JSON.parse(await readFile(arquivo, "utf8"));
      expect(lidas).toEqual([...visitadas]);
    }
    // Nenhum temporário fica para trás.
    expect(await readdir(pasta)).toEqual(["nod-origens.json"]);
  });

  it("a promessa não rejeita quando a pasta não existe", async () => {
    const gravar = gravadorEmFila(join(tmpdir(), "nao-existe-nod", "x", "nod-origens.json"), () => "[]");
    await expect(gravar()).resolves.toBeUndefined();
  });

  // QA do #515 @3c77fab4: o SIGKILL no meio da gravação deixa o temporário com as origens no perfil.
  it("o temporário que sobra de uma tela morta sai ao subir e no Sair de todos com a tela fechada", async () => {
    const perfil = await mkdtemp(join(tmpdir(), "nod-origens-"));
    pastas.push(perfil);
    await writeFile(join(perfil, "nod-origens.json"), "[]");
    await writeFile(join(perfil, "nod-origens.json.4242.7.tmp"), '["https://visitada.example"]');
    await writeFile(join(perfil, "outro.tmp"), "fica");
    await apagarTemporariosDasOrigens(perfil);
    expect((await readdir(perfil)).sort()).toEqual(["nod-origens.json", "outro.tmp"]);
    await writeFile(join(perfil, "nod-origens.json.4242.8.tmp"), '["https://visitada.example"]');
    expect(await aplicarGeracaoNoPerfil(perfil, 1)).toBe(true);
    expect((await readdir(perfil)).filter((n) => n.startsWith("nod-origens"))).toEqual([]);
  });
});
