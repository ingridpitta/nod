import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { ItemDaBiblioteca } from "../../../src/contracts/biblioteca.ts";
import { estadoInicial, invalidacoesAoReconectar, invalidacoesAoRetomar, invalidacoesDaTela, reduzir, bibliotecaAberta, type Acao, type Estado } from "../../../web/estado/reducer.ts";
import { grupoDe, gruposVisiveis, juntarPagina, lerSeAindaVale, type BibliotecaDaConversa } from "../../../web/lib/biblioteca.ts";
import { acaoDoItem, desmarcarIrCarregando, htmlDaNotaDoMenu, htmlDoMenuDaBiblioteca, itensDoMenu, marcarIrCarregando, NOTA_FALA_DEMOROU, NOTA_FALA_FORA, renderListaBiblioteca, TEXTO_IR, type ContextoBiblioteca } from "../../../web/telas/biblioteca.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";

/** NOD-326: a aba Biblioteca da gaveta do bot — grupos, paginação, estados, ações e a releitura ao vivo. */

// O relógio da pessoa: 24/10/2026 às 10:00 no fuso local (os grupos são no fuso de quem vê).
const AGORA = new Date(2026, 9, 24, 10, 0).getTime();
const local = (d: number, h = 12, m = 0) => new Date(2026, 9, d, h, m).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
let seq = 0;
const it_ = (criadoEm: string, extra: Partial<ItemDaBiblioteca> = {}): ItemDaBiblioteca => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, nome: `arq${seq}.png`, mime: "image/png", tamanho: 2048, mensagemId: `m${seq}`, criadoEm, ...extra,
});
const base = (itens: ItemDaBiblioteca[], proximo: string | null = null): BibliotecaDaConversa => ({ itens, proximo, erro: false, carregandoMais: false, mostrando: {} });
const ctx = (extra: Partial<ContextoBiblioteca> = {}): ContextoBiblioteca => ({ conversaId: "c1", url: (id) => `/api/t/t/conversas/c1/anexos/${id}`, bot: "Nina", sumiram: new Set(), agora: AGORA, ...extra });

