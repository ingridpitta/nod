import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DonoDto, EsperaDoDonoDto, EstadoDoDono, PedidoNaFilaDto } from "../../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { comTexto } from "../../../web/lib/atividade.ts";
import { anunciosDeFim, aoEsconder, aoSumir, chaveDoProgresso, MARGEM_A_VISTA, pilulaEscondida, progressoNaTela, SEM_PROGRESSO, teclaNaPilula, type ProgressoNaTela } from "../../../web/lib/pilula.ts";
import { htmlDaPilula, ID_PAINEL, pilulaNaConversa, type PilulaNaConversa } from "../../../web/telas/pilula-do-bot.ts";
import { CHAVE_LINHA } from "../../../src/use-cases/telemetria-linhas.ts";

/**
 * A pílula do bot que se alarga (chat limpo, PR 8; plano, Parte 4 · 4c; protótipo D4BE2-pilula-alarga): no lugar da linha
 * do dono. Some com a fala do progresso à vista e não com espera ou fila; os lotes somados; a prioridade do texto fechado;
 * as seções alargadas; alargar, Esc, o foco quando ela fecha sozinha, `hidden` escondida, o estado aberto depois do
 * re-render e o movimento reduzido; a visibilidade com a fala dentro e fora da janela e com o histórico mudando sem rolagem.
 */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 18, 1, 30).getTime();
const C = "c-orq";

const estadoDono = (extra: Partial<EstadoDoDono> = {}): EstadoDoDono => ({
  agenteId: "orq", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null, ...extra,
});
const dono = (e: Partial<EstadoDoDono> = {}, esperas: EsperaDoDonoDto[] = [], fila: PedidoNaFilaDto[] = []): DonoDto => ({ estado: estadoDono(e), esperas, fila });

const frente = (id: string, titulo: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "orq", conversaId: C, titulo, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 40 * MIN, iniciadoEm: AGORA - 40 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null,
  turnoVivoId: null, esperandoComputadorDe: null, forma: "frente", loteId: "l1", lote: { id: "l1", abertoEm: AGORA - 40 * MIN, frentes: 5, abertas: 2 }, ...extra,
});

/** O lote do protótipo: 3 prontas (01:09, 01:10, 01:10) e 2 rodando (w3 há 12 min, w5 há 9 min). */
const HEROS: TrabalhoDto[] = [
  frente("w1", "Hero w1 · Aurora", { estado: "terminado", terminadoEm: new Date(2026, 9, 18, 1, 9).getTime() }),
  frente("w2", "Hero w2 · Motor no escuro", { estado: "terminado", terminadoEm: new Date(2026, 9, 18, 1, 10).getTime() }),
  frente("w3", "Hero w3 · Terminal retrô", { turnoVivoId: "tv3", iniciadoEm: AGORA - 12 * MIN, criadoEm: AGORA - 40 * MIN + 3 }),
  frente("w4", "Hero w4 · Wordmark gigante", { estado: "terminado", terminadoEm: new Date(2026, 9, 18, 1, 10, 30).getTime() }),
  frente("w5", "Hero w5 · Boot do time", { ultimoPasso: "rodando os testes", iniciadoEm: AGORA - 9 * MIN, criadoEm: AGORA - 40 * MIN + 5 }),
];

function estadoCom(trabalhos: TrabalhoDto[], d: DonoDto | null, extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "orq", nome: "Orquestrador de Sites", conversaId: C, cor: "c-rouge", forma: "shape-square", ownerId: "p", titulo: "", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null, ...(d ? { donos: [d] } : {}) },
    tela: { tipo: "conversa", conversaId: C, agenteId: "orq" },
    atividades: { [C]: { tv3: comTexto(undefined, "ajustando o contraste") } },
    ...extra,
  };
}

const progresso = (aVista: string[], naTimeline: string[] = aVista): ProgressoNaTela => ({ aVista: new Set(aVista), naTimeline: new Set(naTimeline) });
const daPilula = (p: PilulaNaConversa) => {
  if (p.tipo !== "pilula") throw new Error(`esperava a pílula, veio ${p.tipo}`);
  return p;
};

