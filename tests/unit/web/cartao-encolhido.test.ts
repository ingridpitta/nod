import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { aplicarEncolhidos, decididaNaConversa, VALIDADE_DO_ENCOLHIDO_MS, type DecididaNestaAba, type DocumentoDoEncolhido } from "../../../web/lib/foco-do-encolhido.ts";
import { blocosDoHistorico, renderMensagem } from "../../../web/telas/conversa.ts";
import { dadosDoEncolhido } from "../../../web/telas/cartao-encolhido.ts";

/**
 * Chat limpo, PR 4 (plano, Parte 3 · 3A; protótipo D3A): decidido, o cartão encolhe NO LUGAR do pedido — o título e o
 * resultado —, em vez de sumir e deixar um recibo no fim da conversa. O lugar é a âncora do pedido (a última mensagem do
 * turno que pediu, antes do recibo); sem ela, a posição do próprio recibo.
 */

const C = "c1";
const AGORA = Date.parse("2026-10-18T11:20:00Z");
const MIN = 60_000;
const t0 = AGORA - 60 * MIN;
const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
const bot = { ...pessoa, autor_tipo: "agente", autor_id: "a" } as const;

const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: bot, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, destino: "chat", ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { autoria: pessoa });
const fala = (id: string, criadoEm: number, turnoId: string): Mensagem => msg(id, criadoEm, { turnoId, origemTurno: "conversa", fimDoTurno: true });
const aprovacao = (id: string, criadoEm: number, turnoId: string | null, decisaoId = "d1", desfecho: "executado" | "retirado_pela_pessoa" = "executado"): Mensagem =>
  msg(id, criadoEm, { turnoId, autoria: pessoa, kind: "resultado_aprovacao", texto: "Marlon aprovou 1 de 1.", payload: { kind: "resultado_aprovacao", decisaoId, frase: "Enviar e-mail para Helena Souza · “Re: Proposta Q4”", itens: [{ idx: 0, desfecho, texto: "e-mail" }] } });

const pedido = (id: string, turnoId: string | null): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: C, turnoId, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-19T11:00:00Z", prazoExecucaoEm: null, frase: "Enviar e-mail para Helena Souza", desfecho: null, vistaEm: null, criadoEm: new Date(t0 + 2 * MIN).toISOString(), fioId: null },
  estadoColuna: "pendente", agenteNome: "Clarice", aguardandoHaMs: MIN, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null,
  itensAprovacao: [{ tenantId: "t", id: `${id}-i`, decisaoId: id, idx: 0, textoOriginal: "e-mail", textoFinal: "e-mail", destino: { conector: "gmail", ferramenta: "GMAIL_SEND_EMAIL", argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null }],
});

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = [], extra: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...extra,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Clarice", conversaId: C, cor: "c-violet", forma: "shape-circle", ownerId: "p" }] } as never,
    conectores: [{ slug: "gmail", nome: "Gmail", habilitado: true, ownerId: "p", catalogo: [{ nome: "GMAIL_FETCH_EMAILS", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }, { nome: "GMAIL_SEND_EMAIL", descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }] }] as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

const chaves = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).map((b) => b.chave).filter((k) => !k.startsWith("sep:"));

