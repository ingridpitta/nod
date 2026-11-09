import { describe, expect, it } from "vitest";
import type { QuadroCompartilhadoDto } from "../../../src/contracts/quadro-pessoas.ts";
import { destinoDaAbaQuadros } from "../../../web/lib/tab-bar-celular.ts";
import { renderAbaQuadros, renderAbaSuaVez, renderFolhaRecentes, renderTabBar, renderTituloGrande, type LinhaDoPedidoNaTela, type LinhaRecenteNaTela } from "../../../web/telas/tab-bar-celular.ts";

/** ADA-19: o HTML da tab bar, das abas Sua vez e Quadros e da folha de recentes (protótipo ada-2 v2, passos 2.5–2.6). */
const MAU = '<script>alert(1)</script>';

describe("renderTabBar", () => {
  it("três abas num nav, a ativa com aria-current, e o botão de busca", () => {
    const h = renderTabBar("conversas", { pedidos: 0, naoLidas: false });
    expect(h).toContain('<nav class="tab-abas" aria-label="Navegação">');
    expect(h.match(/data-act="aba-do-inicio"/g)).toHaveLength(3);
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/data-aba="conversas" aria-current="page"/);
    expect(h).toContain('data-act="abrir-busca" aria-label="Buscar"');
    expect(h).not.toContain("tab-ponto");
    expect(h).not.toContain("tab-num");
  });

  it("não lidas viram ponto em Conversas; pedidos viram número em Sua vez — visuais aria-hidden, o leitor ouve no rótulo", () => {
    const h = renderTabBar("sua-vez", { pedidos: 120, naoLidas: true });
    expect(h).toContain('aria-label="Conversas, há não lidas"');
    expect(h).toContain('<span class="tab-ponto" aria-hidden="true"></span>');
    expect(h).toContain('<span class="tab-num" aria-hidden="true">99+</span>');
    expect(h).toContain('aria-label="Sua vez, 120 pedidos"');
    expect(h).toMatch(/data-aba="sua-vez" aria-current="page"/);
  });

  it("sem dica de gesto", () => {
    expect(renderTabBar("quadros", { pedidos: 1, naoLidas: false })).not.toMatch(/segure|deslize|arraste/i);
  });

  it("título grande com o nome da aba", () => {
    expect(renderTituloGrande("conversas")).toBe('<h1 class="inicio-titulo-grande">Conversas</h1>');
  });
});

