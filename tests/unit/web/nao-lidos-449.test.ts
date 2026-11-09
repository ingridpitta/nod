import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaNaoLida } from "../../../src/contracts/nao-lidos.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { PayloadNaoLidosLista, PayloadReciboLeitura } from "../../../src/contracts/ferramentas-nao-lidos.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { LIMITE_DESLIZE_PX, deslocamento, soltouMarca } from "../../../web/lib/deslize-lida.ts";
import { htmlDaPrevia, pedacosDoTexto, resumoDeUmaLinha } from "../../../web/lib/previa-nao-lida.ts";
import { teclaNaoLidos } from "../../../web/lib/teclado-nao-lidos.ts";
import { cartaoNaoLidos, reciboLeitura } from "../../../web/telas/nao-lidos-no-chat.ts";

/** NOD-449 na web: a prévia (tabela e código viram etiqueta), o card e o recibo do chat, o teclado e o deslize. */

const AUTORIA = { sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1, autor_tipo: "agente", autor_id: "a1" } as const;
function msg(texto: string, extra: Partial<Mensagem> = {}): Mensagem {
  return { tenantId: "t", id: "m1", conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: AUTORIA, ...extra } as Mensagem;
}

describe("a prévia da linha", () => {
  it("tabela vira 'Tabela · N linhas' e o texto em volta continua corrido", () => {
    const t = "Resumo da manhã:\n\n| Pedido | Valor |\n|---|---|\n| 1 | 10 |\n| 2 | 20 |\n| 3 | 30 |\n| 4 | 40 |\n\nO Café Aurora ainda **não pagou**.";
    expect(pedacosDoTexto(t)).toEqual([
      { tipo: "texto", texto: "Resumo da manhã:" },
      { tipo: "etiqueta", icone: "tabela", texto: "Tabela · 4 linhas" },
      { tipo: "texto", texto: "O Café Aurora ainda não pagou." },
    ]);
  });

  it("bloco de código vira 'Código'; linha com | sem separador continua texto", () => {
    expect(pedacosDoTexto("Rodei:\n```bash\nnpm test\n```\nTudo verde.")).toEqual([
      { tipo: "texto", texto: "Rodei:" }, { tipo: "etiqueta", icone: "codigo", texto: "Código" }, { tipo: "texto", texto: "Tudo verde." },
    ]);
    expect(pedacosDoTexto("a | b | c")).toEqual([{ tipo: "texto", texto: "a | b | c" }]);
  });

  it("artefato e anexo viram etiqueta; o HTML escapa", () => {
    const art = msg("", { payload: { kind: "artefato", artefatoId: "x", versao: 1, titulo: "Painel <b>" } as never });
    expect(htmlDaPrevia([art])).toContain('<span class="nl-etiqueta">');
    expect(htmlDaPrevia([art])).toContain("Painel &lt;b&gt;");
    expect(htmlDaPrevia([msg("<i>oi</i>")])).toBe("&lt;i&gt;oi&lt;/i&gt;");
  });

  it("__ dentro de identificador fica; __negrito__ solto sai (QA do PR #616)", () => {
    expect(pedacosDoTexto("Rodei my__var__x e a__b__c; isto é __forte__.")).toEqual([{ tipo: "texto", texto: "Rodei my__var__x e a__b__c; isto é forte." }]);
    expect(pedacosDoTexto("**ok** e __também__")).toEqual([{ tipo: "texto", texto: "ok e também" }]);
  });

  it("o resumo de uma linha é o texto mais recente", () => {
    expect(resumoDeUmaLinha([msg("primeira"), msg("| a |\n|---|\n| 1 |\n\nsegunda")])).toBe("segunda");
  });
});

