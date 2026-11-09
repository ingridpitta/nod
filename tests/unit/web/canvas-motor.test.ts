import { describe, expect, it } from "vitest";
import type { EstruturaCanvasDto, TelaCanvasDto } from "../../../src/contracts/canvas.ts";
import { CSP_ARTEFATO } from "../../../web/lib/artefato.ts";
import {
  abertosPorEndereco, ajustar, CABECA, depoisDaBusca, PAUSA_BLOBS_MS, caixaDaFileira, canvasDaUrl, documentoDaTela, escolherVivos, fracaoNaTela, hashesQueFaltam, ignorarPonteiro, lerHash, MAX_VIVOS,
  montarLayout, noMundo, seloDaVersao, tamanhoReal, telaNoPonto, urlDoCanvas, VAO, visiveis, ZOOM_MAX, ZOOM_MIN, zoomNoPonto,
} from "../../../web/lib/canvas-motor.ts";

/** ADA-13 (ADR-150): o motor da página Canvas, sem DOM. */
const H = (n: number): string => n.toString(16).padStart(64, "0");
const tela = (id: string, tamanho: "desk" | "cel" = "desk", html = H(1)): TelaCanvasDto => ({ id, jornada: id.split("-")[0]!, titulo: id, legenda: "", tamanho, hoje: false, novo: [], html, miniatura: null });
const estrutura = (jornadas: TelaCanvasDto[][]): EstruturaCanvasDto => ({
  issue: null, titulo: "t", versaoTexto: null, links: [], css: [H(100)], js: [H(101)], notas: [],
  jornadas: jornadas.map((telas, i) => ({ id: `J${i + 1}`, titulo: `J${i + 1}`, resumo: "", telas })),
});

describe("canvas-motor: layout", () => {
  it("põe as telas no tamanho real, lado a lado, e a jornada seguinte embaixo da mais alta", () => {
    const l = montarLayout(estrutura([[tela("J1-1"), tela("J1-2", "cel")], [tela("J2-1", "cel")]]));
    const a = l.porId.get("J1-1")!;
    const b = l.porId.get("J1-2")!;
    const c = l.porId.get("J2-1")!;
    expect([a.w, a.h, b.w, b.h]).toEqual([1440, 900, 390, 844]);
    expect(b.x).toBe(1440 + VAO);
    expect(a.y).toBe(CABECA);
    expect(c.y).toBeGreaterThan(a.y + a.h);
    expect(l.limites.w).toBe(1440 + VAO + 390);
    expect(caixaDaFileira(l.fileiras[0]!).w).toBe(l.limites.w);
  });
  it("estrutura vazia não quebra", () => {
    const l = montarLayout({ jornadas: [] });
    expect(l.limites).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(ajustar(l.limites, { w: 800, h: 600 }).zoom).toBe(1);
  });
});

describe("canvas-motor: vista", () => {
  it("Ajustar cabe tudo na tela e centra", () => {
    const v = ajustar({ x: 0, y: 0, w: 4000, h: 2000 }, { w: 1000, h: 800 }, 0);
    expect(v.zoom).toBeCloseTo(0.25);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo((800 - 500) / 2);
  });
  it("o zoom fica preso entre o mínimo e o máximo", () => {
    expect(ajustar({ x: 0, y: 0, w: 1e7, h: 1e7 }, { w: 100, h: 100 }).zoom).toBe(ZOOM_MIN);
    expect(zoomNoPonto({ x: 0, y: 0, zoom: 1 }, 100, 0, 0).zoom).toBe(ZOOM_MAX);
  });
  it("zoom no ponto mantém o ponto do mundo embaixo do ponteiro", () => {
    const v = { x: 30, y: -40, zoom: 0.5 };
    const antes = noMundo(v, 300, 200);
    const depois = noMundo(zoomNoPonto(v, 1.7, 300, 200), 300, 200);
    expect(depois.x).toBeCloseTo(antes.x);
    expect(depois.y).toBeCloseTo(antes.y);
  });
  it("tamanho real = zoom 1 e a tela centrada (ou no topo, se não cabe)", () => {
    const t = { x: 2000, y: 500, w: 390, h: 844 };
    const v = tamanhoReal(t, { w: 1200, h: 1000 });
    expect(v.zoom).toBe(1);
    expect(t.x + v.x).toBe((1200 - 390) / 2);
    expect(t.y + v.y).toBe((1000 - 844) / 2);
    expect(t.y + tamanhoReal(t, { w: 1200, h: 700 }).y).toBe(16);
  });
});

