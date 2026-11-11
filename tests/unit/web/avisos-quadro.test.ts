import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMITES_QUADRO, type ColunaQuadro, type QuadroDto, type TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto, FAIXA_DO_PRAZO as faixaNoDominio, podeTerPrazo as podeNoDominio, prazoLegivelMin as legivelNoDominio } from "../../../src/domain/colunas.ts";
import { FAIXA_DO_PRAZO, fraseDoErroDeColuna, LIMITE_PRAZO_MIN, paradaHa, podeTerPrazo, prazoEmMin, prazoLegivelMin, prazoNoPopover, reciboDaResposta } from "../../../web/lib/colunas.ts";
import { folhaDasColunas, menuDaColuna, popoverDePrazo } from "../../../web/telas/colunas-quadro.ts";
import { PASSOU_DO_PRAZO, rotuloDoCard } from "../../../web/telas/quadro.ts";
import { cardDaTarefa, quadroDaMeta } from "../../../web/telas/quadro-real.ts";

/** NOD-420: o prazo da coluna, o "parada há" e o Responder no card, sem DOM. */

const MIN = 60_000;
const AGORA = 1_800_000_000_000;
const MAL = `<img src=x onerror="alert(1)">"'&`;
const comPrazo = (): ColunaQuadro[] => COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, prazoMin: 120 } : c));
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, terminadaEm: null, agenteId: "a", ordem: 1, prioridade: "sem", linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Ada", numero: null, codigo: `#${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], cs: ColunaQuadro[] = comPrazo()): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, modoConversa: "individual", prefixo: null, meta: "Meta", prazo: null, cumpridoEm: null, metaDesde: 1, resumo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada",
  colunas: colunasDto(cs), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
});
const tela = (tarefas: TarefaDto[], edicao: Parameters<typeof quadroDaMeta>[0]["edicao"] = null) =>
  quadroDaMeta({ q: q(tarefas), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao, agora: AGORA });

