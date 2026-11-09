import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { criarTocadorDeLeitura, dePcm16BE, TAXA_LEITURA, urlDaLeitura, type BufferDeAudio, type ContextoDeAudio, type FonteDeAudio, type LeituraAtual, type MotivoParada } from "../../../web/lib/ouvir.ts";
import { podeOuvir, renderMensagem } from "../../../web/telas/conversa.ts";

/** NOD-106: o botão Ouvir em cada resposta — tocador, estado no reducer e o botão na barra. */

const C = "c1";
function cenario(ouvir = true): Estado {
  const conversa: ConversaDto = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
  return {
    ...base,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C, cor: "c-blue", forma: "shape-square", ownerId: "p" }, { id: "e", nome: "Equipe", conversaId: "c2", cor: "c-blue", forma: "shape-square", ownerId: "outra" }] } as never,
    disponibilidadeLigacao: { a: { disponivel: true as const, consentimentoNecessario: false, versaoConsentimento: 3, provedor: "google", ouvir }, e: { disponivel: true as const, consentimentoNecessario: false, versaoConsentimento: 3, provedor: "google", ouvir: true } },
  };
}
const resposta = (o: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id: "m1", conversaId: C, turnoId: null, autoria: { autor_tipo: "agente", autor_id: "a" }, kind: "texto", texto: "Oi! Tudo certo.", payload: null, confianca: "confiavel", parcial: false, criadoEm: Date.UTC(2026, 9, 17, 14, 0), ...o,
} as Mensagem);

describe("quem tem o botão Ouvir", () => {
  it("só a resposta pronta de texto do bot próprio, com a leitura ligada", () => {
    const e = cenario();
    expect(podeOuvir(resposta(), e, false)).toBe(true);
    expect(podeOuvir(resposta(), e, true)).toBe(false);
    expect(podeOuvir(resposta({ parcial: true }), e, false)).toBe(false);
    expect(podeOuvir(resposta({ kind: "sistema" }), e, false)).toBe(false);
    expect(podeOuvir(resposta({ payload: { kind: "artefato" } as never }), e, false)).toBe(false);
    expect(podeOuvir(resposta({ autoria: { autor_tipo: "pessoa", autor_id: "p" } as never }), e, false)).toBe(false);
    expect(podeOuvir(resposta({ autoria: { autor_tipo: "agente", autor_id: "e" } as never }), e, false)).toBe(false);
    expect(podeOuvir(resposta(), cenario(false), false)).toBe(false);
    expect(podeOuvir(resposta(), { ...e, disponibilidadeLigacao: {} }, false)).toBe(false);
  });

  it("ocioso: alto-falante com rótulo, antes do besouro; sem aria-pressed nem disabled", () => {
    const html = renderMensagem(resposta(), cenario());
    expect(html).toMatch(/<button[^>]*data-act="ouvir-mensagem"[^>]*data-id="m1"/);
    expect(html).toContain('aria-label="Ouvir a resposta"');
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toMatch(/data-act="ouvir-mensagem"[^>]*\sdisabled/);
    if (html.includes('data-act="relatar-mensagem"')) expect(html.indexOf('data-act="ouvir-mensagem"')).toBeLessThan(html.indexOf('data-act="relatar-mensagem"'));
    expect(renderMensagem(resposta(), cenario(false))).not.toContain("ouvir-mensagem");
  });

  it("carregando e tocando: pílula Parar; aria-busy só no carregando; a barra fica à mostra (.lendo)", () => {
    const carregando = renderMensagem(resposta(), { ...cenario(), leitura: { mensagemId: "m1", fase: "carregando" } });
    expect(carregando).toContain('aria-label="Parar de ouvir"');
    expect(carregando).toContain('aria-busy="true"');
    expect(carregando).toContain("<span>Parar</span>");
    expect(carregando).toMatch(/<article[^>]*class="[^"]*\blendo\b/);
    expect(carregando).not.toContain('data-act="relatar-mensagem"');
    const tocando = renderMensagem(resposta(), { ...cenario(), leitura: { mensagemId: "m1", fase: "tocando" } });
    expect(tocando).toContain("ouvir-tocando");
    expect(tocando).not.toContain("aria-busy");
    // Outra resposta lendo: esta continua ociosa.
    const outra = renderMensagem(resposta(), { ...cenario(), leitura: { mensagemId: "m9", fase: "tocando" } });
    expect(outra).toContain('aria-label="Ouvir a resposta"');
    expect(outra).not.toMatch(/<article[^>]*class="[^"]*\blendo\b/);
  });

  it("ligação viva: aria-disabled com o motivo ligado por aria-describedby, ainda focável", () => {
    const html = renderMensagem(resposta(), { ...cenario(), ligacaoViva: { ligacaoId: "l1", agenteId: "a", conversaId: C, local: true } });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-describedby="dica-ouvir-m1"');
    expect(html).toMatch(/id="dica-ouvir-m1"[^>]*>Desligue a ligação para ouvir</);
    expect(html).not.toMatch(/data-act="ouvir-mensagem"[^>]*\sdisabled/);
  });

  it("falha antes do som: o aviso embaixo do balão, só na resposta que falhou", () => {
    const e = { ...cenario(), falhaLeitura: { mensagemId: "m1" } };
    const html = renderMensagem(resposta(), e);
    expect(html).toContain('role="status"');
    expect(html).toContain("Não deu para ouvir agora.");
    expect(html.indexOf("Não deu para ouvir agora.")).toBeGreaterThan(html.indexOf("bubble"));
    expect(renderMensagem(resposta({ id: "m2" }), e)).not.toContain("Não deu para ouvir agora.");
  });
});

