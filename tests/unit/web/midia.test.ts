import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { LIMITE_POR_FAMILIA, MOTIVOS_RECUSA_MIDIA, type AnexoDaConversa } from "../../../src/contracts/anexo.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { baixaveis, duracaoHumana, LIMITE_WEB, MOTIVOS_RECUSA_WEB, renderMidiasDoBot, textoRecusas, type ItemLuz } from "../../../web/lib/midia.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";

/** NOD-323 (ADR-126, protótipo v3.1): a mídia que o bot anexou, abaixo do balão. */

const url = (id: string) => `/u/${id}`;
const img = (id: string, w: number, h: number, extra: Partial<AnexoDaConversa> = {}): AnexoDaConversa => ({ id, nome: `${id}.png`, mime: "image/png", tamanho: 1000, origem: "bot", largura: w, altura: h, ...extra });
const luzDe = (html: string): ItemLuz[] => JSON.parse(/data-luz="([^"]*)"/.exec(html)![1]!.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")) as ItemLuz[];

describe("renderMidiasDoBot (NOD-323)", () => {
  it("sem mídia do bot não desenha nada (a da pessoa e a captura ficam onde estão)", () => {
    expect(renderMidiasDoBot([], { url })).toBe("");
    expect(renderMidiasDoBot([img("a", 10, 10, { origem: "pessoa" }), img("b", 10, 10, { origem: "captura" })], { url })).toBe("");
  });

  it("1 imagem: proporção real, cabe em 400 × 400, alt com o nome, abre em tela cheia", () => {
    const h = renderMidiasDoBot([img("a", 1600, 900)], { url });
    expect(h).toContain('class="msg-midia-img" style="--w:400px;--ar:1.778"');
    expect(h).toContain('alt="Imagem: a.png"');
    expect(h).toContain('data-act="midia-abrir" data-anexo-id="a" data-i="0" aria-haspopup="dialog"');
    expect(h).toContain('width="1600" height="900"');
    // retrato: a altura manda (400 de altura → 225 de largura); pequena: o tamanho do arquivo
    expect(renderMidiasDoBot([img("r", 900, 1600)], { url })).toContain("--w:225px");
    expect(renderMidiasDoBot([img("p", 120, 80)], { url })).toContain("--w:120px");
  });

  it("2 e 3 de mesma proporção: grade quadrada; proporções diferentes: a linha de 180 px sem recorte", () => {
    expect(renderMidiasDoBot([img("a", 100, 100), img("b", 200, 200)], { url })).toContain('class="msg-midia-grade" style="--k:2"');
    const linha = renderMidiasDoBot([img("a", 300, 200), img("b", 100, 100)], { url });
    expect(linha).toContain('class="msg-midia-linha" style="--n:2;--soma:2.5"');
    expect(linha).toContain('style="--r:1.5;--ar:1.5"');
    expect(linha).not.toContain("msg-midia-grade");
  });

  it("7 imagens: três na grade, a 3ª com +5 que abre nela, e a tela cheia navega as 7 na ordem", () => {
    const sete = Array.from({ length: 7 }, (_, i) => img(`i${i}`, 100, 100));
    const h = renderMidiasDoBot(sete, { url });
    expect(h).toContain('style="--k:3"');
    expect(h.match(/data-act="midia-abrir"/g)).toHaveLength(3);
    expect(h).toContain('aria-label="Ver as outras 5 imagens"');
    expect(h).toContain(">+5<");
    expect(h).toContain('data-i="2"');
    expect(luzDe(h).map((x) => x.id)).toEqual(sete.map((a) => a.id));
  });

  it("GIF: anima com Pausar; pausado pela pessoa ou com movimento reduzido abre parado com Reproduzir", () => {
    const g = img("g", 200, 200, { mime: "image/gif", nome: "g.gif" });
    const anima = renderMidiasDoBot([g], { url });
    expect(anima).toContain('class="msg-midia-gif"');
    expect(anima).toContain('aria-pressed="false" aria-label="Pausar g.gif"');
    const pausado = renderMidiasDoBot([g], { url, gifsPausados: new Set(["g"]) });
    expect(pausado).toContain('class="msg-midia-gif parado"');
    expect(pausado).toContain('aria-label="Reproduzir g.gif"');
    expect(renderMidiasDoBot([g], { url, reduzirMovimento: true })).toContain("msg-midia-gif parado");
    // com movimento reduzido, a escolha da pessoa (Reproduzir) vale
    expect(renderMidiasDoBot([g], { url, reduzirMovimento: true, gifsPausados: new Set(["g"]) })).toContain('class="msg-midia-gif"');
    // na grade o GIF é só a prévia: fica no quadro
    expect(renderMidiasDoBot([g, img("b", 10, 10)], { url })).toContain("msg-midia-cel msg-midia-borda parado");
  });

  it("vídeo: só a capa com ▶ e a duração, que abre o player em tela cheia", () => {
    const h = renderMidiasDoBot([{ id: "v", nome: "demo.mp4", mime: "video/mp4", tamanho: 5, origem: "bot", largura: 1280, altura: 720, duracaoMs: 72_000 }], { url });
    expect(h).toContain('class="msg-midia-vid"');
    expect(h).toContain('aria-label="Assistir demo.mp4, 1:12"');
    expect(h).toContain('src="/u/v#t=0.1" preload="metadata" muted playsinline');
    expect(h).toContain('<span class="msg-midia-dur">1:12</span>');
    expect(luzDe(h)).toEqual([{ id: "v", nome: "demo.mp4", mime: "video/mp4", url: "/u/v", w: 1280, h: 720, dur: 72_000 }]);
  });

  it("áudio: o memo (play, velocidade, trilha e tempo) toca ali mesmo e não entra na tela cheia", () => {
    const h = renderMidiasDoBot([{ id: "s", nome: "voz.mp3", mime: "audio/mpeg", tamanho: 5, origem: "bot", duracaoMs: 9_000 }], { url });
    expect(h).toContain('class="msg-memo"');
    expect(h).toContain('aria-label="Reproduzir voz.mp3"');
    expect(h).toContain('aria-valuetext="0:00 de 0:09"');
    expect(h).toContain('<audio src="/u/s" preload="metadata"');
    expect(luzDe(h)).toEqual([]);
  });

  it("grande demais: cartão com o tamanho e o limite; Finder só no Mac desta máquina; fora dele, onde está", () => {
    const grande: AnexoDaConversa = { id: "x", nome: "longo.mp4", mime: "video/mp4", tamanho: 80 * 1024 * 1024, origem: "bot", semBytes: true, maquina: { id: "m1", nome: "MacBook" } };
    const noMac = renderMidiasDoBot([grande], { url, bot: "Chico", esteMac: "m1" });
    expect(noMac).toContain("80,0 MB · passa do limite de 50 MB para vídeo no chat");
    expect(noMac).toContain('data-act="midia-finder" data-anexo-id="x"');
    expect(noMac).toContain('data-midia-local="1"');
    const naWeb = renderMidiasDoBot([grande], { url, bot: "Chico", esteMac: null });
    expect(naWeb).not.toContain("midia-finder");
    expect(naWeb).toContain("Fica na pasta do Chico no MacBook.");
    expect(renderMidiasDoBot([grande], { url, esteMac: "outro" })).toContain("Fica na pasta do bot no MacBook.");
    expect(naWeb).not.toContain("/u/x");
    expect(baixaveis([grande, img("a", 1, 1), img("p", 1, 1, { origem: "pessoa" })]).map((a) => a.id)).toEqual(["a"]);
  });

  it("pdf do bot: o card de arquivo com prévia e Baixar", () => {
    const h = renderMidiasDoBot([{ id: "d", nome: "r.pdf", mime: "application/pdf", tamanho: 2048, origem: "bot" }], { url });
    expect(h).toContain('<div class="msg-arquivos"><div class="msg-arquivo" data-anexo-id="d">');
    expect(h).toContain('data-act="previa-arquivo"');
  });

  it("o nome do arquivo é escapado em todo lugar", () => {
    const h = renderMidiasDoBot([img("a", 1, 1, { nome: '"><img src=x onerror=1>.png' })], { url });
    expect(h).not.toContain("<img src=x");
    expect(luzDe(h)[0]!.nome).toBe('"><img src=x onerror=1>.png');
  });

  it("duração humana", () => {
    expect([duracaoHumana(0), duracaoHumana(65_400), duracaoHumana(3_725_000), duracaoHumana(undefined)]).toEqual(["0:00", "1:05", "1:02:05", null]);
  });
});

