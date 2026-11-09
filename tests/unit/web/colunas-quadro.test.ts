import { describe, expect, it } from "vitest";
import { LIMITES_QUADRO, type ColunaDto, type ColunaQuadro, type QuadroDto, type TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import {
  COLUNAS_PADRAO_DA_WEB, comColunas, fraseDaColuna, fraseDoErroDeColuna, saidaComErroDesiste, seletorDoFocoDaColuna, destinosAoRemover, iconeDaColuna, inicioDoFimPreso, LIMITE_COLUNAS, LIMITE_NOME_COLUNA, nomeRepetido, passoDeMover, porqueNaoRemove, soltarEm,
} from "../../../web/lib/colunas.ts";
import { botaoDeNova, colunaNova, folhaDasColunas, menuDaColuna, naFolha, popoverDeRemover } from "../../../web/telas/colunas-quadro.ts";
import { STATUS } from "../../../web/lib/quadro.ts";
import { quadroDaMeta } from "../../../web/telas/quadro-real.ts";

/** NOD-448: editar as colunas na tela, sem DOM (o Chrome real fica no e2e dos doces). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const padrao = colunasDto(COLUNAS_PADRAO);
const comDoces = (): ColunaQuadro[] => [
  ...COLUNAS_PADRAO.slice(0, 2),
  { id: "c-forno", nome: "No forno", grupo: "iniciado" },
  ...COLUNAS_PADRAO.slice(2, 6),
  ...COLUNAS_PADRAO.slice(6),
  { id: "c-entregue", nome: "Entregue", grupo: "feito" },
];
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, terminadaEm: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Ada", numero: null, codigo: `#${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], colunas: ColunaQuadro[] = [...COLUNAS_PADRAO]): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: null, modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, metaDesde: 1, resumo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada",
  colunas: colunasDto(colunas), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
const tela = (qd: QuadroDto, edicao: Parameters<typeof quadroDaMeta>[0]["edicao"] = null) =>
  quadroDaMeta({ q: qd, nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao });

describe("web/lib/colunas", () => {
  it("os limites espelhados são os do contrato (a web só importa tipos, ADR-018)", () => {
    expect(LIMITE_NOME_COLUNA).toBe(LIMITES_QUADRO.coluna);
    expect(LIMITE_COLUNAS).toBe(LIMITES_QUADRO.colunas);
  });

  it("as padrão espelhadas na web são as do servidor; o quadro sem colunas (servidor antigo) ganha as padrão", () => {
    expect(COLUNAS_PADRAO_DA_WEB).toEqual(padrao);
    // O STATUS da web na mesma ordem das padrão do servidor (Precisa de você por último no andamento, decisão 2 do Gil).
    expect([...STATUS]).toEqual(padrao.map((c) => c.id));
    expect(comColunas<{ id: string; colunas?: ColunaDto[] | null }>({ id: "q" }).colunas).toEqual(padrao);
    const proprias = colunasDto(comDoces());
    expect(comColunas({ colunas: proprias }).colunas).toBe(proprias);
  });

  it("o ícone: a padrão tem o dela; a da pessoa usa a forma do grupo", () => {
    expect(iconeDaColuna({ id: "revisao", grupo: "iniciado" })).toBe("revisao");
    expect(iconeDaColuna({ id: "c-x", grupo: "nao_iniciado" })).toBe("afazer");
    expect(iconeDaColuna({ id: "c-x", grupo: "iniciado" })).toBe("fazendo");
    expect(iconeDaColuna({ id: "c-x", grupo: "feito" })).toBe("feito");
    expect(iconeDaColuna({ id: "c-x", grupo: "fechado" })).toBe("cancelado");
  });

  it("a frase de cada coluna é a regra do motor (deveComecar): A fazer aciona, Revisão e Bloqueado não", () => {
    expect(fraseDaColuna({ id: "afazer", grupo: "nao_iniciado" })).toMatch(/aciona o responsável/);
    expect(fraseDaColuna({ id: "backlog", grupo: "nao_iniciado" })).toBe("Não aciona ninguém");
    expect(fraseDaColuna({ id: "fazendo", grupo: "iniciado" })).toMatch(/aciona o responsável/);
    expect(fraseDaColuna({ id: "c-x", grupo: "iniciado" })).toMatch(/aciona o responsável/);
    expect(fraseDaColuna({ id: "revisao", grupo: "iniciado" })).toBe("Trocar o responsável aciona");
    expect(fraseDaColuna({ id: "bloqueado", grupo: "iniciado" })).toBe("Não aciona ninguém");
  });

  it("não remove Precisa de você, Cancelado nem a última de Feito; o resto sai", () => {
    expect(porqueNaoRemove(padrao, "voce", "Ada")).toBe("É onde Ada te chama. Dá para renomear.");
    expect(porqueNaoRemove(padrao, "cancelado")).toMatch(/fica no quadro/);
    expect(porqueNaoRemove(padrao, "feito")).toBe("Precisa haver uma coluna de feito.");
    expect(porqueNaoRemove(colunasDto(comDoces()), "feito")).toBeNull();
    expect(porqueNaoRemove(padrao, "fazendo")).toBe("Precisa haver uma coluna onde o trabalho anda.");
    expect(porqueNaoRemove(colunasDto(comDoces()), "fazendo")).toBeNull();
    expect(porqueNaoRemove(padrao, "revisao")).toBeNull();
    expect(porqueNaoRemove(padrao, "sumiu")).toMatch(/não existe/);
  });

  it("mover um passo: só dentro do grupo, sem passar pelas fixas", () => {
    expect(passoDeMover(padrao, "afazer", "esquerda")).toEqual({ ok: true, antes_de: "backlog" });
    expect(passoDeMover(padrao, "backlog", "direita")).toEqual({ ok: true, depois_de: "afazer" });
    expect(passoDeMover(padrao, "backlog", "esquerda")).toEqual({ ok: false, porque: "Só entre colunas de Não iniciado" });
    expect(passoDeMover(padrao, "afazer", "direita")).toEqual({ ok: false, porque: "Só entre colunas de Não iniciado" });
    expect(passoDeMover(padrao, "bloqueado", "direita")).toEqual({ ok: false, porque: "Precisa de você fica por último no andamento" });
    expect(passoDeMover(padrao, "voce", "esquerda")).toEqual({ ok: false, porque: "Precisa de você fica por último no andamento" });
    expect(passoDeMover(padrao, "cancelado", "esquerda")).toEqual({ ok: false, porque: "Esta coluna fica no lugar" });
  });

  it("soltar no arrasto: antes ou depois conforme o lado; fora do grupo ou em fixa, nada", () => {
    expect(soltarEm(padrao, "fazendo", "bloqueado")).toEqual({ depois_de: "bloqueado" });
    expect(soltarEm(padrao, "bloqueado", "fazendo")).toEqual({ antes_de: "fazendo" });
    expect(soltarEm(padrao, "fazendo", "afazer")).toBeNull();
    expect(soltarEm(padrao, "fazendo", "voce")).toBeNull();
    expect(soltarEm(padrao, "fazendo", "fazendo")).toBeNull();
  });

  it("destinos ao remover: todas menos ela e Precisa de você; o padrão é a vizinha do grupo", () => {
    const cs = colunasDto(comDoces());
    const d = destinosAoRemover(cs, "c-forno");
    expect(d.opcoes.map((c) => c.id)).not.toContain("voce");
    expect(d.opcoes.map((c) => c.id)).not.toContain("c-forno");
    expect(d.padrao).toBe("fazendo");
    expect(destinosAoRemover(cs, "c-entregue").padrao).toBe("feito");
  });

  it("nome repetido sem acento, caixa nem espaço sobrando; renomear a própria não conta", () => {
    expect(nomeRepetido(padrao, "  em REVISAO ")?.id).toBe("revisao");
    expect(nomeRepetido(padrao, "Em revisão", "revisao")).toBeNull();
    expect(nomeRepetido(padrao, "Compras")).toBeNull();
  });

  it("como o servidor: o nome não pode ser o id reservado de outra coluna, mesmo renomeada (revisão 3 do PR #615)", () => {
    const cs = padrao.map((c) => (c.id === "fazendo" ? { ...c, nome: "Produzindo" } : c));
    expect(nomeRepetido(cs, "Fazendo", "feito")?.id).toBe("fazendo");
    expect(nomeRepetido(cs, "Fazendo", "fazendo")).toBeNull();
    expect(nomeRepetido(cs, "Pedido")).toBeNull();
  });

  it("o erro do servidor pelo código fechado: dado recusado mantém o campo; conflito relê (revisão do PR #615)", () => {
    expect(fraseDoErroDeColuna("entrada_invalida")).toMatchObject({ manter: true, texto: expect.stringContaining("confira o nome") });
    expect(fraseDoErroDeColuna("servidor_indisponivel").manter).toBe(true);
    expect(fraseDoErroDeColuna("conflito")).toMatchObject({ manter: false, texto: expect.stringContaining("o quadro mudou") });
    expect(fraseDoErroDeColuna(null).manter).toBe(false);
  });

  it("sair do renomear com erro: desiste se segue repetido, vazio ou igual; corrigido, grava", () => {
    expect(saidaComErroDesiste(padrao, "fazendo", "em revisão")).toBe(true);
    expect(saidaComErroDesiste(padrao, "fazendo", "  ")).toBe(true);
    expect(saidaComErroDesiste(padrao, "fazendo", "Fazendo")).toBe(true);
    expect(saidaComErroDesiste(padrao, "fazendo", "Produção")).toBe(false);
  });

  it("o fim preso: as tiras recolhidas de Feito e Fechado no fim", () => {
    expect(inicioDoFimPreso(padrao)).toBe(6);
    expect(inicioDoFimPreso(colunasDto(comDoces()))).toBe(7);
    expect(inicioDoFimPreso(padrao.map((c) => ({ ...c, recolhida: false })))).toBe(8);
  });
});

describe("web/telas/colunas-quadro", () => {
  it("o menu: grupo no topo, desabilitados com o porquê, remover desabilitado em Precisa de você", () => {
    const h = menuDaColuna(padrao, padrao.find((c) => c.id === "voce")!, "Ada");
    expect(h).toContain(`role="menu"`);
    expect(h).toContain("Andamento");
    expect(h).toMatch(/data-act="col-remover"[^>]*aria-disabled="true"/);
    expect(h).toContain("É onde Ada te chama");
    const livre = menuDaColuna(padrao, padrao.find((c) => c.id === "revisao")!, "Ada");
    expect(livre).not.toMatch(/data-act="col-remover"[^>]*aria-disabled="true"/);
  });

  it("remover: o seletor traz o destino padrão e a frase de que não aciona ninguém", () => {
    const cs = colunasDto(comDoces());
    const h = popoverDeRemover(cs, cs.find((c) => c.id === "c-forno")!, 3);
    expect(h).toContain(`data-form="col-remover"`);
    expect(h).toMatch(/<option value="fazendo" selected/);
    expect(h).not.toContain(`value="voce"`);
    expect(h).toContain("Mudar de coluna não aciona ninguém.");
  });

  it("coluna nova: os quatro grupos para escolher; o erro aparece", () => {
    const h = colunaNova({ tipo: "nova", erro: "Escolha o grupo da coluna" });
    expect((h.match(/name="grupo"/g) ?? []).length).toBe(4);
    expect(h).toContain("Escolha o grupo da coluna");
    expect(botaoDeNova(true)).toContain(`aria-disabled="true"`);
  });

  it("a folha do celular: por grupo, com alças e o título Ordem das colunas", () => {
    expect(naFolha({ tipo: "ordem" })).toBe(true);
    expect(naFolha({ tipo: "menu", coluna: "x" })).toBe(false);
    expect(naFolha({ tipo: "renomear", coluna: "x", naFolha: true })).toBe(true);
    const h = folhaDasColunas(padrao, { tipo: "ordem" }, { fazendo: 2 }, "Ada");
    expect(h).toContain("Ordem das colunas");
    expect((h.match(/<li class="qd-fo-l\b/g) ?? []).length).toBe(8);
    expect(h).toContain("qd-alca");
  });

  it("nome hostil de coluna sai escapado no menu, na folha e no quadro", () => {
    const cs: ColunaQuadro[] = [...COLUNAS_PADRAO, { id: "c-mal", nome: MAL, grupo: "feito" }];
    const dto = colunasDto(cs);
    const c = dto.find((x) => x.id === "c-mal")!;
    for (const h of [menuDaColuna(dto, c, MAL), popoverDeRemover(dto, c, 1), folhaDasColunas(dto, { tipo: "ordem" }, {}, MAL), tela(q([t("1", { status: "c-mal" })], cs))]) {
      expect(h).not.toContain("<img");
      expect(h).not.toMatch(/onerror="/);
    }
  });
});

describe("quadroDaMeta com colunas da pessoa", () => {
  it("mostra as colunas do quadro, na ordem, com o ícone cinza só nas da pessoa", () => {
    const h = tela(q([t("1", { status: "c-forno" })], comDoces()));
    expect(h).toContain("No forno");
    expect(h.indexOf("No forno")).toBeLessThan(h.indexOf("Fazendo"));
    expect(h).toMatch(/data-coluna="c-forno"[^>]*class="[^"]*qd-col-pessoa|class="[^"]*qd-col-pessoa[^"]*"[^>]*data-coluna="c-forno"/);
    expect(h).toContain("qd-st-pessoa");
    expect(tela(q([]))).not.toContain("qd-st-pessoa");
  });

  it("quadro com as padrão fica igual: as 8 colunas, as tiras de Feito e Cancelado presas e o +", () => {
    const h = tela(q([t("1")]));
    expect((h.match(/<section class="qd-col [^"]*"[^>]*data-coluna="/g) ?? []).length).toBe(8);
    expect((h.match(/qd-fixa/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(h).toContain(`data-act="col-nova"`);
  });

  it("a coluna nova entra no quadro quando a edição pede", () => {
    expect(tela(q([]), { tipo: "nova", depoisDe: "fazendo" })).toContain("qd-col-nova");
    expect(tela(q([]))).not.toContain(`data-form="col-nova"`);
  });

  it("renomear troca o cabeçalho pelo campo", () => {
    const h = tela(q([]), { tipo: "renomear", coluna: "fazendo" });
    expect(h).toContain(`data-form="col-renomear"`);
    expect(h).toContain(`value="Fazendo"`);
  });

  it("o foco do botão da coluna volta depois que o quadro é regravado (QA do PR #615)", () => {
    const el = (classe: string, coluna: string | undefined, largo: boolean) => ({ classList: { contains: (c: string) => c === classe }, dataset: { coluna }, closest: (sel: string) => (largo && sel === ".qd-so-largo" ? {} : null) });
    expect(seletorDoFocoDaColuna(el("qd-col-bt", "c-compras", true))).toBe('.qd-so-largo .qd-col-bt[data-coluna="c-compras"]');
    expect(seletorDoFocoDaColuna(el("qd-col-bt", "fazendo", false))).toBe('.qd-col-bt[data-coluna="fazendo"]');
    expect(seletorDoFocoDaColuna(el("qd-card", "fazendo", true))).toBeNull();
    expect(seletorDoFocoDaColuna(el("qd-col-bt", 'x"]', true))).toBeNull();
  });

  it("o foco do ⋯, do Passar para… e do prazo na folha volta depois do quadro.mudou da própria mudança (QA do PR #624)", () => {
    const el = (act: string, coluna: string, onde: ".qd-so-largo" | ".qd-folha") => ({ classList: { contains: (c: string) => c === "qd-col-mais" }, dataset: { act, coluna }, closest: (sel: string) => (sel === onde ? {} : null) });
    expect(seletorDoFocoDaColuna(el("col-menu", "revisao", ".qd-so-largo"))).toBe('.qd-so-largo [data-act="col-menu"][data-coluna="revisao"]');
    expect(seletorDoFocoDaColuna(el("col-passagem", "revisao", ".qd-so-largo"))).toBe('.qd-so-largo [data-act="col-passagem"][data-coluna="revisao"]');
    expect(seletorDoFocoDaColuna(el("col-prazo", "fazendo", ".qd-folha"))).toBe('.qd-folha [data-act="col-prazo"][data-coluna="fazendo"]');
    expect(seletorDoFocoDaColuna(el("tarefa-mover", "fazendo", ".qd-so-largo"))).toBeNull();
    expect(seletorDoFocoDaColuna(el("col-menu", 'x"]', ".qd-so-largo"))).toBeNull();
  });
});