describe("estado da leitura no reducer", () => {
  it("leitura-mudou troca a fase e mantém a falha quando ela não vem", () => {
    const e0 = cenario();
    expect(e0.leitura).toBeNull();
    const e1 = reduzir(e0, { tipo: "leitura-mudou", leitura: { mensagemId: "m1", fase: "carregando" }, falha: { mensagemId: "m0" } });
    expect(e1.leitura).toEqual({ mensagemId: "m1", fase: "carregando" });
    const e2 = reduzir(e1, { tipo: "leitura-mudou", leitura: { mensagemId: "m1", fase: "tocando" } });
    expect(e2.falhaLeitura).toEqual({ mensagemId: "m0" });
    expect(reduzir(e2, { tipo: "leitura-mudou", leitura: { mensagemId: "m1", fase: "tocando" } })).toBe(e2);
    expect(reduzir(e2, { tipo: "leitura-mudou", leitura: null, falha: null })).toMatchObject({ leitura: null, falhaLeitura: null });
  });
});

describe("PCM16 big-endian", () => {
  it("lê big-endian e guarda o byte que sobra para o próximo pedaço", () => {
    const a = dePcm16BE(new Uint8Array([0x40, 0x00, 0x80]), null);
    expect(Array.from(a.amostras)).toEqual([0.5]);
    expect(a.sobra).toBe(0x80);
    const b = dePcm16BE(new Uint8Array([0x00, 0x7f, 0xff]), a.sobra);
    expect(Array.from(b.amostras)).toEqual([-1, 0x7fff / 0x8000]);
    expect(b.sobra).toBeNull();
  });

  it("a URL escapa o tenant e o id", () => {
    expect(urlDaLeitura("t 1", "m/2")).toBe("/api/t/t%201/mensagens/m%2F2/ouvir");
  });
});

