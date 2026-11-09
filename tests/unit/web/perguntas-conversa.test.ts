import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import type { Mensagem, PayloadMensagem } from "../../../src/contracts/mensagem.ts";
import type { FioDaPergunta, PedidoDoItem } from "../../../src/contracts/pedido.ts";
import { opcaoRespondida } from "../../../src/domain/opcoes-da-pergunta.ts";
import { textoPedidoDeTela } from "../../../src/domain/computador.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { destinoDoEnvio, enviarPeloComposer, indiceDaOpcao, modoDoComposer, proximaDoComposer, textoDaLetra, type ApiDeEnvio } from "../../../web/lib/perguntas.ts";
import { pilulaDaPergunta, pilulaDasNovas } from "../../../web/lib/rolagem.ts";
import { hora } from "../../../web/lib/render.ts";
import { htmlComposer, renderTimeline } from "../../../web/telas/conversa.ts";
import { aparenciaDoComposer, renderTopoComposer } from "../../../web/telas/pergunta.ts";
import { renderDecisoesDaConversa, renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24) e, desde 2026-10-18, o cartão da pergunta (plano
 * "pergunta com botões", Partes 2, 3a e 4; protótipo aprovado, telas E2, S1, S2, S3, S4 e S5). A pergunta é UM elemento:
 * o texto como título, o × que deixa pra lá, as opções com letras A a D (a recomendada em A, com "Recomendo") e "Ou
 * responda no chat abaixo". Saíram "Parei aqui até você responder", a faixa acima do campo, o seletor "Responder | Outro
 * assunto", a nota do campo e o "vence em".
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...autoria, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;

function item(id: string, p: { tipo?: TipoDecisao; criadoEm?: number; vencido?: boolean; frase?: string; ownerId?: string; pedido?: PedidoDoItem | null; fio?: { id: string; rodada: number } } = {}): Item {
  const criadoEm = p.criadoEm ?? AGORA - 2 * H;
  return {
    decisao: {
      tenantId: "t", id, ownerId: p.ownerId ?? "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: "t1", tipo: p.tipo ?? "pergunta",
      estado: p.vencido ? "vencida" : "pendente",
      prazoDecisaoEm: new Date(p.vencido ? AGORA - 3 * H : criadoEm + 24 * H).toISOString(), prazoExecucaoEm: null,
      frase: p.frase ?? `pergunta ${id}`,
      desfecho: p.vencido ? { tipo: "expirou_sem_ninguem_ver", em: new Date(AGORA - 3 * H).toISOString() } : null,
      vistaEm: null, criadoEm: new Date(criadoEm).toISOString(), fioId: null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: "Nina", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H, gemeas: [], itensAprovacao: [], proposta: null, fio: p.fio ?? null, rotinaParada: null,
    ...(p.pedido !== undefined ? { pedido: p.pedido } : {}),
  };
}

function fala(id: string, decisaoId: string, texto: string, opcoes?: string[], criadoEm = AGORA - 2 * H, extra: Partial<Extract<PayloadMensagem, { kind: "pedido_a_pessoa" }>> = {}): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria, kind: "texto", texto, payload: { kind: "pedido_a_pessoa", decisaoId, ...(opcoes ? { opcoes } : {}), ...extra }, confianca: "confiavel", parcial: false, criadoEm };
}

function resposta(id: string, decisaoId: string, texto: string, criadoEm: number, perguntaEm: number, extra: { retomada?: boolean; via?: "opcao" | "texto"; opcao?: number } = {}): Mensagem {
  const { retomada = true, ...via } = extra;
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria: daPessoa, kind: "texto", texto, payload: { kind: "resposta_a_pedido", decisaoId, agenteId: "a", perguntaEm, retomada, ...via }, confianca: "confiavel", parcial: false, criadoEm };
}

const nina = { id: "a", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;

function conversa(mensagens: Mensagem[], fios: FioDaPergunta[] = []): ConversaEstado {
  return { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios, carregadaEm: 0 };
}

function cenario(mensagens: Mensagem[], itens: Item[] | null, fios: FioDaPergunta[] = []): Estado {
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { tenantId: "t", pessoaId: "p" },
    tela: { tipo: "conversa", conversaId: "c", agenteId: "a" },
    frota: { agentes: [nina], inventario: null, negacoes: [] } as never,
    suaVez: itens ? { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } : null,
    conversas: { c: conversa(mensagens, fios) },
  };
}

