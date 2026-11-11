import { beforeAll, describe, expect, it } from "vitest";
import type { QuadroDto } from "../../../src/contracts/quadro.ts";
import type { ExibirDoQuadro } from "../../../src/contracts/raio-x.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { criarBarraDoQuadro } from "../../../web/lib/barra-do-quadro.ts";

/**
 * Quadro minimalista (2026-11-10): o estado da barra (funil, Opções, quem trabalha, o modal de Nova tarefa), sem DOM: o
 * elemento é o dataset, o value e a classe certa para o `instanceof` (o unit não tem jsdom).
 */
class FalsoEl { dataset: Record<string, string> = {}; id = ""; value = ""; checked = false; closest(): null { return null; } }
class FalsoSelect extends FalsoEl {}
class FalsoInput extends FalsoEl {}
class FalsoTextArea extends FalsoEl {}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g["HTMLElement"] ??= FalsoEl;
  g["HTMLSelectElement"] ??= FalsoSelect;
  g["HTMLInputElement"] ??= FalsoInput;
  g["HTMLTextAreaElement"] ??= FalsoTextArea;
  g["CSS"] ??= { escape: (s: string) => s };
});

function el<T extends FalsoEl>(C: new () => T, dataset: Record<string, string> = {}, extra: Partial<FalsoEl> = {}): HTMLElement {
  return Object.assign(new C(), { dataset }, extra) as never;
}

const QUADRO = { id: "q1", colunas: colunasDto(COLUNAS_PADRAO) } as QuadroDto;

function montar(o: { criar?: boolean; celular?: boolean } = {}) {
  let exibir: ExibirDoQuadro = { recolhidas: true, compacto: false };
  const gravados: Partial<ExibirDoQuadro>[] = [];
  const focos: string[] = [];
  const criados: unknown[] = [];
  let desenhos = 0;
  const b = criarBarraDoQuadro({
    quadro: () => QUADRO, colunas: () => QUADRO.colunas, exibir: () => exibir,
    gravarExibir: (m) => { gravados.push(m); exibir = { ...exibir, ...m }; },
    desenhar: () => { desenhos++; }, focar: (s) => { focos.push(s); }, anunciar: () => undefined,
    podeCriar: () => o.criar !== false, criarTarefa: async (c) => { criados.push(c); return true; },
    noQuadro: () => true, celular: () => o.celular === true,
  });
  return { b, gravados, focos, criados, desenhos: () => desenhos };
}

const tecla = (key: string, extra: Partial<KeyboardEvent> = {}) => {
  let parou = false;
  const ev = { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null, preventDefault: () => { parou = true; }, ...extra } as unknown as KeyboardEvent;
  return { ev, parou: () => parou };
};