describe("cada tipo de cartão encolhido", () => {
  const { e } = cenario([]);

  it("aprovação: o pedido como título e 'Aprovado por você · feito HH:MM' com ✓; recusada, a linha discreta", () => {
    const d = dadosDoEncolhido(aprovacao("r", AGORA, "t1"), e);
    expect(d).toMatchObject({ decisaoId: "d1", titulo: "Enviar e-mail para Helena Souza · “Re: Proposta Q4”", marca: "ok", anuncio: "Aprovado: Enviar e-mail para Helena Souza · “Re: Proposta Q4”" });
    expect(d?.resultado).toMatch(/^Aprovado por você · feito \d\d:\d\d$/);
    expect(dadosDoEncolhido(aprovacao("r", AGORA, "t1", "d1", "retirado_pela_pessoa"), e)).toMatchObject({ resultado: "Recusado por você", marca: null });
  });

  it("acesso pelo pedido: a frase do pedido e 'Acesso permitido · Gmail', com o registro de autorização (emenda da ADR-044)", () => {
    const m = msg("cs", AGORA, { autoria: pessoa, kind: "consentimento", texto: "Concedido por Marlon em 2026-10-18 11:00 UTC: gmail.GMAIL_FETCH_EMAILS; não inclui: …", payload: { kind: "consentimento", conectorId: "k", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], naoInclui: [], decisaoId: "d7", turnoId: "t1", frase: "Clarice quer ler seus e-mails no Gmail" } });
    const html = renderMensagem(m, e);
    expect(html).toContain('data-cartao-encolhido="d7"');
    expect(html).toContain('tabindex="-1">Clarice quer ler seus e-mails no Gmail</span>');
    // NOD-399: uma linha: ✓, o resultado e, depois do separador, o pedido.
    expect(html).toMatch(/class="cp-linha cp-ok cartao-encolhido cp-com-extra"[^>]*><svg class="cp-ic"[^]*?<span class="ce-resultado">Acesso permitido · Gmail<\/span><span class="sr-only"> \(feito\)<\/span>/);
    expect(html).toContain("<summary>Ver registro de autorização</summary>");
    expect(html).toContain("Concedido por Marlon em 2026-10-18 11:00 UTC");
  });

  it("acesso sem pedido (Conectores, de antes de 18/10): o que foi liberado, em português, pelo grupo do catálogo", () => {
    const m = msg("cs", AGORA, { autoria: pessoa, kind: "consentimento", texto: "Concedido…", payload: { kind: "consentimento", conectorId: "k", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"], naoInclui: [] } });
    expect(dadosDoEncolhido(m, e)).toMatchObject({ decisaoId: "cs", titulo: "Ler e criar e enviar no Gmail", resultado: "Acesso permitido · Gmail" });
  });

  it("o consentimento da aprovação automática não encolhe: não houve cartão nem clique", () => {
    const m = msg("cs", AGORA, { autoria: { ...pessoa, decidido_por: "regra:modo_automatico" }, kind: "consentimento", texto: "Concedido…", payload: { kind: "consentimento", conectorId: "k", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], naoInclui: [] } });
    expect(dadosDoEncolhido(m, e)).toBeNull();
  });

  it("o recibo automático sem payload não encolhe (a linha de sempre)", () => {
    expect(dadosDoEncolhido(msg("ra", AGORA, { kind: "resultado_aprovacao", texto: "Aprovado sem perguntar: …" }), e)).toBeNull();
  });

  it("proposta confirmada e recusada: o título gravado e 'Confirmado por você' / 'Recusado por você'", () => {
    const decidida = (estado: "confirmada" | "recusada") => msg("pd", AGORA, { autoria: pessoa, kind: "sistema", texto: "…", payload: { kind: "proposta_decidida", propostaId: "pr1", tipo: "rotina", titulo: "Rotina · todo dia às 9h", estado, turnoId: "t1" } });
    expect(dadosDoEncolhido(decidida("confirmada"), e)).toMatchObject({ decisaoId: "pr1", titulo: "Rotina · todo dia às 9h", resultado: "Confirmado por você", marca: "ok", anuncio: "Confirmado: Rotina · todo dia às 9h" });
    expect(dadosDoEncolhido(decidida("recusada"), e)).toMatchObject({ resultado: "Recusado por você", marca: null });
  });

  it("escapa o título e o resultado que vêm do modelo e do conector", () => {
    const html = renderMensagem(msg("r", AGORA, { autoria: pessoa, kind: "resultado_aprovacao", texto: "x", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: '<img src=x onerror=1>"', itens: [{ idx: 0, desfecho: "executado" }] } }), e);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=1&gt;&quot;");
  });
});