describe("renderAbaSuaVez", () => {
  const linha: LinhaDoPedidoNaTela = { decisaoId: "d1", agenteId: "a1", conversaId: "c1", quem: `Vera ${MAU}`, pedido: `Posso? ${MAU}`, motivo: "Pergunta · Conversa", desde: 0, daMinhaConversa: true, mascote: '<span class="m"></span>', hora: "14:02", horaIso: "2026-11-07T14:02:00.000Z" };

  it("Precisa de você com a contagem; a linha abre o pedido na conversa", () => {
    const h = renderAbaSuaVez({ tipo: "pronta", linhas: [linha] });
    expect(h).toContain("Precisa de você");
    expect(h).toContain('data-act="abrir-pedido" data-decisao-id="d1" data-conversa="c1" data-agente="a1"');
    expect(h).toContain("Pergunta · Conversa");
    expect(h).toContain('<span class="m"></span>');
    expect(h).not.toContain(MAU);
    expect(h).toContain("&lt;script&gt;");
  });

  it("pedido na conversa de outra pessoa vai para a fila de Sua vez (onde ela decide), nunca para a conversa que não lê", () => {
    const h = renderAbaSuaVez({ tipo: "pronta", linhas: [{ ...linha, daMinhaConversa: false }] });
    expect(h).toContain('data-act="abrir-pedido-na-fila" data-decisao-id="d1"');
    expect(h).not.toContain('data-act="abrir-pedido"');
  });

  it("revisão do #704: a linha não casa com o seletor do atalho até o pedido (a barra vem antes da timeline no DOM)", () => {
    // verPerguntaNaConversa e verDecisao procuram [data-pergunta|data-decisao|data-proposta="<id>"] no documento todo: a
    // linha da aba (que fica na barra, escondida atrás da conversa) seria achada antes do balão e o atalho rolaria para ela.
    const h = renderAbaSuaVez({ tipo: "pronta", linhas: [linha, { ...linha, decisaoId: "d2", daMinhaConversa: false }] });
    expect(h).not.toMatch(/\sdata-(?:pergunta|decisao|proposta)="/);
  });

  it("vazio, carregando (3 linhas) e erro com tentar de novo", () => {
    expect(renderAbaSuaVez({ tipo: "pronta", linhas: [] })).toContain("Nada esperando por você.");
    expect(renderAbaSuaVez({ tipo: "carregando" }).match(/esq-pedido/g)).toHaveLength(3);
    const erro = renderAbaSuaVez({ tipo: "erro" });
    expect(erro).toContain("Não deu para atualizar.");
    expect(erro).toContain('data-act="tentar-sua-vez"');
  });
});

describe("renderAbaQuadros", () => {
  const base = { nomeDoBot: (id: string) => `bot ${id}`, mascote: () => "" };
  const q = (id: string, agenteNome: string) => ({ id, agenteId: agenteNome, agenteNome, prefixo: null });

  it("vazio leva para Conversas", () => {
    const h = renderAbaQuadros({ tipo: "pronta", destino: destinoDaAbaQuadros([]), ...base });
    expect(h).toContain("Ainda não há quadros. Peça a um bot para criar um.");
    expect(h).toContain('data-act="aba-do-inicio" data-aba="conversas"');
  });

  it("um quadro em destaque; N agrupados; compartilhado abre a tela de quadro compartilhado", () => {
    expect(renderAbaQuadros({ tipo: "pronta", destino: destinoDaAbaQuadros([q("q1", "Ada")]), ...base })).toContain('class="aba-quadro destaque" data-act="abrir-quadro-do-bot" data-agente="Ada" data-id="q1"');
    const comp = { id: "qc", agenteId: "x", agenteNome: MAU, prefixo: null, donaNome: "Rafa", modo: "individual" } as QuadroCompartilhadoDto;
    const h = renderAbaQuadros({ tipo: "pronta", destino: destinoDaAbaQuadros([q("q1", "Ada"), q("q2", "Zé")], [comp]), ...base });
    expect(h.match(/class="aba-rotulo/g)).toHaveLength(3);
    expect(h).toContain("Compartilhados com você");
    expect(h).toContain('data-act="abrir-quadro-compartilhado" data-quadro="qc"');
    expect(h).not.toContain(MAU);
  });

  it("erro com tentar de novo", () => {
    expect(renderAbaQuadros({ tipo: "erro" })).toContain('data-act="tentar-quadros"');
  });
});

describe("renderFolhaRecentes", () => {
  const l = (id: string, aberta = false): LinhaRecenteNaTela => ({ agenteId: id, conversaId: `c-${id}`, nome: `${id} ${MAU}`, previa: "oi", em: 0, aberta, mascote: "", hora: "ontem", horaIso: "2026-11-06T10:00:00.000Z" });

  it("é um diálogo modal chamado Conversas recentes (critério 4); a aberta vai marcada", () => {
    const h = renderFolhaRecentes([l("a", true), l("b")]);
    expect(h).toContain('role="dialog" aria-modal="true" aria-labelledby="titulo-recentes"');
    expect(h).toContain('<h3 id="titulo-recentes">Conversas recentes</h3>');
    expect(h.match(/data-act="abrir-recente"/g)).toHaveLength(2);
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
    expect(h).not.toContain(MAU);
  });

  it("vazio", () => {
    expect(renderFolhaRecentes([])).toContain("Sem conversas recentes.");
  });
});
