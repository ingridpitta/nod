import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { LIMITES_QUADRO } from "../../../src/contracts/quadro.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ACTS_COBERTOS, DESCRICAO_DA_TAREFA_MAX, htmlMenuSegurado, itensDoMenuSegurado, tarefaDaFala, TITULO_DA_TAREFA_MAX } from "../../../web/lib/menu-segurado-da-fala.ts";
import { acoesDaFala, htmlMenuDaFala, itensDoMenu } from "../../../web/telas/acoes-da-fala.ts";

/** ADA-2 F5 (ADR-156 §2 e §3): o menu do toque longo na mensagem e o "Criar tarefa disto". */
const AGORA = Date.parse("2026-11-07T14:02:00Z");
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...autoria, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;

function msg(id: string, texto: string, extra: Partial<Mensagem> = {}): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000, ...extra };
}
const ze = { id: "a", tenantId: "t", ownerId: "p", nome: "Ze 2", titulo: "", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;
function cenario(mensagens: Mensagem[], p: { modoDev?: boolean; tela?: Estado["tela"] } = {}): Estado {
  const conversa = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], reacoes: [], carregadaEm: 0 } as ConversaEstado;
  return { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, tela: p.tela ?? { tipo: "conversa", conversaId: "c", agenteId: "a" }, frota: { agentes: [ze], inventario: null, negacoes: [] } as never, conversas: { c: conversa }, modoDev: { ligado: p.modoDev === true, raioX: {} } };
}
const acoes = (itens: ReturnType<typeof itensDoMenuSegurado>): string[] => itens.map((i) => ("divisor" in i ? "—" : i.acao));
const BOT = msg("m1", "Fechei o PR 481 e abri a issue de follow-up para o cache dos convites.");

describe("itensDoMenuSegurado: o menu do toque longo", () => {
  it("fala do bot com quadro: Responder, Copiar, Criar tarefa disto; divisor; o resto do ⋯ e Reportar", () => {
    const itens = itensDoMenuSegurado(BOT, cenario([BOT]), true);
    expect(acoes(itens)).toEqual(["responder", "copiar", "criar-tarefa", "—", "abrir-task", "lembrar", "relatar"]);
    const textos = itens.filter((i): i is Exclude<typeof i, { divisor: true }> => !("divisor" in i)).map((i) => i.texto);
    expect(textos.slice(0, 3)).toEqual(["Responder", "Copiar", "Criar tarefa disto"]);
    expect(textos.at(-1)).toBe("Reportar problema nesta resposta");
  });

  it("sem quadro, sem 'Criar tarefa disto'", () => {
    expect(acoes(itensDoMenuSegurado(BOT, cenario([BOT]), false))).toEqual(["responder", "copiar", "—", "abrir-task", "lembrar", "relatar"]);
  });

  it("fala só com anexo (texto vazio): Copiar e Criar tarefa somem (e Responder, que precisa de texto)", () => {
    const vazia = msg("m2", "  ");
    expect(acoes(itensDoMenuSegurado(vazia, cenario([vazia]), true))).toEqual(["relatar"]);
  });

  it("fala da pessoa: Responder, Copiar e Criar tarefa valem; Reportar diz 'nesta mensagem'", () => {
    const minha = msg("m3", "pode pegar o T3", { autoria: daPessoa, turnoId: null });
    const itens = itensDoMenuSegurado(minha, cenario([minha]), true);
    expect(acoes(itens).slice(0, 3)).toEqual(["responder", "copiar", "criar-tarefa"]);
    const ultimo = itens.at(-1)!;
    expect("divisor" in ultimo ? "" : ultimo.texto).toBe("Reportar problema nesta mensagem");
  });

  it("fora da conversa própria (tela da task): sem Responder nem Criar tarefa (não há bot de destino)", () => {
    const naTask = cenario([BOT], { tela: { tipo: "trabalho", id: "w1" } as never });
    expect(acoes(itensDoMenuSegurado(BOT, naTask, true))).toEqual(["copiar", "—", "relatar"]);
  });

  it("nenhuma ação some: todo item do ⋯ e todo botão da barra têm lugar no menu segurado (ADR-148)", () => {
    const e = cenario([BOT], { modoDev: true });
    const segurado = acoes(itensDoMenuSegurado(BOT, e, true, [{ act: "ouvir-mensagem", rotulo: "Ouvir" }]));
    for (const i of itensDoMenu(BOT, e, true)) expect(segurado).toContain(i.acao);
    const barra = [...acoesDaFala(BOT, e).matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]!);
    const deBarraParaItem: Record<string, string> = { "reagir-fala": "reações no topo", "responder-fala": "responder", "relatar-mensagem": "relatar", "mais-da-fala": "o próprio menu" };
    for (const act of barra) expect(ACTS_COBERTOS as readonly string[]).toContain(act);
    expect(Object.keys(deBarraParaItem).sort()).toEqual([...ACTS_COBERTOS].sort());
    expect(segurado).toContain("responder");
    expect(segurado).toContain("relatar");
    expect(segurado).toContain("raio-x");
    // O botão extra da barra (Ouvir) vira item que clica nele.
    expect(segurado).toContain("proxy:ouvir-mensagem");
  });

  it("um botão extra já coberto não entra duas vezes", () => {
    expect(acoes(itensDoMenuSegurado(BOT, cenario([BOT]), false, [{ act: "responder-fala", rotulo: "Responder" }])).filter((a) => a === "responder")).toHaveLength(1);
  });

  it("HTML: reações no topo, divisor com role=separator, itens com data-fala (o mesmo clique do ⋯)", () => {
    const html = htmlMenuSegurado(BOT, cenario([BOT]), true, [{ act: "ouvir-mensagem", rotulo: 'Ouvir "isto"' }]);
    expect(html.indexOf('class="linha-emojis"')).toBeLessThan(html.indexOf('data-fala="responder"'));
    expect(html).toContain('<div class="mfs-divisor" role="separator"></div>');
    expect(html).toContain('data-fala="criar-tarefa"');
    expect(html).toContain('data-fala="proxy:ouvir-mensagem"');
    expect(html).toContain("Ouvir &quot;isto&quot;");
    expect(html).toMatch(/^<div role="menu" aria-label="Ações da mensagem">/);
  });

  it("o ⋯ do computador também ganha 'Criar tarefa disto' logo depois de Copiar, só com quadro", () => {
    expect(itensDoMenu(BOT, cenario([BOT]), true).map((i) => i.acao).slice(0, 2)).toEqual(["copiar", "criar-tarefa"]);
    expect(itensDoMenu(BOT, cenario([BOT])).map((i) => i.acao)).not.toContain("criar-tarefa");
    expect(htmlMenuDaFala(BOT, cenario([BOT]), true)).toContain('data-fala="criar-tarefa"');
  });
});