describe("onde o cartão encolhido fica", () => {
  it("na âncora do pedido: depois da última fala do turno que pediu, antes do recibo — não no fim", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), fala("m4", t0 + 6 * MIN, "t2"), aprovacao("r", t0 + 7 * MIN, "t1")]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "encolhido:r", "m3", "m4"]);
  });

  it("a fala do turno que seguiu depois da decisão ('Enviado.') fica depois do cartão, como no protótipo", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), aprovacao("r", t0 + 2 * MIN, "t1"), fala("m3", t0 + 3 * MIN, "t1")]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "encolhido:r", "m3"]);
  });

  // Chat limpo, PR 6: o cartão que subiu para a fala que pediu não abre bloco de horário. Decidido três horas depois, o
  // divisor entra depois dele, antes da fala que seguiu ("Enviado."), e não entre a fala que pediu e o cartão.
  it("decidido horas depois: o divisor de data vem depois do cartão encolhido, antes da fala que seguiu", () => {
    const { e, c } = cenario([daPessoa("m1", t0 - 180 * MIN), fala("m2", t0 - 179 * MIN, "t1"), aprovacao("r", t0, "t1"), fala("m3", t0 + MIN, "t1")]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "m2", "encolhido:r", "sep:m3", "m3"]);
  });

  it("âncora fora da janela: o cartão encolhe na posição do próprio recibo", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t2"), aprovacao("r", t0 + 2 * MIN, "t-antigo"), daPessoa("m3", t0 + 3 * MIN)]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "r", "m3"]);
    expect(blocosDoHistorico(c, e).find((b) => b.chave === "r")?.html).toContain("cartao-encolhido");
  });

  it("recibo antigo com payload e sem turno (consentimento de antes de 18/10): encolhido onde está, no fim", () => {
    const antigo = msg("cs", t0 + 9 * MIN, { autoria: pessoa, kind: "consentimento", texto: "Concedido…", payload: { kind: "consentimento", conectorId: "k", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], naoInclui: [] } });
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), antigo]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "cs"]);
    expect(blocosDoHistorico(c, e).at(-1)?.html).toContain("Acesso permitido · Gmail");
  });

  it("recibo de regra (aprovação automática, acesso automático) mora na Atividade: fora do chat", () => {
    const automatico = msg("ra", t0 + 2 * MIN, { kind: "resultado_aprovacao", texto: "Aprovado sem perguntar", destino: "atividade" });
    const acesso = msg("cs", t0 + 3 * MIN, { autoria: { ...pessoa, decidido_por: "regra:modo_automatico" }, kind: "consentimento", texto: "Concedido…", destino: "atividade", payload: { kind: "consentimento", conectorId: "k", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], naoInclui: [], decisaoId: "d2", turnoId: "t1" } });
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), automatico, acesso]);
    expect(chaves(c, e)).toEqual(["m1", "m2"]);
  });

  it("re-render sem pulo: o cartão encolhido toma o lugar do cartão aberto, e o aberto de mesmo id não volta enquanto 'Sua vez' não foi relida", () => {
    const antes = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN)], [pedido("d1", "t1")]);
    expect(chaves(antes.c, antes.e)).toEqual(["m1", "m2", "decisao:d1", "m3"]);
    // O frame da mensagem chegou e a conversa foi relida; "Sua vez" ainda diz que o pedido está aberto.
    const depois = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), aprovacao("r", t0 + 6 * MIN, "t1")], [pedido("d1", "t1")]);
    expect(chaves(depois.c, depois.e)).toEqual(["m1", "m2", "encolhido:r", "m3"]);
    expect(blocosDoHistorico(depois.c, depois.e).map((b) => b.html).join("")).not.toContain("Preciso da sua decisão");
    // Desenhar de novo dá os mesmos blocos: nada é regravado (web/lib/regioes.ts).
    expect(blocosDoHistorico(depois.c, depois.e)).toEqual(blocosDoHistorico(depois.c, depois.e));
  });

  it("dois pedidos do mesmo turno: o já decidido (encolhido) vem antes do que ainda está aberto", () => {
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), aprovacao("r", t0 + 6 * MIN, "t1", "d1")], [pedido("d2", "t1")]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "encolhido:r", "decisao:d2", "m3"]);
  });

  it("'Sempre permitir': o resultado e a regra da mesma decisão encolhem juntos na âncora, cada título com o seu id", () => {
    const regra = msg("rg", t0 + 3 * MIN, { autoria: pessoa, kind: "consentimento", texto: "Marlon permitiu para sempre: gmail.GMAIL_SEND_EMAIL. Vale já…", payload: { kind: "regra_permanente", decisaoId: "d1", turnoId: "t1", acoes: ["gmail.GMAIL_SEND_EMAIL"] } });
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), aprovacao("r", t0 + 2 * MIN, "t1"), regra, daPessoa("m3", t0 + 5 * MIN)]);
    expect(chaves(c, e)).toEqual(["m1", "m2", "encolhido:r", "encolhido:rg", "m3"]);
    const html = blocosDoHistorico(c, e).map((b) => b.html).join("");
    const ids = [...html.matchAll(/ id="(ce-t-[^"]+)"/g)].map((x) => x[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`aria-labelledby="${id}"`);
  });

  it("a proposta decidida: o cartão da proposta sai do fim e o encolhido fica na fala do turno que a propôs", () => {
    const proposta = { tenantId: "t", id: "pr1", conversaId: C, agenteId: "a", kind: "rotina", estado: "pendente", payload: { kind: "rotina", cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "x", entregavel: "x", limitesAprovacao: "x", politicaSemDado: "x", proximaExecucao: AGORA, resumo: "todo dia às 9h" }, criadoEm: t0 } as Proposta;
    const decidida = msg("pd", t0 + 6 * MIN, { autoria: pessoa, kind: "sistema", texto: "Marlon confirmou…", payload: { kind: "proposta_decidida", propostaId: "pr1", tipo: "rotina", titulo: "Rotina · todo dia às 9h", estado: "confirmada", turnoId: "t1" } });
    const { e, c } = cenario([daPessoa("m1", t0), fala("m2", t0 + MIN, "t1"), daPessoa("m3", t0 + 5 * MIN), decidida], [], { propostas: [proposta] });
    expect(chaves(c, e)).toEqual(["m1", "m2", "encolhido:pd", "m3"]);
  });

  it("a sala e o servidor de antes (sem destino) também encolhem; o recibo não some dentro de 'N avisos do sistema'", () => {
    const sem = (m: Mensagem): Mensagem => ({ ...m, destino: undefined });
    const aviso = (id: string, em: number) => sem(msg(id, em, { kind: "sistema", texto: `aviso ${id}` }));
    const decidida = sem(msg("pd", t0 + 4 * MIN, { autoria: pessoa, kind: "sistema", texto: "…", payload: { kind: "proposta_decidida", propostaId: "pr1", tipo: "perfil", titulo: "Perfil · Clarice", estado: "confirmada", turnoId: null } }));
    const { e, c } = cenario([sem(daPessoa("m1", t0)), aviso("a1", t0 + MIN), aviso("a2", t0 + 2 * MIN), decidida, aviso("a3", t0 + 5 * MIN)]);
    const html = blocosDoHistorico(c, e).map((b) => b.html).join("");
    expect(html).not.toContain("avisos do sistema");
    expect(html).toContain('tabindex="-1">Perfil · Clarice</span>');
  });
});