describe("a pílula fechada: o texto prioriza as frentes", () => {
  it("achado do QA no #427: a frente sozinha presa a máquina sem contato não repete a espera na contagem", () => {
    const presa = [frente("h", "Login", { loteId: "l2", lote: { id: "l2", abertoEm: AGORA, frentes: 1, abertas: 1 }, turnoVivoId: "tvh", maquina: { id: "vm1", nome: "VM-1", ehMac: false, semContatoDesde: AGORA - 12 * MIN } })];
    const so = daPilula(pilulaNaConversa(estadoCom(presa, dono({ principal: "esperando", esperando: 1, motivoEspera: "VM-1 · sem contato", desde: AGORA - 12 * MIN })), "orq", SEM_PROGRESSO));
    const textos = [so.pilula.texto, ...so.pilula.resto];
    expect(textos.filter((x) => x.includes("sem contato") || /esperando$/.test(x)).length).toBeLessThanOrEqual(1);
    expect(so.pilula.resto).not.toContain("esperando VM-1 · sem contato");
    // Com outra espera do bot (a conversa esperando a CI), conta só a outra, sem o motivo (que pode ser o da presa).
    const duas = daPilula(pilulaNaConversa(estadoCom(presa, dono({ principal: "esperando", esperando: 2, motivoEspera: "VM-1 · sem contato", desde: AGORA - 12 * MIN })), "orq", SEM_PROGRESSO));
    expect(duas.pilula.resto.slice(1)).toEqual(["1 esperando"]);
  });

  it("um lote: \"5 frentes\" e \"3 de 5 prontas\", com o ponto vivo; o botão abre o painel (aria-expanded, aria-controls)", () => {
    const p = daPilula(pilulaNaConversa(estadoCom(HEROS, dono({ principal: "trabalhando", frentes: 2 })), "orq", SEM_PROGRESSO));
    expect(p.pilula.texto).toBe("5 frentes");
    expect(p.pilula.resto).toEqual(["3 de 5 prontas"]);
    expect(p.partes.botao).toBe('<span class="pf-ponto vivo" aria-hidden="true"></span><span class="pf-texto">5 frentes</span><span class="sr-only">, </span><span class="pf-resto">3 de 5 prontas</span>' + p.partes.botao.slice(p.partes.botao.indexOf("<svg")));
    const html = htmlDaPilula(p.partes, { aberta: false, escondida: false });
    expect(html).toContain(`<button type="button" class="pf-botao" data-act="pilula" aria-expanded="false" aria-controls="${ID_PAINEL}">`);
  });

  it("o título do lote vem do servidor (PR 5, `tituloDoLote`) quando ele manda; a frente sozinha diz o que está fazendo", () => {
    const comTitulo = HEROS.map((t) => ({ ...t, tituloDoLote: "frentes de hero" }));
    expect(daPilula(pilulaNaConversa(estadoCom(comTitulo, dono()), "orq", SEM_PROGRESSO)).pilula.texto).toBe(`${HEROS.length} frentes de hero`);
    const outroAssunto = HEROS.map((t) => ({ ...t, tituloDoLote: "Roteiros do hero" }));
    expect(daPilula(pilulaNaConversa(estadoCom(outroAssunto, dono()), "orq", SEM_PROGRESSO)).pilula.texto).toBe(`${HEROS.length} frentes · Roteiros do hero`);
    const jaContado = HEROS.map((t) => ({ ...t, tituloDoLote: "5 frentes de hero" }));
    expect(daPilula(pilulaNaConversa(estadoCom(jaContado, dono()), "orq", SEM_PROGRESSO)).pilula.texto).toBe("5 frentes de hero");
    const sozinha = [frente("h", "Hero do site", { loteId: "l2", lote: { id: "l2", abertoEm: AGORA, frentes: 1, abertas: 1 }, ultimoPasso: "montando o layout" })];
    const p = daPilula(pilulaNaConversa(estadoCom(sozinha, dono()), "orq", SEM_PROGRESSO));
    expect([p.pilula.texto, ...p.pilula.resto]).toEqual(["Hero do site", "montando o layout"]);
  });

  it("vários lotes somam: \"2 lotes · 4 de 7 prontas\"; a frente do lote que saiu da lista conta no total (`lote.frentes`)", () => {
    const outro = [frente("a1", "Arte do convite", { loteId: "l9", lote: { id: "l9", abertoEm: AGORA, frentes: 2, abertas: 1 } }), frente("a2", "Arte do banner", { loteId: "l9", lote: { id: "l9", abertoEm: AGORA, frentes: 2, abertas: 1 }, estado: "terminado", terminadoEm: AGORA - MIN })];
    const p = daPilula(pilulaNaConversa(estadoCom([...HEROS, ...outro], dono()), "orq", SEM_PROGRESSO));
    expect(p.pilula.texto).toBe("2 lotes");
    expect(p.pilula.resto).toEqual(["4 de 7 prontas"]);
    // Alargada, separa por lote.
    expect(p.partes.corpo).toContain('<h3 class="pf-lote">5 frentes · 3 de 5 prontas</h3>');
    expect(p.partes.corpo).toContain('<h3 class="pf-lote">2 frentes · 1 de 2 prontas</h3>');
  });

  it("sem frentes: a espera com o ponto vazado (\"Esperando a CI do #845 · 38 min\") ou a fila (\"1 pedido na fila\")", () => {
    const espera = dono({ principal: "esperando", esperando: 1, motivoEspera: "a CI do #845", desde: AGORA - 38 * MIN }, [{ tipo: "comando", trabalhoId: null, motivo: "a CI do #845", desde: AGORA - 38 * MIN, comando: "gh pr checks 845 --watch", ultimaLinha: "checks · pending", tentativa: 2, tentativas: 3 }]);
    const p = daPilula(pilulaNaConversa(estadoCom([], espera), "orq", SEM_PROGRESSO));
    expect([p.pilula.sinal, p.pilula.texto, ...p.pilula.resto]).toEqual(["espera", "Esperando a CI do #845", "38 min"]);
    expect(p.partes.botao).toContain('<span class="pf-ponto espera" aria-hidden="true"></span>');
    const fila = daPilula(pilulaNaConversa(estadoCom([], dono({ principal: "fila", fila: 1 }, [], [{ turnoId: "t1", de: "pessoa", nome: null, desde: AGORA - 2 * MIN }])), "orq", SEM_PROGRESSO));
    expect([fila.pilula.sinal, fila.pilula.texto]).toEqual(["fila", "1 pedido na fila"]);
  });

  it("frentes e espera juntas: as frentes no texto e a espera em contagem ao lado", () => {
    const p = daPilula(pilulaNaConversa(estadoCom(HEROS, dono({ esperando: 1, motivoEspera: "a CI do #845", fila: 1 }, [], [{ turnoId: "t1", de: "colega", nome: "Leonardo", desde: AGORA }])), "orq", SEM_PROGRESSO));
    expect(p.pilula.resto).toEqual(["3 de 5 prontas", "esperando a CI do #845", "1 pedido na fila"]);
  });

  it("\"Esperando você\" saiu da pílula (a pergunta tem o cartão); o bot livre não tem pílula", () => {
    expect(pilulaNaConversa(estadoCom([], dono({ principal: "esperando_voce", esperandoVoce: 1 })), "orq", SEM_PROGRESSO).tipo).toBe("nada");
    expect(pilulaNaConversa(estadoCom([], dono()), "orq", SEM_PROGRESSO).tipo).toBe("nada");
    const comPergunta = daPilula(pilulaNaConversa(estadoCom(HEROS, dono({ esperandoVoce: 2 })), "orq", SEM_PROGRESSO));
    expect(comPergunta.partes.corpo).not.toContain("Esperando você");
  });

  it("revisão do PR 400: a frente parada à espera da pessoa aparece fechada, como no bloco da fala (a linha do dono dizia \"Esperando você\")", () => {
    const comUma = HEROS.map((t) => (t.id === "w5" ? { ...t, estado: "precisa_de_voce" as const, ultimoPasso: "rodando os testes" } : t));
    expect(daPilula(pilulaNaConversa(estadoCom(comUma, dono()), "orq", SEM_PROGRESSO)).pilula.resto).toEqual(["3 de 5 prontas", "1 precisa de você"]);
    const comDuas = comUma.map((t) => (t.id === "w3" ? { ...t, estado: "fechado_ocioso" as const } : t));
    expect(daPilula(pilulaNaConversa(estadoCom(comDuas, dono()), "orq", SEM_PROGRESSO)).pilula.resto).toEqual(["3 de 5 prontas", "2 precisam de você"]);
    // A frente sozinha: o estado ganha do último passo, que esconderia o "precisa de você".
    const sozinha = [frente("h", "Hero do site", { estado: "precisa_de_voce", ultimoPasso: "montando o layout", loteId: "l2", lote: { id: "l2", abertoEm: AGORA, frentes: 1, abertas: 1 } })];
    expect(daPilula(pilulaNaConversa(estadoCom(sozinha, dono()), "orq", SEM_PROGRESSO)).pilula.resto).toEqual(["precisa de você"]);
  });

  it("sem o dono no servidor (anterior ao I10): a faixa de tasks de antes", () => {
    const p = pilulaNaConversa(estadoCom(HEROS, null), "orq", SEM_PROGRESSO);
    expect(p.tipo).toBe("legado");
    expect(p.tipo === "legado" && p.html).toContain("pilula-trab");
  });
});