describe("grupos no relógio de quem vê", () => {
  it("Hoje começa à meia-noite local; os 6 dias antes são Últimos 7 dias; o resto, Mais antigos", () => {
    expect(grupoDe(local(24, 0, 0), AGORA)).toBe("hoje");
    expect(grupoDe(local(23, 23, 59), AGORA)).toBe("semana");
    expect(grupoDe(local(18, 0, 0), AGORA)).toBe("semana");
    expect(grupoDe(local(17, 23, 59), AGORA)).toBe("antigos");
  });

  // Revisão 1: fixa o fuso (o CI roda em UTC) e atravessa o horário de verão de Auckland (27/09/2026).
  it("em qualquer fuso, inclusive na virada do horário de verão", () => {
    const tz = process.env.TZ;
    try {
      for (const fuso of ["America/Sao_Paulo", "Pacific/Auckland", "UTC"]) {
        process.env.TZ = fuso;
        const agora = new Date(2026, 8, 30, 10, 0).getTime();
        const em = (d: number, h: number, m: number) => new Date(2026, 8, d, h, m).toISOString();
        expect(grupoDe(em(30, 0, 0), agora), fuso).toBe("hoje");
        expect(grupoDe(em(29, 23, 59), agora), fuso).toBe("semana");
        expect(grupoDe(em(24, 0, 0), agora), fuso).toBe("semana");
        expect(grupoDe(em(23, 23, 59), agora), fuso).toBe("antigos");
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it("o grupo vazio some; 5 por grupo; Mostrar mais local ou, só no último grupo, no servidor", () => {
    const hoje = Array.from({ length: 7 }, (_, k) => it_(local(24, 9, 50 - k)));
    const antigos = [it_(local(1))];
    const g = gruposVisiveis(base([...hoje, ...antigos], "cursor"), AGORA);
    expect(g.map((v) => v.grupo)).toEqual(["hoje", "antigos"]);
    expect(g[0]).toMatchObject({ total: 7, maisLocal: true, maisNoServidor: false });
    expect(g[0]!.itens).toHaveLength(5);
    expect(g[1]).toMatchObject({ total: 1, maisLocal: false, maisNoServidor: true });
    expect(gruposVisiveis(base([...hoje, ...antigos], null), AGORA)[1]!.maisNoServidor).toBe(false);
  });
});

describe("juntarPagina", () => {
  const a = it_(local(24, 9)), b = it_(local(23)), c = it_(local(20)), d = it_(local(10));
  it("a página seguinte entra no fim, sem repetir", () => {
    const j = juntarPagina(base([a, b], "x"), { itens: [b, c], proximo: null }, true);
    expect(j.itens.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(j.proximo).toBeNull();
  });

  it("a releitura da 1ª página traz o novo e guarda o que já foi carregado com Mostrar mais (e o cursor de antes)", () => {
    const novo = it_(local(24, 9, 59));
    const antes = { ...base([a, b, c, d], null), mostrando: { semana: 10 } };
    const j = juntarPagina(antes, { itens: [novo, a, b], proximo: "p1" }, false);
    expect(j.itens.map((i) => i.id)).toEqual([novo.id, a.id, b.id, c.id, d.id]);
    expect(j.proximo).toBeNull();
    expect(j.mostrando).toEqual({ semana: 10 });
  });

  // Revisão 2 (alto): 61 arquivos novos com a aba fechada; a 1ª página não alcança o que estava guardado.
  it("a releitura sem nada em comum com o guardado recomeça da página nova (não some arquivo no meio)", () => {
    const antes = { ...base([a, b, c, d], null), mostrando: { antigos: 10 } };
    const novos = Array.from({ length: 3 }, (_, k) => it_(local(24, 9, 59 - k)));
    const j = juntarPagina(antes, { itens: novos, proximo: "p-novo" }, false);
    expect(j.itens.map((i) => i.id)).toEqual(novos.map((i) => i.id));
    expect(j.proximo).toBe("p-novo");
    expect(j.mostrando).toEqual({});
  });

  it("a releitura que cabe numa página só substitui (o que sumiu no servidor sai)", () => {
    const j = juntarPagina(base([a, b, c], null), { itens: [a, c], proximo: null }, false);
    expect(j.itens.map((i) => i.id)).toEqual([a.id, c.id]);
  });
});

type AgenteFrota = FrotaDto["agentes"][number];
const nina: AgenteFrota = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null };
const estado = (extra: Partial<Estado> = {}): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [nina], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, ...extra } as Estado);
const naBiblioteca = (extra: Partial<Estado> = {}) => estado({ abaGaveta: { a1: "biblioteca" }, ...extra });
const frame = (tipo: string, dados: Record<string, unknown>) => ({ tipo: "frame", frame: { streamId: "s", seq: 1, pessoaId: "p", tipo, dados }, agora: AGORA }) as never;

describe("reducer: a Biblioteca só é lida com a aba aberta", () => {
  it("falta biblioteca:c1 só com a aba Biblioteca aberta na visão geral e ainda não lida", () => {
    expect(invalidacoesDaTela(estado())).not.toContain("biblioteca:c1");
    expect(invalidacoesDaTela(naBiblioteca())).toContain("biblioteca:c1");
    expect(invalidacoesDaTela(naBiblioteca({ gaveta: { agenteId: "a1", nivel: { tipo: "ajustes" } } }))).not.toContain("biblioteca:c1");
    expect(bibliotecaAberta(naBiblioteca({ gaveta: { agenteId: "a1", nivel: { tipo: "ajustes" } } }))).toBe(false);
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [], proximo: null }, seguinte: false });
    expect(invalidacoesDaTela(lida)).not.toContain("biblioteca:c1");
  });

  it("reconectar e retomar o stream relêem a Biblioteca já lida", () => {
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [], proximo: null }, seguinte: false });
    expect(invalidacoesAoReconectar(lida)).toContain("biblioteca:c1");
    expect(invalidacoesAoRetomar(lida)).toContain("biblioteca:c1");
    expect(invalidacoesAoRetomar(naBiblioteca())).not.toContain("biblioteca:c1");
  });

  it("o frame da conversa relê a Biblioteca só se ela já foi lida", () => {
    const nova = frame("mensagem.nova", { conversaId: "c1", mensagemId: "m9" });
    expect(reduzir(naBiblioteca(), nova).invalidacoes).not.toContain("biblioteca:c1");
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [], proximo: null }, seguinte: false });
    expect(reduzir(lida, nova).invalidacoes).toContain("biblioteca:c1");
    expect(reduzir(lida, frame("turno.encerrado", { conversaId: "c1", turnoId: "t1" })).invalidacoes).toContain("biblioteca:c1");
    expect(reduzir(lida, frame("turno.interrompido", { conversaId: "c1", turnoId: "t1" })).invalidacoes).toContain("biblioteca:c1");
    expect(reduzir(lida, frame("mensagem.nova", { conversaId: "c2", mensagemId: "m9" })).invalidacoes).not.toContain("biblioteca:c1");
  });

  it("a 1ª leitura que falha mostra o erro; Tentar de novo apaga a entrada (e a falta volta)", () => {
    const erro = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: null, seguinte: false });
    expect(erro.bibliotecaDoBot.c1).toMatchObject({ erro: true, itens: [] });
    const de_novo = reduzir(erro, { tipo: "biblioteca-tentar", conversaId: "c1" });
    expect(de_novo.bibliotecaDoBot.c1).toBeUndefined();
    expect(invalidacoesDaTela(de_novo)).toContain("biblioteca:c1");
  });

  it("Mostrar mais: +5 do que já foi lido; no último grupo com cursor, carrega; a página seguinte que falha só devolve o botão", () => {
    const hoje = Array.from({ length: 8 }, (_, k) => it_(local(24, 9, 50 - k)));
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: hoje, proximo: "cur" }, seguinte: false });
    const mais = reduzir(lida, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    expect(mais.bibliotecaDoBot.c1).toMatchObject({ mostrando: { hoje: 10 }, carregandoMais: false });
    const servidor = reduzir(mais, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    expect(servidor.bibliotecaDoBot.c1!.carregandoMais).toBe(true);
    expect(reduzir(servidor, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" })).toBe(servidor);
    const falhou = reduzir(servidor, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: null, seguinte: true });
    expect(falhou.bibliotecaDoBot.c1).toMatchObject({ erro: false, carregandoMais: false, falhouMais: true });
    expect(falhou.bibliotecaDoBot.c1!.itens).toHaveLength(8);
    // Revisão 2: a falha aparece na tela e o botão vira Tentar de novo; tentar de novo limpa o aviso.
    const html = renderListaBiblioteca(falhou.bibliotecaDoBot.c1, ctx());
    expect(html).toContain('<span class="gvb-falhou" role="status">Não deu para carregar mais arquivos.</span>');
    expect(html).toContain(">Tentar de novo</button>");
    const de_novo = reduzir(falhou, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    expect(de_novo.bibliotecaDoBot.c1).toMatchObject({ carregandoMais: true, falhouMais: false, mostrando: { hoje: 13 } });
  });

  it("a troca de pessoa limpa a Biblioteca", () => {
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [it_(local(24, 9))], proximo: null }, seguinte: false });
    expect(Object.keys(lida.bibliotecaDoBot)).toEqual(["c1"]);
    expect(reduzir(lida, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } } as never).bibliotecaDoBot).toEqual({});
    expect(reduzir(lida, { tipo: "sessao", escopo: { tenantId: "outro", pessoaId: "p" } } as never).bibliotecaDoBot).toEqual({});
    expect(Object.keys(reduzir(lida, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } } as never).bibliotecaDoBot)).toEqual(["c1"]);
  });

  // Revisão 1 (alto): a releitura que falha não apaga a lista; a página seguinte que chega fora de hora não entra.
  it("a releitura que falha mantém a lista que estava boa", () => {
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [it_(local(24, 9))], proximo: null }, seguinte: false });
    const falhou = reduzir(lida, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: null, seguinte: false });
    expect(falhou.bibliotecaDoBot.c1).toBe(lida.bibliotecaDoBot.c1);
  });

  it("a página seguinte que chega depois do erro ou do Tentar de novo é descartada", () => {
    const hoje = Array.from({ length: 6 }, (_, k) => it_(local(24, 9, 50 - k)));
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: hoje, proximo: "cur" }, seguinte: false });
    const servidor = reduzir(reduzir(lida, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" }), { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    expect(servidor.bibliotecaDoBot.c1!.carregandoMais).toBe(true);
    const tarde: Acao = { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [it_(local(1))], proximo: null }, seguinte: true };
    const tentou = reduzir(servidor, { tipo: "biblioteca-tentar", conversaId: "c1" });
    expect(reduzir(tentou, tarde)).toBe(tentou);
    const erro = reduzir(tentou, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: null, seguinte: false });
    expect(reduzir(erro, tarde)).toBe(erro);
    expect(reduzir(lida, tarde)).toBe(lida);
  });

  // Revisão 3: outro grupo com itens já lidos anda enquanto a página do último grupo vem; a do servidor não repete.
  it("com a página a caminho, o Mostrar mais de outro grupo expande o que já foi lido", () => {
    const hoje = Array.from({ length: 7 }, (_, k) => it_(local(24, 9, 50 - k)));
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [...hoje, it_(local(1))], proximo: "cur" }, seguinte: false });
    const servidor = reduzir(lida, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "antigos" });
    expect(servidor.bibliotecaDoBot.c1!.carregandoMais).toBe(true);
    const outro = reduzir(servidor, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    expect(outro.bibliotecaDoBot.c1).toMatchObject({ carregandoMais: true, mostrando: { hoje: 10 } });
    expect(reduzir(outro, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "antigos" })).toBe(outro);
  });

  it("a releitura sem nada em comum durante a página a caminho descarta essa página (o cursor dela é o antigo)", () => {
    const hoje = Array.from({ length: 6 }, (_, k) => it_(local(24, 9, 50 - k)));
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: hoje, proximo: "cur" }, seguinte: false });
    const servidor = reduzir(reduzir(lida, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" }), { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    const novos = [it_(local(24, 9, 59))];
    const relida = reduzir(servidor, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: novos, proximo: "novo" }, seguinte: false });
    expect(relida.bibliotecaDoBot.c1).toMatchObject({ carregandoMais: false, proximo: "novo" });
    const tarde: Acao = { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [it_(local(1))], proximo: null }, seguinte: true };
    expect(reduzir(relida, tarde)).toBe(relida);
  });

  it("a releitura ao vivo não encerra o Mostrar mais a caminho, e a página dele ainda entra", () => {
    const hoje = Array.from({ length: 6 }, (_, k) => it_(local(24, 9, 50 - k)));
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: hoje, proximo: "cur" }, seguinte: false });
    const servidor = reduzir(reduzir(lida, { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" }), { tipo: "biblioteca-mais", conversaId: "c1", grupo: "hoje" });
    const novo = it_(local(24, 9, 59));
    const relida = reduzir(servidor, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [novo, ...hoje], proximo: "cur" }, seguinte: false });
    expect(relida.bibliotecaDoBot.c1!.carregandoMais).toBe(true);
    const velho = it_(local(1));
    const fim = reduzir(relida, { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [velho], proximo: null }, seguinte: true });
    expect(fim.bibliotecaDoBot.c1!.itens.map((i) => i.id)).toEqual([novo.id, ...hoje.map((i) => i.id), velho.id]);
    expect(fim.bibliotecaDoBot.c1!.carregandoMais).toBe(false);
  });
});

