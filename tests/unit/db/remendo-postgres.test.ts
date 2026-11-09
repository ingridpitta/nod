import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { remendado, remendar, TROCAS } from "../../../scripts/remendar-postgres.mjs";

/**
 * NOD-266 (revisão do PR #321): o postinstall roda a cada `npm install`, então o remendo precisa ser idempotente de
 * verdade. A terceira troca reescreve o texto da primeira; se "já aplicada" fosse decidido pelo `depois`, a segunda
 * passagem inseriria de novo a checagem sem `, true` ANTES da boa, e a vaga do pool voltaria a sumir.
 * O original é reconstruído desfazendo as trocas no build instalado (o remendo já rodou no postinstall).
 */
const instalado = readFileSync(join(createRequire(import.meta.url).resolve("postgres").replace(/src[\\/]index\.js$/, ""), "src", "connection.js"), "utf8");
const desfazer = (texto: string, ate = 0): string =>
  TROCAS.slice(ate).reverse().reduce((t, { antes, depois }) => t.replace(depois, antes), texto);
const contar = (texto: string, trecho: string): number => texto.split(trecho).length - 1;

function emArquivo(texto: string): string {
  const arquivo = join(mkdtempSync(join(tmpdir(), "remendo-pg-")), "connection.js");
  writeFileSync(arquivo, texto);
  return arquivo;
}

describe("scripts/remendar-postgres.mjs", () => {
  const original = desfazer(instalado);

  it("o original reconstruído não tem nenhuma troca", () => {
    for (const { feita } of TROCAS) expect(original).not.toContain(feita);
  });

  it.each([
    ["do original", original],
    ["de um node_modules só com o remendo de 2026-10-08", desfazer(instalado, 2)],
  ])("a partir %s: a primeira passagem aplica tudo, a segunda e a terceira não mudam nada", (_, inicial) => {
    const arquivo = emArquivo(inicial);
    expect(remendar([arquivo])).toBe(1);
    const umaVez = readFileSync(arquivo, "utf8");
    expect(remendar([arquivo])).toBe(0);
    expect(remendar([arquivo])).toBe(0);
    expect(readFileSync(arquivo, "utf8")).toBe(umaVez);
    expect(remendado([arquivo])).toBe(true);
    for (const { feita } of TROCAS) expect(contar(umaVez, feita)).toBe(1);
    expect(umaVez).toContain("Errors.connection('CONNECTION_CLOSED', options)), true // nod:remendo-vaga-do-pool");
  });

  it("remendado acusa a troca duplicada (o estado que a versão anterior do script deixava)", () => {
    const duplicado = instalado.replace(TROCAS[0]?.antes ?? "", TROCAS[0]?.depois ?? "");
    expect(remendado([emArquivo(duplicado)])).toBe(false);
  });
});
