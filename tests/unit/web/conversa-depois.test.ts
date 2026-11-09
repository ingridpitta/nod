import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comFimDaAcao, comTexto, comVigia } from "../../../web/lib/atividade.ts";
import { blocosAoVivo, blocosDoHistorico, renderCabecalhoConversa, renderMensagem, renderResumoDasAcoes, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderCardArtefato } from "../../../web/telas/card-artefato.ts";
import { renderTopoComposer } from "../../../web/telas/pergunta.ts";
import { acaoHumana, previaDoItem } from "../../../web/telas/sua-vez.ts";

/** O canvas "Uma conversa de verdade · depois" (2026-10-03), item a item. */

const C = "c1";
const AGORA = Date.parse("2026-10-03T14:45:00Z");
const msg = (id: string, autor: "pessoa" | "agente", criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, ...extra,
} as Mensagem);

const itemAprovacao = (id: string, argumentos: Record<string, unknown> = {}): SuaVezDto["itens"][number]["itensAprovacao"][number] => ({
  tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: "Atualizar metas", textoFinal: "Atualizar metas", destino: { conector: "googlesheets", ferramenta: "update_values", argumentos },
  selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null,
});

const pedido = (id: string, extra: { turnoId?: string | null; criadoEm?: string; tipo?: "aprovacao" | "pergunta"; itens?: ReturnType<typeof itemAprovacao>[] } = {}): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: C, turnoId: extra.turnoId ?? null, tipo: extra.tipo ?? "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-04T14:00:00Z", prazoExecucaoEm: null, frase: "Atualizar a planilha de metas com a receita de setembro", desfecho: null, vistaEm: null, criadoEm: extra.criadoEm ?? "2026-10-03T14:40:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 5 * 60_000, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], itensAprovacao: extra.itens ?? [itemAprovacao(`${id}-i`)], proposta: null, fio: null, rotinaParada: null,
});

const SHEETS = { slug: "googlesheets", nome: "Google Sheets", habilitado: true, ownerId: "p", catalogo: [{ nome: "update_values", descricao: "", schema: {}, readOnlyHint: false, grupo: "alterar" as const }] };

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = [], extra: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...extra,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    conectores: [SHEETS] as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

/** As falas paradas de um turno na conversa (a chave é por fala, revisão 4 do #508). */
const paradas = (e: Estado, turnoId: string) => Object.values(e.falasSaindo?.[C] ?? {}).filter((s) => s.turno.turnoId === turnoId);

describe("1. o balão de quem escreve", () => {
  it("continua .message.you (o azul mora no CSS) e o chip de comando fica dentro do balão", () => {
    const html = renderMensagem(msg("m1", "pessoa", 1, { texto: "/uso agora" }), cenario([]).e);
    expect(html).toContain('class="message you');
    expect(html).toContain('class="chip-comando"');
  });
});