describe("a tela da Biblioteca", () => {
  it("carregando, erro e vazio", () => {
    expect(renderListaBiblioteca(undefined, ctx())).toContain('aria-busy="true"><span class="sr-only">Carregando a biblioteca</span>');
    const erro = renderListaBiblioteca({ ...base([]), erro: true }, ctx());
    expect(erro).toContain("Não deu para carregar a Biblioteca.");
    expect(erro).toContain('data-act="biblioteca-tentar" data-id="c1"');
    expect(renderListaBiblioteca(base([]), ctx())).toContain("Os arquivos que Nina criar aparecem aqui.");
  });

  it("a ação de cada item: imagem e vídeo na tela cheia, prévia, o resto (áudio também) baixa, sem bytes não faz nada", () => {
    const s = new Set<string>();
    expect(acaoDoItem(it_(local(24)), s)).toBe("luz");
    expect(acaoDoItem(it_(local(24), { mime: "video/mp4", nome: "v.mp4" }), s)).toBe("luz");
    expect(acaoDoItem(it_(local(24), { mime: "application/pdf", nome: "a.pdf" }), s)).toBe("previa");
    expect(acaoDoItem(it_(local(24), { mime: "audio/mpeg", nome: "a.mp3" }), s)).toBe("baixar");
    expect(acaoDoItem(it_(local(24), { mime: "application/zip", nome: "a.zip" }), s)).toBe("baixar");
    expect(acaoDoItem(it_(local(24), { semBytes: true }), s)).toBe("nada");
    const sumiu = it_(local(24));
    expect(acaoDoItem(sumiu, new Set([sumiu.id]))).toBe("nada");
  });

  it("a lista é um .msg-midias com data-luz só das mídias, na ordem dos data-i", () => {
    const img = it_(local(24, 9)), pdf = it_(local(24, 8), { mime: "application/pdf", nome: "r.pdf" }), vid = it_(local(23), { mime: "video/mp4", nome: "v.mp4", duracaoMs: 61000 });
    const html = renderListaBiblioteca(base([img, pdf, vid]), ctx());
    expect(html).toContain('class="msg-midias gvb-lista" data-biblioteca="c1"');
    const luz = JSON.parse(html.match(/data-luz="([^"]*)"/)![1]!.replaceAll("&quot;", '"')) as { id: string }[];
    expect(luz.map((l) => l.id)).toEqual([img.id, vid.id]);
    expect(html).toMatch(new RegExp(`data-anexo-id="${img.id}" data-i="0"`));
    expect(html).toMatch(new RegExp(`data-anexo-id="${vid.id}" data-i="1"`));
    expect(html).toContain('data-act="previa-arquivo"');
    expect(html).toContain('<h3 id="gvb-hoje">Hoje</h3>');
    expect(html).toContain('<h3 id="gvb-semana">Últimos 7 dias</h3>');
    expect(html).not.toContain("gvb-antigos");
  });

  it("cada linha tem só o ícone (ou a miniatura) e o nome: sem tamanho e sem data; vídeo é o quadrado com ▶", () => {
    const vid = it_(local(24, 9), { mime: "video/mp4", nome: "teaser.mp4", tamanho: 5_000_000, duracaoMs: 61000 });
    const html = renderListaBiblioteca(base([vid, it_(local(24, 8), { mime: "application/pdf", nome: "relatorio.pdf", tamanho: 2_000_000 })]), ctx());
    expect(html).not.toMatch(/MB|KB|\d{2}:\d{2}|1:01/);
    expect(html).not.toContain("<video");
    expect(html).toContain('<span class="gvb-mini gvb-video">');
    expect(html).toContain('<span class="gvb-base">teaser</span><span class="gvb-ext">.mp4</span>');
    expect(html).toContain('<ul class="gv-cartao gvb-itens" role="list">');
  });

  it("o sem bytes e o que saiu da pasta: sem clique e sem Baixar no menu", () => {
    const sem = it_(local(24, 9), { semBytes: true, maquina: { id: "mac", nome: "MacBook" } }), sumiu = it_(local(24, 8));
    const html = renderListaBiblioteca(base([sem, sumiu]), ctx({ sumiram: new Set([sumiu.id]) }));
    expect(html).toContain("Fica na pasta de Nina em MacBook");
    expect(html).toContain("Saiu da pasta de Nina");
    expect(html).toContain('class="gvb-item gvb-sumiu"');
    expect(html).toContain('<div class="gv-linha gvb-abrir gvb-inerte">');
    expect(html.match(/data-act="biblioteca-menu"[^>]*data-url=/g)).toBeNull();
    expect(itensDoMenu({ baixar: false })).toEqual(["ir"]);
    expect(itensDoMenu({ baixar: true })).toEqual(["baixar", "ir"]);
  });

  // Revisão 1: o arquivo que ficou NESTE Mac é conferido na pasta do bot; o de outro Mac, não.
  it("o sem bytes deste Mac leva data-midia-local (o app confere a pasta); o de outro Mac e o que já sumiu, não", () => {
    const aqui = it_(local(24, 9), { semBytes: true, maquina: { id: "mac", nome: "MacBook" } });
    const outro = it_(local(24, 8), { semBytes: true, maquina: { id: "outro", nome: "iMac" } });
    const html = renderListaBiblioteca(base([aqui, outro]), ctx({ esteMac: "mac" }));
    expect(html).toContain(`data-anexo-id="${aqui.id}" data-midia-local="1" data-midia-url="/api/t/t/conversas/c1/anexos/${aqui.id}" data-bot="Nina"`);
    expect(html).not.toContain(`data-anexo-id="${outro.id}" data-midia-local`);
    expect(renderListaBiblioteca(base([aqui]), ctx())).not.toContain("data-midia-local");
    expect(renderListaBiblioteca(base([aqui]), ctx({ esteMac: "mac", sumiram: new Set([aqui.id]) }))).not.toContain("data-midia-local");
  });

  it("o Mostrar mais vira Carregando… e fica desativado enquanto a página seguinte chega", () => {
    const html = renderListaBiblioteca({ ...base([it_(local(1))], "cur"), carregandoMais: true }, ctx());
    expect(html).toContain('<li class="gvb-rodape"><button type="button" class="gvb-mostrar" data-act="biblioteca-mais" data-id="c1" data-grupo="antigos" aria-label="Carregando mais arquivos" disabled aria-busy="true">Carregando…');
    expect(renderListaBiblioteca(base([it_(local(1))], "cur"), ctx())).toContain('aria-label="Mostrar mais arquivos de Mais antigos">Mostrar mais<');
  });

  it("a aba na gaveta: carrega com a aba aberta e desenha a lista", () => {
    expect(renderDetalhes(naBiblioteca())).toContain("Carregando a biblioteca");
    const lida = reduzir(naBiblioteca(), { tipo: "hidratar-biblioteca", conversaId: "c1", pagina: { itens: [it_(local(24, 9))], proximo: null }, seguinte: false });
    expect(renderDetalhes(lida)).toContain('data-biblioteca="c1"');
  });
});