const fio = (decisaoId: string, estado: FioDaPergunta["estado"], mensagens: string[]): FioDaPergunta => ({ id: decisaoId, agenteId: "a", estado, rodada: 1, decisoes: [decisaoId], mensagens });

const PERGUNTA = "Tentei 3 vezes e não ficou verde. Como sigo?";
const OPCOES = ["Mergear com o teste rodado na VM", "Reapontar a pilha para a main", "Tentar mais uma vez"];
const umaAberta = (opcoes: string[] | undefined = OPCOES, extra = {}): Estado => cenario([fala("m1", "d1", PERGUNTA, opcoes, AGORA - 2 * H, extra)], [item("d1")]);
const timeline = (e: Estado): string => renderTimeline(e.conversas.c ?? null, e);
const PADRAO = { placeholder: "Escreva uma mensagem para Nina…", nota: "" };

describe("o pedido de tela vira o cartão Abrir computador", () => {
  it("aberta mostra o motivo e o botão que assume a tela; a senha não fica no balão", () => {
    const motivo = "verificar que é humano no LinkedIn";
    const html = timeline(cenario([fala("m1", "d1", textoPedidoDeTela(motivo))], [item("d1", { frase: textoPedidoDeTela(motivo) })]));
    expect(html).toContain("msg-computador");
    expect(html).toContain(motivo);
    expect(html).toContain('data-act="abrir-computador"');
    expect(html).toContain('data-assumir="1"');
    expect(html).not.toContain("Parei aqui até você responder");
    expect(html).not.toContain("Não envie senha");
  });
});