describe("a pílula alargada (protótipo D4BE2)", () => {
  const p = daPilula(pilulaNaConversa(estadoCom(HEROS, dono()), "orq", progresso([], ["w1", "w2", "w3", "w4", "w5"])));

  it("rodando primeiro, com o último passo e o tempo; depois as prontas pela hora, com ✓; o traço entre as duas", () => {
    const ordem = [...p.partes.corpo.matchAll(/data-id="(w\d)"/g)].map((m) => m[1]);
    expect(ordem).toEqual(["w3", "w5", "w1", "w2", "w4"]);
    expect(p.partes.corpo).toContain('Hero w3 · Terminal retrô</button><span class="sr-only"> (rodando)</span><span class="progresso-passo">ajustando o contraste</span></span><span class="progresso-fim">12 min</span>');
    expect(p.partes.corpo).toContain('<span class="progresso-passo">rodando os testes</span></span><span class="progresso-fim">9 min</span>');
    expect(p.partes.corpo).toContain('<li class="progresso-item pf-depois pronta">');
    expect(p.partes.corpo).toContain('<span class="progresso-fim">01:09</span>');
    expect(p.partes.corpo.match(/pf-depois/g)).toHaveLength(1);
  });

  it("o cabeçalho com o resumo e \"fechar\"; no pé, \"Ver na conversa ↑\" (com a fala na janela) e \"Parar\"", () => {
    expect(p.partes.cab).toContain('<span class="pf-cab-titulo">5 frentes · 3 de 5 prontas</span>');
    expect(p.partes.cab).toContain(`class="pf-fechar" data-act="pilula" data-recolher="1" aria-expanded="true" aria-controls="${ID_PAINEL}">fechar`);
    expect(p.partes.pe).toContain('data-act="pilula-ver-na-conversa">Ver na conversa');
    expect(p.partes.pe).toContain('<button type="button" class="pf-parar" data-act="pilula-parar">Parar</button>');
    expect(p.pilula.abertas.map((t) => t.id)).toEqual(["w3", "w5"]);
    // A fala fora da janela carregada: "Ver na conversa" não tem para onde levar.
    expect(daPilula(pilulaNaConversa(estadoCom(HEROS, dono()), "orq", SEM_PROGRESSO)).partes.pe).not.toContain("Ver na conversa");
  });

  it("as seções Esperando e Na fila, abaixo das frentes, com o que a linha aberta mostrava", () => {
    const d = dono({ esperando: 1, motivoEspera: "a CI do #845", fila: 1 }, [{ tipo: "comando", trabalhoId: "w5", motivo: "a CI do #845", desde: AGORA - 38 * MIN, comando: "gh pr checks 845 --watch", ultimaLinha: "checks · pending", tentativa: 2, tentativas: 3 }], [{ turnoId: "t1", de: "colega", nome: "Leonardo", desde: new Date(2026, 9, 18, 1, 2).getTime() }]);
    const corpo = daPilula(pilulaNaConversa(estadoCom(HEROS, d), "orq", SEM_PROGRESSO)).partes.corpo;
    expect(corpo.indexOf('<h3 class="pf-secao">Esperando</h3>')).toBeGreaterThan(corpo.indexOf("Hero w4"));
    expect(corpo).toContain('<code class="pf-comando">gh pr checks 845 --watch</code><span class="pf-sub mono">última linha: checks · pending</span><span class="pf-sub">volta quando a CI do #845 terminar · tentativa 2 de 3 · da frente Hero w5 · Boot do time</span></span><span class="pf-item-fim">38 min</span>');
    expect(corpo.indexOf('<h3 class="pf-secao">Na fila</h3>')).toBeGreaterThan(corpo.indexOf("Esperando</h3>"));
    expect(corpo).toContain('<span class="pf-item-titulo">Pedido do Leonardo</span></span><span class="pf-item-fim">01:02</span>');
  });

  it("o painel é uma região com nome; fechado ele é `hidden`, aberto não", () => {
    const fechada = htmlDaPilula(p.partes, { aberta: false, escondida: false });
    expect(fechada).toContain(`<section class="pf-painel" id="${ID_PAINEL}" role="region" aria-label="Frentes de Orquestrador de Sites" hidden>`);
    const aberta = htmlDaPilula(p.partes, { aberta: true, escondida: false });
    expect(aberta).toContain('<div class="pilula-frentes" data-estado="aberta">');
    expect(aberta).toContain('aria-expanded="true"');
    expect(aberta).toContain('role="region" aria-label="Frentes de Orquestrador de Sites"><div class="pf-cab">');
    // No celular a folha tem o fundo que fecha ao toque, fora do Tab e da árvore de acessibilidade.
    expect(aberta).toContain('<button type="button" class="pf-fundo" data-act="pilula" data-recolher="1" tabindex="-1" aria-hidden="true"></button>');
  });
});