describe("o menu \"…\" e a guarda de sessão (revisão 2)", () => {
  it("NOD-363: o Ir está em todo item, com ou sem Baixar, e não há mais nota fixa de 'mais acima'", () => {
    const tudo = htmlDoMenuDaBiblioteca({ nome: "a.pdf", baixar: true });
    expect(tudo).toBe('<div role="menu" aria-label="Ações de a.pdf"><button type="button" role="menuitem" data-gestao="baixar">Baixar</button><button type="button" role="menuitem" data-gestao="ir">Ir para a mensagem</button></div><p class="menu-status sr-only" role="status"></p>');
    const soIr = htmlDoMenuDaBiblioteca({ nome: "<b>x</b>", baixar: false });
    expect(soIr).toBe('<div role="menu" aria-label="Ações de &lt;b&gt;x&lt;/b&gt;"><button type="button" role="menuitem" data-gestao="ir">Ir para a mensagem</button></div><p class="menu-status sr-only" role="status"></p>');
    expect(soIr).not.toContain("menu-nota");
  });
  it("NOD-363 (revisão 1, achado 2): o Ir carregando usa aria-disabled (o foco fica nele), diz Carregando… e volta", () => {
    const attrs = new Map<string, string>();
    const bt = { textContent: TEXTO_IR as string | null, setAttribute: (n: string, v: string) => { attrs.set(n, v); }, removeAttribute: (n: string) => { attrs.delete(n); } };
    marcarIrCarregando(bt);
    expect(bt.textContent).toBe("Carregando…");
    expect(Object.fromEntries(attrs)).toEqual({ "aria-disabled": "true" });
    expect(bt).not.toHaveProperty("disabled");
    desmarcarIrCarregando(bt);
    expect(bt.textContent).toBe("Ir para a mensagem");
    expect(attrs.size).toBe(0);
  });
  it("NOD-363: a nota da falha é curta, anunciada, focável e escapada", () => {
    expect(htmlDaNotaDoMenu(NOTA_FALA_FORA)).toBe('<p class="menu-nota" role="status" tabindex="-1">Não deu para chegar a essa mensagem: ela é antiga demais ou saiu do chat.</p>');
    expect(htmlDaNotaDoMenu("<i>")).toContain("&lt;i&gt;");
    expect(htmlDaNotaDoMenu(NOTA_FALA_DEMOROU)).toContain("A mensagem demorou para carregar. Tente de novo.");
  });
  it("NOD-363 (revisão 2, achado 3): o \"…\" de cada item leva a conversa e a fala de origem que o Ir usa", () => {
    const i = it_(local(24, 9), { nome: "a.pdf", mime: "application/pdf", mensagemId: "fala-<1>" });
    const html = renderListaBiblioteca(base([i]), ctx({ conversaId: "c&1" }));
    expect(html).toContain(`data-act="biblioteca-menu" data-id="${i.id}" data-conversa="c&amp;1" data-mensagem-de="fala-&lt;1&gt;"`);
  });
  it("o nome vai escapado no rótulo do menu", () => {
    expect(htmlDoMenuDaBiblioteca({ nome: '"><img>', baixar: true })).toContain('aria-label="Ações de &quot;&gt;&lt;img&gt;"');
  });
  it("a resposta que chega depois da troca de sessão é descartada; a falha vira null", async () => {
    let sessao = "a";
    let soltar!: (v: string) => void;
    const lendo = lerSeAindaVale(() => new Promise<string>((r) => { soltar = r; }), () => sessao === "a");
    sessao = "b";
    soltar("página da a");
    expect(await lendo).toEqual({ vale: false });
    expect(await lerSeAindaVale(async () => "ok", () => true)).toEqual({ vale: true, valor: "ok" });
    expect(await lerSeAindaVale(() => Promise.reject(new Error("rede")), () => true)).toEqual({ vale: true, valor: null });
  });
});

