import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { comTexto, ATIVIDADE_VAZIA } from "../../../web/lib/atividade.ts";
import { lembrar } from "../../../web/lib/lembrar.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { blocosDoHistorico, renderHistoricoDaTimeline } from "../../../web/telas/conversa.ts";
import { readFileSync } from "node:fs";
import { blocoDaAbertura, comProgressoNaFala, criarProgressoNaTela, frentesNaFala, htmlProgresso, resumoDoProgresso, type LugarNaTela } from "../../../web/telas/progresso-na-fala.ts";

/**
 * Chat limpo, PR 7 (plano, Parte 4 · 4b; protótipo "4 · Progresso na fala + pílula que se alarga", com a fala à vista): o
 * progresso das frentes mora na fala do bot que as abriu. Estados, frente fora da lista, rede, sem âncora, a ordem dentro da
 * fala e o histórico que não é refeito quando uma frente anda.
 */

const C = "c-orq";
const AGORA = new Date(2026, 9, 18, 1, 40).getTime();
const MIN = 60_000;
const t0 = new Date(2026, 9, 18, 0, 50).getTime();

const autoriaBot = { autor_tipo: "agente" as const, autor_id: "orq", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:teste" as const, regra_versao: 1 };
const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autoriaBot, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm,
  origemTurno: null, trabalhoId: null, fimDoTurno: false, destino: "chat", ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => msg(id, criadoEm, { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never, texto: "Faz 5 opções de hero, uma por estilo.", ...extra });
const anexo = (id: string, criadoEm: number, payload: Mensagem["payload"], extra: Partial<Mensagem> = {}): Mensagem => msg(id, criadoEm, { kind: "sistema", texto: "linha", payload, destino: "anexo", ...extra });

const HEROS = [
  { trabalhoId: "w1", titulo: "Hero w1 · Aurora" },
  { trabalhoId: "w2", titulo: "Hero w2 · Motor no escuro" },
  { trabalhoId: "w3", titulo: "Hero w3" },
  { trabalhoId: "w4", titulo: "Hero w4 · Wordmark gigante" },
  { trabalhoId: "w5", titulo: "Hero w5" },
];
const abriu = (frentes = HEROS, extra: Partial<Mensagem> = {}): Mensagem => anexo("fa", t0 + MIN, { kind: "frentes_abertas", loteId: "l1", origem: "pessoa", frentes }, { turnoId: "tc", origemTurno: "conversa", ...extra });

/** O pedido, o "Vou abrir…" do meio do turno, a abertura (anexo) e a fala do fim do turno, e uma conversa depois. */
function conversaDoHero(extra: Mensagem[] = []): Mensagem[] {
  return [
    daPessoa("p1", t0),
    msg("b0", t0 + MIN, { turnoId: "tc", origemTurno: "conversa", texto: "Vou abrir uma frente por estilo." }),
    abriu(),
    msg("b1", t0 + 2 * MIN, { turnoId: "tc", origemTurno: "conversa", fimDoTurno: true, texto: "Abri 5 frentes, uma por estilo. Te mostro quando as 5 ficarem prontas." }),
    daPessoa("p2", t0 + 3 * MIN, { texto: "E o texto do hero, quem revisa?" }),
    msg("b2", t0 + 4 * MIN, { turnoId: "td", origemTurno: "conversa", fimDoTurno: true, texto: "A Helena." }),
    ...extra,
  ];
}

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "orq", conversaId: C, titulo: HEROS.find((h) => h.trabalhoId === id)?.titulo ?? id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: t0, iniciadoEm: t0 + MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: "l1", ...extra,
});
const pronta = (id: string, minuto: number): TrabalhoDto => trabalho(id, { estado: "terminado", terminadoEm: t0 + minuto * MIN });

function cenario(mensagens: Mensagem[], extra: Partial<Estado> = {}, conversa: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const dto: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "orq", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...conversa,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: dto, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "orq", nome: "Orquestrador de Sites", conversaId: C, cor: "c-rouge", forma: "shape-square" }] } as never,
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
    ...extra,
  };
  return { e, c: e.conversas[C]! };
}