describe("some com a fala à vista, não com espera nem fila", () => {
  const grupos = [{ ids: ["w1", "w2", "w3"] }];

  it("todo grupo com uma frente num bloco à vista: escondida; a fala fora da vista ou fora da janela: à vista", () => {
    expect(pilulaEscondida({ grupos, esperas: 0, fila: 0 }, progresso(["w2"]))).toBe(true);
    expect(pilulaEscondida({ grupos, esperas: 0, fila: 0 }, progresso([], ["w2"]))).toBe(false);
    expect(pilulaEscondida({ grupos, esperas: 0, fila: 0 }, SEM_PROGRESSO)).toBe(false);
    // Dois lotes: só a fala de um à vista não basta.
    expect(pilulaEscondida({ grupos: [...grupos, { ids: ["a1"] }], esperas: 0, fila: 0 }, progresso(["w2"]))).toBe(false);
  });

  it("espera e fila não têm fala-âncora: a pílula fica à vista enquanto valem", () => {
    expect(pilulaEscondida({ grupos, esperas: 1, fila: 0 }, progresso(["w2"]))).toBe(false);
    expect(pilulaEscondida({ grupos, esperas: 0, fila: 2 }, progresso(["w2"]))).toBe(false);
    expect(pilulaEscondida({ grupos: [], esperas: 1, fila: 0 }, SEM_PROGRESSO)).toBe(false);
  });

  it("escondida, sai da árvore de acessibilidade e do Tab com `hidden` (nunca só opacidade)", () => {
    const e = estadoCom(HEROS, dono());
    const p = daPilula(pilulaNaConversa(e, "orq", progresso(["w3"])));
    expect(p.escondida).toBe(true);
    expect(htmlDaPilula(p.partes, { aberta: false, escondida: true })).toMatch(/^<div class="pilula-frentes" data-estado="fechada" hidden>/);
    const comFila = estadoCom(HEROS, dono({ fila: 1 }, [], [{ turnoId: "t1", de: "pessoa", nome: null, desde: AGORA }]));
    expect(daPilula(pilulaNaConversa(comFila, "orq", progresso(["w3"]))).escondida).toBe(false);
  });
});