describe("a fiação no main", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("busca a 1ª página, relê na janela da atividade e só com o painel à vista", () => {
    expect(main).toContain('q.startsWith("biblioteca:")) return t.tipo === "conversa" && t.conversaId === q.slice(11) && bibliotecaAberta(estado) && painelVisivel()');
    expect(main).toMatch(/daAtividade = [^\n]*q\.startsWith\("biblioteca:"\)/);
    expect(main).toContain('return r.vale ? { tipo: "hidratar-biblioteca", conversaId, pagina: r.valor, seguinte: false } : null;');
  });
  it("os três data-act têm handler", () => {
    for (const act of ["biblioteca-mais", "biblioteca-tentar", "biblioteca-menu"]) expect(main).toContain(`"${act}": (el) =>`);
  });
  it("os handlers usam o menu e a guarda de sessão testados aqui", () => {
    expect(main).toContain("htmlDoMenuDaBiblioteca({ nome, baixar: Boolean(url) })");
  });
  it("NOD-363: o Ir passa por irParaFalaDaBiblioteca; a gaveta fecha antes do levarAo; fechar solta o alvo; aria-disabled barra o clique", () => {
    const corpo = main.slice(main.indexOf("function abrirMenuDaBiblioteca("), main.indexOf("function escolherAba("));
    expect(corpo).toContain("espera = irParaFalaDaBiblioteca(mundoDaFala, ui, conversa, mensagemDe)");
    const ir = corpo.slice(corpo.indexOf("irAte: (fala, vizinha) =>"));
    // Revisão 3 (M3): cada passo tem de existir (indexOf -1 passaria no toBeLessThan) e vir antes do levarAo.
    const levar = ir.indexOf("levarAo(fala, !vizinha)");
    expect(levar).toBeGreaterThan(-1);
    for (const passo of ['fecharPerfil("chat", false)', 'classList.remove("detalhes-abertos")', "marcarPainelNaPilula()", "d.close()", "abrirDetalhesAcima(fala)"]) {
      const i = ir.indexOf(passo);
      expect(i, passo).toBeGreaterThan(-1);
      expect(i, passo).toBeLessThan(levar);
    }
    expect(corpo).toContain("espera?.soltar();");
    // Revisão 2 (achado 2): a âncora redesenhada é reencontrada para posicionar, aria-expanded e foco.
    expect(corpo).toContain('[data-act="biblioteca-menu"][data-id="${CSS.escape(id)}"]');
    expect(corpo).toContain("ancoraViva().getBoundingClientRect()");
    expect(corpo).toContain("proximoItemDoMenu(bts.length,");
    expect(corpo).toContain("aberto: () => aberto && d.open && d.isConnected");
    // QA (mutantes M7, M8, M11): o mundo lê a tela de verdade e relê pelo invalidar; o celular fecha o perfil.
    expect(main).toContain("tela: () => estado.tela,");
    expect(main).toContain('invalidar: (q) => dispatch({ tipo: "invalidar", quais: [q as Invalidacao] }),');
    expect(ir).toContain('if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);');
    expect(corpo).toContain("htmlDaNotaDoMenu(antiga ? NOTA_FALA_FORA : NOTA_FALA_DEMOROU)");
    expect(corpo).toContain('#detalhes [data-act="biblioteca-menu"]');
    expect(corpo).toContain('bt.getAttribute("aria-disabled") === "true") return;');
    expect(corpo).toContain("NOTA_FALA_FORA : NOTA_FALA_DEMOROU");
    expect(main.match(/lerSeAindaVale\(/g)).toHaveLength(2);
  });
  it("a tela cheia reencontra a lista da Biblioteca (sem data-mensagem)", () => {
    const luz = readFileSync(new URL("../../../web/telas/luz.ts", import.meta.url), "utf8");
    expect(luz).toContain("[data-biblioteca=");
  });
});
