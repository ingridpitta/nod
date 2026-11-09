import { describe, expect, it } from "vitest";
import type { AnexoDaConversa } from "../../../src/contracts/anexo.ts";
import { LINK_ANEXO } from "../../../src/domain/midia.ts";
import { htmlErroMidia, renderMidiasDoBot, type ItemLuz } from "../../../web/lib/midia.ts";
import { LINK_ANEXO_WEB, textoFormatado } from "../../../web/lib/texto-formatado.ts";
import { destinoDaSeta, htmlDaLuz, htmlDoItem, proximaVel, rotuloVel, temFinder, VELOCIDADES } from "../../../web/telas/luz-html.ts";

/** NOD-323 (protótipo v3.1): a tela cheia, a velocidade, o link nod-anexo no texto e o cartão do arquivo que sumiu. */
const foto = (id: string, extra: Partial<ItemLuz> = {}): ItemLuz => ({ id, nome: `${id}.png`, mime: "image/png", url: `/u/${id}`, w: 1600, h: 900, ...extra });
const ID = "0b9f0d4e-3a1c-4c2b-9f00-1234567890ab";

describe("a tela cheia (J2/J3)", () => {
  it("uma imagem: sem setas nem miniaturas, nome sem posição, Baixar com ?baixar=1 e Fechar", () => {
    const h = htmlDaLuz([foto("a")], 0, null);
    expect(h).not.toContain("luz-seta");
    expect(h).not.toContain("luz-minis");
    expect(h).toContain('<p class="luz-legenda" id="luz-legenda">a.png</p>');
    expect(h).toContain('href="/u/a?baixar=1" download="a.png"');
    expect(h).toContain('data-luz="fechar" aria-label="Fechar"');
    expect(h).not.toContain("Mostrar no Finder");
  });
  it("várias: setas, i / N na legenda e as miniaturas com a atual marcada", () => {
    const h = htmlDaLuz([foto("a"), foto("b"), foto("c")], 1, null);
    expect(h).toContain('aria-label="Anterior"');
    expect(h).toContain('aria-label="Próxima"');
    expect(h).toContain("b.png · 2 / 3");
    expect(h.match(/class="luz-mini"/g)).toHaveLength(3);
    expect(h).toContain('data-luz-ir="1" aria-label="b.png, 2 de 3" aria-current="true"');
  });
  it("nas pontas a seta daquele lado some (sem dar a volta) — QA do #507", () => {
    const tres = [foto("a"), foto("b"), foto("c")];
    expect(htmlDaLuz(tres, 0, null)).toMatch(/data-luz="ant" aria-label="Anterior" hidden/);
    expect(htmlDaLuz(tres, 0, null)).not.toMatch(/data-luz="prox" aria-label="Próxima" hidden/);
    expect(htmlDaLuz(tres, 2, null)).toMatch(/data-luz="prox" aria-label="Próxima" hidden/);
    expect(htmlDaLuz(tres, 2, null)).not.toMatch(/data-luz="ant" aria-label="Anterior" hidden/);
    expect(destinoDaSeta(0, -1, 3)).toBeNull();
    expect(destinoDaSeta(2, 1, 3)).toBeNull();
    expect(destinoDaSeta(1, 1, 3)).toBe(2);
  });
  it("o vídeo abre já tocando na tela cheia; a miniatura de vídeo, não — QA do #507", () => {
    const h = htmlDaLuz([{ id: "v", nome: "v.mp4", mime: "video/mp4", url: "/u/v", dur: 3000 }, foto("a")], 0, null);
    expect(h).toMatch(/<video src="\/u\/v" preload="metadata" playsinline autoplay data-luz="video"/);
    expect(h.match(/autoplay/g)).toHaveLength(1);
  });
  it("vídeo: a barra mínima (play, trilha, tempo com a duração, 1×) e a proporção real", () => {
    const h = htmlDoItem(foto("v", { mime: "video/mp4", nome: "demo.mp4", w: 1280, h: 720, dur: 83_000 }), 0, 1);
    expect(h).toContain('<video src="/u/v" preload="metadata" playsinline autoplay data-luz="video" aria-label="demo.mp4">');
    expect(h).toContain("0:00 / 1:23");
    expect(h).toContain('aria-label="Velocidade 1×">1×</button>');
    expect(h).toContain("--ar:1.778");
  });
  it("GIF tem alt próprio; o nome é escapado", () => {
    expect(htmlDoItem(foto("g", { mime: "image/gif", nome: "<b>.gif" }), 0, 1)).toContain('alt="GIF: &lt;b&gt;.gif"');
  });
  it("Mostrar no Finder só no app do Mac da máquina do arquivo (e escondido nas outras mídias da mesma luz)", () => {
    expect(temFinder(foto("a", { mac: "m1" }), "m1")).toBe(true);
    expect(temFinder(foto("a", { mac: "m1" }), "m2")).toBe(false);
    expect(temFinder(foto("a"), "m1")).toBe(false);
    expect(temFinder(foto("a", { mac: "m1" }), null)).toBe(false);
    expect(htmlDaLuz([foto("a", { mac: "m1" })], 0, "m1")).toMatch(/data-luz="finder"[^>]*title="Mostrar no Finder">/);
    expect(htmlDaLuz([foto("a")], 0, "m1")).toMatch(/data-luz="finder"[^>]* hidden>/);
  });
  it("velocidade em ciclo: 0,5× 1× 1,25× 1,5× 2× e volta", () => {
    expect(VELOCIDADES.map(rotuloVel)).toEqual(["0,5×", "1×", "1,25×", "1,5×", "2×"]);
    expect(proximaVel(1)).toBe(1.25);
    expect(proximaVel(2)).toBe(0.5);
    expect(proximaVel(3)).toBe(0.5);
  });
});

