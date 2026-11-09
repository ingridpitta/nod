import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto, type AtividadeTurno } from "../../../web/lib/atividade.ts";
import { planoDoMorph } from "../../../web/lib/morph.ts";
import { blocosAoVivo, renderMensagem } from "../../../web/telas/conversa.ts";

/** NOD-358 (emenda da ADR-114): a resposta do bot em vários balões, um por parágrafo, sem dividir listas. */

const C = "c1";
const AGORA = Date.parse("2026-10-26T03:00:00Z");
const msg = (id: string, autor: "pessoa" | "agente", texto: string, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000, ...extra,
} as Mensagem);

function cenario(mensagens: Mensagem[]): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never };
}

const conta = (html: string, trecho: string | RegExp): number => html.split(trecho).length - 1;
const RESPOSTA = "Fechei a revisão.\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso\n\nTe aviso quando sair.";
/** Parte 2 do plano "o pensamento no chat": ao vivo, o balão só entra com texto definitivo (> 280 caracteres); a gravada divide igual. */
const RESPOSTA_LONGA = `Fechei a revisão ${"de todos os pontos levantados na reunião de ontem com o time. ".repeat(5)}\n\nFaltam quatro coisas para sexta:\n\n- deploy\n- teste\n- doc\n- aviso\n\nTe aviso quando sair.`;

describe("a fala gravada", () => {
  it("um balão por parágrafo; mascote, nome e hora uma vez; a lista com a frase que a apresenta", () => {
    const html = renderMensagem(msg("m1", "agente", RESPOSTA), cenario([]));
    expect(conta(html, 'class="bubble"')).toBe(3);
    expect([...html.matchAll(/data-balao="(\d)"/g)].map((m) => m[1])).toEqual(["0", "1", "2"]);
    expect(conta(html, "<nod-mascote")).toBe(1);
    expect(conta(html, 'class="msg-autor"')).toBe(1);
    expect(conta(html, "<time>")).toBe(1);
    expect(conta(html, "data-mensagem=")).toBe(1);
    const segundo = html.slice(html.indexOf('data-balao="1"'), html.indexOf('data-balao="2"'));
    expect(segundo).toContain("Faltam quatro coisas para sexta:");
    expect(segundo).toContain('<ul class="md-lista">');
  });

  it("um parágrafo só: o balão de antes, sem data-balao", () => {
    const html = renderMensagem(msg("m1", "agente", "Pronto, está no ar."), cenario([]));
    expect(html).toContain('<div class="bubble">Pronto, está no ar.</div>');
    expect(html).not.toContain("data-balao");
  });

  it("as tags da fala vão no último balão", () => {
    const html = renderMensagem(msg("m1", "agente", "Um.\n\nDois.", { parcial: true }), cenario([]));
    expect(conta(html, 'class="meta-tags"')).toBe(1);
    expect(html.indexOf('class="meta-tags"')).toBeGreaterThan(html.indexOf('data-balao="1"'));
  });

  it("a fala da pessoa não se divide", () => {
    const html = renderMensagem(msg("m1", "pessoa", "Um.\n\nDois."), cenario([]));
    expect(conta(html, 'class="bubble"')).toBe(1);
    expect(html).not.toContain("data-balao");
  });
});

