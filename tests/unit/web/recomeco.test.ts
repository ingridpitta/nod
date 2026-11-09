import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { interpretarFrame } from "../../../web/lib/live-events.ts";
import { alternarExplicacao, alvosDoRecomeco, detailsParaFecharComEsc, marcaDoRecomeco, notaDasEtapas } from "../../../web/lib/recomeco.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { cartaoTrocaDeIa, linhaContaTrocada, linhaIaTrocada } from "../../../web/telas/ia-fora.ts";

/** NOD-312: a carona "· relê o necessário", a marca "↺ recomeçou" e os ícones em SVG (protótipo v3, 2aaf3d2). */
const AGORA = Date.parse("2026-10-28T12:00:00Z");
const doBot = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...doBot, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;

let seq = 0;
function msg(extra: Partial<Mensagem>): Mensagem {
  seq += 1;
  return { tenantId: "t", id: `m${seq}`, conversaId: "c", turnoId: "t1", autoria: doBot, kind: "texto", texto: "ok", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000 + seq, ...extra };
}
const pessoa = (texto = "faz isso"): Mensagem => msg({ autoria: daPessoa, texto, turnoId: null });
const contaTrocada = (): Mensagem => msg({ kind: "sistema", texto: "Conta 1 do Claude Code no limite até 14:00. Seguindo com a conta 2.", payload: { kind: "conta_trocada" } as never });
const iaTrocada = (): Mensagem => msg({ kind: "sistema", texto: "", payload: { kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite" } as never });
const fala = (motivo?: Mensagem["motivoRecomeco"], turnoId = "t2"): Mensagem => msg({ turnoId, texto: "Pronto.", ...(motivo ? { motivoRecomeco: motivo } : {}) });

const ze = { id: "a", tenantId: "t", ownerId: "p", nome: "Gil", titulo: "", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;
function cenario(mensagens: Mensagem[]): Estado {
  const c = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], reacoes: [], carregadaEm: 0 } as ConversaEstado;
  return { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: { tipo: "conversa", conversaId: "c", agenteId: "a" }, frota: { agentes: [ze], inventario: null, negacoes: [] } as never, conversas: { c } };
}
const timeline = (ms: Mensagem[]): string => renderTimeline(cenario(ms).conversas.c ?? null, cenario(ms));

describe("alvosDoRecomeco: onde vão a carona e a marca", () => {
  it("troca de conta com linha: a carona vai na linha, nada na fala", () => {
    const linha = contaTrocada();
    const f = fala("troca_de_conta");
    const alvos = alvosDoRecomeco([pessoa(), linha, f], () => "Gil");
    expect([...alvos.entries()]).toEqual([[linha.id, { tipo: "carona", motivo: "troca_de_conta", nomeDoBot: "Gil" }]]);
  });

  it("encadeado (conta e IA no mesmo pedido): uma carona só, na linha da troca de IA", () => {
    const conta = contaTrocada();
    const ia = iaTrocada();
    const alvos = alvosDoRecomeco([pessoa(), conta, ia, fala("troca_de_ia")]);
    expect([...alvos.keys()]).toEqual([ia.id]);
  });

  it("sessão recusada e troca de máquina, sem linha: a marca na 1ª fala do turno, uma vez", () => {
    const f1 = fala("sessao_recusada", "t9");
    const f2 = fala("sessao_recusada", "t9");
    expect([...alvosDoRecomeco([pessoa(), f1, f2]).entries()]).toEqual([[f1.id, { tipo: "marca", motivo: "sessao_recusada", nomeDoBot: null }]]);
    const f3 = fala("troca_de_maquina", "t10");
    expect(alvosDoRecomeco([pessoa(), f3]).get(f3.id)?.tipo).toBe("marca");
  });
  it("motivo que a web não conhece (servidor mais novo): nenhuma marca, nada de 'undefined' (revisão 8)", () => {
    const f = fala("troca_de_galaxia" as never, "t11");
    expect(alvosDoRecomeco([pessoa(), f]).size).toBe(0);
  });

  it("QA: a linha de troca de antes da fala da pessoa não pega carona (a busca para na fala da pessoa)", () => {
    const velha = contaTrocada();
    const f = fala("troca_de_conta", "t30");
    const alvos = alvosDoRecomeco([velha, pessoa(), f]);
    expect([...alvos.entries()]).toEqual([[f.id, { tipo: "marca", motivo: "troca_de_conta", nomeDoBot: null }]]);
  });

  it("QA: a linha de troca de antes de outra fala do bot não pega carona (a busca para na fala do bot)", () => {
    const velha = contaTrocada();
    const f = fala("troca_de_conta", "t31");
    const alvos = alvosDoRecomeco([pessoa(), velha, fala(undefined, "t29"), f]);
    expect([...alvos.entries()]).toEqual([[f.id, { tipo: "marca", motivo: "troca_de_conta", nomeDoBot: null }]]);
  });

  it("QA: fala da pessoa ou linha de sistema com motivo (dado estranho) nunca recebem a marca", () => {
    const p = msg({ autoria: daPessoa, texto: "oi", turnoId: null, motivoRecomeco: "sessao_recusada" });
    const s = msg({ kind: "sistema", texto: "x", payload: null, motivoRecomeco: "sessao_recusada" });
    expect(alvosDoRecomeco([p, s]).size).toBe(0);
  });

  it("troca de conta ou de IA sem linha (a IA que volta sozinha não deixa linha): a marca na fala", () => {
    const f1 = fala("troca_de_conta", "t20");
    expect(alvosDoRecomeco([pessoa(), f1]).get(f1.id)?.tipo).toBe("marca");
    const f2 = fala("troca_de_ia", "t21");
    expect(alvosDoRecomeco([pessoa(), f2]).get(f2.id)?.tipo).toBe("marca");
  });

  it("a linha de um pedido anterior não é reaproveitada: a busca para na fala da pessoa", () => {
    const antiga = contaTrocada();
    const f = fala("troca_de_conta");
    expect([...alvosDoRecomeco([pessoa(), antiga, fala(undefined, "t1"), pessoa("de novo"), f]).entries()]).toEqual([[f.id, { tipo: "marca", motivo: "troca_de_conta", nomeDoBot: null }]]);
  });

  it("cartão \"Uma IA só\" decidido é linha de troca: outra IA leva a carona da troca de IA; conta, a da troca de conta (revisão 2)", () => {
    const cartao = (decisao: string, contaDe: string | null = null): Mensagem => msg({ kind: "sistema", texto: "", payload: { kind: "troca_de_ia", agenteId: "a", iaDe: "claude-cli", iaPara: "codex-cli", tasks: 1, fixo: true, decisao, contaDe, voltaEm: null } as never });
    const outra = cartao("outra_ia");
    expect([...alvosDoRecomeco([pessoa(), outra, fala("troca_de_ia", "t30")]).keys()]).toEqual([outra.id]);
    const conta = cartao("conta");
    expect([...alvosDoRecomeco([pessoa(), conta, fala("troca_de_conta", "t31")]).keys()]).toEqual([conta.id]);
    const levouConta = cartao("levar", "c1");
    expect([...alvosDoRecomeco([pessoa(), levouConta, fala("troca_de_conta", "t32")]).keys()]).toEqual([levouConta.id]);
    const esperou = cartao("esperar");
    const f = fala("troca_de_ia", "t33");
    expect([...alvosDoRecomeco([pessoa(), esperou, f]).keys()]).toEqual([f.id]);
  });

  it("a carona só vai na linha que descreve o motivo; senão, a marca (revisão 2)", () => {
    const conta = contaTrocada();
    const f1 = fala("troca_de_maquina", "t40");
    expect(alvosDoRecomeco([pessoa(), conta, f1]).get(f1.id)?.tipo).toBe("marca");
    const ia = iaTrocada();
    const f2 = fala("troca_de_conta", "t41");
    expect([...alvosDoRecomeco([pessoa(), ia, f2]).entries()]).toEqual([[f2.id, { tipo: "marca", motivo: "troca_de_conta", nomeDoBot: null }]]);
    const f3 = fala("sessao_recusada", "t42");
    expect(alvosDoRecomeco([pessoa(), contaTrocada(), f3]).get(f3.id)?.tipo).toBe("marca");
    // A conta que seguiu noutra IA: a troca de IA pega carona na linha de conta.
    const seguiu = msg({ kind: "sistema", texto: "Seguindo no ChatGPT.", payload: { kind: "conta_seguiu" } as never });
    expect([...alvosDoRecomeco([pessoa(), seguiu, fala("troca_de_ia", "t43")]).keys()]).toEqual([seguiu.id]);
  });

  it("turno sem motivo (servidor antigo ou retomada): nada", () => {
    expect(alvosDoRecomeco([pessoa(), contaTrocada(), fala()]).size).toBe(0);
  });
});

describe("o chat: carona, marca e ícones", () => {
  it("a linha da troca de conta leva a carona clicável, com aria e a explicação fechada logo abaixo", () => {
    const linha = contaTrocada();
    const html = timeline([pessoa(), linha, fala("troca_de_conta")]);
    expect(html).toContain('class="linha-link p312-carona" data-act="recomeco-explicar"');
    expect(html).toContain(`aria-controls="recomeco-explica-${linha.id}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(new RegExp(`id="recomeco-explica-${linha.id}" role="region" aria-label="Por que reler\\?" hidden`));
    expect(html).toContain("A outra conta não traz o que Gil já leu e testou nesta conversa.");
    // A carona não leva o nome do bot (decisão da Ada): "· relê o necessário".
    expect(html).toContain(">relê o necessário</button>");
  });

  it("aberta, a explicação sai sem hidden e o botão com aria-expanded=true (sobrevive ao re-render)", () => {
    const linha = contaTrocada();
    alternarExplicacao(linha.id, true);
    const html = timeline([pessoa(), linha, fala("troca_de_conta")]);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(new RegExp(`id="recomeco-explica-${linha.id}"[^>]*hidden`));
    alternarExplicacao(linha.id, false);
  });

  it("a fala de sessão recusada leva a marca ao lado da hora, e a explicação abaixo do nome", () => {
    const f = fala("sessao_recusada");
    const html = timeline([pessoa(), f]);
    expect(html).toMatch(/<time>[^<]*<\/time><button type="button" class="p312-marca"/);
    expect(html).toContain('aria-label="recomeçou: Gil não continuou de onde parou. Ver por quê"');
    expect(html).toContain("<b>Gil recomeçou</b>");
    expect(html).toContain('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5"/>');
  });

  it("sem recomeço, nada novo: nem carona, nem marca (e o ↻ da linha é SVG, não caractere)", () => {
    const html = timeline([pessoa(), contaTrocada(), fala()]);
    expect(html).not.toContain("p312-carona");
    expect(html).not.toContain("p312-marca");
    expect(html).not.toContain("↻");
    expect(html).toContain('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5"/>');
  });

  it("a linha sozinha (fora da timeline) segue como hoje, sem carona", () => {
    const html = linhaContaTrocada(contaTrocada()) ?? "";
    expect(html).not.toContain("p312-carona");
    expect(html).not.toContain("p312-explica");
    expect(html).toContain('stroke-width="1.6"');
  });

  it("o desfecho do cartão \"Uma IA só\" leva a carona clicável e a explicação (revisão 2)", () => {
    const cartao = msg({ kind: "sistema", texto: "", payload: { kind: "troca_de_ia", agenteId: "a", iaDe: "claude-cli", iaPara: "codex-cli", tasks: 1, fixo: true, decisao: "outra_ia", contaDe: null, voltaEm: null } as never });
    const html = cartaoTrocaDeIa(cartao, { nomeDoBot: "Gil", agora: AGORA, recomeco: { tipo: "carona", motivo: "troca_de_ia", nomeDoBot: "Gil" } }) ?? "";
    expect(html).toContain("O Gil segue no ChatGPT até o Claude voltar.");
    expect(html).toContain('class="linha-link p312-carona" data-act="recomeco-explicar"');
    expect(html).toContain("A outra IA não traz o que Gil já leu e testou nesta conversa.");
    expect(cartaoTrocaDeIa(cartao, { nomeDoBot: "Gil", agora: AGORA }) ?? "").not.toContain("p312-carona");
  });

  it("chat limpo (ADR-114): a linha de troca mora na Atividade, então a fala leva a marca (revisão 3)", () => {
    const comDestino = (m: Mensagem, destino: string): Mensagem => ({ ...m, destino } as Mensagem);
    const linha = comDestino(contaTrocada(), "atividade");
    const f = comDestino(fala("troca_de_conta", "t50"), "chat");
    const html = timeline([comDestino(pessoa(), "chat"), linha, f]);
    expect(html).not.toContain("p312-carona");
    expect(html).toContain('class="p312-marca"');
    const cartao = comDestino(msg({ kind: "sistema", texto: "", payload: { kind: "troca_de_ia", agenteId: "a", iaDe: "claude-cli", iaPara: "codex-cli", tasks: 1, fixo: true, decisao: "outra_ia", contaDe: null, voltaEm: null } as never }), "chat");
    const f2 = comDestino(fala("troca_de_ia", "t51"), "chat");
    const html2 = timeline([comDestino(pessoa(), "chat"), cartao, f2]);
    expect(html2).not.toContain("p312-carona");
    expect(html2).toContain('class="p312-marca"');
    // A linha que fica no chat (servidor que ainda a manda para o chat) segue com a carona.
    const visivel = comDestino(contaTrocada(), "chat");
    expect(timeline([comDestino(pessoa(), "chat"), visivel, comDestino(fala("troca_de_conta", "t52"), "chat")])).toContain("p312-carona");
  });

  it("o separador e a carona não se separam na quebra (QA: o · não fica órfão no fim da linha)", () => {
    expect(timeline([pessoa(), contaTrocada(), fala("troca_de_conta")])).toContain('<span class="p312-junto"><span class="p312-sep" aria-hidden="true">·</span>&nbsp;<button type="button" class="linha-link p312-carona"');
    const ia = linhaIaTrocada(iaTrocada(), { recomeco: { tipo: "carona", motivo: "troca_de_ia", nomeDoBot: "Gil" } }) ?? "";
    expect(ia).toContain('<span class="p312-junto"><span class="p312-sep" aria-hidden="true">·</span>&nbsp;<span class="p312-carona-txt">');
  });

  it("QA: Esc na linha da troca de IA aberta com a carona fecha o details (e só ele)", () => {
    type No = { tagName: string; open?: boolean; achar: Record<string, No | null> };
    const el = (tagName: string, achar: Record<string, No | null> = {}, open?: boolean): No => ({ tagName, achar, ...(open === undefined ? {} : { open }) });
    const comCarona = el("DETAILS", { ".p312-carona-txt": el("SPAN") }, true);
    const semCarona = el("DETAILS", { ".p312-carona-txt": null }, true);
    const fechado = el("DETAILS", { ".p312-carona-txt": el("SPAN") }, false);
    const dentro = (d: No | null) => ({ closest: (s: string) => (s === "details.linha-ia-troca" ? d : null) });
    const q = (d: No) => Object.assign(d, { querySelector: (s: string) => d.achar[s] ?? null });
    expect(detailsParaFecharComEsc(dentro(q(comCarona)) as never)).toBe(comCarona);
    expect(detailsParaFecharComEsc(dentro(q(semCarona)) as never)).toBeNull();
    expect(detailsParaFecharComEsc(dentro(q(fechado)) as never)).toBeNull();
    expect(detailsParaFecharComEsc(dentro(null) as never)).toBeNull();
  });

  it("troca de IA: carona em texto no summary (sem botão aninhado) e a frase a mais no detalhe", () => {
    const ia = iaTrocada();
    const html = linhaIaTrocada(ia, { recomeco: { tipo: "carona", motivo: "troca_de_ia", nomeDoBot: "Gil" } }) ?? "";
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain('<span class="p312-carona-txt">relê o necessário</span>');
    expect(summary).not.toContain("<button");
    expect(html).toContain("O ChatGPT não traz o que Gil já leu e testou no Claude");
  });
});

describe("ao vivo: a nota do turno que recomeçou", () => {
  it("turno.iniciado com motivo_recomeco guarda o motivo no turno vivo; valor desconhecido é ignorado", () => {
    const frame = (motivo: unknown) => interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "turno.iniciado", dados: { kind: "turno_despachado", turnoId: "t2", conversaId: "c", motivo_recomeco: motivo } }));
    const f1 = frame("troca_de_conta");
    const f2 = frame("inventado");
    if (!f1 || !f2) throw new Error("frame não interpretado");
    expect(reduzir(cenario([]), { tipo: "frame", frame: f1, agora: AGORA }).turnosVivos.t2?.motivoRecomeco).toBe("troca_de_conta");
    expect(reduzir(cenario([]), { tipo: "frame", frame: f2, agora: AGORA }).turnosVivos.t2?.motivoRecomeco).toBeNull();
  });

  it("a nota diz quem recomeçou e que relê o necessário", () => {
    expect(notaDasEtapas("troca_de_conta", "Gil")).toBe('<p class="p312-etapa-nota">Gil recomeçou em outra conta e relê o necessário antes de seguir.</p>');
  });
});

describe("NOD-312: o nome do bot é escapado (revisão 5)", () => {
  it("a marca e a explicação nunca levam HTML do nome", () => {
    const nome = '<img src=x onerror="alert(1)">';
    for (const motivo of ["troca_de_ia", "troca_de_conta", "troca_de_maquina", "sessao_recusada"] as const) {
      const { marca, explicacao } = marcaDoRecomeco("m1", { tipo: "marca", motivo, nomeDoBot: nome });
      expect(marca + explicacao).not.toContain("<img");
      expect(explicacao).toContain("&lt;img");
    }
  });
});