describe("a visibilidade da fala (o esquema da pílula da pergunta, #389)", () => {
  const janela = { topo: 100, base: 700 };

  it("o bloco conta como à vista com pelo menos 24 px dentro da janela; todos os blocos contam como na timeline", () => {
    const dentro = progressoNaTela([{ ids: ["w1", "w2"], topo: 300, base: 380 }], janela);
    expect([...dentro.aVista]).toEqual(["w1", "w2"]);
    const acima = progressoNaTela([{ ids: ["w1"], topo: 20, base: 100 + MARGEM_A_VISTA }], janela);
    expect([...acima.aVista]).toEqual([]);
    expect([...acima.naTimeline]).toEqual(["w1"]);
    const raspando = progressoNaTela([{ ids: ["w1"], topo: 20, base: 100 + MARGEM_A_VISTA + 1 }], janela);
    expect([...raspando.aVista]).toEqual(["w1"]);
    expect([...progressoNaTela([{ ids: ["w1"], topo: 700 - MARGEM_A_VISTA, base: 800 }], janela).aVista]).toEqual([]);
  });

  it("o histórico mudando sem rolagem (o bloco desce com uma fala nova): a mesma medida decide, e a chave só muda quando o resultado muda", () => {
    const antes = progressoNaTela([{ ids: ["w1"], topo: 600, base: 680 }], janela);
    const depois = progressoNaTela([{ ids: ["w1"], topo: 720, base: 800 }], janela);
    expect(chaveDoProgresso(antes)).not.toBe(chaveDoProgresso(depois));
    expect(chaveDoProgresso(progressoNaTela([{ ids: ["w1"], topo: 500, base: 580 }], janela))).toBe(chaveDoProgresso(antes));
    expect(chaveDoProgresso(progressoNaTela([], janela))).toBe(chaveDoProgresso(SEM_PROGRESSO));
  });
});