type FonteFalsa = FonteDeAudio & { quando: number | null; parada: boolean };
function contextoFalso(aoCriarFonte: () => void = () => undefined): ContextoDeAudio & { agora: number; fontes: FonteFalsa[]; resumes: number; estado: string } {
  const c = {
    agora: 0,
    fontes: [] as FonteFalsa[],
    resumes: 0,
    estado: "suspended",
    get currentTime() { return c.agora; },
    get state() { return c.estado; },
    destination: {},
    resume: () => { c.resumes++; c.estado = "running"; return Promise.resolve(); },
    createBuffer: (_canais: number, quadros: number, taxa: number): BufferDeAudio => {
      const dados = new Float32Array(quadros);
      return { duration: quadros / taxa, getChannelData: () => dados };
    },
    createBufferSource: (): FonteDeAudio => {
      aoCriarFonte();
      const f: FonteFalsa = { buffer: null, onended: null, quando: null, parada: false, connect: () => undefined, start: (q) => { f.quando = q ?? 0; }, stop: () => { f.parada = true; } };
      c.fontes.push(f);
      return f;
    },
  };
  return c;
}

/** Um corpo que a gente empurra pedaço a pedaço. */
function corpoControlado(): { resposta: Response; empurrar(b: Uint8Array): void; fechar(): void; quebrar(): void } {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const corpo = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
  return { resposta: new Response(corpo, { status: 200, headers: { "content-type": "audio/L16; rate=24000" } }), empurrar: (b) => ctl.enqueue(b), fechar: () => ctl.close(), quebrar: () => ctl.error(new Error("caiu")) };
}
const pcm = (amostras: number): Uint8Array => new Uint8Array(amostras * 2).fill(0x10);
const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function montar(fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>) {
  const ctx = contextoFalso();
  const mudancas: { atual: LeituraAtual | null; motivo?: MotivoParada }[] = [];
  const urls: string[] = [];
  const t = criarTocadorDeLeitura({
    fetch: (url, init) => { urls.push(url); return fetch(url, init); },
    criarContexto: () => ctx,
    aoMudar: (atual, motivo) => mudancas.push(motivo ? { atual, motivo } : { atual }),
  });
  return { t, ctx, mudancas, urls };
}