describe("o cartão da pergunta na conversa (tela E2)", () => {
  it("aberta: um cartão só — título, ×, lista A/B/C e 'Ou responda no chat abaixo'; a fala não sai também como balão", () => {
    const html = timeline(umaAberta(OPCOES, { recomendada: 0 }));
    expect(html).toContain('class="message bot pergunta"');
    expect(html).toContain('data-pergunta="d1"');
    expect(html).toContain('<div class="cartao-pergunta aberta" role="group" aria-labelledby="pq-t-d1" data-cartao-pergunta="d1" data-nome="Nina">');
    expect(html).toContain(`<div class="pq-titulo" id="pq-t-d1">${PERGUNTA}</div>`);
    expect(html.split(PERGUNTA).length - 1).toBe(1);
    expect(html).not.toContain('class="bubble"');
    expect(html).toContain('data-act="dispensar" data-id="d1" aria-label="Deixar a pergunta pra lá" title="Fecha sem responder; nada é retomado"');
    const letras = [...html.matchAll(/<span class="pq-letra" aria-hidden="true">([A-D])<\/span>/g)].map((m) => m[1]);
    expect(letras).toEqual(["A", "B", "C"]);
    expect(html).toContain('<button type="button" class="pq-opcao" data-act="responder-opcao" data-id="d1" data-texto="Mergear com o teste rodado na VM">');
    expect(html).toContain('<p class="pq-rodape">Ou responda no chat abaixo</p>');
    // Saiu tudo o que cercava a pergunta.
    for (const velho of ["Parei aqui até você responder", "ou responda com suas palavras", "Responder a esta", "vence ", "Preciso da sua decisão", "<input"]) expect(html, velho).not.toContain(velho);
    expect(renderDecisoesDaConversa(umaAberta(), "c", new Set())).toBe("");
  });

  it("'Recomendo' só na A e só com recomendada: 0; o leitor de tela ouve ', recomendada' e não a letra", () => {
    const com = timeline(umaAberta(OPCOES, { recomendada: 0 }));
    expect(com.match(/class="pq-recomendo"/g)).toHaveLength(1);
    const a = com.slice(com.indexOf('data-texto="Mergear'), com.indexOf('data-texto="Reapontar'));
    expect(a).toContain('<span class="pq-recomendo" aria-hidden="true">Recomendo</span><span class="sr-only">, recomendada</span>');
    // Payload antigo (sem recomendada): sem etiqueta, ordem como veio.
    const sem = timeline(umaAberta());
    expect(sem).not.toContain("Recomendo");
    expect(sem.indexOf("Mergear")).toBeLessThan(sem.indexOf("Reapontar"));
  });

  it("sem opções: 'Responda no chat abaixo', sem lista; opções e textos escapados", () => {
    const html = timeline(cenario([fala("m1", "d1", PERGUNTA)], [item("d1")]));
    expect(html).not.toContain("pq-lista");
    expect(html).toContain('<p class="pq-rodape">Responda no chat abaixo</p>');
    const perigosa = timeline(umaAberta(["Não, deixe <aberto>"]));
    expect(perigosa).toContain("Não, deixe &lt;aberto&gt;");
    expect(perigosa).not.toContain("<aberto>");
  });

  // QA do PR #389 (2026-10-18): o título passou a ser texto escapado e o link da pergunta deixou de ser clicável. Volta pelo
  // mesmo textoFormatado do balão comum: link com chip/rótulo, HTML do modelo continua texto, `javascript:` não vira link.
  it("links no texto da pergunta são clicáveis, com o tratamento seguro do balão comum (na conversa e em 'Sua vez')", () => {
    const texto = "Posso mergear https://github.com/gamefik/nod/pull/7? Veja o [plano](https://example.com/plano). <img src=x onerror=alert(1)> [x](javascript:alert(1))";
    const e = cenario([fala("m1", "d1", texto, OPCOES)], [item("d1", { frase: texto, pedido: { texto, opcoes: OPCOES, origem: "conversa" } })]);
    for (const html of [timeline(e), renderSuaVez(e)]) {
      const titulo = html.slice(html.indexOf('<div class="pq-titulo"'), html.indexOf('class="pq-lista"'));
      expect(titulo).toContain('href="https://github.com/gamefik/nod/pull/7"');
      expect(titulo).toContain('<a class="lk" href="https://example.com/plano" data-lk target="_blank" rel="noopener noreferrer nofollow">plano</a>');
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).not.toContain('href="javascript:');
    }
  });

  it("enquanto ocupado as opções ficam desligadas (clique duplo não manda duas respostas)", () => {
    const e = { ...umaAberta(), ocupado: true };
    expect(timeline(e).match(/class="pq-opcao"[^>]* disabled>/g)).toHaveLength(3);
    expect(timeline(umaAberta())).not.toMatch(/class="pq-opcao"[^>]* disabled/);
  });

  it("aberto ANTES de 'Sua vez' carregar, pelo fio da conversa: as opções já estão lá (sem salto)", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, OPCOES)], null, [fio("d1", "esperando_voce", ["m1"])]);
    const html = timeline(e);
    expect(html).toContain('class="cartao-pergunta aberta"');
    expect(html.match(/class="pq-opcao"/g)).toHaveLength(3);
    // Sem fio e sem "Sua vez": nada é afirmado, o cartão fica só com o título.
    const nada = timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], null));
    expect(nada).toContain('class="cartao-pergunta encerrada"');
    expect(nada).not.toContain("pq-opcao");
  });

  it("a pergunta dirigida a outra pessoa (quem_destrava): a dona vê o cartão sem opções, 'Esperando a resposta de outra pessoa'", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, OPCOES)], [], [{ ...fio("d1", "esperando_voce", ["m1"]), decisorId: "ana" }]);
    const html = timeline(e);
    expect(html).toContain('<p class="pq-estado">Esperando a resposta de outra pessoa</p>');
    expect(html).not.toContain("pq-opcao");
    // Dirigida a mim: aberta.
    expect(timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], null, [{ ...fio("d1", "esperando_voce", ["m1"]), decisorId: "p" }]))).toContain('class="cartao-pergunta aberta"');
  });

  it("da 2ª rodada, a linha discreta '2ª rodada' no cartão", () => {
    const e = cenario([fala("m1", "d1", "Antes?"), fala("m2", "d2", PERGUNTA, OPCOES, AGORA - H)], [item("d2")], [{ id: "d1", agenteId: "a", estado: "esperando_voce", rodada: 2, decisoes: ["d1", "d2"], mensagens: ["m1", "m2"] }]);
    const html = timeline(e);
    expect(html.slice(html.indexOf('data-cartao-pergunta="d2"'))).toContain('<p class="pq-rodada">2ª rodada</p>');
  });
});

