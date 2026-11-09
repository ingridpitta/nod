/**
 * NOD-97 PR 6 (ressalva do Revisor no #515 @3c77fab4): a gravação do nod-origens.json por temporário + rename e a
 * limpeza do temporário só aparecem quando a escrita para no meio (disco cheio, processo morto). Aqui a escrita do
 * temporário falha depois de gravar metade: o arquivo de origens tem de seguir com o conteúdo anterior, inteiro, e o
 * temporário pela metade não pode ficar no perfil. Sem o rename (writeFile direto no arquivo) o JSON fica truncado; sem
 * a limpeza sobra o .tmp com as origens visitadas.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const falha = vi.hoisted(() => ({ ligada: false }));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const writeFile = (async (arquivo: Parameters<typeof fs.writeFile>[0], dados: string, opcoes?: Parameters<typeof fs.writeFile>[2]) => {
    if (falha.ligada && String(arquivo).includes("nod-origens.json")) {
      falha.ligada = false;
      await fs.writeFile(arquivo, dados.slice(0, Math.floor(dados.length / 2)), opcoes); // a metade que chegou ao disco
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    }
    return fs.writeFile(arquivo, dados, opcoes);
  }) as typeof fs.writeFile;
  return { ...fs, writeFile, default: { ...fs, writeFile } };
});

const { gravadorEmFila } = await import("../../../infra/computador/tela.mjs");

const pastas: string[] = [];
afterEach(async () => {
  falha.ligada = false;
  await Promise.all(pastas.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("gravadorEmFila: escrita que para no meio", () => {
  it("o nod-origens.json segue inteiro com o conteúdo anterior e o temporário pela metade sai do perfil", async () => {
    const perfil = await mkdtemp(join(tmpdir(), "nod-origens-atomico-"));
    pastas.push(perfil);
    const arquivo = join(perfil, "nod-origens.json");
    let visitadas = ["https://a.example", "https://b.example"];
    const gravar = gravadorEmFila(arquivo, () => JSON.stringify(visitadas));
    await gravar();
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toEqual(visitadas);

    const antes = visitadas;
    visitadas = [...antes, ...Array.from({ length: 50 }, (_, i) => `https://visitada-${i}.example`)];
    falha.ligada = true;
    await expect(gravar()).resolves.toBeUndefined();
    expect(falha.ligada).toBe(false); // a falha aconteceu mesmo
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toEqual(antes);
    expect(await readdir(perfil)).toEqual(["nod-origens.json"]);

    // A fila segue: a próxima gravação grava o estado atual.
    await gravar();
    expect(JSON.parse(await readFile(arquivo, "utf8"))).toEqual(visitadas);
    expect(await readdir(perfil)).toEqual(["nod-origens.json"]);
  });

  it("a mesma falha na primeira gravação não deixa arquivo pela metade nem temporário", async () => {
    const perfil = await mkdtemp(join(tmpdir(), "nod-origens-atomico-"));
    pastas.push(perfil);
    await writeFile(join(perfil, "outro"), "x");
    const gravar = gravadorEmFila(join(perfil, "nod-origens.json"), () => JSON.stringify(["https://a.example"]));
    falha.ligada = true;
    await gravar();
    expect(await readdir(perfil)).toEqual(["outro"]);
  });
});