describe("alargar, Esc e o foco", () => {
  it("alargar é o estado da tela (`faixaTrabalhosAberta`), que sobrevive ao re-render; navegar fecha", () => {
    let e = reduzir(estadoCom(HEROS, dono()), { tipo: "faixa-trabalhos", agenteId: "orq" });
    expect(e.faixaTrabalhosAberta).toBe("orq");
    // Um frame qualquer (o tempo andou): a pílula redesenhada continua alargada.
    e = { ...e, agora: AGORA + MIN };
    const p = daPilula(pilulaNaConversa(e, "orq", SEM_PROGRESSO));
    expect(htmlDaPilula(p.partes, { aberta: e.faixaTrabalhosAberta === "orq", escondida: p.escondida })).toContain('data-estado="aberta"');
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "inicio" } });
    expect(e.faixaTrabalhosAberta).toBeNull();
  });

  it("Esc fecha a pílula alargada (e o foco volta a ela); fechada, Esc é de outro", () => {
    expect(teclaNaPilula("Escape", true)).toBe("fechar");
    expect(teclaNaPilula("Escape", false)).toBeNull();
    expect(teclaNaPilula("Tab", true)).toBeNull();
  });

  it("a fala entra na vista: alargada, a pílula fecha sozinha; com o foco nela, ele vai para a fala", () => {
    expect(aoEsconder({ aberta: true, focoDentro: true })).toEqual({ fechar: true, foco: "fala" });
    expect(aoEsconder({ aberta: true, focoDentro: false })).toEqual({ fechar: true, foco: null });
    // Fechada, com o foco no botão dela: a pílula some e o foco também vai à fala.
    expect(aoEsconder({ aberta: false, focoDentro: true })).toEqual({ fechar: false, foco: "fala" });
    expect(aoEsconder({ aberta: false, focoDentro: false })).toEqual({ fechar: false, foco: null });
  });

  it("revisão do PR 400: a pílula sai de vez (o último lote acabou) — o foco vai ao campo e o estado aberto é esquecido", () => {
    expect(aoSumir({ aberta: true, focoDentro: true })).toEqual({ fechar: true, foco: "campo" });
    expect(aoSumir({ aberta: true, focoDentro: false })).toEqual({ fechar: true, foco: null });
    expect(aoSumir({ aberta: false, focoDentro: false })).toEqual({ fechar: false, foco: null });
    // O último lote terminou: sem frente aberta, nada a mostrar — é aí que o main.ts chama aoSumir.
    const prontas = HEROS.map((t) => ({ ...t, estado: "terminado" as const, terminadoEm: AGORA - MIN }));
    expect(pilulaNaConversa(estadoCom(prontas, dono()), "orq", SEM_PROGRESSO).tipo).toBe("nada");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const desenhar = main.slice(main.indexOf("function desenharPilula(): void {"), main.indexOf("function anunciarFrentesTerminadas("));
    expect(desenhar).toMatch(/if \(p\.tipo === "nada"\) \{\n\s+const ao = aoSumir\(/);
    expect(desenhar).toMatch(/ao\.foco === "campo"\) document\.getElementById\("composer-texto"\)\?\.focus/);
  });

  it("alargar conta para o gatilho da ADR-099 no tipo `frentes`, com a chave da pílula", () => {
    const p = daPilula(pilulaNaConversa(estadoCom(HEROS, dono()), "orq", SEM_PROGRESSO));
    expect(p.partes.telemetria).toBe("frentes:pilula:lote:l1");
    expect(daPilula(pilulaNaConversa(estadoCom([], dono({ fila: 1 }, [], [{ turnoId: "t", de: "pessoa", nome: null, desde: AGORA }])), "orq", SEM_PROGRESSO)).partes.telemetria).toBeNull();
  });

  it("revisão do PR 400: com vários lotes a chave passa na validação do servidor (sem vírgula, até 200) e casa a mostrada com a aberta", () => {
    // Ids de verdade são uuid: seis lotes juntos por vírgula davam ~260 caracteres com ",", e o servidor recusava o lote
    // inteiro de eventos (inclusive os de "ver as N" e da troca que iam junto).
    const uuid = (n: number): string => `0000000${n}-aaaa-4bbb-8ccc-0000000000${String(n).padStart(2, "0")}`;
    const lote = (n: number, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => frente(`f${n}`, `Frente ${n}`, { id: uuid(n), loteId: uuid(50 + n), lote: { id: uuid(50 + n), abertoEm: AGORA, frentes: 1, abertas: 1 }, criadoEm: AGORA - n * MIN, ...extra });
    const seis = [1, 2, 3, 4, 5, 6].map((n) => lote(n));
    const chave = daPilula(pilulaNaConversa(estadoCom(seis, dono()), "orq", SEM_PROGRESSO)).partes.telemetria ?? "";
    expect(chave).toMatch(CHAVE_LINHA);
    expect(chave.startsWith("frentes:pilula:")).toBe(true);
    // A mesma pílula redesenhada (outra ordem, o tempo andou) tem a mesma chave; outro conjunto de lotes, outra.
    expect(daPilula(pilulaNaConversa({ ...estadoCom([...seis].reverse(), dono()), agora: AGORA + MIN }, "orq", SEM_PROGRESSO)).partes.telemetria).toBe(chave);
    expect(daPilula(pilulaNaConversa(estadoCom(seis.slice(0, 5), dono()), "orq", SEM_PROGRESSO)).partes.telemetria).not.toBe(chave);
    expect(daPilula(pilulaNaConversa(estadoCom(seis.slice(0, 2), dono()), "orq", SEM_PROGRESSO)).partes.telemetria).toMatch(CHAVE_LINHA);
  });
});

describe("a região viva: só quando uma frente termina", () => {
  it("\"Hero w3 pronta\" na passagem de aberta para terminada; nada a cada passo nem na primeira olhada", () => {
    const primeira = anunciosDeFim(null, HEROS);
    expect(primeira.anuncios).toEqual([]);
    const passo = anunciosDeFim(primeira.estados, HEROS.map((t) => ({ ...t, ultimoPasso: "outro passo" })));
    expect(passo.anuncios).toEqual([]);
    const fim = anunciosDeFim(primeira.estados, HEROS.map((t) => (t.id === "w3" ? { ...t, estado: "terminado" as const } : t.id === "w5" ? { ...t, estado: "parado" as const } : t)));
    expect(fim.anuncios).toEqual(["Hero w3 · Terminal retrô pronta", "Hero w5 · Boot do time parada"]);
    // A que já estava terminada não é anunciada de novo.
    expect(anunciosDeFim(fim.estados, HEROS.map((t) => (t.id === "w3" ? { ...t, estado: "terminado" as const } : t))).anuncios).toEqual([]);
  });
});