describe("web/lib/barra-do-quadro", () => {
  it("abre e fecha cada popover; só um aberto por vez; o foco vai para dentro e volta ao botão", () => {
    const { b, focos } = montar();
    expect(b.aoClicar(el(FalsoEl), "fil-abrir")).toBe(true);
    expect(b.ui().aberto).toBe("filtros");
    expect(focos.at(-1)).toBe("#qm-fil-busca");
    b.aoClicar(el(FalsoEl), "op-abrir");
    expect(b.ui().aberto).toBe("opcoes");
    b.aoClicar(el(FalsoEl), "op-abrir");
    expect(b.ui().aberto).toBeNull();
    expect(focos.at(-1)).toBe('[data-act="op-abrir"]');
  });

  it("os filtros: abre o campo, liga e desliga valores, tira um campo, limpa; ficam por quadro no Exibir", () => {
    const { b } = montar();
    b.aoClicar(el(FalsoEl), "fil-abrir");
    b.aoClicar(el(FalsoEl, { campo: "status" }), "fil-campo");
    expect(b.ui().campo).toBe("status");
    b.aoClicar(el(FalsoEl, { campo: "status", valor: "afazer" }), "fil-alternar");
    b.aoClicar(el(FalsoEl, { campo: "prioridade", valor: "alta" }), "fil-alternar");
    expect(b.ui().filtros).toEqual([{ campo: "status", valor: "afazer" }, { campo: "prioridade", valor: "alta" }]);
    b.aoClicar(el(FalsoEl, { campo: "inventado", valor: "x" }), "fil-alternar");
    expect(b.ui().filtros).toHaveLength(2);
    b.aoClicar(el(FalsoEl, { campo: "status" }), "fil-tirar");
    expect(b.ui().filtros).toEqual([{ campo: "prioridade", valor: "alta" }]);
    b.aoClicar(el(FalsoEl, { campo: "prioridade", modo: "nao" }), "fil-modo");
    expect(b.ui().negados).toEqual(["prioridade"]);
    b.aoClicar(el(FalsoEl, { campo: "prioridade", modo: "e" }), "fil-modo");
    expect(b.ui().negados).toEqual([]);
    b.aoClicar(el(FalsoEl, { campo: "status", modo: "nao" }), "fil-modo");
    b.aoClicar(el(FalsoEl), "fil-limpar");
    expect(b.ui().filtros).toEqual([]);
    expect(b.ui().negados).toEqual([]);
  });

  it("2026-11-10: o funil fica lembrado no Exibir do quadro (vai ao servidor), e o guardado inválido é ignorado", () => {
    const { b, gravados } = montar();
    b.aoClicar(el(FalsoEl, { campo: "status", valor: "afazer" }), "fil-alternar");
    expect(gravados.at(-1)).toEqual({ filtros: [{ campo: "status", valor: "afazer" }] });
    b.aoClicar(el(FalsoEl, { campo: "status", modo: "nao" }), "fil-modo");
    expect(gravados.at(-1)).toEqual({ negados: ["status"] });
    b.aoClicar(el(FalsoEl), "fil-limpar");
    expect(gravados.at(-1)).toEqual({ filtros: [], negados: [] });
    // Recarregou: o que veio das preferências volta; o campo que não existe mais fica de fora.
    const guardado = criarBarraDoQuadro({
      quadro: () => QUADRO, colunas: () => QUADRO.colunas, exibir: () => ({ recolhidas: true, compacto: false, filtros: [{ campo: "prioridade", valor: "alta" }, { campo: "sumiu" as never, valor: "x" }], negados: ["prioridade"] }),
      gravarExibir: () => undefined, desenhar: () => undefined, focar: () => undefined, anunciar: () => undefined, podeCriar: () => true, criarTarefa: async () => true, noQuadro: () => true, celular: () => false,
    });
    expect(guardado.ui().filtros).toEqual([{ campo: "prioridade", valor: "alta" }]);
    expect(guardado.ui().negados).toEqual(["prioridade"]);
  });

  it("as Opções gravam no Exibir: visão, inverter, colunas escondidas e propriedades (na ordem do catálogo)", () => {
    const { b, gravados } = montar();
    b.aoClicar(el(FalsoEl, { valor: "lista" }), "op-vista");
    b.aoClicar(el(FalsoEl), "op-inverter");
    b.aoClicar(el(FalsoEl, { coluna: "backlog" }), "op-coluna");
    b.aoClicar(el(FalsoEl, { coluna: "nao-existe" }), "op-coluna");
    b.aoClicar(el(FalsoEl, { prop: "descricao" }), "op-prop");
    b.aoClicar(el(FalsoEl, { prop: "prioridade" }), "op-prop");
    b.aoClicar(el(FalsoEl, { chave: "compacto" }), "exibir-alternar");
    expect(gravados).toEqual([
      { vista: "lista" }, { inverter: true }, { ocultas: ["backlog"] }, { ocultas: ["backlog"] },
      { propriedades: ["prioridade", "descricao", "responsavel", "datas", "linear", "pr", "labels", "prazo"] }, { propriedades: ["descricao", "responsavel", "datas", "linear", "pr", "labels", "prazo"] },
      { compacto: true },
    ]);
    expect(b.aoMudar(el(FalsoSelect, { campo: "op-ordenar" }, { value: "prioridade" }))).toBe(true);
    expect(b.aoMudar(el(FalsoSelect, { campo: "op-agrupar" }, { value: "inventado" }))).toBe(true);
    expect(gravados.at(-1)).toEqual({ ordenar: "prioridade" });
  });

  it("o modal: abre pelo botão, pelo + da coluna (com a coluna) e pelo C; Esc fecha; ⌘↵ cria com os chips escolhidos", async () => {
    const { b, criados, focos } = montar();
    b.aoClicar(el(FalsoEl, { status: "fazendo" }), "col-nova-tarefa");
    expect(b.ui().modal?.coluna).toBe("fazendo");
    const esc = tecla("Escape");
    expect(b.aoTeclar(esc.ev, false)).toBe(false); // sem o nó do modal no documento, o Esc não é dele
    b.aoClicar(el(FalsoEl), "nt-fechar");
    expect(b.ui().modal).toBeNull();
    expect(focos.at(-1)).toContain('[data-act="col-nova-tarefa"][data-status="fazendo"]');
    const c = tecla("c");
    expect(b.aoTeclar(c.ev, false)).toBe(true);
    expect(c.parou()).toBe(true);
    expect(b.ui().modal?.coluna).toBe("backlog");
    b.aoDigitar(el(FalsoInput, {}, { id: "qm-nt-tit", value: "Nova coisa" }));
    b.aoDigitar(el(FalsoTextArea, {}, { id: "qm-nt-desc", value: "  detalhe  " }));
    b.aoMudar(el(FalsoSelect, { nt: "prioridade" }, { value: "urgente" }));
    b.aoMudar(el(FalsoSelect, { nt: "coluna" }, { value: "afazer" }));
    b.aoMudar(el(FalsoSelect, { nt: "agente" }, { value: "a1" }));
    b.aoMudar(el(FalsoInput, { nt: "outra" }, { checked: true }));
    expect(b.aoEnviar({ dataset: { form: "nova-tarefa-modal" } } as never)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(criados).toEqual([{ titulo: "Nova coisa", descricao: "detalhe", status: "afazer", agente: "a1", prioridade: "urgente" }]);
    // Criar outra: o modal fica, limpo, com os mesmos chips.
    expect(b.ui().modal).toMatchObject({ titulo: "", descricao: "", coluna: "afazer", prioridade: "urgente", criarOutra: true });
  });

  it("sem título não cria; digitando, o C não abre; no celular o + da coluna segue no campo inline; sem permissão, nada abre", async () => {
    const { b, criados } = montar();
    b.aoClicar(el(FalsoEl), "nt-abrir");
    b.aoEnviar({ dataset: { form: "nova-tarefa-modal" } } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(criados).toEqual([]);
    expect(b.ui().modal?.erro).toBeTruthy();
    const outro = montar();
    expect(outro.b.aoTeclar(tecla("c").ev, true)).toBe(false);
    expect(montar({ celular: true }).b.aoClicar(el(FalsoEl, { status: "afazer" }), "col-nova-tarefa")).toBe(false);
    const sem = montar({ criar: false });
    sem.b.aoClicar(el(FalsoEl), "nt-abrir");
    expect(sem.b.ui().modal).toBeNull();
  });

  it("o clique fora fecha o popover; dentro dele, não", () => {
    const { b } = montar();
    b.aoClicar(el(FalsoEl), "ativos-abrir");
    const dentro = { closest: (s: string) => (s.includes(".qm-ativos-l") ? {} : null) } as unknown as Element;
    expect(b.aoClicarFora(dentro)).toBe(false);
    expect(b.aoClicarFora({ closest: () => null } as unknown as Element)).toBe(true);
    expect(b.ui().aberto).toBeNull();
  });
});