describe("tarefaDaFala: o título e a descrição da tarefa criada da fala", () => {
  it("título = começo da fala cortado na palavra; descrição = origem + fala inteira", () => {
    const longa = "Fechei o PR 481 e abri a issue de follow-up para o cache dos convites, que ainda erra quando o convite expira no meio do fluxo.";
    const t = tarefaDaFala(longa, "Ze 2", "07/11 14:02");
    expect([...t.titulo].length).toBeLessThanOrEqual(TITULO_DA_TAREFA_MAX + 1);
    expect(t.titulo.endsWith("…")).toBe(true);
    expect(longa.startsWith(t.titulo.slice(0, -1))).toBe(true);
    expect(longa.charAt(t.titulo.length - 1)).toBe(" ");
    expect(t.descricao).toBe(`Da conversa com Ze 2, 07/11 14:02\n\n${longa}`);
  });

  it("fala curta: o título é a fala inteira, numa linha", () => {
    expect(tarefaDaFala("Revisar\n o  PR 7", "Ada", "07/11 14:02").titulo).toBe("Revisar o PR 7");
  });

  it("fala enorme: a descrição cabe no teto do quadro e termina em reticências", () => {
    const t = tarefaDaFala("palavra ".repeat(2000), "Ada", "07/11 14:02");
    expect([...t.descricao].length).toBeLessThanOrEqual(LIMITES_QUADRO.descricao);
    expect(t.descricao.endsWith("…")).toBe(true);
    expect([...t.titulo].length).toBeLessThanOrEqual(LIMITES_QUADRO.titulo);
  });

  it("os tetos da web batem com os do contrato", () => {
    expect(DESCRICAO_DA_TAREFA_MAX).toBe(LIMITES_QUADRO.descricao);
    expect(TITULO_DA_TAREFA_MAX).toBeLessThanOrEqual(LIMITES_QUADRO.titulo);
  });
});

describe("o CSS do toque longo", () => {
  const css = readFileSync(new URL("../../../web/celular-base.css", import.meta.url), "utf8");
  it("o menu de vidro tem 240, raio 14 e itens de 46 em 16 px; o iOS não abre a lupa durante o segurar", () => {
    expect(css).toMatch(/\.bot-menu\.menu-fala-seg \{ width: 240px; border-radius: 14px;/);
    expect(css).toMatch(/\.bot-menu\.menu-fala-seg button\[role="menuitem"\]:not\(\.emoji-mais\) \{ min-height: 46px; font-size: 16px; \}/);
    expect(css).toContain(".fala-segurando, .fala-segurando * { -webkit-touch-callout: none;");
  });
  it("card de aprovação (e o de lote, que também é .cp) em contorno, dentro da media query do celular", () => {
    const corpoDaQuery = css.slice(css.indexOf("@media (hover: none) and (pointer: coarse)"));
    expect(corpoDaQuery).toContain(".cp { border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }");
    expect(corpoDaQuery).toMatch(/\.cp button\.cp-sim, \.cp button\.cp-sim:hover \{ min-height: var\(--cel-alvo\); border: 1\.5px solid var\(--ink\); border-radius: 22px; background: transparent; color: var\(--ink\); font-size: 15px; font-weight: 600;/);
    expect(corpoDaQuery).toMatch(/\.cp button\.cp-nao, \.cp button\.cp-nao:hover \{ min-height: var\(--cel-alvo\);[^}]*color: var\(--ink-2\);/);
    expect(corpoDaQuery).toMatch(/\.cp button\.cp-sim\.cp-perigo, \.cp button\.cp-sim\.cp-perigo:hover \{ border-color: var\(--danger\); background: transparent; color: var\(--danger\); \}/);
    // O card de lote nasce com a raiz .cp (card-proposta.ts), então o contorno vale para ele sem seletor próprio.
    const lote = readFileSync(new URL("../../../web/lib/card-proposta.ts", import.meta.url), "utf8");
    expect(lote).toContain('<div class="cp${o.classe ? ` ${o.classe}` : ""}"');
  });

  it("o toque simples não alterna mais a barra no celular (o listener saiu da gaveta)", () => {
    const gaveta = readFileSync(new URL("../../../web/lib/gaveta-bots.ts", import.meta.url), "utf8");
    expect(gaveta).not.toContain('classList.toggle("acoes-a-mostra")');
  });
});