describe("canvas-motor: endereço", () => {
  it("lê #Jx-y como tela e #Jx como jornada; o resto é null", () => {
    expect(lerHash("#J1-2")).toEqual({ tela: "J1-2" });
    expect(lerHash("J3")).toEqual({ jornada: "J3" });
    expect(lerHash("#conversa")).toBeNull();
    expect(lerHash("#J1-2;alert(1)")).toBeNull();
  });
});

describe("canvas-motor: visíveis e vivos", () => {
  const l = montarLayout(estrutura([Array.from({ length: 30 }, (_, i) => tela(`J1-${i + 1}`))]));
  it("só as telas perto da vista contam como visíveis", () => {
    const v = tamanhoReal(l.porId.get("J1-1")!, { w: 1600, h: 1000 });
    const ids = visiveis(l, v, { w: 1600, h: 1000 }).map((t) => t.tela.id);
    expect(ids).toContain("J1-1");
    expect(ids).not.toContain("J1-10");
  });
  it("no máximo 12 vivos, os mais perto do centro, e nenhum com o zoom baixo demais", () => {
    const todas = [...l.porId.values()];
    const v = { x: 0, y: 0, zoom: 0.5 };
    const vivos = escolherVivos(todas, v, { w: 1000, h: 800 }, new Set());
    expect(vivos).toHaveLength(MAX_VIVOS);
    expect(vivos[0]).toBe("J1-1");
    expect(escolherVivos(todas, { ...v, zoom: 0.05 }, { w: 1000, h: 800 }, new Set())).toEqual([]);
  });
  it("o que já estava vivo ganha o empate (sem piscar ao rolar)", () => {
    const duas = [l.porId.get("J1-1")!, l.porId.get("J1-2")!];
    const centro = { x: -(1440 + VAO / 2) * 0.5 + 500, y: 0, zoom: 0.5 };
    expect(escolherVivos(duas, centro, { w: 1000, h: 800 }, new Set(["J1-2"]), { max: 1 })).toEqual(["J1-2"]);
    expect(escolherVivos(duas, centro, { w: 1000, h: 800 }, new Set(["J1-1"]), { max: 1 })).toEqual(["J1-1"]);
  });
});

describe("canvas-motor: pino", () => {
  it("fração da tela presa em [0, 1] e a tela embaixo do ponto", () => {
    const l = montarLayout(estrutura([[tela("J1-1")]]));
    const t = l.porId.get("J1-1")!;
    expect(fracaoNaTela(t, { x: t.x + 720, y: t.y + 225 })).toEqual({ x: 0.5, y: 0.25 });
    expect(fracaoNaTela(t, { x: t.x - 10, y: t.y + 5000 })).toEqual({ x: 0, y: 1 });
    expect(telaNoPonto(l, { x: t.x + 1, y: t.y + 1 })?.tela.id).toBe("J1-1");
    expect(telaNoPonto(l, { x: -5, y: -5 })).toBeNull();
  });
  it("conta só os abertos de primeiro nível, por tela ou jornada", () => {
    const c = (o: Partial<{ telaId: string | null; jornada: string | null; paiId: string | null; resolvido: boolean; arquivado: boolean }>) => ({ telaId: null, jornada: null, paiId: null, resolvido: false, arquivado: false, ...o });
    const m = abertosPorEndereco([c({ telaId: "J1-1" }), c({ telaId: "J1-1" }), c({ telaId: "J1-1", paiId: "x" }), c({ telaId: "J1-1", resolvido: true }), c({ jornada: "J2" })]);
    expect(m.get("J1-1")).toBe(2);
    expect(m.get("J2")).toBe(1);
  });
});