const lista = (trabalhos: TrabalhoDto[]): Partial<Estado> => ({ trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null } });
/** Os blocos do histórico com o progresso já desenhado (o que main.ts mostra). */
const blocos = (c: ConversaEstado, e: Estado) => comProgressoNaFala(blocosDoHistorico(c, e), c, e).filter((b) => !b.chave.startsWith("sep:"));
const doBloco = (c: ConversaEstado, e: Estado, chave: string): string => blocos(c, e).find((b) => b.chave === chave)?.html ?? "";
const segmentos = (html: string): string[] => [...html.matchAll(/class="progresso-seg ([a-z_]+)"/g)].map((m) => m[1] ?? "");

/** O dia do protótipo: w1, w2 e w4 prontas; w3 rodando com o ao vivo; w5 rodando, só com o último passo do servidor. */
function diaDoPrototipo(): { e: Estado; c: ConversaEstado } {
  const trabalhos = [pronta("w1", 19), pronta("w2", 20), trabalho("w3", { turnoVivoId: "tv3", iniciadoEm: AGORA - 12 * MIN }), pronta("w4", 20), trabalho("w5", { ultimoPasso: "rodando os testes", iniciadoEm: AGORA - 9 * MIN })];
  const base = cenario(conversaDoHero(), lista(trabalhos));
  const e: Estado = { ...base.e, atividades: { [C]: { tv3: comTexto(ATIVIDADE_VAZIA, "Ajustando o contraste do título.") } } };
  return { e, c: e.conversas[C]! };
}

/** O dia do protótipo com outras mensagens (a mesma lista e o mesmo ao vivo). */
function diaDoPrototipoCom(mensagens: Mensagem[]): { e: Estado; c: ConversaEstado } {
  const { e: dia } = diaDoPrototipo();
  const base = cenario(mensagens, { trabalhos: dia.trabalhos });
  const e: Estado = { ...base.e, atividades: dia.atividades };
  return { e, c: e.conversas[C]! };
}