describe("o link nod-anexo no texto do bot (J6)", () => {
  it("a regex da web é a mesma do servidor", () => {
    expect(LINK_ANEXO_WEB.source).toBe(LINK_ANEXO.source);
    expect(LINK_ANEXO_WEB.flags).toBe(LINK_ANEXO.flags);
  });
  it("vira um botão que abre a mídia daquela mensagem; o que não é uuid fica texto", () => {
    expect(textoFormatado(`veja [o vídeo](nod-anexo:${ID.toUpperCase()})`)).toBe(`veja <button type="button" class="md-midia-link" data-act="midia-abrir" data-anexo-id="${ID}">o vídeo</button>`);
    expect(textoFormatado("[x](nod-anexo:../../etc)")).not.toContain("<button");
    expect(textoFormatado(`[<img>](nod-anexo:${ID})`)).toContain(">&lt;img&gt;</button>");
  });
});

describe("o arquivo grande no Mac (J5)", () => {
  const grande: AnexoDaConversa = { id: "g", nome: "demo.mov", mime: "video/quicktime", tamanho: 900 * 1024 * 1024, origem: "bot", semBytes: true, maquina: { id: "m1", nome: "MacBook" } } as AnexoDaConversa;
  const url = (id: string) => `/u/${id}`;
  it("no Mac dele: Mostrar no Finder e o que a conferência precisa (url e bot)", () => {
    const h = renderMidiasDoBot([grande], { url, esteMac: "m1", bot: "Faustino" });
    expect(h).toContain('data-act="midia-finder"');
    expect(h).toContain('data-midia-local="1" data-midia-url="/u/g" data-bot="Faustino"');
  });
  it("noutro aparelho: onde ele está, sem Finder nem conferência", () => {
    const h = renderMidiasDoBot([grande], { url, esteMac: null, bot: "Faustino" });
    expect(h).toContain("Fica na pasta do Faustino no MacBook.");
    expect(h).not.toContain("data-midia-local");
  });
  it("o que sumiu da pasta vira o cartão apagado, sem ação", () => {
    const h = renderMidiasDoBot([grande], { url, esteMac: "m1", bot: "Faustino", sumiram: new Set(["g"]) });
    expect(h).toContain('class="msg-arquivo alto mudo"');
    expect(h).toContain("Não está mais na pasta do Faustino.");
    expect(h).not.toContain("midia-finder");
  });
});

describe("a mídia que não carregou (j5-2) — QA do #507", () => {
  it("fora de um botão (o memo), Tentar de novo é um botão de verdade; dentro, o próprio botão da mídia tenta de novo", () => {
    expect(htmlErroMidia(false)).toContain('<button type="button" class="bt link sm" data-act="midia-tentar">Tentar de novo</button>');
    expect(htmlErroMidia(true)).not.toContain("<button");
    expect(htmlErroMidia(true)).toContain('aria-hidden="true"');
  });
});