describe("tocador da leitura", () => {
  it("destravar cria e retoma o contexto uma vez só", () => {
    const { t, ctx } = montar(() => new Promise(() => undefined));
    t.destravar();
    t.destravar();
    expect(ctx.resumes).toBe(1);
  });

  it("encadeia os pedaços sem buraco, vai de carregando a tocando e termina quando o último acaba", async () => {
    const corpo = corpoControlado();
    const { t, ctx, mudancas, urls } = montar(() => Promise.resolve(corpo.resposta));
    ctx.agora = 1;
    const fim = t.ouvir("t", "m1");
    expect(t.atual()).toEqual({ mensagemId: "m1", fase: "carregando" });
    expect(urls).toEqual(["/api/t/t/mensagens/m1/ouvir"]);
    corpo.empurrar(pcm(2400));
    await esperar();
    expect(t.atual()?.fase).toBe("tocando");
    corpo.empurrar(pcm(4800));
    corpo.fechar();
    expect(await fim).toEqual({ ok: true });
    expect(ctx.fontes).toHaveLength(2);
    expect(ctx.fontes[0]?.quando).toBeCloseTo(1.05, 5);
    expect(ctx.fontes[1]?.quando).toBeCloseTo(1.05 + 2400 / TAXA_LEITURA, 5);
    expect(t.atual()?.fase).toBe("tocando");
    ctx.fontes[0]?.onended?.();
    expect(t.atual()).not.toBeNull();
    ctx.fontes[1]?.onended?.();
    expect(t.atual()).toBeNull();
    expect(mudancas).toEqual([{ atual: { mensagemId: "m1", fase: "carregando" } }, { atual: { mensagemId: "m1", fase: "tocando" } }, { atual: null, motivo: "terminou" }]);
  });

  it("parar no carregando aborta o pedido e nada da geração velha volta", async () => {
    let sinal: AbortSignal | null = null;
    let soltar!: (r: Response) => void;
    const { t, mudancas } = montar((_u, init) => { sinal = init.signal; return new Promise((r) => { soltar = r; }); });
    const fim = t.ouvir("t", "m1");
    t.parar();
    expect(sinal!.aborted).toBe(true);
    const corpo = corpoControlado();
    soltar(corpo.resposta);
    expect(await fim).toEqual({ ok: true });
    expect(t.atual()).toBeNull();
    expect(mudancas.at(-1)).toEqual({ atual: null, motivo: "parou" });
    expect(mudancas).toHaveLength(2);
  });

  it("parar tocando para as fontes já agendadas", async () => {
    const corpo = corpoControlado();
    const { t, ctx, mudancas } = montar(() => Promise.resolve(corpo.resposta));
    const fim = t.ouvir("t", "m1");
    corpo.empurrar(pcm(100));
    await esperar();
    t.parar();
    expect(ctx.fontes[0]?.parada).toBe(true);
    expect(await fim).toEqual({ ok: true });
    expect(mudancas.at(-1)).toEqual({ atual: null, motivo: "parou" });
  });

  it("ouvir outra resposta troca: a primeira para com 'trocou' e só a segunda segue", async () => {
    const corpos = [corpoControlado(), corpoControlado()];
    let i = 0;
    const { t, mudancas } = montar(() => Promise.resolve(corpos[i++]!.resposta));
    const f1 = t.ouvir("t", "m1");
    corpos[0]!.empurrar(pcm(100));
    await esperar();
    const f2 = t.ouvir("t", "m2");
    expect(mudancas).toContainEqual({ atual: null, motivo: "trocou" });
    expect(t.atual()).toEqual({ mensagemId: "m2", fase: "carregando" });
    // A primeira foi cancelada: o leitor dela já não lê, e a promessa dela fecha sem mexer na segunda.
    expect(await f1).toEqual({ ok: true });
    expect(t.atual()?.mensagemId).toBe("m2");
    corpos[1]!.fechar();
    expect(await f2).toEqual({ ok: true });
    expect(t.atual()).toBeNull();
  });

  it("uma geração velha não muda o estado se a troca acontece durante a criação da fonte", async () => {
    const corpos = [corpoControlado(), corpoControlado()];
    let chamada = 0;
    let trocar = (): void => undefined;
    const ctx = contextoFalso(() => trocar());
    const mudancas: { atual: LeituraAtual | null; motivo?: MotivoParada }[] = [];
    const t = criarTocadorDeLeitura({
      fetch: () => Promise.resolve(corpos[chamada++]!.resposta),
      criarContexto: () => ctx,
      aoMudar: (atual, motivo) => mudancas.push(motivo ? { atual, motivo } : { atual }),
    });
    const primeira = t.ouvir("t", "m1");
    trocar = () => {
      trocar = () => undefined;
      void t.ouvir("t", "m2");
    };
    corpos[0]!.empurrar(pcm(100));
    await esperar();
    expect(t.atual()).toEqual({ mensagemId: "m2", fase: "carregando" });
    expect(mudancas.at(-1)).toEqual({ atual: { mensagemId: "m2", fase: "carregando" } });
    corpos[1]!.fechar();
    expect(await primeira).toEqual({ ok: true });
  });

  it("409 estado_invalido é falta de consentimento; 502, 429 e rede caída são falha", async () => {
    const r409 = montar(() => Promise.resolve(Response.json({ codigo: "estado_invalido" }, { status: 409 })));
    expect(await r409.t.ouvir("t", "m1")).toEqual({ ok: false, motivo: "sem_consentimento" });
    expect(r409.t.atual()).toBeNull();
    for (const status of [502, 429, 403, 404]) {
      const r = montar(() => Promise.resolve(Response.json({ codigo: "x" }, { status })));
      expect(await r.t.ouvir("t", "m1")).toEqual({ ok: false, motivo: "falha" });
    }
    const outro409 = montar(() => Promise.resolve(Response.json({ codigo: "conflito" }, { status: 409 })));
    expect(await outro409.t.ouvir("t", "m1")).toEqual({ ok: false, motivo: "falha" });
    const rede = montar(() => Promise.reject(new TypeError("rede")));
    expect(await rede.t.ouvir("t", "m1")).toEqual({ ok: false, motivo: "falha" });
    expect(rede.t.atual()).toBeNull();
  });

  it("200 vazio volta ao ocioso sem aviso", async () => {
    const corpo = corpoControlado();
    const { t, mudancas } = montar(() => Promise.resolve(corpo.resposta));
    const fim = t.ouvir("t", "m1");
    corpo.fechar();
    expect(await fim).toEqual({ ok: true });
    expect(mudancas.at(-1)).toEqual({ atual: null, motivo: "terminou" });
  });

  it("erro antes do primeiro som é falha; no meio, o som só para", async () => {
    const antes = corpoControlado();
    const a = montar(() => Promise.resolve(antes.resposta));
    const fa = a.t.ouvir("t", "m1");
    antes.quebrar();
    expect(await fa).toEqual({ ok: false, motivo: "falha" });
    const meio = corpoControlado();
    const b = montar(() => Promise.resolve(meio.resposta));
    const fb = b.t.ouvir("t", "m1");
    meio.empurrar(pcm(100));
    await esperar();
    meio.quebrar();
    expect(await fb).toEqual({ ok: true });
    expect(b.t.atual()).toBeNull();
    expect(b.ctx.fontes[0]?.parada).toBe(true);
    expect(b.mudancas.at(-1)).toEqual({ atual: null, motivo: "parou" });
  });
});