describe("main.ts: a pílula decide com a medida da timeline desenhada", () => {
  it("revisão do PR 400: o render desenha a pílula depois de regravar a timeline (e de a rolagem medir o progresso), nunca antes", () => {
    // Antes da timeline, a conversa recém-aberta com a fala à vista usava a medida da tela anterior: a pílula nascia à vista,
    // contava "mostrada" na telemetria e escorregava para fora no mesmo quadro.
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const render = main.slice(main.indexOf("function renderPrincipal(): void {"), main.indexOf("function regravarTimeline("));
    const regrava = render.indexOf("regravarTimeline(corpo, partes");
    expect(regrava).toBeGreaterThan(0);
    expect(render.indexOf("desenharPilula();")).toBeGreaterThan(regrava);
    expect(render.slice(0, regrava)).not.toContain("desenharPilula();");
    expect(main.slice(main.indexOf("function regravarTimeline("))).toMatch(/rolagem\.depoisDeDesenhar\(/);
  });

  it("rebase sobre o QA do PR 7: o bloco trocado no lugar, sem regravar a fala, é medido de novo antes de a pílula decidir", () => {
    // `criarProgressoNaTela` troca o bloco dentro do lugar `[data-progresso]` sem regravar a fala: um `.progresso` guardado
    // pela rolagem sairia do documento e a pílula voltaria com a fala à vista. A rolagem guarda os lugares e lê o filho.
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const rolagem = readFileSync(new URL("../../../web/lib/rolagem-na-tela.ts", import.meta.url), "utf8");
    expect(rolagem).toContain('querySelectorAll<HTMLElement>("[data-progresso]")');
    expect(rolagem).not.toContain('querySelectorAll<HTMLElement>(".progresso[data-frentes]")');
    expect(rolagem).toMatch(/lugar\.firstElementChild/);
    const render = main.slice(main.indexOf("function renderPrincipal(): void {"), main.indexOf("function regravarTimeline("));
    const desenho = render.indexOf("if (progressoNaTela.desenhar(conversaDaTela(estado), estado, memoriaNaFala()) > 0) rolagem.progressoTrocado();");
    expect(desenho).toBeGreaterThan(render.indexOf("regravarTimeline(corpo, partes"));
    expect(render.indexOf("desenharPilula();")).toBeGreaterThan(desenho);
  });
});

describe("CSS da pílula", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");

  it("o painel é absoluto, contido, e anima `clip-path` (nunca width/max-height); escondida, `hidden` vira display: none", () => {
    expect(css).toMatch(/\.pf-moldura \{ position: absolute;/);
    expect(css).toMatch(/\.pf-painel \{[^}]*contain: layout paint;[^}]*clip-path: inset\(calc\(100% - 36px\) calc\(50% - var\(--pilula-w\) \/ 2\) 0 round 18px\);[^}]*transition: clip-path/);
    expect(css).not.toMatch(/\.pf-painel \{[^}]*transition:[^}]*(width|max-height)/);
    expect(css).toContain(".pilula-frentes[hidden] { display: none; }");
    expect(css).toContain(".pf-painel[hidden] { display: none; }");
  });

  it("movimento reduzido: alarga e some sem animação", () => {
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .pf-fechada"));
    expect(bloco).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{\n {2}\.pf-fechada, [^{]*\.pf-painel, \.pilula-frentes\[data-estado="aberta"\] \.pf-painel \{ transition: none; \}/);
    // Revisão do PR 400: o desligar usa o MESMO seletor da entrada — `.pf-painel.entrando *` (0,2,0) perdia para o
    // `:is(.pf-lista > li, …)` (0,3,1) e as linhas subiam uma a uma com movimento reduzido.
    const entrada = /\n(\.pf-painel\.entrando :is\([^)]*\)) \{ animation: pf-entra/.exec(css)?.[1] ?? "";
    expect(entrada).not.toBe("");
    expect(bloco.slice(0, bloco.indexOf("\n}"))).toContain(`${entrada} { animation: none; }`);
    // E a classe da entrada nem é posta com movimento reduzido.
    expect(readFileSync(new URL("../../../web/lib/pilula-na-tela.ts", import.meta.url), "utf8")).toContain('if (!c.reduzido()) e.painel.classList.add("entrando");');
  });

  it("revisão do PR 400: a pílula fechada não vaza da borda — o resto cinza encolhe com reticências antes do título", () => {
    // Com `left: 50%` e sem largura, a pílula cabia na metade da faixa e, com `.pf-resto { flex: none }`, o passo longo de
    // uma frente sozinha (até 140 caracteres) saía da borda por cima da timeline e o título encolhia a zero.
    expect(css).toMatch(/\.pf-fechada \{[^}]*left: 50%;[^}]*width: max-content; max-width: 100%;/);
    // QA do PR 400: o título não encolhe nem uma fração de pixel enquanto o resto cede (a reticência comia a última letra);
    // o teto (a pílula menos ponto, seta e vãos) o mantém dentro da borda quando ele sozinho não cabe.
    expect(css).toContain(".pf-texto { flex: none; min-width: 0; max-width: calc(100% - 43px); overflow: hidden; text-overflow: ellipsis; }");
    expect(css).toMatch(/\.pf-resto \{ flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  });

  it("no celular a pílula tem alvo de 44 px e, alargada, vira folha de baixo com o fundo que fecha", () => {
    const bloco = mobile.slice(mobile.indexOf("A pílula do bot no celular"));
    expect(bloco).toContain(".pf-fechada { height: 44px;");
    expect(bloco).toMatch(/\.pf-moldura \{ position: fixed;[^}]*bottom: 0; \}/);
    expect(bloco).toContain('.pilula-frentes[data-estado="aberta"] .pf-fundo { display: block; position: fixed;');
  });
});

