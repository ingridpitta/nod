import { describe, expect, it } from "vitest";
import { LIMITE_POR_FAMILIA } from "../../../src/contracts/anexo.ts";
import { caminhoRelativoSeguro, classificar, segmentoOculto, farejarMidia, linksLocais, medidasDe, reescreverLinks } from "../../../src/domain/midia.ts";
import { m4a, mp3Cbr, oggOpus, wav } from "../../fixtures/audio/construir.ts";
import { gif, html, jpeg, mp4, pdf, png, svg, webm, webp, zip } from "../../fixtures/midia/construir.ts";

describe("midia: tipo pelos bytes (NOD-323)", () => {
  it("reconhece cada formato pelo conteúdo", () => {
    expect(farejarMidia(png(10, 10))).toBe("image/png");
    expect(farejarMidia(jpeg(10, 10))).toBe("image/jpeg");
    expect(farejarMidia(gif(10, 10))).toBe("image/gif");
    expect(farejarMidia(webp(10, 10))).toBe("image/webp");
    expect(farejarMidia(mp4(10, 10, 1000))).toBe("video/mp4");
    expect(farejarMidia(mp4(10, 10, 1000, "qt  "))).toBe("video/quicktime");
    expect(farejarMidia(m4a(1000))).toBe("audio/mp4");
    expect(farejarMidia(webm())).toBe("video/webm");
    expect(farejarMidia(wav(500))).toBe("audio/wav");
    expect(farejarMidia(mp3Cbr(10))).toBe("audio/mpeg");
    expect(farejarMidia(mp3Cbr(10, { id3: true }))).toBe("audio/mpeg");
    expect(farejarMidia(oggOpus(500))).toBe("audio/ogg");
    expect(farejarMidia(pdf())).toBe("application/pdf");
    expect(farejarMidia(zip())).toBe("application/zip");
  });

  it("SVG, HTML, texto e vazio não são mídia (executariam script ou não se mostram)", () => {
    expect(farejarMidia(svg())).toBeNull();
    expect(farejarMidia(html())).toBeNull();
    expect(farejarMidia(new TextEncoder().encode("olá"))).toBeNull();
    expect(farejarMidia(new Uint8Array())).toBeNull();
    expect(farejarMidia(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });

  it("medidas: dimensões das imagens e do vídeo, duração do vídeo e do áudio", () => {
    expect(medidasDe("image/png", png(1600, 900))).toEqual({ largura: 1600, altura: 900 });
    expect(medidasDe("image/jpeg", jpeg(1080, 1920))).toEqual({ largura: 1080, altura: 1920 });
    expect(medidasDe("image/gif", gif(320, 240))).toEqual({ largura: 320, altura: 240 });
    expect(medidasDe("image/webp", webp(800, 600))).toEqual({ largura: 800, altura: 600 });
    expect(medidasDe("image/webp", webp(801, 601, "VP8L"))).toEqual({ largura: 801, altura: 601 });
    expect(medidasDe("image/webp", webp(640, 480, "VP8 "))).toEqual({ largura: 640, altura: 480 });
    expect(medidasDe("video/mp4", mp4(1920, 1080, 12_500))).toEqual({ largura: 1920, altura: 1080, duracaoMs: 12_500 });
    expect(medidasDe("audio/wav", wav(1500))).toEqual({ duracaoMs: 1500 });
    expect(medidasDe("video/webm", webm())).toEqual({});
  });

  it("medida absurda ou truncada some em vez de quebrar a prévia", () => {
    expect(medidasDe("image/png", png(0, 10))).toEqual({});
    expect(medidasDe("image/png", png(10, 200_000))).toEqual({});
    expect(medidasDe("image/png", png(10, 10).subarray(0, 18))).toEqual({});
    expect(medidasDe("image/jpeg", jpeg(10, 10).subarray(0, 8))).toEqual({});
  });

  it("classificar: família e limite (acima do limite, só o cartão)", () => {
    expect(classificar(mp4(1, 1, 1), LIMITE_POR_FAMILIA.video)).toEqual({ mime: "video/mp4", familia: "video", semBytes: false });
    expect(classificar(mp4(1, 1, 1), LIMITE_POR_FAMILIA.video + 1)).toEqual({ mime: "video/mp4", familia: "video", semBytes: true });
    expect(classificar(gif(1, 1), 10)?.familia).toBe("gif");
    expect(classificar(svg(), 10)).toBeNull();
  });
});

describe("midia: caminho guardado no servidor", () => {
  it("só relativo a ~/nod, começando pela pasta do bot, sem .. nem absoluto", () => {
    expect(caminhoRelativoSeguro("Chico/saida/capa.png", "Chico")).toBe(true);
    expect(caminhoRelativoSeguro("Chico/saida/capa.png", "Chico/nod-323-frente")).toBe(true);
    expect(caminhoRelativoSeguro("Outro/capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("/Users/x/nod/Chico/capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("~/nod/Chico/capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico/../Outro/capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico/./capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico//capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico\\capa.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro(`Chico/${"a".repeat(1100)}`, "Chico")).toBe(false);
  });
});

describe("midia: links locais da fala (J6)", () => {
  it("acha imagem e link para a máquina e ignora web, âncora, nod-anexo e código", () => {
    const texto = [
      "Pronto: ![Capa](saida/capa.png) e o [vídeo](<~/nod/Chico/demo v2.mp4>).",
      "Veja [o site](https://exemplo.com) e [topo](#topo) e [já](nod-anexo:00000000-0000-4000-8000-000000000000).",
      "`![exemplo](nao.png)`",
      "```",
      "![no bloco](tambem-nao.png)",
      "```",
      "Fim [relatório](/Users/ana/nod/Chico/rel%20final.pdf \"título\").",
    ].join("\n");
    expect(linksLocais(texto).map((l) => [l.imagem, l.texto, l.caminho])).toEqual([
      [true, "Capa", "saida/capa.png"],
      [false, "vídeo", "~/nod/Chico/demo v2.mp4"],
      [false, "relatório", "/Users/ana/nod/Chico/rel final.pdf"],
    ]);
  });

  it("reescreve: imagem anexada sai, link anexado vira nod-anexo, o que falhou não mostra caminho de imagem", () => {
    const texto = "Fiz a capa:\n\n![Capa](saida/capa.png)\n\nE o [vídeo](saida/demo.mp4) e ![Logo](logo.svg) e [docs](README.md).";
    const ids: Record<string, string> = { "saida/capa.png": "a1", "saida/demo.mp4": "b2" };
    expect(reescreverLinks(texto, linksLocais(texto), (c) => ids[c] ?? null))
      .toBe("Fiz a capa:\n\nE o [vídeo](nod-anexo:b2) e Logo e [docs](README.md).");
  });

  it("sem links, o texto volta igual (nem o espaço muda)", () => {
    const texto = "  Só texto.  \n\n\n";
    expect(reescreverLinks(texto, linksLocais(texto), () => "x")).toBe(texto);
  });
});

describe("midia: achados da revisão 3 e do QA 2 do #507", () => {
  const ftyp = (marca: string) => { const b = new Uint8Array(32); b.set([0, 0, 0, 24], 0); b.set([..."ftyp" + marca].map((c) => c.charCodeAt(0)), 4); return b; };
  it("ftyp: só as marcas de MP4 conhecidas viram vídeo; HEIC e AVIF, não (M6)", () => {
    expect(farejarMidia(ftyp("isom"))).toBe("video/mp4");
    expect(farejarMidia(ftyp("mp42"))).toBe("video/mp4");
    expect(farejarMidia(ftyp("heic"))).toBeNull();
    expect(farejarMidia(ftyp("avif"))).toBeNull();
    expect(farejarMidia(ftyp("mif1"))).toBeNull();
  });
  it("ID3 seguido de texto não é MP3; o cabeçalho ID3v2 válido é", () => {
    expect(farejarMidia(new TextEncoder().encode("ID3 isto é um texto qualquer"))).toBeNull();
    expect(farejarMidia(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x10, 0x7f, 0xff, 0xfb]))).toBe("audio/mpeg");
    expect(farejarMidia(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x80, 0x00]))).toBeNull();
  });
  it("pasta ou arquivo oculto e cara de env não vão para o chat, nem no servidor", () => {
    for (const x of [".git", ".env.png", ".oculta", "png.env", "x.env.local", "env.png", ".env"]) expect(segmentoOculto(x)).toBe(true);
    for (const x of ["capa.png", "environment.png", "devenv.png", "video.mp4"]) expect(segmentoOculto(x)).toBe(false);
    expect(caminhoRelativoSeguro("Chico/.git/x.png", "Chico")).toBe(false);
    expect(caminhoRelativoSeguro("Chico/saida/png.env", "Chico")).toBe(false);
  });
  it("só a linha da imagem que saiu é arrumada: o bloco de código e os espaços ficam (M4)", () => {
    const texto = "Pronto:\n\n![capa](capa.png)\n\n```\na   \n\n\n\nb\n```\nfim  ";
    const links = linksLocais(texto);
    expect(reescreverLinks(texto, links, () => "id1")).toBe("Pronto:\n\n```\na   \n\n\n\nb\n```\nfim  ");
    expect(reescreverLinks("veja ![a](a.png) aqui", linksLocais("veja ![a](a.png) aqui"), () => "id1")).toBe("veja  aqui");
  });
});