describe("canvas-motor: documento da tela (ADR-051)", () => {
  it("a CSP sem rede e a ponte vêm antes de qualquer byte do protótipo", () => {
    const d = documentoDaTela({ html: "<p>oi</p><script>fetch('x')</script>", css: ["body{}"], js: ["</script><script>alert(1)"], novo: [".nova"] });
    const iCsp = d.indexOf("Content-Security-Policy");
    expect(iCsp).toBeGreaterThan(0);
    expect(d).toContain(CSP_ARTEFATO.replace(/'/g, "&#39;"));
    expect(iCsp).toBeLessThan(d.indexOf("<p>oi</p>"));
    expect(d).toContain('[".nova"]');
    // O JS comum não fecha o próprio <script> antes da hora.
    expect(d).not.toContain("</script><script>alert(1)");
  });
  it("revisão 9 do #649 (M1): o mesmo contexto do docHtml do Gil (tema claro, cv-dentro/cv-cel e o wrapper .cv-tela)", () => {
    const cel = documentoDaTela({ html: "<p>oi</p>", css: [], js: [], novo: [], tamanho: "cel" });
    expect(cel).toContain('<html lang="pt-BR" data-theme="light" class="cv-dentro cv-cel">');
    expect(cel).toContain('<body><div class="cv-tela"><p>oi</p></div>');
    expect(documentoDaTela({ html: "x", css: [], js: [], novo: [], tamanho: "desk" })).toContain('class="cv-dentro">');
  });
  it("pede só os hashes que faltam (CSS e JS comuns, o HTML das vivas)", () => {
    const e = estrutura([[tela("J1-1", "desk", H(1)), tela("J1-2", "desk", H(2))]]);
    expect(hashesQueFaltam(e, ["J1-2"], new Set([H(100)])).sort()).toEqual([H(101), H(2)].sort());
  });
});

describe("canvas-motor: busca de blobs (codex no #649, P2)", () => {
  it("a busca que falhou pausa e não marca nada como ausente; a que deu certo marca só o que não veio", () => {
    expect(depoisDaBusca([H(1), H(2)], new Set(), true, 1000)).toEqual({ ausentes: [], pausaAte: 1000 + PAUSA_BLOBS_MS });
    expect(depoisDaBusca([H(1), H(2)], new Set([H(1)]), false, 1000)).toEqual({ ausentes: [H(2)], pausaAte: 0 });
    expect(depoisDaBusca([H(1)], new Set([H(1)]), false, 1000)).toEqual({ ausentes: [], pausaAte: 0 });
  });
});

describe("canvas-motor: confiança (ADR-051 §3, #649 A3)", () => {
  it("a versão não confiável leva o selo; a confiável, nada", () => {
    expect(seloDaVersao(false)).toContain("não confiável");
    expect(seloDaVersao(true)).toBe("");
  });
});

describe("canvas-motor: ponteiro no palco (#649 revisão 2, M3)", () => {
  it("no tamanho real o clique é do protótipo, salvo no modo Pino; botão e link nunca arrastam", () => {
    expect(ignorarPonteiro({ controle: false, noReal: true, modoPino: false })).toBe(true);
    expect(ignorarPonteiro({ controle: false, noReal: true, modoPino: true })).toBe(false);
    expect(ignorarPonteiro({ controle: true, noReal: false, modoPino: true })).toBe(true);
    expect(ignorarPonteiro({ controle: false, noReal: false, modoPino: false })).toBe(false);
  });
});

describe("canvas-motor: o canvas na URL (#649 revisão 3, M3)", () => {
  const ID = "6f4e66aa-0000-4000-8000-000000000001";
  it("o canvas aberto vai para a URL com o endereço, e volta dela depois do reload", () => {
    const url = urlDoCanvas("https://nod.exemplo/c/abc?tarefa=ADA-13#velho", ID, "J1-2");
    expect(url).toBe(`/c/abc?tarefa=ADA-13&canvas=${ID}#J1-2`);
    expect(canvasDaUrl(`https://nod.exemplo${url}`)).toBe(ID);
    expect(urlDoCanvas(`https://nod.exemplo${url}`, ID)).toBe(url); // undefined mantém o hash
    expect(urlDoCanvas(`https://nod.exemplo${url}`, ID, null)).toBe(`/c/abc?tarefa=ADA-13&canvas=${ID}`);
  });
  it("fechar o canvas tira o parâmetro e o hash; o que não é uuid não abre", () => {
    expect(urlDoCanvas(`https://nod.exemplo/c/abc?canvas=${ID}#J1-2`, null)).toBe("/c/abc");
    expect(canvasDaUrl("https://nod.exemplo/?canvas=../x")).toBeNull();
    expect(canvasDaUrl("https://nod.exemplo/")).toBeNull();
  });
});
