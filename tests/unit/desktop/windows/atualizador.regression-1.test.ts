// Regression: QA-678 — mutantes que sobreviviam nas guardas do lerAnuncio e do gravadorConferindo
// Found by /qa on 2026-11-05
import { createHash } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gravadorConferindo, lerAnuncio } from "../../../../desktop/windows/atualizador.ts";

const exe = new TextEncoder().encode("MZ instalador falso");
const sha = createHash("sha256").update(exe).digest("hex");
async function* pedacos(b: Uint8Array) { yield b; }
const ok = "https://storage.googleapis.com/nod-atualizacoes/1.2.0/nod-1.2.0-win-x64.exe?X-Goog-Signature=s";

describe("QA #678: cada guarda do lerAnuncio barra sozinha (com o host certo)", () => {
  it("o anúncio bom passa", () => {
    expect(lerAnuncio({ url: ok, name: "1.2.0", sha256: sha })).toEqual({ url: ok, versao: "1.2.0", sha256: sha });
  });
  it.each([
    ["http no host do Cloud Storage", { url: ok.replace("https:", "http:"), name: "1.2.0", sha256: sha }],
    ["usuário na URL do Cloud Storage", { url: ok.replace("https://", "https://u@"), name: "1.2.0", sha256: sha }],
    ["usuário e senha na URL do Cloud Storage", { url: ok.replace("https://", "https://u:p@"), name: "1.2.0", sha256: sha }],
    ["sha256 curto", { url: ok, name: "1.2.0", sha256: "abc" }],
    ["sha256 com sobra no fim", { url: ok, name: "1.2.0", sha256: `${sha}00` }],
    ["sha256 com sobra no começo", { url: ok, name: "1.2.0", sha256: `zz${sha}` }],
    ["sha256 não hexadecimal", { url: ok, name: "1.2.0", sha256: "g".repeat(64) }],
    ["versão com barra", { url: ok, name: "1.2.0/../x", sha256: sha }],
  ])("%s = null", (_, corpo) => {
    expect(lerAnuncio(corpo)).toBeNull();
  });
});

describe("QA #678: o gravador confere o sha256 sem ligar para maiúsculas", () => {
  it("sha256 em maiúsculas do mesmo conteúdo grava", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "qa678-"));
    await expect(gravadorConferindo(pasta)("nod-1.2.0-win-x64.exe", pedacos(exe), sha.toUpperCase())).resolves.toBe(join(pasta, "nod-1.2.0-win-x64.exe"));
    expect(await readdir(pasta)).toEqual(["nod-1.2.0-win-x64.exe"]);
  });
});