describe("web/lib/colunas: prazo (NOD-420)", () => {
  it("espelha o teto, a regra e o texto do domínio", () => {
    expect(LIMITE_PRAZO_MIN).toBe(LIMITES_QUADRO.prazoMin);
    for (const c of colunasDto(COLUNAS_PADRAO)) expect(podeTerPrazo(c)).toBe(podeNoDominio(c));
    for (const m of [1, 30, 59, 60, 90, 120, 1440, 2880, 2000]) expect(prazoLegivelMin(m)).toBe(legivelNoDominio(m));
  });

  it("o popover lê e escreve em min, h e dias; recusa o que o servidor recusaria", () => {
    expect(prazoEmMin("2", "h")).toBe(120);
    expect(prazoEmMin("1,5", "h")).toBe(90);
    expect(prazoEmMin("30", "dias")).toBe(LIMITE_PRAZO_MIN);
    for (const ruim of ["", "0", "-1", "abc", "31"]) expect(prazoEmMin(ruim, "dias")).toBeNull();
    expect(prazoNoPopover(120)).toEqual({ valor: "2", unidade: "h" });
    expect(prazoNoPopover(90)).toEqual({ valor: "90", unidade: "min" });
    expect(prazoNoPopover(2880)).toEqual({ valor: "2", unidade: "dias" });
    expect(prazoNoPopover(undefined)).toEqual({ valor: "", unidade: "h" });
  });

  it("o ⋯ oferece o prazo só nas colunas do andamento; o cabeçalho mostra '2 h'", () => {
    const cs = colunasDto(comPrazo());
    const de = (id: string) => menuDaColuna(cs, cs.find((c) => c.id === id)!, "Ada");
    expect(de("revisao")).toContain("Prazo: 2 h");
    expect(de("fazendo")).toContain("Definir prazo");
    for (const id of ["afazer", "bloqueado", "feito"]) expect(de(id)).not.toContain('data-act="col-prazo"');
    expect(cs.some((c) => c.id === "voce")).toBe(false);
    expect(tela([])).toContain(`<span class="qd-col-prazo" title="Prazo da coluna: 2 h"><span class="qd-sr">Prazo: </span>2 h</span>`);
  });

  it("cabeçalho com prazo: o nome não some (title com o nome inteiro, prazo como chip ao lado; QA do PR #624)", () => {
    const longo = "Revisão do código pela equipe inteira";
    const cs = comPrazo().map((c) => (c.id === "revisao" ? { ...c, nome: longo } : c));
    const h = quadroDaMeta({ q: q([], cs), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao: null, agora: AGORA, agentes: [{ id: "a", nome: "Ada" }] });
    // O nome cortado por reticências tem o inteiro no title; o chip vem logo depois do botão do nome.
    expect(h).toMatch(new RegExp(`<span class="qd-col-nome" title="${longo}">${longo}</span><span class="qd-n">0</span></button><span class="qd-col-prazo" title="Prazo da coluna: 2 h"><span class="qd-sr">Prazo: </span>2 h</span>`));
    // Medido em 2026-11-02 (Chrome headless, coluna de 232 px, com "Passar para…" e ⋯): sem o piso, "Fazendo" ficava com
    // 17 px e o nome longo com 26 px. O CSS garante o piso do nome, o chip sem quebra e a passagem encolhendo antes.
    const css = readFileSync(new URL("../../../web/quadro.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regra = (sel: string): string => {
      const m = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((r) => r[1]!.split(",").map((s) => s.trim()).includes(sel)).map((r) => r[2]!).join(";");
      expect(m, `regra de ${sel}`).not.toBe("");
      return m.replace(/\s+/g, " ");
    };
    const prop = (sel: string, p: string): string[] => [...regra(sel).matchAll(new RegExp(`(?:^|;)\\s*${p}\\s*:\\s*([^;]+)`, "g"))].map((x) => x[1]!.trim());
    expect(prop(".qd-col-prazo", "white-space")).toContain("nowrap");
    expect(prop(".qd-col-prazo", "flex")).toContain("none");
    expect(prop(".qd-col-prazo", "border-radius").length).toBeGreaterThan(0);
    const piso = prop(".qd-col-cab > .qd-col-bt", "min-width");
    expect(piso.length, "o botão do nome tem um piso de largura").toBeGreaterThan(0);
    expect(piso.at(-1)).not.toBe("0");
    expect(prop(".qd-col-passa", "flex").at(-1), "o Passar para… encolhe antes do nome").toMatch(/^0 [1-9]\d* /);
    expect(prop(".qd-col-passa", "min-width").length).toBeGreaterThan(0);
  });

  it("prazo fora da faixa: a tela diz a faixa, não o aviso do navegador nem o erro genérico (QA do PR #624)", () => {
    expect(FAIXA_DO_PRAZO).toBe(faixaNoDominio);
    expect(FAIXA_DO_PRAZO).toBe("de 1 min a 30 dias");
    const h = popoverDePrazo(colunasDto(comPrazo()).find((c) => c.id === "revisao")!);
    // Sem a validação nativa (min/max/step do input), o 0, o 1,5 h e o 50 dias chegam ao envio, que responde com a faixa.
    expect(h).toContain('<form data-form="col-prazo" data-coluna="revisao" novalidate>');
    expect(h).not.toMatch(/id="qd-prz-valor"[^>]*\s(min|max|step)="(?!any)/);
    // O 400 do servidor ao salvar o prazo diz a faixa (antes: "confira o nome e o grupo").
    expect(fraseDoErroDeColuna("entrada_invalida", "prazo").texto).toContain(FAIXA_DO_PRAZO);
    expect(fraseDoErroDeColuna("entrada_invalida").texto).toContain("nome e o grupo");
  });

  it("o popover do prazo: valor atual, Sem prazo só quando tem, erro anunciado e nome escapado", () => {
    const cs = colunasDto(comPrazo());
    const h = popoverDePrazo(cs.find((c) => c.id === "revisao")!);
    expect(h).toContain('value="2"');
    expect(h).toContain('<option value="h" selected>');
    expect(h).toContain('data-act="col-prazo-tirar"');
    expect(popoverDePrazo(cs.find((c) => c.id === "fazendo")!)).not.toContain("col-prazo-tirar");
    const err = popoverDePrazo({ ...cs.find((c) => c.id === "fazendo")!, nome: MAL }, "Use um número");
    expect(err).toContain('role="alert"');
    expect(err).toContain('aria-invalid="true"');
    expect(err).not.toContain("<img");
    expect(tela([], { tipo: "prazo", coluna: "revisao" })).toContain('data-form="col-prazo"');
  });

  it("a folha do celular tem o prazo das colunas do andamento; abre o popover na linha, não no cabeçalho (revisão 4 do PR #624)", () => {
    const cs = colunasDto(comPrazo());
    const folha = folhaDasColunas(cs, { tipo: "ordem" }, {}, "Ada");
    expect(folha).toContain(`<button type="button" class="qd-fo-prazo" data-act="col-prazo" data-coluna="revisao" aria-label="Prazo de Em revisão: 2 h">2 h</button>`);
    expect(folha).toContain(`data-act="col-prazo" data-coluna="fazendo" aria-label="Definir prazo de Fazendo">Prazo</button>`);
    for (const id of ["afazer", "voce", "bloqueado", "feito"]) expect(folha).not.toContain(`data-act="col-prazo" data-coluna="${id}"`);
    const aberta = folhaDasColunas(cs, { tipo: "prazo", coluna: "revisao", naFolha: true }, {}, "Ada");
    expect(aberta).toContain(`<li class="qd-fo-l qd-fo-edit" data-coluna="revisao"><div class="qd-pop qd-pop-prazo"`);
    // Na folha, o cabeçalho da coluna não abre outro popover (o form ficaria duplicado, com o mesmo id).
    const h = tela([], { tipo: "prazo", coluna: "revisao", naFolha: true });
    expect(h.match(/data-form="col-prazo"/g) ?? []).toHaveLength(h.includes('class="qd-folha"') ? 1 : 0);
  });
});

describe("card: parada há e Responder (NOD-420)", () => {
  it("'parada há' pelo relógio, em destaque além do prazo; tarefa andando sem prazo não mostra", () => {
    expect(paradaHa(AGORA - 30_000, AGORA)).toBe("parada agora");
    expect(paradaHa(AGORA - 5 * MIN, AGORA)).toBe("parada há 5 min");
    expect(paradaHa(AGORA - 3 * 60 * MIN, AGORA)).toBe("parada há 3 h");
    expect(paradaHa(AGORA - 50 * 60 * MIN, AGORA)).toBe("parada há 2 dias");
    const h = tela([
      t("1", { status: "revisao", naColunaDesde: AGORA - 3 * 60 * MIN }),
      t("2", { status: "revisao", naColunaDesde: AGORA - 10 * MIN }),
      t("3", { status: "fazendo", naColunaDesde: AGORA - 999 * MIN }),
    ]);
    // Revisão 4 do PR #624 (a11y): o relógio decorativo e o "passou do prazo" para quem não vê a cor.
    expect(h).toMatch(/<span class="qd-quando qd-atrasada" title="Passou do prazo da coluna"><svg class="qd-ic qd-ic-prazo"[^>]*aria-hidden="true">.*?<\/svg>parada há 3 h<span class="qd-sr">, passou do prazo<\/span><\/span>/);
    expect(h).toContain(`<span class="qd-quando">parada há 10 min</span>`);
    expect(h).not.toContain("parada há 16 h");
    // O rótulo do botão do card (o que o leitor de tela lê ao focar) também diz.
    expect(h).toContain(`data-act="abrir-tarefa" data-id="1" aria-label="#1, Tarefa 1, ${PASSOU_DO_PRAZO}"`);
    const agente: Parameters<typeof cardDaTarefa>[1] = () => null;
    const atrasada = cardDaTarefa(t("1", { status: "revisao", naColunaDesde: AGORA - 3 * 60 * MIN }), agente, false, { agora: AGORA, prazoMin: 120 });
    expect(atrasada.atrasada).toBe(true);
    expect(rotuloDoCard(atrasada)).toMatch(/, passou do prazo$/);
    const noPrazo = cardDaTarefa(t("2", { status: "revisao", naColunaDesde: AGORA - 10 * MIN }), agente, false, { agora: AGORA, prazoMin: 120 });
    expect(rotuloDoCard(noPrazo)).not.toContain(PASSOU_DO_PRAZO);
  });

  it("coluna 'só a pessoa tira daqui' (NOD-419): sem prazo no ⋯ nem na folha; o gravado antes da trava não marca atraso (revisão 4 do PR #624)", () => {
    const travada = comPrazo().map((c) => (c.id === "revisao" ? { ...c, trava: { soPessoa: true } } as ColunaQuadro : c));
    const cs = colunasDto(travada).map((c, i) => ({ ...c, ...(travada[i]!.id === "revisao" ? { trava: { soPessoa: true } } : {}) }));
    const rev = cs.find((c) => c.id === "revisao")!;
    expect(podeTerPrazo(rev)).toBe(false);
    expect(menuDaColuna(cs, rev, "Ada")).not.toContain('data-act="col-prazo"');
    expect(folhaDasColunas(cs, { tipo: "ordem" }, {}, "Ada")).not.toContain('data-act="col-prazo" data-coluna="revisao"');
    const h = quadroDaMeta({ q: { ...q([t("1", { status: "revisao", naColunaDesde: AGORA - 3 * 60 * MIN })]), colunas: cs }, nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set(), edicao: null, agora: AGORA });
    expect(h).not.toContain("qd-atrasada");
    expect(h).not.toContain('class="qd-col-prazo"');
  });

  it("Bloqueado traz o Responder no card e na linha; a pergunta do bot (ADR-162) só o \"te perguntou\"; as outras nada", () => {
    const h = tela([t("1", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Azul?" }), t("2", { status: "bloqueado", pergunta: "Acesso?" }), t("3", { status: "fazendo", titulo: MAL })]);
    expect(h).toContain(`<form class="qd-card-resp" data-form="responder-tarefa" data-id="2">`);
    expect(h).toContain(`id="qd-cresp-card-2"`);
    expect(h).toContain(`id="qd-cresp-linha-2"`);
    expect(h).not.toContain(`data-form="responder-tarefa" data-id="1"`);
    // A que espera a pessoa fica na coluna dela, com o chip com sino (2026-11-10), no card e na linha do celular.
    expect((h.match(/<span class="qd-espera qd-espera-voce" title="Esperando você responder">/g) ?? []).length).toBe(2);
    expect(h).not.toContain("qd-perguntou");
    expect(h).toContain(`aria-label="Responder: Tarefa 2"`);
    // O Enviar diz de qual tarefa é (revisão 3 do PR #624), com o título escapado.
    expect(h).toContain(`aria-label="Enviar resposta: Tarefa 2"`);
    const mal = tela([t("4", { status: "bloqueado", pergunta: "?", titulo: MAL })]);
    expect(mal).toContain(`aria-label="Enviar resposta: ${MAL.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")}"`);
    expect(h).toContain(`maxlength="${LIMITES_QUADRO.resposta}"`);
    expect(h).not.toContain('data-id="3"><textarea');
    expect(h).not.toContain("<img");
  });

  it("o recibo diz para onde voltou e quem segue", () => {
    const depois = q([t("1", { status: "revisao", agenteNome: "Beto" }), t("2", { status: "afazer", agenteId: null, agenteNome: null })]);
    expect(reciboDaResposta(depois, "1")).toBe("Voltou para Em revisão · Beto segue");
    expect(reciboDaResposta(depois, "2")).toBe("Voltou para A fazer");
    expect(reciboDaResposta(null, "1")).toBe("Resposta enviada");
  });
});