describe("foco e anúncio só na aba que decidiu", () => {
  it("o clique conta dentro da conversa; o de 'Sua vez' não — e a tela Sua vez também é desenhada na região #timeline", () => {
    // Os ancestrais de cada botão como o main.ts desenha (QA do PR 4: toda tela entra na região #timeline; só a conversa,
    // a sala e a task têm as partes #timeline-historico e #timeline-ao-vivo). `closest` casa qualquer item da lista.
    const dentro = (...ancestrais: string[]) => ({ closest: (s: string) => (s.split(",").some((x) => ancestrais.includes(x.trim())) ? {} : null) });
    const naConversa = dentro("#timeline-historico", "#timeline");
    const naSuaVez = dentro("#timeline");
    expect(decididaNaConversa(dentro("#timeline-ao-vivo", "#timeline"), "d1", AGORA)).not.toBeNull();
    expect(decididaNaConversa({ closest: () => null }, "d1", AGORA)).toBeNull();
    expect(decididaNaConversa(naConversa, "d1", AGORA)).toEqual({ id: "d1", ate: AGORA + VALIDADE_DO_ENCOLHIDO_MS });
    expect(decididaNaConversa(naSuaVez, "d1", AGORA)).toBeNull();
    expect(decididaNaConversa(naConversa, '"]<x', AGORA)).toBeNull();
  });

  type Falso = { focado: boolean; classes: string[]; focus(): void; getAttribute(n: string): string | null; classList: { add(c: string): void } };
  function el(atributos: Record<string, string> = {}): Falso {
    const e: Falso = { focado: false, classes: [], focus() { e.focado = true; }, getAttribute: (n) => atributos[n] ?? null, classList: { add: (c) => void e.classes.push(c) } };
    return e;
  }
  function doc(cartoes: Record<string, string>, ativo?: unknown): DocumentoDoEncolhido & { titulos: Map<string, Falso>; cartoes: Map<string, Falso> } {
    const body = {};
    const titulos = new Map(Object.keys(cartoes).map((id) => [id, el()]));
    const els = new Map(Object.entries(cartoes).map(([id, anuncio]) => [id, el({ "data-anuncio": anuncio })]));
    return {
      titulos, cartoes: els, body, activeElement: ativo ?? body,
      querySelector(sel: string) {
        const id = /#timeline \[data-cartao-encolhido="([^"]+)"\]/.exec(sel)?.[1];
        const cartao = id ? els.get(id) : undefined;
        return cartao && id ? { ...cartao, querySelector: (s: string) => (s === ".pq-titulo" ? titulos.get(id) ?? null : null) } : null;
      },
    };
  }
  const pedidoDe = (id: string, ate = AGORA + 10_000): DecididaNestaAba => ({ id, ate });

  it("no primeiro desenho do cartão: foco no título, o anúncio na região aria-live e a classe que anima uma vez", () => {
    const d = doc({ d1: "Aprovado: Enviar e-mail para Helena Souza" });
    const ditos: string[] = [];
    expect(aplicarEncolhidos(d, [pedidoDe("d1")], AGORA, (t) => ditos.push(t))).toEqual([]);
    expect(d.titulos.get("d1")?.focado).toBe(true);
    expect(ditos).toEqual(["Aprovado: Enviar e-mail para Helena Souza"]);
    // O objeto devolvido por querySelector é uma cópia no falso; a classe vai pelo classList do cartão.
    expect(d.cartoes.get("d1")?.classes).toEqual(["encolhendo"]);
  });

  it("o cartão ainda não nasceu (a ação está executando, a conversa não foi relida): espera o próximo desenho", () => {
    const d = doc({});
    const ditos: string[] = [];
    expect(aplicarEncolhidos(d, [pedidoDe("d1")], AGORA, (t) => ditos.push(t))).toEqual([pedidoDe("d1")]);
    expect(ditos).toEqual([]);
  });

  it("decidido em outro lugar não tem pedido: o cartão que aparece não rouba o foco nem fala", () => {
    const d = doc({ d9: "Aprovado: outra coisa" });
    const ditos: string[] = [];
    expect(aplicarEncolhidos(d, [pedidoDe("d1")], AGORA, (t) => ditos.push(t))).toEqual([pedidoDe("d1")]);
    expect(d.titulos.get("d9")?.focado).toBe(false);
    expect(ditos).toEqual([]);
  });

  it("cada botão que decide um pedido dentro da conversa guarda o pedido (web/main.ts) — também o 'Permitir' do acesso", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const corpoDa = (acao: string): string => {
      const inicio = main.indexOf(`\n  "${acao}": `);
      expect(inicio, acao).toBeGreaterThan(-1);
      const resto = main.slice(inicio + 1);
      const fim = resto.slice(1).search(/\n {2}(?:"[\w-]+"|[a-zA-Z]\w*): /);
      return fim === -1 ? resto : resto.slice(0, fim + 1);
    };
    const acoes = ["permitir-acesso", "recusar-decisao", "decidir-aprovacao", "decidir-aprovacao-resto", "decidir-aprovacao-sempre", "decidir-aprovacao-nenhum", "decidir-lote", "decidir-proposta", "confirmar-proposta", "recusar-proposta", "permitir-pasta"];
    for (const acao of acoes) expect(corpoDa(acao), acao).toContain("marcarDecidida(el, ");
  });

  it("com o foco já no campo, anuncia e não rouba o foco; vencido o prazo, o pedido cai", () => {
    const d = doc({ d1: "Recusado: Enviar e-mail" }, { id: "composer-texto" });
    const ditos: string[] = [];
    aplicarEncolhidos(d, [pedidoDe("d1")], AGORA, (t) => ditos.push(t));
    expect(d.titulos.get("d1")?.focado).toBe(false);
    expect(ditos).toEqual(["Recusado: Enviar e-mail"]);
    expect(aplicarEncolhidos(doc({}), [pedidoDe("d1", AGORA - 1)], AGORA, () => undefined)).toEqual([]);
  });
});