describe("a fala viva", () => {
  const comAtividade = (a: AtividadeTurno, encerrado = false): ReturnType<typeof blocosAoVivo>[number] => {
    const base = cenario([msg("m0", "pessoa", "oi")]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } };
    const fim = encerrado ? reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA }) : e;
    return blocosAoVivo(fim.conversas[C]!, fim)[0]!;
  };
  const vivo = (texto: string): ReturnType<typeof blocosAoVivo>[number] => comAtividade(comTexto(ATIVIDADE_VAZIA, texto));

  it("cada balão é uma parte do morph; o novo entra com balao-entra", () => {
    const b = vivo(RESPOSTA_LONGA);
    expect(b.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar", "balao", "balao-1", "balao-2"]);
    expect(b.html).toContain('<div class="bubble balao-entra" data-parte="balao-1" data-balao="1" data-no-lugar>');
    expect(b.html).not.toMatch(/class="bubble balao-entra" data-parte="balao"/);
    expect(conta(b.html, "<nod-mascote")).toBe(1);
  });

  it("enquanto o texto chega, os balões só crescem e o morph troca só o último", () => {
    let antes: ReturnType<typeof vivo> | undefined;
    for (let n = 1; n <= RESPOSTA_LONGA.length; n++) {
      const agora = vivo(RESPOSTA_LONGA.slice(0, n));
      const plano = planoDoMorph(antes?.morfar, agora.morfar);
      if (antes) {
        expect(plano).not.toBeNull();
        const baloes = plano!.partes.filter((p) => p.chave.startsWith("balao"));
        // Os balões fechados ficam (html null): muda só o que era o último (cresce, ou ganha data-balao quando o 1 nasce).
        const tinha = antes.morfar!.partes.filter((p) => p.chave.startsWith("balao")).length;
        expect(baloes.length).toBeGreaterThanOrEqual(tinha);
        baloes.slice(0, tinha - 1).forEach((p) => expect(p.html).toBeNull());
      }
      antes = agora;
    }
  });

  it("revisão 3 do PR #522: o balão único ao vivo é o da fala de um parágrafo (sem data-balao, a largura de antes)", () => {
    const longo = `Ok, ${"a revisão passou em todos os pontos. ".repeat(9)}`;
    expect(vivo(longo).html).toContain('<div class="bubble" data-parte="balao" data-no-lugar>Ok, a revisão passou');
    // Quando o segundo nasce, o primeiro ganha data-balao (a largura do texto), no mesmo nó (data-no-lugar).
    expect(vivo(`${longo}\n\nA`).html).toContain('<div class="bubble" data-parte="balao" data-balao="0" data-no-lugar>Ok, a revisão passou');
    // Parte 2: o texto curto ao vivo ainda é pensamento, sem balão.
    expect(vivo("Ok.").html).not.toContain('class="bubble"');
  });

  it("revisão 3 do PR #522: os balões do relatório longo mantêm a chave quando a narração curta é substituída", () => {
    const relatorio = `Relatório: ${"a ".repeat(160)}fim.`;
    let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, relatorio), "Consultou Linear", { texto: "Usando Linear", frentes: false });
    a = comFerramenta(comTexto(a, "Vou conferir."), "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const antes = comAtividade(a).morfar!;
    // Parte 2: só o relatório longo está no balão; a narração curta é nota do pensamento.
    expect(antes.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave)).toEqual(["balao"]);
    const depois = comAtividade(comTexto(a, "Pronto.")).morfar!;
    expect(depois.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave)).toEqual(["balao"]);
    // O balão do relatório fica (html null no plano); nenhum balão sai nem entra.
    const plano = planoDoMorph(antes, depois)!;
    expect(plano.partes.find((p) => p.chave === "balao")?.html).toBeNull();
    expect(plano.partes.map((p) => p.chave)).not.toContain("balao-1");
  });

  it("revisão 4 do PR #522: o relatório escrito depois da narração guarda a geração dele quando vira relatório (também com CRLF)", () => {
    for (const q of ["\n", "\r\n"]) {
      const relatorio = [`Relatório: ${"a ".repeat(100)}um.`, `Dois ${"b ".repeat(60)}.`, `Três ${"c ".repeat(60)}.`].join(q + q);
      let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Vou olhar."), "Consultou Linear", { texto: "Usando Linear", frentes: false });
      a = comTexto(a, relatorio);
      const escrevendo = comAtividade(a).morfar!.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave);
      expect(escrevendo).toEqual(["balao-g1", "balao-g1-1", "balao-g1-2"]);
      a = comFerramenta(a, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
      const antes = comAtividade(a).morfar!;
      const depois = comAtividade(comTexto(a, "Pronto.")).morfar!;
      // Parte 2: "Pronto." é curto — fica no pensamento; os balões do relatório não mudam.
      expect(depois.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave)).toEqual(escrevendo);
      // Os balões do relatório não mudam no plano do morph (html null): nada sai, nada reanima.
      const plano = planoDoMorph(antes, depois)!;
      escrevendo.forEach((c) => expect(plano.partes.find((p) => p.chave === c)?.html).toBeNull());
    }
  });

  it("revisão 5 do PR #522: o balão do relatório que puxa a narração seguinte (título) guarda a chave", () => {
    const relatorio = `## Resumo\n\n${"a ".repeat(160)}fim.`;
    let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, relatorio), "Consultou Linear", { texto: "Usando Linear", frentes: false });
    a = comFerramenta(comTexto(a, "Vou publicar."), "Publicou", { texto: "Usando GitHub", frentes: false });
    const chaves = (x: AtividadeTurno) => comAtividade(x).morfar!.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave);
    expect(chaves(a)).toEqual(["balao"]);
    const depois = comTexto(a, "Publicado.");
    expect(chaves(depois)).toEqual(["balao"]);
    expect(comAtividade(depois).html).toContain("Publicado.");
  });

  it("revisão 6 do PR #522: a narração de exatamente 280 caracteres ainda é curta (sai quando o texto volta)", () => {
    const narracao = `Vou ${"x".repeat(272)} já.`;
    expect(narracao).toHaveLength(280);
    const a = comFerramenta(comTexto(ATIVIDADE_VAZIA, narracao), "F", { texto: "Usando", frentes: false });
    const b = comAtividade(comTexto(a, "Pronto."));
    // Parte 2: curta, nunca entrou no balão — é nota do pensamento; "Pronto." também é curto.
    expect(b.morfar!.partes.filter((p) => p.chave.startsWith("balao"))).toEqual([]);
    expect(b.html).toContain(`<li class="pensar-nota">${narracao}</li>`);
  });

  it("revisão 8 do PR #522: a narração curta com quebras no fim conta como curta quando sai da lista guardada", () => {
    let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, `${"x".repeat(279)}\n\n`), "Ferramenta", { texto: "Usando", frentes: false });
    for (let i = 0; i < 205; i++) a = comFerramenta(comTexto(a, `Passo ${i}.`), "Ferramenta", { texto: "Usando", frentes: false });
    const b = comAtividade(comTexto(a, "Vou olhar."));
    expect(b.morfar!.partes.filter((p) => p.chave.startsWith("balao"))).toEqual([]);
    expect(b.html).toContain('<span class="fala-viva-estado">Vou olhar.</span>');
  });

  it("revisão 5 do PR #522: a geração não cai quando a lista de narrações guardadas anda (mais de 200 ferramentas)", () => {
    let a = ATIVIDADE_VAZIA;
    for (let i = 0; i < 205; i++) a = comFerramenta(comTexto(a, `Passo ${i}.`), "Ferramenta", { texto: "Usando", frentes: false });
    const narrando = comTexto(a, `Vou olhar ${"cada um dos arquivos da lista com calma. ".repeat(8)}\n\nJá volto.`);
    const chaves = (x: AtividadeTurno) => comAtividade(x).morfar!.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave);
    expect(chaves(narrando)).toEqual(["balao-g205", "balao-g205-1"]);
    expect(chaves(comFerramenta(narrando, "Ferramenta", { texto: "Usando", frentes: false }))).toEqual(["balao-g205", "balao-g205-1"]);
  });

  it("revisão 5 do PR #522: balões de texto repetido e relatório com CRLF acham a geração certa", () => {
    // QA do PR #522: três parágrafos em CRLF (com dois, o "+2" do separador escondia o fim contado com "\r").
    const relatorio = [`Relatório ${"a ".repeat(150)}.`, "Ok.", "Três."].join("\r\n\r\n");
    let a = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Vou ver."), "F", { texto: "Usando", frentes: false });
    a = comFerramenta(comTexto(a, relatorio), "F", { texto: "Usando", frentes: false });
    a = comFerramenta(comTexto(a, "Mais um."), "F", { texto: "Usando", frentes: false });
    const chaves = comAtividade(comTexto(a, "Ok.")).morfar!.partes.filter((p) => p.chave.startsWith("balao")).map((p) => p.chave);
    // Parte 2: "Ok." é curto (pensamento); os três balões do relatório ficam com a geração deles.
    expect(chaves).toEqual(["balao-g1", "balao-g1-1", "balao-g1-2"]);
  });

  it("revisão 4 do PR #522: cada balão tem a sua chave de texto (as tabelas de dois balões não colidem)", () => {
    // A tabela longa tem o "mostrar mais", com a chave do texto no data-disclosure.
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = vivo(`Um.\n\n${tabela}\n\nDois.\n\n${tabela}`).html;
    const chaves = [...html.matchAll(/data-disclosure="(tabela:[^"]+)"/g)].map((m) => m[1]);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });

  it("Parte 2: a narração curta nunca vai ao balão — corre no cabeçalho e, fechada por ferramenta, vira nota; o balão nunca perde conteúdo", () => {
    const narrando = comTexto(ATIVIDADE_VAZIA, "Vou olhar o Linear.\n\nJá volto com a lista.");
    expect(comAtividade(narrando).morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
    expect(comAtividade(narrando).html).toContain('<span class="fala-viva-estado">Vou olhar o Linear.</span>');
    const usando = comFerramenta(narrando, "Consultou Linear", { texto: "Usando Linear", frentes: false });
    expect(comAtividade(usando).html).toContain('<li class="pensar-nota">Vou olhar o Linear.\n\nJá volto com a lista.</li>');
    const depois = comAtividade(comTexto(usando, "Achei 3 issues"));
    expect(depois.morfar!.partes.filter((p) => p.chave.startsWith("balao"))).toEqual([]);
    expect(depois.html).toContain('<span class="fala-viva-estado">Achei 3 issues</span>');
    // O pensamento é uma parte só, que muda por dentro: a nota continua lá.
    const plano = planoDoMorph(comAtividade(usando).morfar, depois.morfar)!;
    expect(plano.partes.map((p) => p.chave)).toEqual(["nome", "pensar"]);
    expect(plano.partes.find((p) => p.chave === "pensar")?.html).toContain("Vou olhar o Linear.");
  });

  it("revisão 2 do PR #522: a fala parada divide como a gravada, sem esconder o começo indeciso do fim", () => {
    const parada = comAtividade(comTexto(ATIVIDADE_VAZIA, "- a\n- b\n\n-"), true);
    const baloes = parada.morfar!.partes.filter((p) => p.chave.startsWith("balao"));
    expect(baloes.map((p) => p.chave)).toEqual(["balao", "balao-1"]);
    expect(baloes[1]!.html).toMatch(/data-balao="1" data-no-lugar>-<\/div>/);
    // O mesmo texto ao vivo esconde o "-" (ainda pode virar item).
    expect(vivo("- a\n- b\n\n-").html).not.toMatch(/<\/ul>.*-<\/div>/s);
  });

  it("o começo de item depois da lista não aparece num balão próprio antes de decidir", () => {
    const lista = `${"- um item longo o bastante para a fala passar do limiar da promoção ao balão\n".repeat(5)}\n-`;
    expect(lista.length).toBeGreaterThan(280);
    expect(vivo(lista).morfar!.partes.map((p) => p.chave)).toEqual(["nome", "pensar", "balao"]);
    expect(vivo(lista).html).not.toMatch(/<\/ul>.*-<\/div>/s);
  });
});

describe("revisão 5 do PR #522: a fala gravada", () => {
  it("revisão 6: o balão 0 usa a chave da mensagem (a tabela dele guarda o mostrar mais de antes)", () => {
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = renderMensagem(msg("m1", "agente", `${tabela}\n\nDois.`), cenario([]));
    expect(html).toContain('data-disclosure="tabela:m1:0"');
  });

  it("cada balão tem a sua chave de texto", () => {
    const tabela = `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| ${i} | x |`).join("\n")}`;
    const html = renderMensagem(msg("m1", "agente", `Um.\n\n${tabela}\n\nDois.\n\n${tabela}`), cenario([]));
    const chaves = [...html.matchAll(/data-disclosure="([^"]+)"/g)].map((m) => m[1]);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });
});

describe("CSS", () => {
  const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
  it("o balão tem a largura do texto, 6 px entre eles e, com menos movimento, não anima", () => {
    expect(css).toContain(".bubble-wrap > .bubble[data-balao]:not(.com-progresso) { width: fit-content;");
    expect(css).toContain(".bubble-wrap > .bubble[data-balao] + .bubble[data-balao] { margin-top: 6px; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.bubble\.balao-entra \{ animation: none; \} \}/);
    // Revisão 2 do PR #522: a regra da animação tem a mesma especificidade da de menos movimento, que vem depois e ganha.
    const anima = css.indexOf(".bubble.balao-entra { animation: balao-entra");
    expect(anima).toBeGreaterThan(-1);
    expect(css.indexOf("@media (prefers-reduced-motion: reduce) { .bubble.balao-entra { animation: none; } }")).toBeGreaterThan(anima);
    expect(css).not.toContain("data-trocada");
  });
});
