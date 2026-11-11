// Regression: QA-678 — o awk do publicar-atualizacao.sh casava nome parcial e não protegia contra linha repetida
// Found by /qa on 2026-11-05
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Roda só a linha `ESPERADO=$(awk ...)` do script (sem gh nem gcloud) sobre os SHA256-*.txt dados. */
const linha = readFileSync("scripts/desktop/publicar-atualizacao.sh", "utf8").split("\n").find((l) => l.trim().startsWith("ESPERADO=$(awk"))!.trim();
function esperado(zip: string, arquivos: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "qa678-awk-"));
  try {
    for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(dir, nome), conteudo);
    return execFileSync("/usr/bin/bash", ["-c", `set -euo pipefail; DIR="$1"; ZIP="$2"; ${linha}; printf %s "$ESPERADO"`, "x", dir, zip], { encoding: "utf8" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const h = (c: string) => c.repeat(64);

describe("QA #678: o awk do publicar-atualizacao.sh acha o hash do arquivo exato", () => {
  it("a linha existe no script", () => expect(linha).toContain("awk -v f=\"$ZIP\""));
  it("nome que só contém o do .exe (o .blockmap, outro prefixo) não conta", () => {
    expect(esperado("nod-1.2.3-win-x64.exe", {
      "SHA256-win-x64.txt": `${h("b")}  release/nod-1.2.3-win-x64.exe.blockmap\n${h("c")}  xnod-1.2.3-win-x64.exe\n${h("a")}  nod-1.2.3-win-x64.exe\r\n`,
    })).toBe(h("a"));
  });
  it("o mesmo nome em dois SHA256-*.txt dá um hash só (o primeiro)", () => {
    expect(esperado("nod-1.2.3-win-x64.exe", {
      "SHA256-win-x64.txt": `${h("a")}  nod-1.2.3-win-x64.exe\n`,
      "SHA256-x64.txt": `${h("a")}  release/nod-1.2.3-win-x64.exe\n`,
    })).toBe(h("a"));
  });
  it("sem a linha: vazio (o script para com 'nenhum SHA256-*.txt')", () => {
    expect(esperado("nod-1.2.3-win-x64.exe", { "SHA256-x64.txt": `${h("d")}  release/nod-1.2.3-mac-x64.zip\n` })).toBe("");
  });
});
