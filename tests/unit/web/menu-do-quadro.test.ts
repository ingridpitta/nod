import { beforeAll, describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { criarBarraDoQuadro } from "../../../web/lib/barra-do-quadro.ts";
import { cabecalhoDoQuadro, type CabecalhoDoQuadro } from "../../../web/telas/menu-do-quadro.ts";
import type { UiDaBarra } from "../../../web/telas/opcoes-quadro.ts";
import { folhaDoTopo } from "../../../web/telas/quadro-celular.ts";
import { quadroDaMeta } from "../../../web/telas/quadro-real.ts";
import { confiar } from "../../../web/telas/quadro.ts";

/**
 * Quadro mínimo (2026-11-10, pedido do Marlon): o cabeçalho de uma linha (nome + chevron, meta e prazo em cinza) e o
 * menu do quadro, que leva o que a faixa de cima tinha. Paridade: nenhuma ação some, só muda de lugar.
 */

const MAL = `<img src=x onerror="alert(1)">`;
const t = (id: string): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: null, prioridade: "sem", codigo: `#${id}`, branch: "",
});
const q = (extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: "Engenharia", projetoId: null, prefixo: null, modoConversa: "individual", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas: [t("1")], ultimoLote: null, feitas: 0, total: 1, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">A</span>`), nome: "Ada" } : null);
const ui = (extra: Partial<UiDaBarra> = {}): UiDaBarra => ({ aberto: null, campo: null, buscaFiltro: "", filtros: [], negados: [], modal: null, ...extra });
const AGORA = Date.UTC(2026, 10, 10, 12);
const pessoas = { painel: null, mural: null, hora: () => "10:00" } as const;
const tela = (qq: QuadroDto, o: Partial<Parameters<typeof quadroDaMeta>[0]> = {}) =>
  quadroDaMeta({ q: qq, nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set(), agora: AGORA, podeCriar: true, ui: ui(), pessoas, ...o });

const cab = (extra: Partial<CabecalhoDoQuadro> = {}): CabecalhoDoQuadro => ({
  nome: "Engenharia", meta: null, prazoFrase: null, progresso: null, importacao: null, aberto: false, passo: null, editandoMeta: false,
  campoPrazo: `<span class="qd-prazo"><select id="qd-prazo"></select></span>`, pessoas: true, nPessoas: 0, trazer: true, trocar: false, ...extra,
});

describe("web/telas/menu-do-quadro", () => {
  it("fechado: só o nome com o chevron; sem meta e sem prazo, nada ao lado", () => {
    const h = cabecalhoDoQuadro(cab());
    expect(h).toContain('data-act="qmenu-abrir" aria-haspopup="menu" aria-expanded="false"');
    expect(h).toContain(">Engenharia<");
    expect(h).not.toContain("qm-cab-meta");
    expect(h).not.toContain("qm-pop-quadro");
  });

  it("meta e prazo em cinza ao lado do nome; o clique abre o menu no item Meta; nome e meta escapados", () => {
    const h = cabecalhoDoQuadro(cab({ nome: MAL, meta: "Lançar", prazoFrase: "até 20 nov" }));
    expect(h).toContain('data-act="qmenu-abrir" data-foco="meta"');
    expect(h).toContain(">Lançar · até 20 nov<");
    expect(h).not.toContain("<img");
    expect(cabecalhoDoQuadro(cab({ prazoFrase: "até 20 nov" }))).toContain(">até 20 nov<");
  });

  it("aberto: Meta, Prazo, Pessoas, Atividade, Trazer do Linear, separador e Remover em vermelho; Em teste no rodapé", () => {
    const h = cabecalhoDoQuadro(cab({ aberto: true, meta: "Lançar", prazoFrase: "até 20 nov", progresso: "0 de 1 feitas", nPessoas: 2 }));
    expect(h).toContain('aria-expanded="true" aria-controls="qm-pop-quadro"');
    expect(h).toContain('id="qm-pop-quadro" role="menu"');
    const ordem = ["0 de 1 feitas", 'data-act="editar-meta"', 'data-act="qmenu-prazo"', "Pessoas · 2", 'data-act="painel-atividade"', 'data-act="trazer-linear"', 'data-act="remover-quadro"', "Em teste · só você vê"];
    const pos = ordem.map((s) => h.indexOf(s));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(h).toMatch(/qm-qm-perigo" data-act="remover-quadro"/);
    expect(h.match(/role="menuitem"/g)).toHaveLength(6);
  });

  it("sem pessoas, sem Linear (membro ou importando) e com o seletor: os itens certos", () => {
    const h = cabecalhoDoQuadro(cab({ aberto: true, pessoas: false, trazer: false, trocar: true }));
    expect(h).not.toContain("painel-pessoas");
    expect(h).not.toContain("trazer-linear");
    expect(h).toContain('data-act="quadro-seletor"');
  });

  it("Meta e Prazo abrem o campo no próprio menu", () => {
    expect(cabecalhoDoQuadro(cab({ aberto: true, editandoMeta: true, meta: "X" }))).toContain('data-form="editar-meta"');
    const p = cabecalhoDoQuadro(cab({ aberto: true, passo: "prazo" }));
    expect(p).toContain('id="qd-prazo"');
    expect(p).not.toContain('data-act="qmenu-prazo"');
  });
});

describe("quadroDaMeta no quadro mínimo", () => {
  it("computador: uma linha só (o nome na barra, junto do funil); nada da faixa de antes", () => {
    const h = tela(q());
    expect(h).toMatch(/<div class="qd-barra-q qm-barra"><span class="qm-esq"><span class="qm-cab-l">/);
    for (const fora of ['class="qd-meta', "qd-flag", "Em teste", "qd-pessoas-links", "+ Meta", 'data-act="remover-quadro"', 'data-act="trazer-linear"']) expect(h).not.toContain(fora);
  });

  it("com o menu aberto, as ações estão lá; meta, prazo e progresso vêm do quadro", () => {
    const h = tela(q({ meta: "Lançar", prazo: "2026-11-20", feitas: 0, total: 1 }), { ui: ui({ aberto: "quadro" }) });
    expect(h).toContain("Lançar · até 20 nov");
    expect(h).toContain("0 de 1 feitas · faltam 10 dias");
    for (const act of ["editar-meta", "qmenu-prazo", "painel-pessoas", "painel-atividade", "trazer-linear", "remover-quadro"]) expect(h).toContain(`data-act="${act}"`);
  });

  it("quem participa não vê Trazer do Linear; o painel de Pessoas aberto tem título e Fechar", () => {
    const membro = tela(q({ voce: { pessoaId: "p2", papel: "membro" } } as Partial<QuadroDto>), { ui: ui({ aberto: "quadro" }) });
    expect(membro).not.toContain('data-act="trazer-linear"');
    const aberto = tela(q(), { pessoas: { ...pessoas, painel: "pessoas" } });
    expect(aberto).toContain('aria-label="Fechar Pessoas"');
    expect(aberto).not.toContain("qd-pessoas-links");
  });

  it("celular: o título e o ⋯ (sem o nome na barra nem a linha Pessoas · Atividade); a folha tem o Em teste no rodapé", () => {
    const h = tela(q(), { celular: { visao: "lista", folha: null } });
    expect(h).toContain("qd-cel-topo");
    expect(h).not.toContain("qm-cab-l");
    expect(h).not.toContain("qd-pessoas-links");
    expect(tela(q(), { celular: { visao: "lista", folha: null }, editandoMeta: true })).toContain('data-form="editar-meta"');
    expect(folhaDoTopo({ meta: null, prazo: { atual: null, frase: null, atalhos: [] }, pessoas: true, trazer: true })).toContain("Em teste · só você vê");
  });
});

class FalsoEl { dataset: Record<string, string> = {}; id = ""; dentro: boolean; closest(s: string): unknown { return this.dentro && s === "#qm-pop-quadro" ? this : null; } constructor(dentro = false) { this.dentro = dentro; } }
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g["HTMLElement"] ??= FalsoEl;
  g["CSS"] ??= { escape: (s: string) => s };
});

