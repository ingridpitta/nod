import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, lerZip, montarZip } from "../../../src/services/zip.ts";

describe("zip mínimo (NOD-346)", () => {
  it("crc32 bate com o valor conhecido", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("ida e volta: nomes UTF-8, texto e binário", () => {
    const bin = Uint8Array.from([0, 1, 2, 255]);
    const zip = montarZip([{ nome: "LEIA-ME.txt", dados: "olá, ção" }, { nome: "conversas/a.json", dados: "[]" }, { nome: "foto.png", dados: bin }], Date.UTC(2026, 9, 23, 12, 0, 0));
    const lido = lerZip(zip);
    expect([...lido.keys()]).toEqual(["LEIA-ME.txt", "conversas/a.json", "foto.png"]);
    expect(new TextDecoder().decode(lido.get("LEIA-ME.txt"))).toBe("olá, ção");
    expect([...lido.get("foto.png")!]).toEqual([...bin]);
  });

  it("recusa nome absoluto, com .. ou repetido", () => {
    expect(() => montarZip([{ nome: "/x", dados: "" }], 0)).toThrow();
    expect(() => montarZip([{ nome: "a/../b", dados: "" }], 0)).toThrow();
    expect(() => montarZip([{ nome: "a", dados: "" }, { nome: "a", dados: "" }], 0)).toThrow();
  });

  it("um unzip de verdade abre (quando houver unzip na máquina)", () => {
    let temUnzip = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      temUnzip = false;
    }
    if (!temUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const arq = join(dir, "t.zip");
    writeFileSync(arq, montarZip([{ nome: "a.txt", dados: "conteúdo" }, { nome: "d/b.json", dados: "{}" }], Date.now()));
    const saida = execFileSync("unzip", ["-t", arq]).toString();
    expect(saida).toContain("No errors detected");
  });
});