describe("depois de responder (tela S1)", () => {
  const perguntaEm = AGORA - 2 * H;
  const respondidaEm = AGORA - H;

  it("respondida por opção (via 'opcao'): o cartão encolhe para a escolhida com ✓ e o balão da pessoa NÃO sai", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, OPCOES, perguntaEm), resposta("r1", "d1", "Reapontar a pilha para a main", respondidaEm, perguntaEm, { via: "opcao", opcao: 1 })], [], [fio("d1", "resolvida", ["m1", "r1"])]);
    const html = timeline(e);
    expect(html).toContain('class="cartao-pergunta respondida"');
    expect(html).toContain('<div class="pq-escolhida"><span class="pq-rotulo">Reapontar a pilha para a main</span><svg class="pq-check"');
    expect(html).not.toContain('data-mensagem="r1"');
    expect(html).not.toContain("pq-opcao");
    expect(html).not.toContain("data-act=\"dispensar\"");
    expect(html).not.toContain("respondendo à pergunta das");
    // Fio de uma rodada resolvido: o cartão encolhido fica à vista, sem recolher em "Pergunta resolvida".
    expect(html).not.toContain("fio-resolvido");
  });

  it("payload antigo (sem via): o texto igual a uma opção, sem diferença de espaços e caixa, marca a opção", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, OPCOES, perguntaEm), resposta("r1", "d1", "  tentar MAIS uma vez", respondidaEm, perguntaEm)], []);
    const html = timeline(e);
    expect(html).toContain('<span class="pq-rotulo">Tentar mais uma vez</span><svg class="pq-check"');
    expect(html).not.toContain('data-mensagem="r1"');
  });

  it("respondida com outras palavras: o cartão diz 'Respondida por você · HH:MM' e a fala da pessoa fica, com o rótulo de hoje", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, OPCOES, perguntaEm), resposta("r1", "d1", "Tenta de novo com o cache limpo", respondidaEm, perguntaEm, { via: "texto" })], []);
    const html = timeline(e);
    expect(html).toContain(`<p class="pq-estado"><span class="pq-ok" aria-hidden="true">✓</span>Respondida por você · ${hora(respondidaEm)}</p>`);
    expect(html).toContain('data-mensagem="r1"');
    expect(html).toContain(`respondendo à pergunta das ${hora(perguntaEm)}`);
    expect(html).toContain("Nina retomou com a sua resposta");
    expect(html).not.toContain("pq-escolhida");
    // Via "texto" ganha da comparação: a resposta igual a uma opção digitada depois de outra coisa não vira ✓.
    const viaTexto = cenario([fala("m1", "d1", PERGUNTA, OPCOES, perguntaEm), resposta("r1", "d1", "Tentar mais uma vez", respondidaEm, perguntaEm, { via: "texto" })], []);
    expect(timeline(viaTexto)).not.toContain("pq-escolhida");
  });

  it("vencida: 'Sem resposta · …' com Reabrir, apagada; deixada pra lá: 'Deixada pra lá'; nenhuma opção clicável fora de aberta", () => {
    const vencida = timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], [item("d1", { vencido: true })]));
    expect(vencida).toContain('class="cartao-pergunta vencida"');
    expect(vencida).toContain("Sem resposta · venceu há 3h · ninguém chegou a ver");
    expect(vencida).toContain('data-act="reabrir" data-id="d1"');
    expect(vencida).not.toContain("pq-opcao");
    // Pelo fio, antes de "Sua vez": vencida também, com Reabrir.
    expect(timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], null, [fio("d1", "vencida", ["m1"])]))).toContain('data-act="reabrir" data-id="d1"');
    // Reaberta: "Sua vez" relida já diz aberta enquanto o fio da conversa ainda diz vencida — o cartão volta a abrir.
    const reaberta = timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], [item("d1")], [fio("d1", "vencida", ["m1"])]));
    expect(reaberta).toContain('class="cartao-pergunta aberta"');
    expect(reaberta).not.toContain('data-act="reabrir"');
    const deixada = timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], [], [fio("d1", "deixada_pra_la", ["m1"])]));
    expect(deixada).toContain('class="cartao-pergunta deixada"');
    expect(deixada).toContain('<p class="pq-estado">Deixada pra lá</p>');
    expect(deixada).not.toContain("pq-opcao");
  });
});