describe("o mesmo aviso de voz para ligar, ditar e ouvir", () => {
  const ler = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  it("os três passam pelo diálogo único, que foca em 'Agora não'", () => {
    const dialogo = ler("web/telas/consentimento-voz.ts");
    expect(dialogo).toContain('querySelector<HTMLButtonElement>("[data-nao]")?.focus()');
    expect(dialogo).toContain("TEXTO_CONSENTIMENTO");
    for (const [arquivo, confirmar] of [["web/telas/ligacao-controle.ts", "Concordo e ligar"], ["web/telas/ditado-controle.ts", "Concordo e ditar"], ["web/main.ts", "Concordo e ouvir"]] as const) {
      const fonte = ler(arquivo);
      expect(fonte).toContain("pedirConsentimentoVoz(");
      expect(fonte).toContain(confirmar);
      expect(fonte).not.toContain("TEXTO_CONSENTIMENTO}");
    }
  });

  it("ligar para a leitura antes de abrir a ligação", () => {
    const fonte = ler("web/telas/ligacao-controle.ts");
    expect(fonte).toMatch(/iniciando = true;[\s\S]{0,200}deps\.pararLeitura\?\.\(\)/);
    expect(ler("web/main.ts")).toContain('pararLeitura: () => tocador.parar("ligacao")');
  });

  it("trocar de sessão para a leitura, e o aceite não lê se a ligação começou no meio", () => {
    const main = ler("web/main.ts");
    expect(main).toMatch(/async function iniciarSessao[\s\S]{0,400}tocador\.parar\("saiu"\)/);
    expect(main).toMatch(/consentirVoz\(VERSAO_CONSENTIMENTO\)[\s\S]{0,400}if \(estado\.ligacaoViva \|\| estado\.sessao\?\.tenantId !== tenantId\) return;[\s\S]{0,80}tocador\.ouvir/);
  });
});

describe("limites visuais da barra do Ouvir", () => {
  const ler = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

  it("reserva os cinco botões dentro da coluna no desktop", () => {
    expect(renderMensagem(resposta(), cenario())).toMatch(/class="[^"]*\bouvivel\b/);
    expect(ler("web/interface.css")).toMatch(/\.message\.bot\.ouvivel \.bubble-wrap \{ max-width: min\(calc\(100% - 216px\), 760px\); \}/);
  });

  it("faz a dica crescer para dentro da viewport no celular", () => {
    expect(ler("web/mobile.css")).toMatch(/\.ouvir-dica \{ left: 0; right: auto; width: max-content; max-width: calc\(100vw - 24px\); white-space: normal; \}/);
  });
});