describe("web/lib/barra-do-quadro: o menu do quadro", () => {
  function montar() {
    const focos: string[] = [];
    const QUADRO = q();
    const b = criarBarraDoQuadro({
      quadro: () => QUADRO, colunas: () => QUADRO.colunas, exibir: () => ({ recolhidas: true, compacto: false }), gravarExibir: () => undefined,
      desenhar: () => undefined, focar: (s) => { focos.push(s); }, anunciar: () => undefined, podeCriar: () => true, criarTarefa: async () => true, noQuadro: () => true, celular: () => false,
    });
    return { b, focos };
  }
  const el = (dataset: Record<string, string> = {}, dentro = false) => Object.assign(new FalsoEl(dentro), { dataset }) as unknown as HTMLElement;
  const esc = (target: unknown = null) => { let parou = false; const ev = { key: "Escape", target, preventDefault: () => { parou = true; } } as unknown as KeyboardEvent; return { ev, parou: () => parou }; };

  it("o nome abre o menu no 1º item; a meta em cinza abre no item Meta; Esc fecha e o foco volta ao nome", () => {
    const { b, focos } = montar();
    expect(b.aoClicar(el(), "qmenu-abrir")).toBe(true);
    expect(b.ui().aberto).toBe("quadro");
    expect(focos.at(-1)).toBe('#qm-pop-quadro [role="menuitem"]');
    const e = esc();
    expect(b.aoTeclar(e.ev, false)).toBe(true);
    expect(b.ui().aberto).toBeNull();
    expect(focos.at(-1)).toBe(".qm-cab-bt");
    b.aoClicar(el({ foco: "meta" }), "qmenu-abrir");
    expect(focos.at(-1)).toBe('#qm-pop-quadro [data-act="editar-meta"]');
  });

  it("Prazo… abre o campo; o Esc volta ao item; o Esc no campo da meta é da tela", () => {
    const { b, focos } = montar();
    b.aoClicar(el(), "qmenu-abrir");
    b.aoClicar(el(), "qmenu-prazo");
    expect(b.ui().passo).toBe("prazo");
    expect(focos.at(-1)).toBe("#qm-pop-quadro #qd-prazo");
    b.aoTeclar(esc().ev, false);
    expect(b.ui()).toMatchObject({ aberto: "quadro", passo: null });
    expect(focos.at(-1)).toBe('#qm-pop-quadro [data-act="qmenu-prazo"]');
    expect(b.aoTeclar(esc({ id: "qd-meta-in" }).ev, false)).toBe(false);
    expect(b.ui().aberto).toBe("quadro");
  });

  it("as ações que levam a outro lugar fecham o menu e seguem para a tela; o clique fora fecha", () => {
    const { b } = montar();
    for (const act of ["painel-pessoas", "painel-atividade", "trazer-linear", "quadro-seletor", "remover-quadro"]) {
      b.aoClicar(el(), "qmenu-abrir");
      expect(b.aoClicar(el({}, true), act)).toBe(false);
      expect(b.ui().aberto).toBeNull();
    }
    b.aoClicar(el(), "qmenu-abrir");
    expect(b.aoClicar(el({}, true), "editar-meta")).toBe(false);
    expect(b.ui().aberto).toBe("quadro");
    expect(b.aoClicarFora({ closest: () => null } as unknown as Element)).toBe(true);
    expect(b.ui().aberto).toBeNull();
  });
});