describe("a conversa aberta antes do histórico chegar (QA do PR 400)", () => {
  // Regressão: a pílula nascia à vista com a timeline ainda vazia (sem fala para medir), contava "mostrada" e escorregava
  // para fora quando as mensagens chegavam com a fala à vista. Achado pelo /qa em 2026-10-18 (conversa curta aberta do zero).
  const carregada = (e: Estado): Estado => ({ ...e, conversas: { [C]: { id: C, mensagens: [], carregadaEm: AGORA } as never } });

  it("com frentes e sem o histórico: escondida (não conta \"mostrada\"); com ele, decide pela medida da fala", () => {
    const e = estadoCom(HEROS, dono());
    expect(daPilula(pilulaNaConversa(e, "orq", SEM_PROGRESSO)).escondida).toBe(true);
    expect(daPilula(pilulaNaConversa(carregada(e), "orq", SEM_PROGRESSO)).escondida).toBe(false);
    expect(daPilula(pilulaNaConversa(carregada(e), "orq", progresso(["w3"]))).escondida).toBe(true);
  });

  it("espera e fila não têm fala-âncora: aparecem já, mesmo sem o histórico", () => {
    const comFila = estadoCom(HEROS, dono({ fila: 1 }, [], [{ turnoId: "t1", de: "pessoa", nome: null, desde: AGORA }]));
    expect(daPilula(pilulaNaConversa(comFila, "orq", SEM_PROGRESSO)).escondida).toBe(false);
    const espera = dono({ principal: "esperando", esperando: 1, motivoEspera: "a CI do #845", desde: AGORA - 38 * MIN }, [{ tipo: "comando", trabalhoId: null, motivo: "a CI do #845", desde: AGORA - 38 * MIN }]);
    expect(daPilula(pilulaNaConversa(estadoCom([], espera), "orq", SEM_PROGRESSO)).escondida).toBe(false);
  });
});

describe("NOD-377: a espera de colega vencida na pílula (protótipo aprovado)", () => {
  const H = 3_600_000;
  const vencida = (c: Partial<NonNullable<EsperaDoDonoDto["colega"]>> = {}): DonoDto => dono(
    { principal: "esperando", esperando: 1, motivoEspera: "Leo", desde: AGORA - 26 * H },
    [{ tipo: "colega", trabalhoId: null, motivo: "Leo", desde: AGORA - 26 * H, colega: { id: "l", removido: false, trabalhando: false, fila: 0, tarefaId: "t1", vencida: true, cobradoEm: null, podeCobrar: true, ...c } }],
  );

  it("fechada: 'sem resposta há 26h' no lugar do tempo, em cinza; aberta: Cobrar e Desistir, sem o tempo à direita", () => {
    const p = daPilula(pilulaNaConversa(estadoCom([], vencida()), "orq", SEM_PROGRESSO));
    expect([p.pilula.texto, ...p.pilula.resto]).toEqual(["Esperando Leo", "sem resposta há 26h"]);
    expect(p.partes.botao).toContain('class="pf-resto p377-resto"');
    expect(p.partes.corpo).toContain('data-act="espera-cobrar" aria-label="Cobrar Leo" data-agente="orq" data-tarefa="t1"');
    expect(p.partes.corpo).toContain(">Desistir</button>");
    expect(p.partes.corpo).toContain("sem resposta há 26h");
    expect(p.partes.corpo).not.toContain("Leo está livre");
    expect(p.partes.corpo).not.toContain("pf-item-fim");
  });

  it("cobrada: 'Esperando Leo · cobrado agora' e só Desistir", () => {
    const p = daPilula(pilulaNaConversa(estadoCom([], vencida({ vencida: false, podeCobrar: false, cobradoEm: AGORA - 5_000 })), "orq", SEM_PROGRESSO));
    expect([p.pilula.texto, ...p.pilula.resto]).toEqual(["Esperando Leo", "cobrado agora"]);
    expect(p.partes.corpo).not.toContain("espera-cobrar");
    expect(p.partes.corpo).toContain("espera-desistir");
  });

  it("no prazo: nada muda (o tempo e sem ações)", () => {
    const d = dono({ principal: "esperando", esperando: 1, motivoEspera: "Leo", desde: AGORA - 2 * H }, [{ tipo: "colega", trabalhoId: null, motivo: "Leo", desde: AGORA - 2 * H, colega: { id: "l", removido: false, trabalhando: false, fila: 0, tarefaId: "t1", vencida: false, cobradoEm: null, podeCobrar: false } }]);
    const p = daPilula(pilulaNaConversa(estadoCom([], d), "orq", SEM_PROGRESSO));
    expect(p.pilula.resto).toEqual(["2h"]);
    expect(p.partes.corpo).not.toContain("p377-acoes");
  });
});