describe("linha do que não entrou (j5-6)", () => {
  it("singular, plural e vários motivos, sem caminho", () => {
    expect(textoRecusas([{ motivo: "fora_da_pasta", n: 1 }], "Chico")).toBe("1 arquivo não foi anexado: fica fora da pasta do Chico.");
    expect(textoRecusas([{ motivo: "credencial", n: 2 }])).toBe("2 arquivos não foram anexados: são arquivos de credencial.");
    expect(textoRecusas([{ motivo: "nao_existe", n: 1 }, { motivo: "vazio", n: 2 }])).toBe("3 arquivos não foram anexados: 1 não foi encontrado; 2 estão vazios.");
    expect(textoRecusas([])).toBeNull();
    expect(textoRecusas(undefined)).toBeNull();
  });
});

describe("paridade com src/contracts (a web só importa tipos)", () => {
  it("limites e motivos", () => {
    expect(LIMITE_WEB).toEqual({ imagem: LIMITE_POR_FAMILIA.imagem, video: LIMITE_POR_FAMILIA.video, audio: LIMITE_POR_FAMILIA.audio, arquivo: LIMITE_POR_FAMILIA.pdf });
    expect(LIMITE_POR_FAMILIA.gif).toBe(LIMITE_POR_FAMILIA.imagem);
    expect(LIMITE_POR_FAMILIA.zip).toBe(LIMITE_POR_FAMILIA.pdf);
    expect([...MOTIVOS_RECUSA_WEB].sort()).toEqual([...MOTIVOS_RECUSA_MIDIA].sort());
  });
});