describe("o pedido de ajuda do computador", () => {
  it("leva 'Assumir controle', sem 'Ou responda no chat abaixo'; com ele aberto, a mensagem digitada vai como mensagem comum", () => {
    const e = cenario([fala("m1", "d1", "Abra meu computador para concluir este passo.", undefined, AGORA - 2 * H, { ajudaDoComputador: true })], [item("d1")]);
    const html = timeline(e);
    expect(html).toContain('data-act="abrir-computador" data-id="a">Assumir controle</button>');
    expect(html).not.toContain("responda no chat");
    expect(modoDoComposer(e, "c").tipo).toBe("normal");
    expect(destinoDoEnvio(modoDoComposer(e, "c"))).toEqual({ tipo: "mensagem" });
    // Sem o balão na conversa, o que "Sua vez" trouxe do balão decide.
    const fora = cenario([], [item("d1", { pedido: { texto: "Abra meu computador.", ajudaDoComputador: true, origem: "conversa" } })]);
    expect(modoDoComposer(fora, "c").tipo).toBe("normal");
  });
});

describe("o campo com pergunta aberta", () => {
  it("uma aberta: nada acima do campo, o campo não muda — e a mensagem digitada responde (decisão 1)", () => {
    const e = umaAberta();
    const modo = modoDoComposer(e, "c");
    expect(modo.tipo === "resposta" && modo.alvo.decisao.id).toBe("d1");
    expect(aparenciaDoComposer(modo, e, PADRAO, "c")).toEqual({ topo: "", placeholder: PADRAO.placeholder, nota: PADRAO.nota });
    expect(destinoDoEnvio(modo)).toEqual({ tipo: "resposta", decisaoId: "d1" });
    const html = htmlComposer("x", [], { anexos: "tudo" });
    expect(html).toContain('id="composer-pergunta"');
    expect(html).toContain('<p class="nota" id="composer-nota" data-padrao=""></p>');
    for (const opcoes of [{ anexos: "tudo" as const, comandos: true }, {}]) {
      const campo = htmlComposer("x", ["Vera"], opcoes);
      for (const dica of ["@ menciona um bot", "/ para comandos", "arraste ou cole", "Enter envia"]) expect(campo).not.toContain(dica);
    }
  });

  it("letra sozinha ('A', 'b', 'B.', 'c)') vira o texto da opção; letra além do total e frase com letra vão como digitadas", () => {
    expect(textoDaLetra("A", OPCOES)).toBe(OPCOES[0]);
    expect(textoDaLetra(" b ", OPCOES)).toBe(OPCOES[1]);
    expect(textoDaLetra("B.", OPCOES)).toBe(OPCOES[1]);
    expect(textoDaLetra("c)", OPCOES)).toBe(OPCOES[2]);
    expect(textoDaLetra("D", OPCOES)).toBe("D");
    expect(textoDaLetra("a sim", OPCOES)).toBe("a sim");
    expect(textoDaLetra("E", OPCOES)).toBe("E");
    expect(textoDaLetra("A", [])).toBe("A");
  });

  it("anexo com pergunta aberta vai como mensagem comum, e a pergunta segue aberta (decisão 9)", async () => {
    const e = umaAberta();
    expect(destinoDoEnvio(modoDoComposer(e, "c"), true)).toEqual({ tipo: "mensagem" });
    const api = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    // Mesmo se alguém chamar com destino resposta e anexo, nada some: vai como mensagem comum.
    const r = await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "resposta", decisaoId: "d1" }, "segue o print", ["an1"]);
    expect(r).toEqual({ enviado: "mensagem" });
    expect(api.enviar).toHaveBeenCalledWith("c", "segue o print", ["an1"]);
    expect(api.responder).not.toHaveBeenCalled();
  });

  it("em modo resposta o envio chama POST decisoes/:id/responder; sem pergunta, o envio normal; sala pela sala", async () => {
    const api = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    const r = await enviarPeloComposer(api, { conversaId: "c", salaId: null }, destinoDoEnvio(modoDoComposer(umaAberta(), "c")), "Tentar mais uma vez");
    expect(r).toEqual({ enviado: "resposta" });
    expect(api.responder).toHaveBeenCalledWith("d1", "Tentar mais uma vez");
    await enviarPeloComposer(api, { conversaId: "c", salaId: "s1" }, destinoDoEnvio(modoDoComposer(cenario([], []), "c")), "oi, sala");
    expect(api.postarNaSala).toHaveBeenCalledWith("s1", "oi, sala");
    expect(api.enviar).not.toHaveBeenCalled();
  });
});

