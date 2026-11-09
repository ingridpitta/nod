import { describe, expect, it } from "vitest";
import type { DonoDto, EsperaDoDonoDto, EstadoDoDono, PedidoNaFilaDto } from "../../../src/contracts/dono.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { esperaDoTrabalho } from "../../../src/domain/trabalho.ts";
import { aplicarFrame, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { esperaNaTela, fraseDoDono, linhaDoDono, quemPediu, textoDaFila } from "../../../web/lib/dono.ts";
import { agrupar, foraDoMac, pontoTrabalho, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { renderTrabalhosPorBot, sinalDoBot } from "../../../web/telas/linha-do-dono.ts";

/**
 * A tela do um dono por bot (ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/): as frases por
 * prioridade (quadro 08), o sinal da barra lateral, Trabalhos por bot (quadro 05) e "esperar não é trabalhar" para a espera
 * de comando. A linha acima do campo virou a pílula que se alarga (chat limpo, PR 8): tests/unit/web/pilula-do-bot.test.ts.
 */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 11, 18, 33).getTime();

const estadoDono = (extra: Partial<EstadoDoDono> = {}): EstadoDoDono => ({
  agenteId: "ze1", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null, ...extra,
});
const dono = (e: Partial<EstadoDoDono> = {}, esperas: EsperaDoDonoDto[] = [], fila: PedidoNaFilaDto[] = []): DonoDto => ({ estado: estadoDono(e), esperas, fila });
const pedido = (n: number, de: PedidoNaFilaDto["de"] = "colega", nome: string | null = "Leonardo"): PedidoNaFilaDto => ({ turnoId: `p${n}`, de, nome, desde: AGORA - (60 - n) * MIN });

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ze1", conversaId: "c-ze1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 20 * MIN, iniciadoEm: AGORA - 18 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

const AGENTES = [
  { id: "ze1", nome: "Ze 1", conversaId: "c-ze1", cor: "c-red", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
  { id: "ze2", nome: "Ze 2", conversaId: "c-ze2", cor: "c-teal", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
  { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-red", forma: "shape-square", ownerId: "p", titulo: "Tech Lead", descricao: "", confirmado: true },
  { id: "nod", nome: "Nod", conversaId: "c-nod", cor: "c-black", forma: "shape-circle", ownerId: "p", titulo: "", descricao: "", confirmado: true },
  { id: "eng", nome: "Eng 1", conversaId: "c-eng", cor: "c-blue", forma: "shape-circle", ownerId: "p", titulo: "Eng", descricao: "", confirmado: true },
];

function estadoCom(trabalhos: TrabalhoDto[], donos: DonoDto[] | undefined, extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: AGENTES } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null, ...(donos ? { donos } : {}) },
    tela: { tipo: "conversa", conversaId: "c-ze1", agenteId: "ze1" },
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
    ...extra,
  };
}

const comando = (extra: Partial<EsperaDoDonoDto> = {}): EsperaDoDonoDto => ({
  tipo: "comando", trabalhoId: null, motivo: "a CI do #845", desde: AGORA - 38 * MIN, comando: "gh pr checks 845 --watch", ultimaLinha: "checks · pending · Test and build", tentativa: 2, tentativas: 3, ...extra,
});

describe("a linha acima do campo, por prioridade (quadro 08)", () => {
  it("Esperando você > Trabalhando em N frentes > Esperando X > N na fila > livre (some)", () => {
    const voce = linhaDoDono(dono({ esperandoVoce: 1, frentes: 2, fila: 1 }, [], [pedido(1)]), AGORA);
    expect(voce).toEqual({ sinal: "voce", texto: "Esperando você", extras: ["2 frentes trabalhando", "1 pedido na fila"], quantos: 1 });
    const trab = linhaDoDono(dono({ frentes: 3, esperando: 1, motivoEspera: "a CI do #845" }), AGORA);
    expect(trab).toEqual({ sinal: "vivo", texto: "Trabalhando em 3 frentes", extras: ["esperando a CI do #845"], quantos: 3 });
    const esp = linhaDoDono(dono({ esperando: 1, motivoEspera: "a CI do #845", desde: AGORA - 38 * MIN, fila: 2 }, [], [pedido(1), pedido(2)]), AGORA);
    expect(esp).toEqual({ sinal: "espera", texto: "Esperando a CI do #845", extras: ["38 min", "2 pedidos na fila"], quantos: 1 });
    expect(linhaDoDono(dono({ fila: 2 }, [], [pedido(1), pedido(2)]), AGORA)).toEqual({ sinal: "fila", texto: "2 pedidos na fila", extras: [], quantos: 2 });
    expect(linhaDoDono(dono(), AGORA)).toBeNull();
  });

  it("o turno da própria conversa não acende a linha (o balão ao vivo já diz); na barra e em Trabalhos, com `comConversa`, conta", () => {
    const soConversa = dono({ principal: "trabalhando", conversaTrabalhando: true });
    expect(linhaDoDono(soConversa, AGORA)).toBeNull();
    expect(linhaDoDono(soConversa, AGORA, { comConversa: true })?.texto).toBe("Trabalhando na conversa");
  });

  it("textos de contagem: uma frente no singular, várias esperas sem motivo, fila misturada com frentes na vez", () => {
    expect(linhaDoDono(dono({ frentes: 1 }), AGORA)?.texto).toBe("Trabalhando em 1 frente");
    expect(linhaDoDono(dono({ frentes: 1, esperando: 3, motivoEspera: "a CI" }), AGORA)?.extras).toEqual(["3 esperando"]);
    expect(linhaDoDono(dono({ esperando: 3, motivoEspera: "a CI", desde: AGORA - 5 * MIN }), AGORA)?.extras).toEqual(["5 min", "mais 2 esperando"]);
    expect(textoDaFila({ fila: 3 }, 1)).toBe("3 na fila");
    expect(textoDaFila({ fila: 1 }, 1)).toBe("1 pedido na fila");
  });

});

describe("as esperas e a fila em frase (a pílula alargada lê daqui)", () => {
  it("as esperas em frase: comando, volta marcada e colega; quem pediu o que está na fila", () => {
    expect(esperaNaTela(comando({ ultimaLinha: null }), AGORA, "Mobile")).toEqual({ titulo: "gh pr checks 845 --watch", comando: true, linhas: ["volta quando a CI do #845 terminar · tentativa 2 de 3 · da frente Mobile"], tempo: "38 min" });
    const volta = esperaNaTela({ tipo: "volta", trabalhoId: null, motivo: "o deploy terminar", desde: AGORA - 10 * MIN, acordaEm: new Date(2026, 9, 11, 19, 5).getTime() }, AGORA);
    expect(volta.titulo).toBe("Volta às 19:05");
    expect(volta.linhas).toEqual(["o deploy terminar"]);
    expect(esperaNaTela({ tipo: "colega", trabalhoId: null, motivo: "Ze 2", desde: AGORA - 3 * MIN }, AGORA).titulo).toBe("Esperando Ze 2");
    expect(quemPediu({ de: "pessoa", nome: null })).toBe("seu pedido");
    expect(quemPediu({ de: "rotina", nome: "Triagem do Slack" })).toBe("rotina Triagem do Slack");
    expect(quemPediu({ de: "colega", nome: "Leonardo" })).toBe("pedido do Leonardo");
  });
});

describe("a barra lateral: um sinal por bot", () => {
  const sinal = (d: DonoDto) => sinalDoBot(estadoCom([], [d]), { id: "ze1", cor: "c-red", conversaId: "c-ze1" });

  it("vivo trabalhando (com o número de frentes se > 1), vazado esperando, azul precisa de você; livre, nada", () => {
    expect(sinal(dono({ frentes: 1 }))).toContain('<span class="ponto-trabalho c-red pulso-trab" aria-hidden="true"></span></span>');
    expect(sinal(dono({ frentes: 3 }))).toContain('<span class="sinal-n">3</span>');
    expect(sinal(dono({ esperando: 10, motivoEspera: "a CI" }))).toContain('<span class="ponto-trabalho fora-do-mac"');
    expect(sinal(dono({ fila: 2 }, [], [pedido(1), pedido(2)]))).toContain("fora-do-mac");
    expect(sinal(dono({ esperandoVoce: 1, frentes: 2 }))).toContain('data-sinal="voce"');
    expect(sinal(dono())).toBe("");
  });

  it("o title diz a frase inteira: \"1 trabalhando · 10 esperando\"", () => {
    expect(sinal(dono({ frentes: 1, esperando: 10, motivoEspera: "a CI do #845" }))).toContain('title="1 trabalhando · 10 esperando"');
    expect(sinal(dono({ esperando: 1, motivoEspera: "a CI do #845", fila: 1 }, [], [pedido(1)]))).toContain('title="esperando a CI do #845 · 1 pedido na fila"');
    expect(fraseDoDono(dono({ esperandoVoce: 1, frentes: 2 }))).toBe("precisa de você · 2 trabalhando");
  });

  it("o turno da conversa não acende o sinal (o GET trabalhos fica velho; o mascote já anima)", () => {
    expect(sinal(dono({ principal: "trabalhando", conversaTrabalhando: true }))).toBe("");
  });

  it("sem o dono no servidor, o chip de antes", () => {
    expect(sinalDoBot(estadoCom([trabalho("x")], undefined), { id: "ze1", cor: "c-red", conversaId: "c-ze1" })).toContain(">1</span>");
  });
});

describe("Trabalhos com uma linha por bot (quadro 05)", () => {
  const frenteZe2a = trabalho("g66", { agenteId: "ze2", conversaId: "c-ze2", titulo: "GFK-1866 · publicar versão completa", turnoVivoId: "x1", iniciadoEm: AGORA - 22 * MIN });
  const frenteZe2b = trabalho("g70", { agenteId: "ze2", conversaId: "c-ze2", titulo: "GFK-1870 · coins e gemas", turnoVivoId: "x2", iniciadoEm: AGORA - 18 * MIN });
  const feitaZe2 = trabalho("g68", { agenteId: "ze2", conversaId: "c-ze2", titulo: "GFK-1868 · preservar Ferons", estado: "terminado", terminadoEm: AGORA - 10 * MIN });
  const donos = [
    dono({ agenteId: "ze1", esperandoVoce: 1, desde: AGORA - 33 * MIN, fila: 2 }, [], [pedido(1), pedido(2)]),
    { ...dono({ agenteId: "ze2", frentes: 2, fila: 1, desde: AGORA - 28 * MIN }, [], [pedido(3)]) },
    dono({ agenteId: "leo", esperando: 1, motivoEspera: "Ze 1", desde: AGORA - 35 * MIN }, [{ tipo: "colega", trabalhoId: null, motivo: "Ze 1", desde: AGORA - 35 * MIN }]),
    dono({ agenteId: "nod" }),
    dono({ agenteId: "eng" }),
  ];
  const decisao = { decisao: { id: "d1", agenteId: "ze1", conversaId: "c-ze1", frase: "parei para perguntar a Marlon: Como seguir com o #845?", criadoEm: new Date(AGORA - 33 * MIN).toISOString() }, estadoColuna: "pendente" } as never;
  const base = (extra: Partial<Estado> = {}) => estadoCom([frenteZe2a, frenteZe2b, feitaZe2], donos, { tela: { tipo: "trabalhos" }, suaVez: { itens: [decisao], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null }, ...extra });

  it("os grupos Precisa de você, Trabalhando e Esperando, e os livres numa linha; o topo conta bots", () => {
    const html = renderTrabalhosPorBot(base());
    expect(html).toContain("<p>1 bot trabalhando · 1 esperando · 1 precisa de você</p>");
    const ordem = ["Precisa de você · 1", "Trabalhando · 1", "Esperando · 1"].map((t) => html.indexOf(t));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain('<p class="tb-livres">Livres: Nod, Eng 1</p>');
    // Uma linha por bot, não por task.
    expect(html.match(/class="tt-linha tb-linha"/g)).toHaveLength(3);
    expect(html).not.toContain("tt-filtros");
  });

  it("cada linha: ponto, mascote, nome, a frase e o detalhe curto, o tempo", () => {
    const html = renderTrabalhosPorBot(base());
    expect(html).toMatch(/<span class="ponto-trabalho precisa"[^>]*><\/span><span class="tt-bot">.*<b>Ze 1<\/b><\/span><span class="tt-meio"><span class="tt-titulo">Como seguir com o #845\?<\/span><span class="tt-passo">2 pedidos na fila<\/span><\/span><span class="tt-fim">há 33 min<\/span>/);
    expect(html).toContain('<span class="tt-titulo">Trabalhando em 2 frentes</span><span class="tt-passo">1 pedido na fila</span>');
    expect(html).toContain('<span class="ponto-trabalho c-teal pulso-trab"');
    expect(html).toContain('<span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span><span class="tt-bot">');
    expect(html).toContain('<span class="tt-titulo">Esperando Ze 1</span></span><span class="tt-fim">desde ');
  });

  it("clicar no bot abre as frentes dele embaixo da linha (abertas, terminadas hoje, a fila)", () => {
    const e = reduzir(base(), { tipo: "bot-trabalhos", agenteId: "ze2" });
    const html = renderTrabalhosPorBot(e);
    expect(html).toContain('data-act="bot-trabalhos" data-agente="ze2" aria-expanded="true"');
    expect(html).toContain('<div class="tb-frentes" role="group" aria-label="Frentes de Ze 2">');
    expect(html).toContain('data-act="abrir-trabalho" data-id="g66"');
    expect(html).toContain('<span class="tb-frente-fim">frente · 22 min</span>');
    expect(html).toContain("GFK-1868 · preservar Ferons");
    expect(html).toContain("Na fila: pedido do Leonardo");
    // Revisão do Gil no #340: a linha corta com reticências; o title traz a frase inteira (e some sem frase).
    const passos = [...html.matchAll(/<span class="tb-frente-passo"( title="([^"]*)")?>([^<]*)<\/span>/g)];
    expect(passos.length).toBeGreaterThan(0);
    for (const [, temTitle, title, texto] of passos) expect(temTitle ? title : "").toBe(texto);
    expect(passos.some(([, temTitle]) => temTitle)).toBe(true);
    expect(reduzir(e, { tipo: "bot-trabalhos", agenteId: null }).botAbertoEmTrabalhos).toBeNull();
  });

  it("NOD-302 (CA11 da NOD-253): o pedido de colega sem task que a cota segura fica \"na fila (cota)\", com a volta, e conta na pílula", () => {
    const voltaEm = new Date(2026, 9, 11, 20, 30).getTime();
    const pedidosNaFila = [{ turnoId: "p3", agenteId: "ze2", de: "Leonardo", pedido: "Revise o PR 42.", ia: "claude-cli" as const, situacao: "reserva" as const, voltaEm, criadoEm: AGORA - 57 * MIN }];
    const comCota = base();
    const e = reduzir({ ...comCota, trabalhos: { ...comCota.trabalhos!, cota: { situacao: "reserva", ias: ["claude-cli"], voltaEm }, pedidosNaFila } }, { tipo: "bot-trabalhos", agenteId: "ze2" });
    const html = renderTrabalhosPorBot(e);
    expect(html).toContain('<div class="tb-frente estatica" data-cota="1"><span class="ld-ordem" aria-hidden="true">1</span><span class="tb-frente-titulo">Na fila: pedido do Leonardo</span><span class="tb-frente-passo">na fila (cota) · volta às 20:30</span>');
    expect(html).toContain("1 espera · trabalho de fundo volta às 20:30");
    // Sem a cota segurando, a fila de sempre.
    expect(renderTrabalhosPorBot(reduzir(base(), { tipo: "bot-trabalhos", agenteId: "ze2" }))).not.toContain("na fila (cota)");
  });

  it("o bot que só conversa: trabalhando pelo turno ao vivo da conversa, não pelo GET trabalhos (que fica velho)", () => {
    const comVelho = estadoCom([], [dono({ agenteId: "nod", principal: "trabalhando", conversaTrabalhando: true })], { tela: { tipo: "trabalhos" } });
    expect(renderTrabalhosPorBot(comVelho)).toContain("Livres: Nod");
    const vivo = { ...comVelho, turnosVivos: { t1: { turnoId: "t1", conversaId: "c-nod", estado: "rodando" as const, executor: null, machineId: null, desde: AGORA, trabalhoId: null } } };
    expect(renderTrabalhosPorBot(vivo)).toContain('<span class="tt-titulo">Trabalhando na conversa</span>');
  });

  it("NOD-369: o topo por bot fica sem o custo de hoje (mesmo com um que sobre no estado); a pílula da memória continua", () => {
    const html = renderTrabalhosPorBot({ ...base({ pressao: "amarela" }), custoHoje: { totalUsd: 4.2, foraDoRitmo: true, bots: [] } } as Estado);
    const topo = html.slice(html.indexOf('<header class="tt-cab">'), html.indexOf("</header>"));
    expect(topo).not.toContain("US$");
    expect(html).not.toContain("tt-custo");
    expect(html).not.toContain("custo-hoje");
    expect(renderTrabalhosPorBot(base())).not.toContain("US$");
    expect(html).toContain("Pouca memória no seu Mac");
  });
});

describe("esperar não é trabalhar: a espera de comando conta como Esperando em todo lugar (item 5)", () => {
  const ci = trabalho("ci", { esperandoComando: { motivo: "a CI do #845", desde: AGORA - 38 * MIN } });
  it("foraDoMac, agrupar, o ponto e a frase; a regra do domínio é a mesma", () => {
    expect(foraDoMac(ci)).toBe(true);
    expect(esperaDoTrabalho(ci)).toBe("comando");
    expect(agrupar([ci], AGORA).esperando.map((t) => t.id)).toEqual(["ci"]);
    expect(agrupar([ci], AGORA).trabalhando).toEqual([]);
    expect(pontoTrabalho(ci, "c-red")).toContain("fora-do-mac");
    expect(situacaoDe(ci)).toBe("esperando a CI do #845");
    // Com turno vivo (o comando acabou e a frente voltou), trabalha.
    const voltou = { ...ci, turnoVivoId: "t9" };
    expect(foraDoMac(voltou)).toBe(false);
    expect(esperaDoTrabalho(voltou)).toBeNull();
  });
});

describe("reducer: o estado do dono que chega no frame trabalho.mudou", () => {
  const frame = (estadoDono: unknown): FrameSse => ({ tipo: "trabalho.mudou", dados: { trabalhoId: "f1", agenteId: "ze1", conversaId: "c-ze1", estado: "rodando", estadoDono } } as never);

  it("vale na hora na lista de GET trabalhos e na conversa do bot (as esperas e a fila esperam o REST)", () => {
    const antes = estadoCom([], [dono({ fila: 1 }, [comando()], [pedido(1)]), dono({ agenteId: "ze2" })], { conversas: { "c-ze1": { dono: dono({ fila: 1 }) } as never } });
    const novo = estadoDono({ principal: "trabalhando", frentes: 3 });
    const depois = aplicarFrame(antes, frame(novo), AGORA);
    expect(depois.trabalhos?.donos?.[0]?.estado).toEqual(novo);
    expect(depois.trabalhos?.donos?.[0]?.esperas).toHaveLength(1);
    expect(depois.trabalhos?.donos?.[1]).toBe(antes.trabalhos?.donos?.[1]);
    expect(depois.conversas["c-ze1"]?.dono?.estado).toEqual(novo);
    expect(depois.invalidacoes).toContain("trabalhos");
  });

  it("fora do formato ou ausente, nada muda (só a releitura)", () => {
    const antes = estadoCom([], [dono({ fila: 1 })]);
    expect(aplicarFrame(antes, frame(undefined), AGORA).trabalhos).toBe(antes.trabalhos);
    expect(aplicarFrame(antes, frame({ agenteId: 3 }), AGORA).trabalhos).toBe(antes.trabalhos);
  });
});

describe("NOD-300: o dono lido em GET trabalhos vale para a conversa do bot", () => {
  const conversa = (agenteId: string, d: DonoDto) => ({ conversa: { id: `c-${agenteId}`, tipo: "propria", agenteId }, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], trabalhos: [], dono: d }) as never;

  it("a releitura com o dono esperando troca o da conversa do bot e não toca na de outro bot", () => {
    const daZe2 = dono({ agenteId: "ze2", principal: "trabalhando", frentes: 1 });
    const antes = estadoCom([], undefined, { conversas: { "c-ze1": conversa("ze1", dono({ principal: "trabalhando", frentes: 1 })), "c-ze2": conversa("ze2", daZe2) } });
    const esperando = dono({ principal: "esperando", esperando: 1, motivoEspera: "VM-1 · sem contato", desde: AGORA - 12 * MIN });
    const depois = reduzir(antes, { tipo: "hidratar-trabalhos", trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null, donos: [esperando] }, agora: AGORA });
    expect(depois.conversas["c-ze1"]?.dono).toEqual(esperando);
    expect(depois.conversas["c-ze2"]).toBe(antes.conversas["c-ze2"]);
  });

  it("o mesmo dono não cria objeto novo na conversa", () => {
    const igual = dono({ principal: "trabalhando", frentes: 1 });
    const antes = estadoCom([], undefined, { conversas: { "c-ze1": conversa("ze1", igual) } });
    const depois = reduzir(antes, { tipo: "hidratar-trabalhos", trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null, donos: [dono({ principal: "trabalhando", frentes: 1 })] }, agora: AGORA });
    expect(depois.conversas["c-ze1"]).toBe(antes.conversas["c-ze1"]);
  });
});