describe("o bloco mora na fala que abriu as frentes", () => {
  it("dentro do balão da última fala do turno, depois do texto; a abertura não vira linha e as outras falas não ganham nada", () => {
    const { e, c } = diaDoPrototipo();
    const chaves = blocos(c, e).map((b) => b.chave);
    expect(chaves).toEqual(["p1", "b0", "b1", "p2", "b2"]);
    const b1 = doBloco(c, e, "b1");
    expect(b1).toContain('<div class="bubble com-progresso">');
    expect(b1.indexOf("Te mostro quando as 5 ficarem prontas")).toBeLessThan(b1.indexOf('<section class="progresso"'));
    // Dentro do balão: a seção fecha e logo depois fecha o balão.
    expect(b1).toContain("</section></div>");
    for (const outra of ["p1", "b0", "p2", "b2"]) expect(doBloco(c, e, outra)).not.toContain("progresso");
    // O marcador não sobra na tela.
    expect(blocos(c, e).some((b) => b.html.includes("<!--progresso:"))).toBe(false);
    expect(renderHistoricoDaTimeline(c, e)).toContain('<section class="progresso"');
    // PR 8: o bloco diz de quais frentes fala; a rolagem o mede e a pílula some com ele à vista.
    const ids = /<section class="progresso" data-frentes="([^"]*)"/.exec(b1)?.[1]?.split(" ").sort();
    expect(ids).toHaveLength(5);
  });

  it("estados: a barra enche das prontas para as que rodam, e o resumo diz quais rodam (protótipo '3 de 5 prontas · w3 e w5 rodando')", () => {
    const { e, c } = diaDoPrototipo();
    const b1 = doBloco(c, e, "b1");
    expect(segmentos(b1)).toEqual(["pronta", "pronta", "pronta", "rodando", "rodando"]);
    expect(b1).toContain('<span class="progresso-txt">3 de 5 prontas<span class="progresso-resto"> · Hero w3 e Hero w5 rodando</span></span>');
    expect(b1).toContain('<span class="progresso-ver">ver as 5</span>');
    expect(b1).toContain('aria-label="Frentes: 3 de 5 prontas"');
  });

  it("'ver as 5' abre a lista no lugar: prontas com ✓ e a hora, rodando com o último passo (ao vivo, senão o do servidor) e o tempo; cada título abre a frente", () => {
    const { e, c } = diaDoPrototipo();
    const b1 = doBloco(c, e, "b1");
    expect(b1).toContain('<details class="progresso-det" data-disclosure="progresso-fa">');
    const itens = [...b1.matchAll(/<li class="progresso-item ([a-z_]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ estado: m[1], html: m[2] ?? "" }));
    expect(itens.map((i) => i.estado)).toEqual(["pronta", "pronta", "pronta", "rodando", "rodando"]);
    // As prontas pela hora em que terminaram: w1 às 01:09, no relógio local (19 min depois de 00:50).
    expect(itens[0]!.html).toContain(">Hero w1 · Aurora</button>");
    expect(itens[0]!.html).toContain('<span class="progresso-fim">01:09</span>');
    expect(itens[0]!.html).toContain("<svg");
    const w3 = itens.find((i) => i.html.includes(">Hero w3</button>"))!.html;
    expect(w3).toContain('<span class="progresso-passo">Ajustando o contraste do título…</span>');
    expect(w3).toContain('<span class="progresso-fim">12 min</span>');
    const w5 = itens.find((i) => i.html.includes(">Hero w5</button>"))!.html;
    expect(w5).toContain('<span class="progresso-passo">rodando os testes</span>');
    expect(w5).toContain('<span class="progresso-fim">9 min</span>');
    expect(b1).toContain('data-act="abrir-trabalho" data-id="w3"');
    expect(b1).toContain('<span class="sr-only"> (rodando)</span>');
  });

  it("parada e falhou: '4 de 5 prontas · Hero w3 parada às 01:36', com ■ e !, no fim da barra", () => {
    const trabalhos = [pronta("w1", 19), pronta("w2", 20), trabalho("w3", { estado: "parado", terminadoEm: t0 + 46 * MIN }), pronta("w4", 20), pronta("w5", 31)];
    const { e, c } = cenario(conversaDoHero(), lista(trabalhos));
    const b1 = doBloco(c, e, "b1");
    expect(segmentos(b1)).toEqual(["pronta", "pronta", "pronta", "pronta", "parada"]);
    expect(b1).toContain("4 de 5 prontas<span class=\"progresso-resto\"> · Hero w3 parada às 01:36</span>");
    expect(b1).toContain('<li class="progresso-item parada"><span class="progresso-ic parada" aria-hidden="true"></span>');
    const falhou = cenario(conversaDoHero(), lista([pronta("w1", 19), pronta("w2", 20), trabalho("w3", { estado: "falhou", terminadoEm: t0 + 46 * MIN }), trabalho("w4", { estado: "parado" }), trabalho("w5", { estado: "parado" })]));
    const html = doBloco(falhou.c, falhou.e, "b1");
    expect(segmentos(html)).toEqual(["pronta", "pronta", "parada", "parada", "falhou"]);
    expect(html).toContain("2 de 5 prontas<span class=\"progresso-resto\"> · 2 paradas · Hero w3 não terminou</span>");
  });

  it("esperando e precisando de você não contam como rodando", () => {
    const trabalhos = [trabalho("w1", { estado: "precisa_de_voce" }), trabalho("w2", { estado: "na_fila", iniciadoEm: null }), trabalho("w3", { esperandoColega: { nome: "Motion", desde: t0, trabalhoId: null } }), pronta("w4", 20), trabalho("w5")];
    const { e, c } = cenario(conversaDoHero(), lista(trabalhos));
    const b1 = doBloco(c, e, "b1");
    expect(segmentos(b1)).toEqual(["pronta", "rodando", "precisa", "esperando", "esperando"]);
    expect(b1).toContain("1 de 5 prontas<span class=\"progresso-resto\"> · Hero w5 rodando · Hero w1 · Aurora precisa de você · 2 esperando</span>");
    // Na fila não tem tempo; esperando o colega diz quem.
    expect(b1).toContain('<span class="progresso-passo">esperando Motion</span>');
  });
});