describe("o card e o recibo no chat", () => {
  const frota = { agentes: [{ id: "a1", nome: "Bia", titulo: "Atendimento", cor: "c-teal", forma: "shape-drop", ownerId: "p", conversaId: "c1" }, { id: "a2", nome: "Lia", titulo: "", cor: "c-green", forma: "shape-drop", ownerId: "p", conversaId: "c2" }] } as never;
  const lista: PayloadNaoLidosLista = { kind: "nao_lidos_lista", conversas: [{ conversaId: "c1", agenteId: "a1", salaId: null, nome: "Bia" }, { conversaId: "c2", agenteId: "a2", salaId: null, nome: "Lia" }] };
  const naoLida: ConversaNaoLida = { conversaId: "c1", tipo: "propria", agenteId: "a1", salaId: null, total: 1, primeiraId: "m1", desde: 0, ultimaEm: 0, mensagens: [msg("A Júlia confirmou os brownies.")], daRotina: false };

  it("cada linha abre a conversa; o ✓ marca a que segue não lida e desmarca a que já foi lida", () => {
    const e: Estado = { ...estadoInicial, frota, naoLidos: { conversas: [naoLida] } };
    const html = cartaoNaoLidos(lista, e);
    expect(html).toContain("2 conversas com coisa para você:");
    expect(html).toContain('data-act="abrir-conversa" data-conversa="c1" data-agente="a1"');
    expect(html).toContain("A Júlia confirmou os brownies.");
    expect(html).toContain('data-act="marcar-lida" data-conversa="c1" data-nome="Bia" aria-pressed="false"');
    expect(html).toContain('<li class="nlc-i nlc-lida">');
    expect(html).toContain('data-act="marcar-nao-lida-card" data-conversa="c2" data-nome="Lia" aria-pressed="true"');
    expect(html).toContain("Marcar todas como lidas");
  });

  it("a hora do card é a curta da tela: fala de ontem diz 'ontem' (QA do PR #616)", () => {
    const agora = new Date(2026, 10, 1, 12).getTime();
    const ontem = { ...naoLida, ultimaEm: agora - 86_400_000 };
    expect(cartaoNaoLidos(lista, { ...estadoInicial, agora, frota, naoLidos: { conversas: [ontem] } })).toContain("<time>ontem</time>");
  });

  it("o 'Marcar todas' do card vence o .cp-link carregado depois: padding e divisória (QA do PR #616)", () => {
    const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.nlc \.nlc-tudo \{[^}]*padding: 9px 14px 10px;[^}]*border-top: 1px solid var\(--line\)/);
    expect(css).not.toMatch(/(^|\n)\.nlc-tudo \{/);
  });

  it("tudo lido: some o 'Marcar todas'", () => {
    const html = cartaoNaoLidos(lista, { ...estadoInicial, frota, naoLidos: { conversas: [] } });
    expect(html).not.toContain("Marcar todas como lidas");
  });

  it("o recibo tem Desfazer até ser desfeito", () => {
    const p: PayloadReciboLeitura = { kind: "recibo_leitura", nomes: ["Bia", "Lia"], leituras: [{ conversaId: "c1", antes: null, depois: "2026-11-01T10:00:00.000000" }] };
    const m = msg("Bia e Lia marcadas como lidas", { id: "r1", kind: "sistema", payload: p });
    expect(reciboLeitura(m, p)).toContain('data-act="desfazer-recibo-leitura" data-id="r1">Desfazer</button>');
    const desfeito = reciboLeitura({ ...m, texto: "Bia e Lia voltaram para Não lidos" }, { ...p, desfeito: true });
    expect(desfeito).not.toContain("Desfazer");
    expect(desfeito).toContain("Bia e Lia voltaram para Não lidos");
  });
});

describe("teclado e deslize", () => {
  const sem = { ctrl: false, meta: false, alt: false };
  it("↑ ↓ e J K andam sem passar das pontas; E marca só com uma linha em foco; modificador não conta", () => {
    expect(teclaNaoLidos("ArrowDown", -1, 3, sem)).toEqual({ tipo: "mover", indice: 0 });
    expect(teclaNaoLidos("j", 1, 3, sem)).toEqual({ tipo: "mover", indice: 2 });
    expect(teclaNaoLidos("J", 2, 3, sem)).toEqual({ tipo: "mover", indice: 2 });
    expect(teclaNaoLidos("k", 0, 3, sem)).toEqual({ tipo: "mover", indice: 0 });
    expect(teclaNaoLidos("ArrowUp", 2, 3, sem)).toEqual({ tipo: "mover", indice: 1 });
    expect(teclaNaoLidos("e", 1, 3, sem)).toEqual({ tipo: "marcar" });
    expect(teclaNaoLidos("e", -1, 3, sem)).toBeNull();
    expect(teclaNaoLidos("e", 1, 3, { ...sem, meta: true })).toBeNull();
    expect(teclaNaoLidos("x", 1, 3, sem)).toBeNull();
  });

  it("deslize: só para a direita, marca depois do limite e se for horizontal", () => {
    expect(deslocamento(-30)).toBe(0);
    expect(deslocamento(40)).toBe(40);
    expect(deslocamento(LIMITE_DESLIZE_PX + 100)).toBeLessThan(LIMITE_DESLIZE_PX + 100);
    expect(soltouMarca(LIMITE_DESLIZE_PX, 0)).toBe(true);
    expect(soltouMarca(LIMITE_DESLIZE_PX - 1, 0)).toBe(false);
    expect(soltouMarca(LIMITE_DESLIZE_PX + 10, 80)).toBe(false);
  });
});