describe("2. a parte ao vivo é a Ada falando", () => {
  it("NOD-348 / Parte 2: com ferramenta, a fala viva da Ada — mascote, nome e o pensamento com 'Usando GitHub', o tempo e a narração como nota", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Lendo o PR https://github.com/acme/loja/pull/481."), "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: "catcher", machineId: null, desde: AGORA - 60_000 } }, atividades: { [C]: { t1: atividade } } };
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["vivo:t1"]);
    const html = blocos[0]!.html;
    // Parte 3: a cor do bot (a classe c-* do perfil; "blue" na frota de teste) vai na raiz, para o brilho ser da cor dele.
    expect(html).toMatch(/^<article class="message bot fala-viva ao-vivo blue" data-turno="t1" data-morfar><nod-mascote [^>]*data-parte="mascote"/);
    expect(html).toContain('state="orbit"');
    expect(html).toContain('<div class="msg-autor" data-parte="nome"><b title="Ada">Ada</b></div>');
    expect(html).toContain('<span class="fala-viva-estado">Usando GitHub</span>');
    expect(html).toContain(`data-desde="${AGORA - 60_000}"`);
    // Sem o nome da IA, sem "digitando", sem cursor, sem a linha antiga e sem o ponto que pulsa.
    for (const fora of ["catcher", "Claude", "digitando", 'class="cursor"', "está trabalhando", "atividade-pulso", "trabalhando ·", "fala-viva-linha"]) expect(html).not.toContain(fora);
    // Parte 2: a narração curta de antes da ferramenta não vai ao balão (a gravada a deixa de fora): vira nota no pensamento.
    expect(html).not.toContain('class="bubble"');
    expect(html).toContain('<li class="pensar-nota">Lendo o PR https://github.com/acme/loja/pull/481.</li>');
    expect(html).toContain('<li class="pensar-acao" data-estado="rodando"><i class="pensar-ic" aria-hidden="true"></i><span>Usando GitHub</span></li>');
    expect(html).toContain('<span class="pensar-contagem">1 ação</span>');
    expect(blocos[0]!.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
    expect(html).not.toContain("ver etapas");
    // Fechado por padrão: o `open` é da pessoa.
    expect(html).not.toContain(" open");
    // O tempo é escrito pelo relógio da tela: o HTML não muda quando o tempo anda.
    expect(blocosAoVivo(c, { ...e, agora: AGORA + 120_000 })[0]!.html).toBe(html);
    // O morph sabe as partes e o que copiar para o mascote; o pensamento muda por dentro (data-no-lugar).
    expect(html).toContain('<details class="pensar" data-parte="pensar" data-no-lugar data-disclosure="pensar-t1" data-fase="fazendo"');
    expect(blocos[0]!.morfar?.mascote).toMatchObject({ state: "orbit", "aria-label": "Ada · usando GitHub" });
    // A narração entre ferramentas corre no cabeçalho (a primeira linha), não num balão.
    const narrando = blocosAoVivo(c, { ...e, atividades: { [C]: { t1: { ...atividade, atual: "Abrindo https://github.com/acme/loja/pull/481 agora" } } } })[0]!;
    expect(narrando.html).toContain('<span class="fala-viva-estado">Abrindo https://github.com/acme/loja/pull/481 agora</span>');
    expect(narrando.html).toContain('state="idle"');
    expect(narrando.html).not.toContain('class="bubble"');
    expect(narrando.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
  });
  it("revisão do #508: o nome do bot com $&, $` e $' não abre atributo no mascote (replace com função)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    for (const nome of ['Ada$&" onmouseover="x', "Ada$`", "Ada$'"]) {
      const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome, cor: "blue", forma: "square", conversaId: C }] } as never, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
      const mascote = /<nod-mascote [^>]*>/.exec(blocosAoVivo(c, e)[0]!.html)![0];
      expect(mascote).not.toMatch(/ onmouseover="/);
      expect(mascote.match(/ aria-label="/g)).toHaveLength(1);
      expect(mascote.match(/ title="/g)).toHaveLength(1);
      // Cada atributo do mascote aparece uma vez só: nada foi aberto pelo nome.
      const nomes = [...mascote.matchAll(/ ([\w-]+)=("[^"]*")/g)].map((m) => m[1]);
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });

  it("revisão do #508: cada data-parte do HTML é uma parte do morph, na mesma ordem (senão o morph cai na recriação)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { t1: { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA - 5 * 60_000 } };
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    for (const a of [undefined, comTexto(ATIVIDADE_VAZIA, "Olá"), mudo]) {
      const e: Estado = { ...base, turnosVivos: vivo, atividades: a ? { [C]: { t1: a } } : {} };
      const b = blocosAoVivo(c, e)[0]!;
      const noWrap = b.html.slice(b.html.indexOf('<div class="bubble-wrap">'));
      const filhas = [...noWrap.matchAll(/<(?:div|details)[^>]* data-parte="(\w+)"/g)].map((m) => m[1]);
      expect(filhas).toEqual(b.morfar!.partes.map((p) => p.chave));
      for (const p of b.morfar!.partes) expect(noWrap).toContain(p.html);
    }
  });

  it("revisão do #508: no silêncio do vigia o mascote para (idle, disponível) e o pensamento diz o silêncio", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 5 * 60_000 } }, atividades: { [C]: { t1: mudo } } };
    const b = blocosAoVivo(c, e)[0]!;
    expect(b.html).toContain('data-fase="silencio"');
    expect(b.html).toContain('<span class="fala-viva-estado">Sem novidade há 4 min</span>');
    // Parte 3: no silêncio o mascote faz `alert` (o "!"), parado no sentido de não girar.
    expect(b.morfar!.mascote).toMatchObject({ state: "alert", "data-estado": "disponivel" });
    expect(/<nod-mascote [^>]*>/.exec(b.html)![0]).toContain('state="alert"');
    expect(b.morfar!.partes.map((p) => p.chave)).toContain("vigia");
    // Com trabalho de verdade, o mesmo turno anima e diz "trabalhando".
    const ativo = blocosAoVivo(c, { ...e, atividades: { [C]: { t1: { ...mudo, vigia: null } } } })[0]!;
    expect(ativo.morfar!.mascote).toMatchObject({ state: "orbit", "data-estado": "trabalhando" });
  });
  it("NOD-348 / Parte 2: sem ferramenta e sem texto, o pensamento diz 'Pensando', fechado, mascote idle e atento", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: "claude", machineId: null, desde: AGORA } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    // Parte 3: pensando é o `thinking` do Bloub, sem expressão.
    expect(html).toContain('state="thinking"');
    expect(html).not.toContain('expression="attentif"');
    expect(html).toContain(`<div class="msg-autor" data-parte="nome"><b title="Ada">Ada</b></div><details class="pensar" data-parte="pensar" data-no-lugar data-disclosure="pensar-t1" data-fase="pensando" data-estado-fala="pensando:Pensando"><summary class="pensar-cab"><span class="fala-viva-estado">Pensando</span><span class="sr-only fala-viva-anuncio">Pensando</span><span class="pensar-meta" aria-hidden="true"><span class="fala-viva-tempo" data-desde="${AGORA}" aria-hidden="true"></span></span>`);
    expect(html).not.toContain("claude");
  });
  it("Parte 2: texto curto corre no cabeçalho do pensamento; passou de 280 caracteres, vira balão sem cursor, numa direção só", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const com = (a: ReturnType<typeof comTexto>): Estado => ({ ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } });
    const curto = blocosAoVivo(c, com(comTexto(ATIVIDADE_VAZIA, "Olhando")))[0]!;
    expect(curto.html).toContain('class="message bot fala-viva ao-vivo blue"');
    expect(curto.html).not.toContain('class="bubble"');
    expect(curto.html).toContain('data-estado-fala="escrevendo"');
    expect(curto.html).toContain('<span class="fala-viva-estado">Olhando</span><span class="sr-only fala-viva-anuncio">Escrevendo</span>');
    expect(curto.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
    const longo = `Olhando ${"o fechamento de setembro, conta por conta. ".repeat(8)}`;
    expect(longo.length).toBeGreaterThan(280);
    const blocos = blocosAoVivo(c, com(comTexto(ATIVIDADE_VAZIA, longo)));
    const html = blocos[0]!.html;
    expect(html).toContain('class="message bot fala-viva ao-vivo com-texto blue"');
    expect(html).toContain('<div class="bubble" data-parte="balao" data-no-lugar>');
    expect(html).not.toContain('class="cursor"');
    expect(blocos[0]!.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "pensar", "balao"]);
    // Promovido, o cabeçalho diz só "Escrevendo" (o texto já está no balão, sem sair duas vezes).
    expect(html).toContain('<span class="fala-viva-estado">Escrevendo</span>');
    expect(html).not.toContain('<span class="fala-viva-estado">Olhando');
  });
  it("NOD-348: abrindo frentes, 'Abrindo frentes' com o mascote fazendo", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comFerramenta(ATIVIDADE_VAZIA, "Abriu frentes", { texto: "Abrindo frentes", frentes: true }) } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toContain('data-fase="fazendo" data-estado-fala="frentes:Abrindo frentes"><summary class="pensar-cab"><span class="fala-viva-estado">Abrindo frentes</span>');
    expect(html).toContain('state="orbit"');
  });
  it("NOD-348: na sala, a fala é do bot do turno (agenteId), não do bot da conversa", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA, agenteId: "g" } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toContain('<b title="Gil">Gil</b>');
    expect(html).toContain('aria-label="Gil · pensando"');
    expect(html).not.toContain(">Ada</b>");
  });

  it("QA do #508: no fim do turno a fala fica, parada, com a mesma chave, até a releitura trazer a fala gravada", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA - 12_000 };
    const comVivo: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Pronto, fechei setembro.") } } };
    const antes = blocosAoVivo(c, comVivo);
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(fim.turnosVivos.t1).toBeUndefined();
    const saindo = blocosAoVivo(fim.conversas[C]!, fim);
    expect(saindo.map((b) => b.chave)).toEqual(antes.map((b) => b.chave));
    const html = saindo[0]!.html;
    // Na classe, para o morph levar à raiz que ficou (vivo → saindo reaproveita o bloco) e o anunciador pular a fala.
    expect(saindo[0]!.morfar!.raiz).toBe("message bot fala-viva ao-vivo com-texto saindo blue");
    expect(html).toContain('<article class="message bot fala-viva ao-vivo com-texto saindo blue" data-turno="t1" data-morfar>');
    // Parte 2: no fim o texto curto é promovido ao balão (a regra do servidor o grava); sem ação, não fica pensamento.
    expect(html).toContain('<div class="bubble" data-parte="balao" data-no-lugar>Pronto, fechei setembro.</div>');
    expect(html).not.toContain('class="pensar"');
    expect(html).not.toContain("data-desde");
    // Parte 3: a fala que entrou faz o mascote piscar (`wink`) por WINK_MS; depois, repouso.
    expect(saindo[0]!.morfar!.mascote).toMatchObject({ state: "wink", "data-estado": "disponivel" });
    expect(blocosAoVivo(fim.conversas[C]!, { ...fim, agora: AGORA + 2_000 })[0]!.morfar!.mascote).toMatchObject({ state: "idle" });
    // A releitura (com a fala gravada) tira a fala que saía; e ela também some sozinha se a releitura não vier.
    const relida = reduzir(fim, { tipo: "hidratar-conversa", conversa: { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2)] } as ConversaDto, agora: AGORA + 500 });
    expect(relida.falasSaindo?.[C]).toBeUndefined();
    expect(blocosAoVivo(fim.conversas[C]!, { ...fim, agora: AGORA + 15_000 })).toEqual([]);
    // Revisão 3: a releitura que saiu ANTES do fim (sem a fala gravada) não a tira; o tick a limpa depois de 15 s.
    const velha = reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA - 200 });
    expect(paradas(velha, "t1")).toHaveLength(1);
    // QA 3: a releitura que sai no mesmo instante do frame só a tira se já traz a fala gravada (QA do #534: é a gravada,
    // não o instante, que decide — o retrato criado pela própria releitura, `semDesmentidos`, tem o instante dela); a de
    // OUTRA conversa não tira as desta.
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA }), "t1")).toHaveLength(1);
    const comGravada = { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2, { turnoId: "t1", texto: "Pronto, fechei setembro." })] } as ConversaDto;
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: comGravada, agora: AGORA }), "t1")).toHaveLength(0);
    const dto = c as unknown as ConversaDto;
    const outra = { ...dto, conversa: { ...dto.conversa, id: "outra-conversa" }, mensagens: [] } as ConversaDto;
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: outra, agora: AGORA + 500 }), "t1")).toHaveLength(1);
    expect(paradas(reduzir(fim, { tipo: "tick", agora: AGORA + 14_000 }), "t1")).toHaveLength(1);
    expect(reduzir(fim, { tipo: "tick", agora: AGORA + 15_000 }).falasSaindo).toEqual({});
  });

  it("NOD-353 / Parte 2: com ferramenta, a fala parada final leva o pensamento pronto ('Usou N ferramentas', ADR-156), na mesma chave de disclosure da viva", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const a = comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Fechei o PR.");
    const comVivo: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 9_000 } }, atividades: { [C]: { t1: a } } };
    const vivo = blocosAoVivo(c, comVivo)[0]!;
    // Ao vivo o texto curto ainda é pensamento: corre no cabeçalho, sem balão.
    expect(vivo.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
    expect(vivo.html).toContain('<span class="fala-viva-estado">Fechei o PR.</span>');
    expect(vivo.html.slice(vivo.html.indexOf("</summary>"), vivo.html.indexOf("</details>"))).not.toContain("Fechei o PR");
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const parada = blocosAoVivo(fim.conversas[C]!, fim)[0]!;
    expect(parada.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar", "balao"]);
    const pensar = parada.morfar!.partes.find((p) => p.chave === "pensar")!.html;
    expect(pensar).toContain('data-disclosure="pensar-t1" data-fase="pronto"');
    expect(pensar).toContain('<span class="fala-viva-estado">Usou 1 ferramenta</span>');
    expect(pensar).not.toContain("pensar-meta");
    expect(parada.html).toContain('<div class="bubble" data-parte="balao" data-no-lugar>Fechei o PR.</div>');
  });
  it("revisão 3 do #508: turno.fala no meio do turno deixa a fala parada antes da fala viva do mesmo turno", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const a = comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Primeira parte.");
    const comVivo: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } };
    const meio = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const blocos = blocosAoVivo(meio.conversas[C]!, meio);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, "vivo:t1"]);
    expect(blocos[0]!.html).toContain("Primeira parte.");
    expect(blocos[1]!.html).not.toContain("Primeira parte.");
    // NOD-353: a fala do meio que saiu não tem o pensamento (a gravada dela também não); a viva do turno segue com ele.
    expect(blocos[0]!.html).not.toContain('class="pensar"');
    expect(blocos[1]!.morfar!.partes.map((p) => p.chave)).toContain("pensar");
  });

  it("QA do #508: sem atividade nada fica saindo; o interrompido fica (QA do #534); o turno de outro bot não a tira", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const frame = (tipo: string, dados: Record<string, unknown>, e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo, dados } as never, agora: AGORA });
    const semTexto = frame("turno.encerrado", { turnoId: "t1", conversaId: C }, { ...base, turnosVivos: { t1: vivo } });
    expect(semTexto.falasSaindo?.[C]).toBeUndefined();
    const comVivo: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Olá") } } };
    // QA do #534 (27/10): o Parar também deixa a fala parada até a gravada (parcial) chegar — antes a viva sumia num quadro.
    expect(paradas(frame("turno.interrompido", { turnoId: "t1", conversaId: C }, comVivo), "t1")).toHaveLength(1);
    const fim = frame("turno.encerrado", { turnoId: "t1", conversaId: C }, comVivo);
    expect(paradas(fim, "t1")).toHaveLength(1);
    // Revisão 3: na sala, o turno de outro bot (que começa ou é interrompido) não tira a fala parada deste.
    expect(paradas(frame("turno.iniciado", { turnoId: "t2", conversaId: C }, fim), "t1")).toHaveLength(1);
    expect(paradas(frame("turno.interrompido", { turnoId: "t2", conversaId: C }, fim), "t1")).toHaveLength(1);
  });

  it("QA 2 do #508: só fica parada a fala do turno rodando, da conversa aberta, fora de task e com texto", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const fim = (e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const com = (t: Record<string, unknown>, a = comTexto(ATIVIDADE_VAZIA, "Olá"), extra: Partial<Estado> = {}): Estado => ({ ...base, turnosVivos: { t1: { ...vivo, ...t } as never }, atividades: { [C]: { t1: a } }, ...extra });
    expect(paradas(fim(com({})), "t1")).toHaveLength(1);
    expect(fim(com({ estado: "na_fila" })).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({ trabalhoId: "w1" })).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({}, comTexto(ATIVIDADE_VAZIA, "  \n "))).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({}, undefined, { conversas: {} })).falasSaindo?.[C]).toBeUndefined();
  });

  it("QA 2 do #508: na sala, a fala parada é do bot do turno, não do bot da conversa", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const frota = { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never;
    const comVivo: Estado = { ...base, frota, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA, agenteId: "g" } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Feito.") } } };
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const html = blocosAoVivo(fim.conversas[C]!, fim)[0]!.html;
    expect(html).toContain('<b title="Gil">Gil</b>');
    expect(html).not.toContain(">Ada</b>");
  });

  it("Parte 2: a narração curta vira nota quando a ferramenta chega; o balão só nasce com o texto definitivo, e nunca perde conteúdo", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const comA = (a: ReturnType<typeof comTexto>): Estado => ({ ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: a } } });
    const primeira = comTexto(ATIVIDADE_VAZIA, "Vou olhar o PR.");
    const usando = comFerramenta(primeira, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const chaves = (e: Estado) => blocosAoVivo(c, e)[0]!.morfar!.partes.map((p) => p.chave);
    const html = (e: Estado) => blocosAoVivo(c, e)[0]!.html;
    expect(chaves(comA(primeira))).toEqual(["nome", "pensar"]);
    expect(html(comA(primeira))).toContain('<span class="fala-viva-estado">Vou olhar o PR.</span>');
    expect(chaves(comA(usando))).toEqual(["nome", "pensar"]);
    expect(html(comA(usando))).toContain('<span class="fala-viva-estado">Usando GitHub</span>');
    expect(html(comA(usando))).toContain('<li class="pensar-nota">Vou olhar o PR.</li>');
    const segunda = comTexto(usando, "Está aprovado.");
    expect(html(comA(comTexto(usando, "Es")))).toContain('<span class="fala-viva-estado">Es</span>');
    expect(html(comA(segunda))).not.toContain('class="bubble"');
    const outra = comFerramenta(segunda, "Consultou Linear", { texto: "Usando Linear", frentes: false });
    // As duas narrações ficam como notas, na ordem, cada uma antes da ação que veio depois dela.
    const todo = html(comA(outra));
    const lista = todo.slice(todo.indexOf('class="pensar-lista"'));
    expect(lista.indexOf("Vou olhar o PR.")).toBeLessThan(lista.indexOf("Consultou GitHub"));
    expect(lista.indexOf("Consultou GitHub")).toBeLessThan(lista.indexOf("Está aprovado."));
    expect(lista.indexOf("Está aprovado.")).toBeLessThan(lista.indexOf("Usando Linear"));
    // No fim, a parada segue a fala gravada (`comporFala`): o texto final entra no balão; a narração curta fica de fora.
    const fim = reduzir(comA(segunda), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const balao = (e: Estado) => blocosAoVivo(e.conversas[C]!, e)[0]!.morfar!.partes.find((p) => p.chave.startsWith("balao"))!.html;
    expect(balao(fim)).toContain("Está aprovado.");
    expect(balao(fim)).not.toContain("Vou olhar o PR.");
    const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
    const longa = comTexto(comFerramenta(comTexto(ATIVIDADE_VAZIA, relatorio), "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Está aprovado.");
    // O relatório longo já está no balão ao vivo (é definitivo); o fim só acrescenta o parágrafo final.
    const baloesDe = (b: ReturnType<typeof blocosAoVivo>[number]) => b.morfar!.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.html);
    expect(baloesDe(blocosAoVivo(c, comA(longa))[0]!)).toHaveLength(1);
    const fimLonga = reduzir(comA(longa), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const baloes = baloesDe(blocosAoVivo(fimLonga.conversas[C]!, fimLonga)[0]!);
    expect(baloes).toHaveLength(2);
    expect(baloes[0]).toContain("setembro fechou acima da meta.");
    expect(baloes[1]).toContain("Está aprovado.");
    // O turno.fala no meio leva o texto e a fala viva recomeça sem ele.
    const meio = reduzir(comA(segunda), { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(meio.atividades[C]!.t1).toMatchObject({ atual: "", antes: [] });
  });
  it("revisão 4 do #508: dois turno.fala antes da releitura ficam os dois, na ordem; o interrompido não os tira", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const frame = (tipo: string, e: Estado, agora: number) => reduzir(e, { tipo: "frame", frame: { tipo, dados: { turnoId: "t1", conversaId: C } } as never, agora });
    const com = (e: Estado, texto: string): Estado => ({ ...e, atividades: { [C]: { t1: comTexto(e.atividades[C]?.t1, texto) } } });
    let e: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: ATIVIDADE_VAZIA } } };
    e = frame("turno.fala", com(e, "Primeira."), AGORA);
    e = frame("turno.fala", com(e, "Segunda."), AGORA + 100);
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, `saindo:t1:${AGORA + 100}:1`, "vivo:t1"]);
    expect(blocos[0]!.html).toContain("Primeira.");
    expect(blocos[1]!.html).toContain("Segunda.");
    const parado = frame("turno.interrompido", e, AGORA + 200);
    expect(paradas(parado, "t1")).toHaveLength(2);
    // Sem fala viva, a última fala parada do turno fica com a chave da fala viva.
    expect(blocosAoVivo(c, parado).map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, "vivo:t1"]);
  });

  it("revisão 4 do #508: a fala parada do turno que acabou vem antes das vivas (sala, turno novo)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = (turnoId: string) => ({ turnoId, conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA });
    const e: Estado = { ...base, turnosVivos: { t1: vivo("t1"), t2: vivo("t2") }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Feito."), t2: ATIVIDADE_VAZIA } } };
    expect(blocosAoVivo(c, e).map((b) => b.chave)).toEqual(["vivo:t1", "vivo:t2"]);
    const fim = reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(blocosAoVivo(fim.conversas[C]!, fim).map((b) => b.chave)).toEqual(["vivo:t1", "vivo:t2"]);
    expect(blocosAoVivo(fim.conversas[C]!, fim)[0]!.html).toContain('<div class="bubble" data-parte="balao" data-no-lugar>Feito.</div>');
  });

  it("NOD-348: na fila, a linha de sistema sem o nome da IA", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "na_fila", executor: "claude", machineId: null, desde: AGORA - 120_000 } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toMatch(/^<div class="msg-sistema">na fila · /);
    expect(html).not.toContain("claude");
    expect(html).not.toContain("fala-viva");
  });

  it("10. o streaming já sai formatado: negrito, lista e tabela enquanto o texto chega", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, `${"Fechei setembro, conta por conta, com os ajustes combinados. ".repeat(6)}\n\n` + "Fechei **setembro**:\n- Sul\n- Norte\n\n| Região | R$ |\n|---|---|\n| Sul | 98 |") } } };
    // Parte 2: o streaming formatado vale a partir da promoção (texto definitivo, > 280 caracteres).
    const corpo = blocosAoVivo(c, e).find((b) => b.chave === "vivo:t1")!.html;
    expect(corpo).toContain("<strong>setembro</strong>");
    expect(corpo).toContain('<ul class="md-lista"><li>Sul</li><li>Norte</li></ul>');
    expect(corpo).toContain('<div class="md-tabela">');
  });
});

describe("3. o pedido fica junto do turno que o pediu", () => {
  it("logo depois da última fala do turno; as mensagens seguintes vêm depois dele, e a seção do fim some", () => {
    const mensagens = [msg("m1", "pessoa", 1), msg("m2", "agente", 2, { turnoId: "t1" }), msg("m3", "pessoa", 3), msg("m4", "agente", 4, { turnoId: "t2" })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "t1" })]);
    const chaves = blocosDoHistorico(c, e).map((b) => b.chave);
    expect(chaves).toEqual(["sep:m1", "m1", "m2", "decisao:d1", "m3", "m4"]);
    expect(renderTimeline(c, e)).not.toContain("Preciso da sua decisão para continuar");
  });

  it("sem turno, fica depois da última mensagem anterior ao pedido; sem mensagem nenhuma, na seção do fim", () => {
    const mensagens = [msg("m1", "pessoa", Date.parse("2026-10-03T14:30:00Z")), msg("m2", "agente", Date.parse("2026-10-03T14:50:00Z"))];
    const { e, c } = cenario(mensagens, [pedido("d1")]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
    const vazio = cenario([], [pedido("d1")]);
    expect(renderTimeline(vazio.c, vazio.e)).toContain("Preciso da sua decisão para continuar");
  });

  // definido em 2026-10-07 (#191, chat limpo): o pedido de uma execução de rotina que virou linha fica logo depois da
  // linha (a chave do bloco é `linha:<primeira mensagem>`), e não volta para depois da fala anterior.
  it("o pedido de uma rotina recolhida numa linha fica depois da linha", () => {
    const rotina = (id: string, criadoEm: number) => msg(id, "agente", criadoEm, { turnoId: "tr1", origemTurno: "rotina", trabalhoId: "tb-r1", fimDoTurno: true });
    const mensagens = [msg("m1", "pessoa", 1, { origemTurno: null, trabalhoId: null, fimDoTurno: false }), rotina("r1", 2), msg("m3", "pessoa", 3, { origemTurno: null, trabalhoId: null, fimDoTurno: false })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "tr1" })]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "linha:r1", "decisao:d1", "m3"]);
  });

  it("com o turno ainda rodando, fica embaixo da mensagem que o disparou", () => {
    const { e, c } = cenario([msg("m1", "pessoa", 1), msg("m2", "pessoa", 2)], [pedido("d1", { turnoId: "t9" })], { turnosEmCurso: [{ id: "t9", estado: "despachando", desde: 1, mensagemId: "m1" }] as never });
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
  });
});

describe("4–6. o card da aprovação de um item", () => {
  it("quem pede, ONDE como chip, a prévia em tabela, Pode fazer e o prazo no rodapé; sem a tag de lista", () => {
    const valores = [["Sudeste", "R$ 210 mil"], ["Sul", "R$ 98 mil"], ["Total", "R$ 482 mil"]];
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [itemAprovacao("i1", { spreadsheetId: "abc", range: "Setembro!A1", values: valores })] })]);
    const html = renderTimeline(c, e);
    expect(html).toContain("<b>Ada precisa do seu ok</b>");
    expect(html).toContain("· há 5 min");
    expect(html).toContain('<span class="lk-chip aprov-app">');
    expect(html).toContain("<span>Google Sheets</span>");
    expect(html).toContain("O que vai ser enviado");
    expect(html).toContain("<td>R$ 482 mil</td>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).toContain('data-act="decidir-aprovacao"');
    expect(html).not.toContain("aprovação em lista");
    // 6: o botão diz a ação em português; o slug continua no "Ver detalhes".
    expect(html).toContain(">Sempre permitir editar no Google Sheets<");
    expect(html).toContain("<dd>googlesheets.update_values</dd>");
    // main.ts lê o texto final e o data-decisao.
    expect(html).toContain('data-item-texto="i1"');
    expect(html).toContain('data-decisao="d1"');
  });

  it("NOD-443 (revisão 7 do PR #628, achado 4): o cartão do turno a pedido de quem participa do quadro diz de quem é o pedido", () => {
    const comPedido = { ...pedido("d1", { turnoId: "t1" }), aPedidoDe: "Ana <b>" };
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [comPedido]);
    const html = renderTimeline(c, e);
    expect(html).toContain("<b>Ada precisa do seu ok</b><span class=\"aprov-pedido-de\">· a pedido de Ana &lt;b&gt;</span>");
    // O pedido da própria dona não ganha a linha.
    const daDona = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1" })]);
    expect(renderTimeline(daDona.c, daDona.e)).not.toContain("a pedido de");
  });

  it("5. vencido com um item só diz 'aprovação', nunca 'aprovação em lista'", () => {
    const vencido = { ...pedido("d1"), estadoColuna: "vencido" as const, decisao: { ...pedido("d1").decisao, estado: "vencida" as const } };
    const { e, c } = cenario([], [vencido]);
    const html = renderTimeline(c, e);
    expect(html).toContain(">aprovação<");
    expect(html).not.toContain("aprovação em lista");
  });

  it("a prévia: campos de texto viram linhas rotuladas; objetos ficam só no 'Ver detalhes'", () => {
    const html = previaDoItem({ destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas", text: "Fechamos <setembro>", blocks: [{ a: 1 }] } } });
    expect(html).toContain("<dt>channel</dt><dd>#vendas</dd>");
    expect(html).toContain("Fechamos &lt;setembro&gt;");
    expect(html).not.toContain("blocks");
    expect(previaDoItem({ destino: { conector: "x", ferramenta: "y", argumentos: {} } })).toBe("");
  });

  it("a ação em português vem do grupo do catálogo; sem catálogo, o nome da ferramenta sem sublinhados", () => {
    expect(acaoHumana([SHEETS] as never, "googlesheets", "update_values")).toBe("editar no Google Sheets");
    expect(acaoHumana([], "slack", "send_message")).toBe("send message no slack");
  });
});

describe("revisão de 2026-10-03: o card da lista, o artefato e os recibos", () => {
  it("aprovação com vários itens usa o mesmo card: quem pede, o app uma vez só, linhas marcáveis e o prazo", () => {
    const slack = (id: string, texto: string) => ({ ...itemAprovacao(id), textoFinal: texto, destino: { conector: "slack", ferramenta: "send_message", argumentos: {} } });
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [slack("i1", "Avisar o comercial"), slack("i2", "Parabenizar o Sudeste")] })]);
    const html = renderTimeline(c, e);
    expect(html).toContain("aprov-card");
    expect(html).toContain("<b>Ada precisa do seu ok</b>");
    expect(html).toContain('class="aprov-itens"');
    expect(html.match(/data-item="i[12]"/g)).toHaveLength(2);
    expect(html).not.toContain("no slack</small>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).not.toContain("aprovação em lista");
  });

  it("o artefato vem com o mascote, o nome e a hora do bot", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("m1", "agente", 1, { kind: "artefato", payload: { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" } as never }), e);
    expect(html).toContain('class="message bot com-artefato"');
    expect(html).toContain('<b title="Ada">Ada</b>');
    expect(html).toContain('data-artefato="art"');
  });

  it("resultado da aprovação vira o cartão encolhido (chat limpo, PR 4): o pedido e o resultado; o detalhe por item fica recolhido", () => {
    const { e } = cenario([]);
    const resultado = (itens: { idx: number; desfecho: string; texto?: string }[], frase = "Atualizar a planilha de metas") => renderMensagem(msg("r", "pessoa", Date.parse("2026-10-03T14:44:00Z"), { kind: "resultado_aprovacao", texto: "Marlon aprovou 0 de 1; não enviado: … (falhou na execução).", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase, itens } as never }), e);
    const falhou = resultado([{ idx: 0, desfecho: "falhou_na_execucao", texto: "Atualizar metas" }]);
    expect(falhou).toContain('class="cp-linha cp-falha cartao-encolhido cp-com-extra"');
    expect(falhou).toContain('tabindex="-1">Atualizar a planilha de metas</span>');
    expect(falhou).toContain('<span class="ce-resultado">Aprovado · não saiu</span><span class="sr-only"> (não saiu)</span>');
    expect(falhou).toContain("<summary>detalhes</summary>");
    expect(falhou).toContain("falhou ao executar");
    const feito = resultado([{ idx: 0, desfecho: "executado", texto: "Atualizar metas" }]);
    expect(feito).toMatch(/class="cp-linha cp-ok cartao-encolhido"[^>]*><svg class="cp-ic"[^]*?<span class="ce-resultado">Aprovado por você · feito \d\d:\d\d<\/span>/);
    expect(feito).not.toContain("<details");
    const varios = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(varios).toContain(">Aprovado por você · 2 de 3 feitas<");
    expect(varios).toContain("você tirou");
    const parcial = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "falhou_na_execucao", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(parcial).toContain(">Aprovado · 1 de 3 não saiu<");
    const recusado = resultado([{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }], "Posso mandar estes 2 avisos?");
    expect(recusado).toContain('tabindex="-1">Posso mandar estes 2 avisos?</span>');
    expect(recusado).toContain('class="cp-linha cp-recusado cartao-encolhido"');
    expect(recusado).toContain('<span class="ce-resultado">Recusado por você</span>');
    expect(recusado).not.toContain("<details");
  });

  it("'permitiu para sempre' antigo (sem payload) continua a linha 'Regra nova · sempre permitir editar no Google Sheets'", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já, para qualquer destino destas ferramentas, enquanto o bot não tiver lido conteúdo de fora na tarefa." }), e);
    expect(html).toContain("<b>Regra nova</b> · sempre permitir editar no Google Sheets");
    expect(html).toContain('class="recibo recibo-regra"');
    expect(html).not.toContain("cartao-encolhido");
  });

  it("a regra nova com payload (regra_permanente) encolhe: 'Sempre permitir editar no Google Sheets' · Regra nova, com o registro", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já…", payload: { kind: "regra_permanente", decisaoId: "d1", turnoId: "t1", acoes: ["googlesheets.update_values"] } }), e);
    expect(html).toContain('data-cartao-encolhido="d1"');
    expect(html).toContain('tabindex="-1">Sempre permitir editar no Google Sheets</span>');
    expect(html).toContain('class="cp-linha cp-regra cartao-encolhido cp-com-extra"');
    expect(html).toContain('<span class="ce-resultado">Regra nova</span>');
    expect(html).toContain("<summary>Ver registro de autorização</summary>");
    expect(html).toContain('data-anuncio="Regra nova: sempre permitir editar no Google Sheets"');
  });
});

describe("7. a linha da memória", () => {
  it("'Anotei uma preferência' com 'Ver na memória'; a linha antiga, sem acento, é lida na frase nova", () => {
    const { e } = cenario([]);
    const nova = renderMensagem(msg("m1", "agente", 1, { kind: "sistema", texto: "Anotei uma preferência: relatórios em reais" }), e);
    expect(nova).toContain("Anotei uma preferência: relatórios em reais");
    expect(nova).toContain('data-act="ir-memoria" data-id="a"');
    const antiga = renderMensagem(msg("m2", "agente", 1, { kind: "sistema", texto: "Anotei como preferencia: sem centavos" }), e);
    expect(antiga).toContain("Anotei uma preferência: sem centavos");
    expect(antiga).not.toContain("como preferencia");
  });
});

describe("8. o cabeçalho com uma regra só", () => {
  it("turno vivo e pedidos juntos: 'Trabalhando · 2 esperam você'; sem turno, 'Aguardando você'", () => {
    const { e } = cenario([], [pedido("d1"), pedido("d2")]);
    const vivo: Estado = { ...e, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
    expect(renderCabecalhoConversa(vivo, "a")).toContain("Trabalhando <span class=\"presenca-sep\" aria-hidden=\"true\">·</span> <b>2 esperam você</b>");
    expect(renderCabecalhoConversa(e, "a")).toContain(">Aguardando você<");
  });
});

describe("9. 'N coisas esperam você' acima do campo", () => {
  it("só os outros pedidos, cada um com a sua ação; a pergunta mora no cartão (plano \"pergunta com botões\", 2026-10-18)", () => {
    const pergunta = { ...pedido("q1", { tipo: "pergunta", criadoEm: "2026-10-03T14:30:00Z", itens: [] }), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const, frase: "Posso mandar o painel?", criadoEm: "2026-10-03T14:30:00Z" } };
    const { e } = cenario([], [pergunta, pedido("d1")]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toContain('<span class="espera-n">1</span>coisa espera você');
    expect(html).not.toContain("Posso mandar o painel?");
    expect(html).toContain('data-act="ver-decisao" data-id="d1"');
    expect(html).toContain("Google Sheets · recusa automática em 23h");
    // O seletor "Responder à pergunta | Outro assunto" e a faixa saíram.
    expect(html).not.toContain("Responder à pergunta");
    expect(html).not.toContain("está esperando sua resposta");
  });

  it("gate_rotina tem o mesmo nome da lista de rotinas: 'Ver aprovação' (re-revisão do #342, ajuste B)", () => {
    const pergunta = { ...pedido("q1"), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const } };
    const gate = { ...pedido("g1"), decisao: { ...pedido("g1").decisao, tipo: "gate_rotina" as const } };
    const { e } = cenario([], [pergunta, gate]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toMatch(/data-act="ver-decisao" data-id="g1"[^>]*>Ver aprovação</);
    expect(html).not.toContain(">Ver pedido<");
  });

  it("só pergunta, sem outro pedido: nada acima do campo", () => {
    const pergunta = { ...pedido("q1"), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const } };
    const { e } = cenario([], [pergunta]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toBe("");
  });
});

describe("12. artefato: abrir em nova aba", () => {
  it("o botão vem antes de 'Tela cheia' e 'Baixar .html'", () => {
    const m = msg("m1", "agente", 1, { kind: "artefato" });
    const html = renderCardArtefato(m, { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" }, 1);
    const ordem = ["artefato-nova-aba", "artefato-tela-cheia", "artefato-baixar"].map((a) => html.indexOf(`data-act="${a}"`));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain("Abrir em nova aba");
  });
});

describe("NOD-353: o resumo das ações na fala (viva, parada e gravada)", () => {
  const T = "22222222-2222-4222-8222-222222222222";
  const usa = (a: ReturnType<typeof comTexto> | undefined, rotulo: string, emUso: string, id: string) => comFerramenta(a, rotulo, { texto: emUso, frentes: false }, id);
  const vivoCom = (base: Estado, a: ReturnType<typeof comTexto>): Estado => ({ ...base, turnosVivos: { [T]: { turnoId: T, conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { [T]: a } } });
  const resumoDe = (html: string) => /<details class="pensar"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  it("revisão 2 do #523: a linha juntada mostra quantas vezes rodou, e a frase vai para o plural", () => {
    const gravada = { ...msg("mv", "agente", 9), turnoId: T, payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo", vezes: 5 }, { rotulo: "Rodou um comando" }] } } as Mensagem;
    const html = resumoDe(renderMensagem(gravada, cenario([]).e));
    // Parte 2: sem `duracaoMs` (servidor de antes), a linha diz só a contagem; as vezes contam nas ações.
    expect(html).toContain('<span class="fala-viva-estado">Usou 6 ferramentas</span>');
    expect(html).not.toContain(' title="Pensou por');
    expect(html).toContain('<li class="pensar-acao" data-estado="feita"><i class="pensar-ic" aria-hidden="true"></i><span>Leu um arquivo</span><span class="pensar-vezes">×5</span></li>');
    expect(html).toContain('<li class="pensar-acao" data-estado="feita"><i class="pensar-ic" aria-hidden="true"></i><span>Rodou um comando</span></li>');
    // Com a duração gravada, o texto continua "Usou N ferramentas" e a duração vai para o title e o aria-label (ADR-156).
    const comTempo = { ...gravada, payload: { ...gravada.payload, duracaoMs: 9_400 } } as Mensagem;
    expect(resumoDe(renderMensagem(comTempo, cenario([]).e))).toContain('<summary class="pensar-cab pensar-ferr" aria-label="Ver as 6 ferramentas usadas, pensou por 9 s" title="Pensou por 9 s">');
    // Fora da forma, a contagem cai (a linha fica).
    const ruim = { ...gravada, payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo", vezes: "<b>" }] } } as unknown as Mensagem;
    expect(resumoDe(renderMensagem(ruim, cenario([]).e))).not.toContain("pensar-vezes");
  });
  it("revisão do #523: payload de ações fora da forma não quebra a fala gravada", () => {
    const ruim = { ...msg("mr", "agente", 9), turnoId: T, payload: { kind: "acoes_do_turno", acoes: "x" } } as unknown as Mensagem;
    expect(() => renderMensagem(ruim, cenario([]).e)).not.toThrow();
    expect(renderMensagem(ruim, cenario([]).e)).not.toContain('class="pensar"');
  });
  it("Parte 2: o pensamento é um <details> fechado por padrão, com o trilho e a faixa definidos no CSS", () => {
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    expect(css).toContain(".pensar > summary {");
    expect(css).toContain(".pensar-meta > span:not(:empty) ~ span:not(:empty)::before { content: \"·\";");
    expect(css).toContain(".pensar-corpo { display: grid; grid-template-rows: 0fr;");
  });

  it("Parte 2: o pensamento existe desde a primeira ação; aberto, a que roda no presente e a que falhou com Falhou; a faixa conta", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    let a = usa(undefined, "Pesquisou na web", "Pesquisando na web", "w1");
    expect(resumoDe(blocosAoVivo(c, vivoCom(base, a))[0]!.html)).toContain('<li class="pensar-acao" data-estado="rodando"><i class="pensar-ic" aria-hidden="true"></i><span>Pesquisando na web</span></li>');
    a = comFimDaAcao(a, "w1", false)!;
    a = usa(a, "Abriu uma página", "Abrindo uma página", "w2");
    a = comFimDaAcao(a, "w2", true)!;
    a = usa(a, "Consultou Gmail", "Usando Gmail", "g1");
    const html = resumoDe(blocosAoVivo(c, vivoCom(base, a))[0]!.html);
    expect(html).toMatch(new RegExp(`^<details class="pensar" data-parte="pensar" data-no-lugar data-disclosure="pensar-${T}" data-fase="fazendo" data-estado-fala="ferramenta:Usando Gmail"><summary class="pensar-cab"><span class="fala-viva-estado">Usando Gmail</span>`));
    expect(html).not.toContain(" open");
    expect(html).toContain('<span class="pensar-contagem">3 ações</span><span class="pensar-falhas">1 falhou</span>');
    expect(html).toContain('<li class="pensar-acao" data-estado="feita"><i class="pensar-ic" aria-hidden="true"></i><span>Pesquisou na web</span></li>');
    expect(html).toContain('<li class="pensar-acao" data-estado="falhou"><i class="pensar-ic" aria-hidden="true"></i><span>Abriu uma página</span><span class="pensar-falhou">Falhou</span></li>');
    expect(html).toContain('<li class="pensar-acao" data-estado="rodando"><i class="pensar-ic" aria-hidden="true"></i><span>Usando Gmail</span></li>');
    // Fora de região live: a troca do presente pelo passado não é anunciada.
    expect(html).not.toMatch(/aria-live|role="status"/);
    // Termina: a linha troca pelo passado.
    const depois = resumoDe(blocosAoVivo(c, vivoCom(base, comFimDaAcao(a, "g1", false)!))[0]!.html);
    expect(depois).toContain('<li class="pensar-acao" data-estado="feita"><i class="pensar-ic" aria-hidden="true"></i><span>Consultou Gmail</span></li>');
  });
  it("a gravada (payload acoes_do_turno, com duracaoMs) tem o mesmo pensamento da parada final, na mesma chave de disclosure", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    let a = usa(undefined, "Leu um arquivo", "Lendo um arquivo", "r1");
    a = comFimDaAcao(a, "r1", false)!;
    a = usa(a, "Rodou um comando", "Rodando um comando", "b1");
    a = comFimDaAcao(a, "b1", true)!;
    a = comTexto(a, "Pronto.");
    const fim = reduzir(vivoCom(base, a), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    const parada = resumoDe(blocosAoVivo(fim.conversas[C]!, fim)[0]!.html);
    expect(parada).toContain('<span class="fala-viva-estado">Usou 2 ferramentas · 1 falhou</span>');
    const gravada = renderMensagem(msg("m2", "agente", 2, { turnoId: T, texto: "Pronto.", payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo" }, { rotulo: "Rodou um comando", falhou: true }], duracaoMs: 0 } } as Partial<Mensagem>), fim);
    // A parada é uma parte do morph (data-parte, data-no-lugar); o resto é igual, letra a letra.
    expect(resumoDe(gravada)).toBe(parada.replace(' data-parte="pensar" data-no-lugar', ""));
    // Entre o nome e o balão.
    expect(gravada.indexOf('class="pensar"')).toBeLessThan(gravada.indexOf('class="bubble"'));
    expect(gravada.indexOf("msg-autor")).toBeLessThan(gravada.indexOf('class="pensar"'));
    // Sem payload, ou fala da pessoa: nada.
    expect(renderMensagem(msg("m3", "agente", 3), fim)).not.toContain('class="pensar"');
  });
  it("revisão do PR (27/10): a mesma ferramenta com desfechos diferentes é um grupo só na gravada, como na parada (×N · N falharam)", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    let a = usa(undefined, "Leu um arquivo", "Lendo um arquivo", "r1");
    a = comFimDaAcao(a, "r1", false)!;
    a = usa(a, "Leu um arquivo", "Lendo um arquivo", "r2");
    a = comFimDaAcao(a, "r2", true)!;
    a = usa(a, "Leu um arquivo", "Lendo um arquivo", "r3");
    a = comFimDaAcao(a, "r3", false)!;
    a = comTexto(a, "Pronto.");
    const fim = reduzir(vivoCom(base, a), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: T, conversaId: C } } as never, agora: AGORA });
    const parada = resumoDe(blocosAoVivo(fim.conversas[C]!, fim)[0]!.html);
    expect(parada).toContain('<span>Leu um arquivo</span><span class="pensar-vezes">×3</span><span class="pensar-falhou">Falhou</span>');
    // O servidor separa por desfecho (acoesDoTurno): "Leu" · "Leu falhou" · "Leu".
    const gravada = renderMensagem(msg("m2", "agente", 2, { turnoId: T, texto: "Pronto.", payload: { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo" }, { rotulo: "Leu um arquivo", falhou: true }, { rotulo: "Leu um arquivo" }], duracaoMs: 0 } } as Partial<Mensagem>), fim);
    expect(resumoDe(gravada)).toBe(parada.replace(' data-parte="pensar" data-no-lugar', ""));
  });

  it("escapa rótulo e id; nada terminado, nada desenhado", () => {
    expect(renderResumoDasAcoes("t", [{ rotulo: "Rodou um comando", estado: "rodando", emUso: "Rodando" }])).toBe("");
    const html = renderResumoDasAcoes('x"><b>', [{ rotulo: "Consultou <img src=x>", estado: "feita", emUso: null }]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('x"><b>');
    expect(html).toContain("&lt;img");
  });
});

describe("NOD-353 (QA do #523): a frase do resumo não sai cortada e o balão fica do tamanho do texto", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  it("o recuo do summary não é margem negativa (que tirava 6px da largura pedida e cortava a frase com reticências)", () => {
    const summary = /\.pensar > summary \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(summary).not.toMatch(/margin-left:\s*-/);
    expect(summary).toMatch(/position: relative; left: -6px/);
  });
  it("com o resumo mais largo que a resposta, o balão não estica (a resposta fica igual à de hoje)", () => {
    expect(css).toContain(".bubble-wrap:has(> .pensar) > .bubble { width: fit-content; max-width: 100%; box-sizing: border-box; }");
  });
});
