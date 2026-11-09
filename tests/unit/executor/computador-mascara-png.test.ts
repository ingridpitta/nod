// Revisão 20 do PR #600: a captura do bot com o dock mostra só a janela do Chrome.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { codificarPng, decodificarPng, mascararForaDaJanela } from "../../../infra/computador/mascara-png.mjs";

const cheia = (largura: number, altura: number, bpp: number, cor: number, valor = 200) => ({ largura, altura, bpp, cor, pixels: Buffer.alloc(largura * altura * bpp, valor) });
const px = (img: ReturnType<typeof decodificarPng>, x: number, y: number) => [...img.pixels.subarray((y * img.largura + x) * img.bpp, (y * img.largura + x + 1) * img.bpp)];

describe("a máscara da captura do bot (revisão 20 do PR #600)", () => {
  it("pinta de preto o que fica fora da janela e mantém o que fica dentro (RGB e RGBA)", () => {
    for (const [cor, bpp] of [[2, 3], [6, 4]] as const) {
      const img = decodificarPng(mascararForaDaJanela(codificarPng(cheia(20, 10, bpp, cor)), { x: 2, y: 0, largura: 10, altura: 6 }));
      expect([img.largura, img.altura]).toEqual([20, 10]);
      expect(px(img, 5, 3)).toEqual(Array(bpp).fill(200));
      expect(px(img, 5, 6)).toEqual(bpp === 4 ? [0, 0, 0, 255] : [0, 0, 0]);
      expect(px(img, 1, 0)).toEqual(bpp === 4 ? [0, 0, 0, 255] : [0, 0, 0]);
      expect(px(img, 12, 0)).toEqual(bpp === 4 ? [0, 0, 0, 255] : [0, 0, 0]);
    }
  });

  it("sem a geometria da janela, a tela inteira fica preta", () => {
    const img = decodificarPng(mascararForaDaJanela(codificarPng(cheia(8, 4, 3, 2)), null));
    expect(img.pixels.every((b) => b === 0)).toBe(true);
  });

  it("lê as linhas com os filtros 1 a 4 (os que o scrot e a libpng usam)", () => {
    const largura = 3, altura = 5, bpp = 3;
    const esperado = Buffer.from(Array.from({ length: largura * altura * bpp }, (_, i) => (i * 37) % 256));
    const linhas: Buffer[] = [];
    const filtros = [0, 1, 2, 3, 4];
    const paeth = (a: number, b: number, c: number) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
    for (let y = 0; y < altura; y++) {
      const f = filtros[y] ?? 0;
      const linha = Buffer.alloc(largura * bpp + 1);
      linha[0] = f;
      for (let i = 0; i < largura * bpp; i++) {
        const x = esperado[y * largura * bpp + i] ?? 0;
        const a = i >= bpp ? esperado[y * largura * bpp + i - bpp] ?? 0 : 0;
        const b = y > 0 ? esperado[(y - 1) * largura * bpp + i] ?? 0 : 0;
        const c = y > 0 && i >= bpp ? esperado[(y - 1) * largura * bpp + i - bpp] ?? 0 : 0;
        const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f] ?? 0;
        linha[i + 1] = (x - pred) & 0xff;
      }
      linhas.push(linha);
    }
    const base = codificarPng({ largura, altura, bpp, cor: 2, pixels: Buffer.alloc(largura * altura * bpp) });
    // Troca o IDAT do PNG base pelo das linhas filtradas.
    const ini = base.indexOf("IDAT") - 4;
    const fim = base.indexOf("IEND") - 4;
    const dados = deflateSync(Buffer.concat(linhas));
    const cab = Buffer.alloc(8); cab.writeUInt32BE(dados.length, 0); cab.write("IDAT", 4, "latin1");
    const png = Buffer.concat([base.subarray(0, ini), cab, dados, Buffer.alloc(4), base.subarray(fim)]);
    expect(decodificarPng(png).pixels.equals(esperado)).toBe(true);
  });

  it("PNG que não lê lança png_invalido (a captura não sai sem máscara)", () => {
    expect(() => mascararForaDaJanela(Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), null)).toThrow("png_invalido");
    expect(() => mascararForaDaJanela(Buffer.from("nada"), null)).toThrow("png_invalido");
  });

  const XVFB = spawnSync("sh", ["-c", "command -v Xvfb"], { encoding: "utf8" }).stdout.trim();
  const SCROT = spawnSync("sh", ["-c", "command -v scrot"], { encoding: "utf8" }).stdout.trim();
  it.skipIf(!XVFB || !SCROT)("lê e mascara a captura do scrot de verdade", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-scrot-"));
    const display = `:${180 + (process.pid % 40)}`;
    const x = spawn(XVFB, [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
    try {
      let ok = false;
      for (let i = 0; i < 50 && !ok; i++) {
        await new Promise((r) => setTimeout(r, 100));
        ok = spawnSync(SCROT, ["-o", join(pasta, "t.png")], { env: { ...process.env, DISPLAY: display } }).status === 0;
      }
      expect(ok).toBe(true);
      const img = decodificarPng(mascararForaDaJanela(await readFile(join(pasta, "t.png")), { x: 0, y: 0, largura: 1280, altura: 752 }));
      expect([img.largura, img.altura]).toEqual([1280, 800]);
      expect(px(img, 640, 780).slice(0, 3)).toEqual([0, 0, 0]);
    } finally {
      x.kill("SIGKILL");
      await rm(pasta, { recursive: true, force: true });
    }
  }, 30_000);
});