describe("duas perguntas abertas: a caixa 'Respondendo' (Parte 3a, tela S2)", () => {
  const duas = (): Estado => cenario(
    [fala("m1", "d1", "O #845 não fica verde. Como sigo?", OPCOES, AGORA - 3 * H), fala("m2", "d2", "Posso apagar a branch b14-rascunho? Ela já está toda no #845.", ["Pode apagar", "Deixa ela"], AGORA - H)],
    [item("d2", { criadoEm: AGORA - H }), item("d1", { criadoEm: AGORA - 3 * H })],
  );

  it("aponta para a MAIS RECENTE, com 'Trocar' e o × que manda como assunto novo; só ela diz 'Ou responda no chat abaixo'", () => {
    const e = duas();
    const modo = modoDoComposer(e, "c");
    expect(modo.tipo === "resposta" && modo.alvo.decisao.id).toBe("d2");
    const topo = renderTopoComposer(modo, e, "c");
    expect(topo).toContain('<div class="caixa-respondendo" role="group" aria-label="A próxima mensagem responde a esta pergunta">');
    // Só "Respondendo", como na tela S2 (QA do PR #389, 2026-10-18): sem "· N de M".
    expect(topo).toContain('<div class="rp-txt"><span class="rp-rotulo">Respondendo</span><span class="rp-trecho"');
    expect(topo).not.toMatch(/\d de \d/);
    expect(topo).toContain("Posso apagar a branch b14-rascunho?");
    expect(topo).toContain('data-act="composer-trocar"');
    expect(topo).toContain('data-act="composer-outro" aria-label="Cancelar a resposta e mandar como mensagem comum"');
    const html = timeline(e);
    expect(html.match(/class="pq-rodape"/g)).toHaveLength(1);
    expect(html.slice(html.indexOf('data-cartao-pergunta="d2"'))).toContain("Ou responda no chat abaixo");
    // Saíram a citação "1 de 2" antiga, o seletor e o "Responder a esta".
    for (const velho of ["citacao-pergunta", "modo-envio", "Responder a esta", "Responder à pergunta"]) expect(topo + html, velho).not.toContain(velho);
  });

  // Regressão (QA do PR #389, 2026-10-18): a caixa usava a classe `.respondendo`, que já é a da MENSAGEM da pessoa que
  // respondeu a uma pergunta (web/telas/conversa.ts); o CSS da caixa pintava essa mensagem de cinza, com padding e flex.
  it("o CSS da caixa não pega a mensagem que respondeu (.message.respondendo)", () => {
    const css = ["interface.css", "mobile.css", "estilos.css"].map((f) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8")).join("\n");
    expect(css).not.toMatch(/(^|[\s,}])\.respondendo[\s{.:,]/m);
    expect(css).toContain(".caixa-respondendo {");
  });

  it("'Trocar' passa à outra (dando a volta); o × manda mensagem comum, a pergunta segue aberta e o rodapé some dos cartões", () => {
    const e = duas();
    const proxima = proximaDoComposer(modoDoComposer(e, "c"));
    expect(proxima).toBe("d1");
    const trocada = reduzir(e, { tipo: "composer", conversaId: "c", escolha: { outroAssunto: false, alvoId: proxima } });
    const modo = modoDoComposer(trocada, "c");
    expect(modo.tipo === "resposta" && modo.alvo.decisao.id).toBe("d1");
    expect(renderTopoComposer(modo, trocada, "c")).toContain("O #845 não fica verde. Como sigo?");
    expect(proximaDoComposer(modo)).toBe("d2");
    const outro = reduzir(e, { tipo: "composer", conversaId: "c", escolha: { outroAssunto: true, alvoId: null } });
    expect(destinoDoEnvio(modoDoComposer(outro, "c"))).toEqual({ tipo: "mensagem" });
    expect(renderTopoComposer(modoDoComposer(outro, "c"), outro, "c")).toBe("");
    expect(timeline(outro)).not.toContain("pq-rodape");
    // Uma das duas respondida depois do ×: sobra uma, a caixa some — e o "outro assunto" deixa de valer em silêncio.
    const sobrouUma = reduzir(outro, { tipo: "hidratar-sua-vez", suaVez: { itens: [item("d2", { criadoEm: AGORA - H })], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });
    expect(destinoDoEnvio(modoDoComposer(sobrouUma, "c"))).toEqual({ tipo: "resposta", decisaoId: "d2" });
    // A escolha só vale enquanto a conversa tem pergunta: sem ela, "Sua vez" relida esquece a escolha.
    const semPergunta = reduzir(outro, { tipo: "hidratar-sua-vez", suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null } });
    expect(semPergunta.composer.c).toBeUndefined();
    // Com uma só, não há caixa nem "Trocar".
    expect(proximaDoComposer(modoDoComposer(umaAberta(), "c"))).toBeNull();
  });
});

describe("a pílula da pergunta fora da tela (tela S3)", () => {
  it("'Nina perguntou algo ↓' leva à pergunta; ganha da pílula das novas; visível ou sem cartão, nada", () => {
    const html = pilulaDaPergunta({ decisaoId: "d1", nome: "Nina", posicao: "abaixo" });
    expect(html).toContain('data-act="ver-pergunta" data-id="d1"');
    expect(html).toContain("<span>Nina perguntou algo</span>");
    expect(html).toContain('d="M8 3v10');
    expect(pilulaDaPergunta({ decisaoId: "d1", nome: "Nina", posicao: "acima" })).toContain('d="M8 13V3');
    expect(pilulaDaPergunta({ decisaoId: "d1", nome: "Nina", posicao: "visivel" })).toBe("");
    expect(pilulaDaPergunta(null)).toBe("");
    expect(pilulaDasNovas(null)).toBe("");
  });
});

describe("a régua do ✓ é a mesma do servidor (espelho de src/domain/opcoes-da-pergunta.ts)", () => {
  it("indiceDaOpcao e opcaoRespondida concordam nos mesmos casos", () => {
    const casos: [string, string[] | undefined][] = [["Reapontar a pilha para a main", OPCOES], ["  tentar MAIS  uma vez ", OPCOES], ["outra coisa", OPCOES], ["", OPCOES], ["Sim", undefined], ["Sim", []], ["NÃO", ["Sim", "não"]]];
    for (const [resposta, opcoes] of casos) expect(indiceDaOpcao(resposta, opcoes), resposta).toBe(opcaoRespondida(resposta, opcoes));
  });
});

describe("'Sua vez' com o cartão (Parte 4, tela S4)", () => {
  it("cabeçalho com avatar, nome, 'há N', a origem e 'Abrir conversa'; o mesmo cartão clicável; sem âmbar, sem 'vence em'", () => {
    const e = cenario([], [item("d1", { pedido: { texto: PERGUNTA, opcoes: OPCOES, recomendada: 0, origem: "rotina" } })]);
    const html = renderSuaVez(e);
    expect(html).toContain('<li class="item-pergunta dec-pendente" data-decisao="d1">');
    expect(html).toContain("<b>Nina</b> há 2h · rotina");
    // "Abrir conversa" abre com o campo apontando para esta pergunta (responder-na-conversa).
    expect(html).toMatch(/data-act="responder-na-conversa" data-id="d1" data-conversa="c" data-agente="a">Abrir conversa<\/button>/);
    expect(html).toContain('class="cartao-pergunta aberta"');
    expect(html.match(/data-act="responder-opcao" data-id="d1"/g)).toHaveLength(3);
    expect(html).toContain("Recomendo");
    expect(html).toContain('data-act="dispensar" data-id="d1"');
    for (const velho of ["tag-ambar", "vence ", "Responder na conversa", "pq-rodape", "<input"]) expect(html, velho).not.toContain(velho);
  });

  it("sem opções: o campo de resposta dentro do cartão, para todas; a origem 'pedido de outro bot'; '2ª rodada' ao lado de 'Abrir conversa'", () => {
    const e = cenario([], [item("d1", { pedido: { texto: "Qual é o processo de lançamento do gamefik? Pode ser um link ou duas linhas.", origem: "peer" }, fio: { id: "d0", rodada: 2 } })]);
    const html = renderSuaVez(e);
    expect(html).toContain("Qual é o processo de lançamento do gamefik?");
    expect(html).toContain('<div class="pq-campo"><input class="resposta" data-resposta="d1" placeholder="Responder à Nina" aria-label="Sua resposta" autocomplete="off" />');
    expect(html).toContain('data-act="responder" data-id="d1"');
    // O envio é o ↑ redondo da tela S4 (QA do PR #389), com nome para o leitor de tela.
    expect(html).toMatch(/<button type="button" class="bt pri pq-enviar" data-act="responder" data-id="d1" title="Enviar" aria-label="Enviar resposta"><svg [^>]*aria-hidden="true">/);
    expect(html).not.toContain(">Enviar</button>");
    expect(html).toContain("· pedido de outro bot");
    expect(html).toContain('<span class="sv-rodada">2ª rodada</span>');
    expect(html).not.toContain("pq-rodada");
  });

  it("sem balão legível (decisora que não é dona, sala esfriada, pergunta antiga): a frase e o campo; a decisora não vê 'Abrir conversa'", () => {
    const deOutra = item("d9", { ownerId: "outra-pessoa", pedido: null, frase: "Posso usar a paleta nova no onboarding?" });
    const html = renderSuaVez(cenario([], [deOutra]));
    expect(html).toContain("Posso usar a paleta nova no onboarding?");
    expect(html).toContain('data-resposta="d9"');
    expect(html).not.toContain("pq-opcao");
    expect(html).not.toContain("Abrir conversa");
    // A frase antiga com o molde "parei para perguntar a X:" sai sem ele.
    const antiga = renderSuaVez(cenario([], [item("d1", { frase: "parei para perguntar a Marlon: Continuo o backlog?" })]));
    expect(antiga).toContain("Continuo o backlog?");
    expect(antiga).not.toContain("parei para perguntar");
  });

  it("o pedido de ajuda do computador em 'Sua vez' leva 'Assumir controle', nunca o campo de texto", () => {
    const html = renderSuaVez(cenario([], [item("d1", { pedido: { texto: "Abra meu computador.", ajudaDoComputador: true, origem: "conversa" } })]));
    expect(html).toContain("Assumir controle");
    expect(html).not.toContain("<input");
  });

  it("vencida, entre as vencidas recolhidas: o cartão apagado com 'Sem resposta', o Reabrir e o × que tira da tela", () => {
    const html = renderSuaVez(cenario([], [item("d1", { vencido: true, pedido: { texto: PERGUNTA, opcoes: OPCOES, origem: null } })]));
    expect(html).toContain('class="cartao-pergunta vencida"');
    expect(html).toContain('data-act="reabrir" data-id="d1"');
    expect(html).not.toContain("pq-opcao");
    // Sozinha, a vencida não tem "Limpar vencidos": o × do cartão é o único jeito de tirá-la da fila.
    expect(html).not.toContain("limpar-vencidos");
    expect(html).toContain('data-act="dispensar" data-id="d1" aria-label="Tirar a pergunta vencida da tela"');
    // Na conversa a vencida segue sem ×: lá ela é histórico, com o Reabrir.
    expect(timeline(cenario([fala("m1", "d1", PERGUNTA, OPCOES)], [item("d1", { vencido: true })]))).not.toContain('data-act="dispensar"');
  });
});

describe("pergunta das voltas fechada pela regra (review de design do #342)", () => {
  const dasVoltas = (): Mensagem => ({ ...fala("m1", "d1", "Nada novo desde a última volta. Continuo de olho?"), autoria: { ...autoria, decidido_por: "regra:voltas_sem_novidade" } });

  it("conversa sem rotina (task, delegação, espera de CI): só 'Fechada sem resposta', sem falar de rotina", () => {
    const html = timeline(cenario([dasVoltas()], []));
    expect(html).toContain('<p class="pq-estado">Fechada sem resposta</p>');
    expect(html).not.toContain("rotina");
    const daDelegacao = { ...dasVoltas(), origemTurno: "retomada" as const, raiz: { turnoId: "t0", origem: "delegacao" as const } };
    expect(timeline(cenario([daDelegacao], []))).not.toContain("rotina");
  });

  it("cadeia de rotina (pela raiz ou pela origem do turno): 'Fechada sem resposta · a rotina segue na próxima janela'", () => {
    const pelaRaiz = { ...dasVoltas(), origemTurno: "retomada" as const, raiz: { turnoId: "t0", origem: "rotina" as const } };
    expect(timeline(cenario([pelaRaiz], []))).toContain("Fechada sem resposta · a rotina segue na próxima janela");
    const peloTurno = { ...dasVoltas(), origemTurno: "rotina" as const };
    expect(timeline(cenario([peloTurno], []))).toContain("Fechada sem resposta · a rotina segue na próxima janela");
  });

  it("aberta, é o cartão aberto; sem 'Sua vez' carregada, nada é afirmado; outra pergunta encerrada continua calada", () => {
    expect(timeline(cenario([dasVoltas()], [item("d1")]))).toContain('class="cartao-pergunta aberta"');
    expect(timeline({ ...cenario([dasVoltas()], []), suaVez: null })).not.toContain("Fechada sem resposta");
    expect(timeline(cenario([fala("m1", "d1", PERGUNTA)], []))).not.toContain("Fechada sem resposta");
  });
});