describe("na conversa (renderMensagem)", () => {
  const C = "c1";
  const msg = (extra: Partial<Mensagem>): Mensagem => ({
    tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: { autor_tipo: "agente", autor_id: "a" },
    kind: "texto", texto: "Pronto, segue o gráfico.", payload: null, confianca: "confiavel", parcial: false, criadoEm: 1, ...extra,
  } as Mensagem);
  function estado(): Estado {
    const conversa: ConversaDto = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
      mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    };
    const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
    return { ...base, agora: 1, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Chico", conversaId: C, cor: "blue", forma: "square" }] } as never };
  }

  it("a mídia do bot vai abaixo do balão (não em msg-anexos nem como captura), com a rota de anexos", () => {
    const html = renderMensagem(msg({ anexos: [img("g", 640, 480)] }), estado());
    expect(html).not.toContain("msg-anexos");
    expect(html).not.toContain("msg-captura");
    expect(html.indexOf('class="msg-midias"')).toBeGreaterThan(html.indexOf('class="bubble"'));
    expect(html).toContain(`/api/t/t/conversas/${C}/anexos/g`);
  });

  it("a captura antiga (sem origem) continua captura", () => {
    const html = renderMensagem(msg({ anexos: [{ id: "c", nome: "tela.png", mime: "image/png", tamanho: 1 }] }), estado());
    expect(html).toContain("msg-captura");
    expect(html).not.toContain("msg-midias");
  });

  it("fala só com mídia não desenha balão vazio; as recusas aparecem na linha discreta", () => {
    const html = renderMensagem(msg({ texto: "", anexos: [img("g", 10, 10)], midiaRecusas: [{ motivo: "fora_da_pasta", n: 1 }] }), estado());
    expect(html).not.toContain('class="bubble"');
    expect(html).toContain("1 arquivo não foi anexado: fica fora da pasta do Chico.");
  });

  it("o render é determinístico (o bloco da mensagem não é refeito à toa)", () => {
    const e = estado();
    const m = msg({ anexos: [img("a", 10, 10), img("b", 20, 10), { id: "v", nome: "v.mp4", mime: "video/mp4", tamanho: 1, origem: "bot" }] });
    expect(renderMensagem(m, e)).toBe(renderMensagem(m, e));
  });
});