describe("de onde vem o estado", () => {
  it("frente fora da lista: o estado e a hora vêm de 'frentes_terminadas'; sem nenhum dos dois, 'sem notícia' — nunca 'pronta'", () => {
    const terminadas = anexo("ft", t0 + 30 * MIN, { kind: "frentes_terminadas", loteId: "l1", frentes: [{ trabalhoId: "w1", titulo: "Hero w1 · Aurora", estado: "terminado" }, { trabalhoId: "w2", titulo: "Hero w2 · Motor no escuro", estado: "parado" }] });
    const { e, c } = cenario(conversaDoHero([terminadas]), lista([trabalho("w3"), trabalho("w4")]));
    const b1 = doBloco(c, e, "b1");
    expect(segmentos(b1)).toEqual(["pronta", "rodando", "rodando", "parada", "sem_noticia"]);
    expect(b1).toContain("1 de 5 prontas<span class=\"progresso-resto\"> · Hero w3 e Hero w4 · Wordmark gigante rodando · Hero w2 · Motor no escuro parada às 01:20 · 1 sem notícia</span>");
    expect(b1).toMatch(/>Hero w1 · Aurora<\/button>[\s\S]*?<span class="progresso-fim">01:20<\/span>/);
    expect(b1).toMatch(/<li class="progresso-item sem_noticia">[\s\S]*?>Hero w5<\/button>[\s\S]*?sem notícia/);
  });

  it("a lista da conversa ainda diz 'rodando' mas 'frentes_terminadas' já chegou: vale o fim", () => {
    const terminadas = anexo("ft", t0 + 30 * MIN, { kind: "frentes_terminadas", loteId: "l1", frentes: HEROS.map((h) => ({ ...h, estado: "terminado" as const })) });
    const { e, c } = cenario(conversaDoHero([terminadas]), lista(HEROS.map((h) => trabalho(h.trabalhoId))));
    expect(doBloco(c, e, "b1")).toContain("5 de 5 prontas");
  });

  it("a frente reaberta depois do fecho do lote (a conversa a lista aberta junto das mensagens) volta a rodar, sem o ✓ do fim", () => {
    const terminadas = anexo("ft", t0 + 30 * MIN, { kind: "frentes_terminadas", loteId: "l1", frentes: HEROS.map((h) => ({ ...h, estado: "terminado" as const })) });
    const reaberta = trabalho("w3", { turnoVivoId: "tv3", ultimoPasso: "refazendo o contraste" });
    const { e, c } = cenario(conversaDoHero([terminadas]), lista([reaberta]), { trabalhos: [reaberta] });
    const b1 = doBloco(c, e, "b1");
    expect(segmentos(b1)).toEqual(["pronta", "pronta", "pronta", "pronta", "rodando"]);
    expect(b1).toContain("4 de 5 prontas<span class=\"progresso-resto\"> · Hero w3 rodando</span>");
    expect(b1).toMatch(/<li class="progresso-item rodando">[\s\S]*?>Hero w3<\/button>/);
  });

  it("frentesNaFala e resumoDoProgresso, puros: o título longo vira contagem", () => {
    const longas = [{ trabalhoId: "a", titulo: "Migrar os relatórios do financeiro para o novo banco" }, { trabalhoId: "b", titulo: "Revisar a CI" }];
    const { e } = cenario([]);
    const frentes = frentesNaFala({ frentes: longas }, [], { ...e, ...lista([trabalho("a", { titulo: longas[0]!.titulo }), trabalho("b", { titulo: "Revisar a CI" })]) }, C);
    expect(resumoDoProgresso(frentes)).toEqual({ principal: "0 de 2 prontas", resto: ["2 rodando"] });
  });

  it("o título com '$&', \"$'\" ou '$`' entra como está, sem colar pedaços da fala no lugar do bloco", () => {
    const titulos = [{ trabalhoId: "w1", titulo: "Preço em R$' e $& no hero" }, { trabalhoId: "w2", titulo: "Custo $` total" }];
    const ms = conversaDoHero().map((m) => (m.id === "fa" ? abriu(titulos) : m));
    const { e, c } = cenario(ms, lista([trabalho("w1", { titulo: titulos[0]!.titulo }), trabalho("w2", { titulo: titulos[1]!.titulo })]));
    const b1 = doBloco(c, e, "b1");
    expect(b1).toContain(">Preço em R$&#39; e $&amp; no hero</button>".replace("&#39;", b1.includes("R$&#39;") ? "&#39;" : "'"));
    expect(b1).toContain(">Custo $` total</button>");
    // Uma fala só, um bloco só: nada do texto da fala foi duplicado pela troca.
    expect(b1.split("Te mostro quando as 5 ficarem prontas").length).toBe(2);
    expect(b1.split('<section class="progresso"').length).toBe(2);
  });

  it("o título vem escapado", () => {
    const html = htmlProgresso([{ trabalhoId: "x", titulo: "<img src=x onerror=alert(1)>", estado: "rodando", passo: "<b>", tempo: null, terminouEm: null }, { trabalhoId: "y", titulo: "Y", estado: "pronta", passo: null, tempo: null, terminouEm: null }], { chave: "fa", agenteId: "orq" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("sem âncora, sem bloco", () => {
  it("sem a fala do turno na janela (só a abertura), não há bloco e os blocos são os mesmos", () => {
    const { e, c } = cenario([abriu(), daPessoa("p2", t0 + 3 * MIN)], lista([trabalho("w1")]));
    const historico = blocosDoHistorico(c, e);
    expect(comProgressoNaFala(historico, c, e)).toBe(historico);
    expect(renderHistoricoDaTimeline(c, e)).not.toContain("progresso");
  });

  it("sem 'frentes_abertas' na janela (a abertura saiu), a fala fica só com o texto", () => {
    const ms = conversaDoHero().filter((m) => m.id !== "fa");
    const { e, c } = cenario(ms, lista([trabalho("w1")]));
    const historico = blocosDoHistorico(c, e);
    expect(comProgressoNaFala(historico, c, e)).toBe(historico);
    expect(doBloco(c, e, "b1")).not.toContain("progresso");
  });

  it("a rotina que abriu frentes: o 'comecei…' segue escondido, então não há bloco (a pílula do PR 8 cobre)", () => {
    const ms = [msg("r1", t0, { turnoId: "tr", origemTurno: "rotina", fimDoTurno: true, texto: "Comecei 2 frentes" }), abriu(HEROS.slice(0, 2), { turnoId: "tr", origemTurno: "rotina" })];
    const { e, c } = cenario(ms, lista([trabalho("w1"), trabalho("w2")]));
    expect(renderHistoricoDaTimeline(c, e)).not.toContain("progresso");
  });

  it("a sala e o servidor sem destino seguem com a linha 'Começou N frentes', sem bloco", () => {
    const semDestino = conversaDoHero().map(({ destino: _d, ...m }) => m as Mensagem);
    const { e, c } = cenario(semDestino, lista([trabalho("w1")]));
    const html = renderHistoricoDaTimeline(c, e);
    expect(html).toContain("Começou 5 frentes");
    expect(html).not.toContain('<section class="progresso"');
  });
});

describe("a frente da rede e a frente única", () => {
  it("a rede não tem fala antes: o bloco entra embaixo do balão da pessoa que virou a frente, numa linha só", () => {
    const ms = [
      daPessoa("p1", t0, { texto: "Migra os relatórios do financeiro", trabalhoId: "wr" }),
      msg("r1", t0 + MIN, { turnoId: "tr", origemTurno: "conversa", trabalhoId: "wr", texto: "Convertendo o lote 1" }),
      anexo("ta", t0 + 2 * MIN, { kind: "trabalho_aberto", trabalhoId: "wr", titulo: "Migrar relatórios", origem: "rede" }, { turnoId: "tr", origemTurno: "conversa", trabalhoId: "wr" }),
    ];
    const { e, c } = cenario(ms, lista([trabalho("wr", { titulo: "Migrar relatórios", origem: "rede", ultimoPasso: "convertendo o lote 2", iniciadoEm: AGORA - 8 * MIN })]));
    const p1 = doBloco(c, e, "p1");
    expect(p1).toContain('<section class="progresso progresso-uma" data-frentes="wr" aria-label="Frente Migrar relatórios: rodando">');
    // Embaixo do balão (fora dele), antes do fim do artigo.
    expect(p1.indexOf("</div>", p1.indexOf('class="bubble"'))).toBeLessThan(p1.indexOf('<section class="progresso'));
    expect(p1).toContain('<span class="progresso-passo">convertendo o lote 2</span>');
    expect(p1).toContain('<span class="progresso-fim">8 min</span>');
    expect(p1).not.toContain("progresso-barra");
    expect(p1).not.toContain("ver as");
  });

  it("a rede que terminou: a resposta final dela (balão 'da task …' do mesmo turno) não puxa o bloco do balão da pessoa", () => {
    const ms = [
      daPessoa("p1", t0, { texto: "Migra os relatórios do financeiro", trabalhoId: "wr" }),
      anexo("ta", t0 + 2 * MIN, { kind: "trabalho_aberto", trabalhoId: "wr", titulo: "Migrar relatórios", origem: "rede" }, { turnoId: "tr", origemTurno: "conversa", trabalhoId: "wr" }),
      msg("r9", t0 + 20 * MIN, { turnoId: "tr", origemTurno: "conversa", trabalhoId: "wr", fimDoTurno: true, texto: "Migrei os 3 lotes." }),
    ];
    const feita = trabalho("wr", { titulo: "Migrar relatórios", origem: "rede", estado: "terminado", terminadoEm: t0 + 20 * MIN });
    const { e, c } = cenario(ms, lista([feita]));
    expect(doBloco(c, e, "r9")).toContain("Migrei os 3 lotes.");
    expect(doBloco(c, e, "r9")).not.toContain("progresso");
    expect(doBloco(c, e, "p1")).toContain('<section class="progresso progresso-uma"');
  });

  it("uma frente só (o abrir_task de sempre): a linha com o título e o passo; pronta, 'pronta às HH:MM'", () => {
    const ms = conversaDoHero().map((m) => (m.id === "fa" ? abriu([HEROS[0]!]) : m));
    const rodando = cenario(ms, lista([trabalho("w1", { ultimoPasso: "abrindo o Figma" })]));
    expect(doBloco(rodando.c, rodando.e, "b1")).toContain('<span class="progresso-passo">abrindo o Figma</span>');
    const feita = cenario(ms, lista([pronta("w1", 19)]));
    const html = doBloco(feita.c, feita.e, "b1");
    expect(html).toContain('<span class="progresso-passo">pronta às 01:09</span>');
    expect(html).toContain('<span class="progresso-ic pronta">');
  });
});

describe("NOD-358 (revisão 6 do PR #522): a fala em vários balões", () => {
  it("o progresso vai só no último balão", () => {
    const ms = conversaDoHero().map((m) => (m.id === "b1" ? { ...m, texto: "Abri 5 frentes.\n\nTe aviso quando saírem." } : m));
    const { e, c } = diaDoPrototipoCom(ms);
    const b1 = doBloco(c, e, "b1");
    expect(b1.split("com-progresso").length - 1).toBe(1);
    expect(b1).toContain('<div class="bubble com-progresso" data-balao="1">');
  });
});

describe("a fala que abriu as frentes é uma pergunta", () => {
  it("o turno abriu frentes e terminou perguntando: o bloco entra embaixo do cartão da pergunta, não some", () => {
    const ms = conversaDoHero().map((m) => (m.id === "b1" ? { ...m, texto: "Abri 5 frentes. Enquanto isso: qual paleta?", payload: { kind: "pedido_a_pessoa" as const, decisaoId: "d1", opcoes: ["Clara", "Escura"] } } : m));
    const { e, c } = diaDoPrototipoCom(ms);
    const b1 = doBloco(c, e, "b1");
    expect(b1).toContain('<section class="progresso"');
    expect(b1).toContain("3 de 5 prontas");
    expect(b1).not.toContain("com-progresso");
    expect(b1.indexOf("qual paleta?")).toBeLessThan(b1.indexOf('<section class="progresso"'));
  });
});

describe("dentro da fala e na tela", () => {
  it("ordem: balão (com o progresso) → reações", () => {
    const { e: base } = diaDoPrototipo();
    const c0 = base.conversas[C]!;
    const e: Estado = { ...base, conversas: { ...base.conversas, [C]: { ...c0, reacoes: [{ mensagemId: "b1", emoji: "👍", total: 1, minha: true }] } as never } };
    const b1 = doBloco(e.conversas[C]!, e, "b1");
    expect(b1).toContain("reacao-chip");
    expect(b1.indexOf('<section class="progresso"')).toBeLessThan(b1.indexOf("reacao-chip"));
  });

  it("telemetria: 'ver as 5' é uma linha do tipo 'frentes' (gatilho da ADR-099), com a chave da abertura e o bot", () => {
    const { e, c } = diaDoPrototipo();
    expect(doBloco(c, e, "b1")).toContain('<summary class="progresso-resumo" data-act="abrir-progresso" data-linha-tipo="frentes" data-linha-chave="frentes:fa" data-agente="orq">');
  });

  it("ADR-061: o histórico lembrado não lê o ao vivo nem o relógio; a frente que anda não muda nenhum bloco, só o do lugar", () => {
    const { e, c } = diaDoPrototipo();
    const desenhar = (x: Estado) => blocosDoHistorico(x.conversas[C]!, x);
    const lembrado = lembrar("progresso-adr061", e, ["dia"], desenhar);
    const andou: Estado = { ...e, agora: AGORA + 3 * MIN, atividades: { [C]: { tv3: comTexto(ATIVIDADE_VAZIA, "Rodando o Lighthouse.") } } };
    // O histórico não é refeito: nem o ao vivo nem o relógio estão no que ele leu.
    expect(lembrar("progresso-adr061", andou, ["dia"], desenhar)).toBe(lembrado);
    // A fala guarda só o lugar vazio, igual antes e depois: main.ts não a regrava (QA do PR 398).
    const b1 = lembrado.find((b) => b.chave === "b1")!.html;
    expect(b1).toContain('<div class="progresso-lugar" data-progresso="fa"></div>');
    expect(desenhar(andou).find((b) => b.chave === "b1")!.html).toBe(b1);
    // O bloco do lugar é que anda.
    const antes = blocoDaAbertura("fa", c, e);
    const depois = blocoDaAbertura("fa", andou.conversas[C]!, andou);
    expect(antes).toContain("Ajustando o contraste do título…");
    expect(depois).toContain("Rodando o Lighthouse…");
    expect(depois).toContain('<span class="progresso-fim">15 min</span>');
    expect(blocoDaAbertura("nao-existe", c, e)).toBe("");
  });
});

/**
 * QA do PR 398 (2026-10-18): com o bloco dentro do bloco da fala, cada passo de qualquer frente regravava a fala inteira (a
 * seleção de texto nela sumia, e o caminho "histórico mudou" de `regravarTimeline` rodava). Agora só o lugar é trocado.
 * Elementos falsos: o teste roda sem navegador.
 */
describe("o progresso na tela troca só o lugar", () => {
  type Falso = LugarNaTela & { trocas: number; det: { open: boolean } | null; focados: string[] };
  function lugarFalso(id: string): Falso {
    let html = "";
    const l: Falso = {
      dataset: { progresso: id }, isConnected: true, trocas: 0, det: null, focados: [],
      get innerHTML() { return html; },
      set innerHTML(v: string) { html = v; l.trocas++; l.det = v.includes("<details") ? { open: false } : null; },
      contains: (x) => x === focoFalso,
      querySelector: (seletor) => (seletor === "details" ? l.det : html.includes('data-act="abrir-progresso"') && seletor.includes("abrir-progresso") ? { focus: () => l.focados.push(seletor) } : null),
    };
    return l;
  }
  const focoFalso = { dataset: { act: "abrir-progresso" } };
  const raizCom = (...lugares: LugarNaTela[]) => ({ querySelectorAll: () => lugares });

  it("desenha o bloco no lugar; o mesmo estado não troca de novo; a frente que anda troca só o lugar", () => {
    const { e, c } = diaDoPrototipo();
    const tela = criarProgressoNaTela(() => null);
    const lugar = lugarFalso("fa");
    tela.achar(raizCom(lugar));
    expect(tela.desenhar(c, e)).toBe(1);
    expect(lugar.innerHTML).toContain('<section class="progresso"');
    expect(tela.desenhar(c, e)).toBe(0);
    const andou: Estado = { ...e, agora: AGORA + 3 * MIN, atividades: { [C]: { tv3: comTexto(ATIVIDADE_VAZIA, "Rodando o Lighthouse.") } } };
    expect(tela.desenhar(andou.conversas[C]!, andou)).toBe(1);
    expect(lugar.innerHTML).toContain("Rodando o Lighthouse…");
    expect(lugar.trocas).toBe(2);
  });

  it("PR 8: o bloco trocado no lugar leva `data-frentes` (a rolagem o mede para a pílula) e o ponto da memória do Mac", () => {
    const { e, c } = diaDoPrototipo();
    const tela = criarProgressoNaTela(() => null);
    const lugar = lugarFalso("fa");
    tela.achar(raizCom(lugar));
    expect(tela.desenhar(c, e)).toBe(1);
    expect(lugar.innerHTML).toMatch(/^<section class="progresso" data-frentes="[^"]+"/);
    expect(lugar.innerHTML).not.toContain("progresso-memoria");
    // O ponto chega sem a frente andar: só o lugar é trocado, com o ponto ao lado do número.
    const memoria = { texto: "Pouca memória no seu Mac · 2 trabalhos abertos", nivel: "amarela" as const };
    expect(tela.desenhar(c, e, memoria)).toBe(1);
    expect(lugar.innerHTML).toContain('<span class="progresso-memoria amarela" role="img" aria-label="Pouca memória no seu Mac · 2 trabalhos abertos"');
    expect(tela.desenhar(c, e, memoria)).toBe(0);
    expect(blocoDaAbertura("fa", c, e, memoria)).toBe(lugar.innerHTML);
  });

  it("a lista aberta continua aberta e o foco no 'ver as 5' volta depois da troca", () => {
    const { e, c } = diaDoPrototipo();
    let foco: unknown = null;
    const tela = criarProgressoNaTela(() => foco);
    const lugar = lugarFalso("fa");
    tela.achar(raizCom(lugar));
    tela.desenhar(c, e);
    lugar.det!.open = true;
    foco = focoFalso;
    const andou: Estado = { ...e, agora: AGORA + 3 * MIN };
    expect(tela.desenhar(andou.conversas[C]!, andou)).toBe(1);
    expect(lugar.det?.open).toBe(true);
    expect(lugar.focados).toEqual(['[data-act="abrir-progresso"]']);
  });

  it("o lugar que saiu da tela não é desenhado; sem conversa ou sem lugares, nada", () => {
    const { e, c } = diaDoPrototipo();
    const tela = criarProgressoNaTela(() => null);
    const fora = { ...lugarFalso("fa"), isConnected: false };
    tela.achar(raizCom(fora));
    expect(tela.desenhar(c, e)).toBe(0);
    expect(tela.desenhar(null, e)).toBe(0);
    tela.achar(null);
    expect(tela.desenhar(c, e)).toBe(0);
  });

  it("main.ts: o histórico entra sem o progresso; os lugares são achados quando ele é regravado, antes de contar as linhas", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).not.toContain("comProgressoNaFala(");
    const regravar = main.slice(main.indexOf("function regravarTimeline("));
    expect(regravar.indexOf("progressoNaTela.achar(")).toBeGreaterThan(-1);
    expect(regravar.indexOf("progressoNaTela.achar(")).toBeLessThan(regravar.indexOf("contarLinhasMostradas()"));
    // PR 8: o bloco trocado é medido de novo (`rolagem.progressoTrocado`) quando o desenho troca algum lugar.
    expect(main).toMatch(/regravarTimeline\(corpo, partes, \{ cascaMuda, historicoMuda, aoVivoMuda \}\);\n(?:\s*\/\/.*\n)*\s*(?:if \()?progressoNaTela\.desenhar\(/);
  });
});
