import { describe, expect, it } from "vitest";
import { COLUNAS_PADRAO } from "../../../src/domain/colunas.ts";
import {
  colunaDoEstado, colunasDaImportacao, cortarComLink, identificadorDaUrl, IMPORTACAO_PARADA_MS, importacaoParada, itemDaIssue, LIMITE_IMPORTACAO, linhaDeTopo,
  linhaDoLinear, numerosDaImportacao, passaNoFiltro, previaDaImportacao, prMaisRecente, type IssueLinear,
} from "../../../src/domain/importar-linear.ts";

const issue = (o: Partial<IssueLinear> = {}): IssueLinear => ({
  identificador: "NOD-422", numero: 422, titulo: "Trazer o trabalho", url: "https://linear.app/nod/issue/NOD-422/trazer",
  descricao: "corpo", estado: "Implementando", noEstadoDesde: Date.UTC(2026, 9, 30), etiquetas: [], mae: null, bloqueadaPor: [],
  comentarios: [], anexos: [], ...o,
});

describe("importar do Linear (NOD-422)", () => {
  it("cada estado da tabela cai na sua coluna; estado novo vai para o Backlog com a nota", () => {
    expect(colunaDoEstado("Implementando")).toEqual({ coluna: "fazendo", nota: null });
    expect(colunaDoEstado("revisando")).toEqual({ coluna: "revisao", nota: null });
    expect(colunaDoEstado("Lançando").coluna).toBe("c-lancando");
    expect(colunaDoEstado("Triagem")).toEqual({ coluna: "backlog", nota: "estado Triagem do Linear sem coluna" });
  });

  it("as colunas da importação têm os nomes do Linear e o responsável pelo nome do bot (Revisando = Faustino)", () => {
    const agentes = [{ id: "a-ada", nome: "Ada" }, { id: "a-x", nome: "Faustino" }, { id: "a-gil", nome: "Gil" }];
    const r = colunasDaImportacao(COLUNAS_PADRAO, agentes);
    if ("erro" in r) throw new Error(r.erro);
    const por = new Map(r.map((c) => [c.id, c]));
    expect(por.get("afazer")).toMatchObject({ nome: "Priorizado", responsavel: "a-ada" });
    expect(por.get("revisao")).toMatchObject({ nome: "Revisando", responsavel: "a-x" });
    expect(por.get("c-prototipando")).toMatchObject({ responsavel: "a-gil" });
    // Teodora e Lançador não existem: a coluna fica sem ninguém (nasce recolhida na tela).
    expect(por.get("c-qa")?.responsavel).toBeUndefined();
    // ADR-162: sem "Precisa de você" (a precisa-humano espera a pessoa na coluna do estado).
    expect(!por.has("voce") && por.has("cancelado") && por.has("feito")).toBe(true);
  });

  it("a coluna que já existe guarda o responsável e a passagem; o padrão da tabela só preenche a vazia (revisão do PR #630)", () => {
    const agentes = [{ id: "a-ada", nome: "Ada" }, { id: "a-x", nome: "Faustino" }];
    const atuais = COLUNAS_PADRAO.map((c) =>
      c.id === "revisao" ? { ...c, responsavel: "a-ada", instrucoes: "revise o PR e rode os testes" } : c.id === "afazer" ? { ...c, responsavel: null } : c,
    );
    const r = colunasDaImportacao(atuais, agentes);
    if ("erro" in r) throw new Error(r.erro);
    const por = new Map(r.map((c) => [c.id, c]));
    expect(por.get("revisao")).toMatchObject({ nome: "Revisando", responsavel: "a-ada", instrucoes: "revise o PR e rode os testes" });
    expect(por.get("afazer")).toMatchObject({ responsavel: "a-ada" });
  });

  it("a importação trazendo sem progresso há mais de 10 minutos está parada; as outras não", () => {
    const agora = Date.UTC(2026, 10, 2, 12);
    expect(importacaoParada({ estado: "trazendo", atualizadoEm: agora - IMPORTACAO_PARADA_MS - 1 }, agora)).toBe(true);
    expect(importacaoParada({ estado: "trazendo", atualizadoEm: agora - 60_000 }, agora)).toBe(false);
    expect(importacaoParada({ estado: "falhou", atualizadoEm: 0 }, agora)).toBe(false);
  });

  it("descrição longa é cortada no teto com o link do resto", () => {
    const url = "https://linear.app/nod/issue/NOD-1";
    const t = cortarComLink("x".repeat(5000), url);
    expect(t.length).toBeLessThanOrEqual(4000);
    expect(t.endsWith(`… continua no Linear: ${url}`)).toBe(true);
    expect(cortarComLink("curto", url)).toBe("curto");
  });

  it("a linha do topo junta etiquetas, mãe e bloqueios", () => {
    expect(linhaDeTopo({ etiquetas: ["ux", "web"], mae: "NOD-400", bloqueadaPor: ["NOD-416"] }, null))
      .toBe("Etiquetas: ux, web · Mãe: NOD-400 · Bloqueada por: NOD-416");
    expect(linhaDeTopo({ etiquetas: [], mae: null, bloqueadaPor: [] }, null)).toBe("");
  });

  it("o PR é o mais recente do GitHub; outros anexos ficam de fora", () => {
    expect(prMaisRecente([
      { url: "https://github.com/gamefik/nod/pull/10", criadoEm: 1 },
      { url: "https://github.com/gamefik/nod/pull/12/files", criadoEm: 3 },
      { url: "https://figma.com/x", criadoEm: 5 },
    ])).toBe("https://github.com/gamefik/nod/pull/12");
    expect(prMaisRecente([])).toBeNull();
  });

  it("a issue vira tarefa: precisa-humano vai para Precisa de você e volta para a do estado; só os 10 últimos comentários", () => {
    const comentarios = Array.from({ length: 14 }, (_, k) => ({ id: `c${k}`, autor: "Ada", texto: `t${k}`, criadoEm: k }));
    const it1 = itemDaIssue(issue({ etiquetas: ["precisa-humano"], comentarios, estado: "QA" }));
    expect(it1).toMatchObject({ status: "voce", voltarPara: "c-qa", numero: 422 });
    expect(it1.comentarios.map((c) => c.id)).toEqual(["c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13"]);
    expect(it1.descricao.startsWith("Etiquetas: precisa-humano\n\ncorpo")).toBe(true);
    const it2 = itemDaIssue(issue({ estado: "Triagem" }));
    expect(it2).toMatchObject({ status: "backlog", voltarPara: null });
    expect(it2.descricao).toContain("Nota: estado Triagem do Linear sem coluna");
  });

  it("a linha do histórico diz o estado e desde quando", () => {
    expect(linhaDoLinear("Implementando", Date.UTC(2026, 9, 30, 15))).toBe("No Linear em Implementando desde 30/10");
  });

  it("QA do PR #630: o dia do \"desde\" é o de São Paulo, não o de UTC", () => {
    // 01/11 às 01:30 em UTC ainda é 31/10 às 22:30 em São Paulo.
    expect(linhaDoLinear("QA", Date.UTC(2026, 10, 1, 1, 30))).toBe("No Linear em QA desde 31/10");
    expect(linhaDoLinear("QA", Date.UTC(2026, 10, 1, 3, 30))).toBe("No Linear em QA desde 01/11");
  });

  it("QA do PR #630: os vazios saem antes do corte; vêm os 10 últimos com texto", () => {
    const comentarios = [
      ...Array.from({ length: 12 }, (_, k) => ({ id: `c${k}`, autor: "Ada", texto: `t${k}`, criadoEm: k })),
      ...Array.from({ length: 3 }, (_, k) => ({ id: `v${k}`, autor: "Ada", texto: k === 1 ? "   " : "", criadoEm: 100 + k })),
    ];
    expect(itemDaIssue(issue({ comentarios })).comentarios.map((c) => c.id)).toEqual(["c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"]);
  });

  it("o mesmo número quando está livre; novo depois do maior quando uma nativa já usa", () => {
    const { numeros, proximo } = numerosDaImportacao(
      [{ identificador: "NOD-513", numero: 513 }, { identificador: "NOD-7", numero: 7 }, { identificador: "NOD-600", numero: 600 }],
      [{ numero: 513, linearId: null }, { numero: 3, linearId: null }],
      4,
    );
    expect(numeros.get("NOD-7")).toBe(7);
    expect(numeros.get("NOD-600")).toBe(600);
    expect(numeros.get("NOD-513")).toBe(601);
    expect(proximo).toBe(602);
  });

  it("o número que um código guardado já usa (tarefa excluída, código antigo) conta como ocupado (revisão do PR #630)", () => {
    const { numeros, proximo } = numerosDaImportacao([{ identificador: "NOD-2", numero: 2 }, { identificador: "NOD-9", numero: 9 }], [{ numero: 1, linearId: null }], 3, [2, 5]);
    expect(numeros.get("NOD-9")).toBe(9);
    expect(numeros.get("NOD-2")).toBe(10);
    expect(proximo).toBe(11);
  });

  it("reimportar mantém o número que a tarefa já tem", () => {
    const { numeros } = numerosDaImportacao([{ identificador: "NOD-9", numero: 9 }], [{ numero: 20, linearId: "NOD-9" }], 21);
    expect(numeros.get("NOD-9")).toBe(20);
  });

  it("a prévia conta por coluna, quem precisa de você e os estados sem coluna; o filtro tira o Backlog", () => {
    const issues = [issue(), issue({ estado: "Backlog" }), issue({ estado: "Triagem", etiquetas: ["precisa-humano"] })];
    const p = previaDaImportacao(issues, new Map([["fazendo", "Faustino"]]));
    expect(p.total).toBe(3);
    expect(p.colunas.find((c) => c.coluna === "fazendo")).toMatchObject({ tarefas: 1, responsavel: "Faustino" });
    // ADR-162: a Triagem precisa-humano conta no Backlog (a coluna do estado, onde o card aparece esperando a pessoa).
    expect(p.colunas.find((c) => c.coluna === "backlog")?.tarefas).toBe(2);
    expect(p.colunas.some((c) => c.coluna === "voce")).toBe(false);
    expect(p.precisamDeVoce).toBe(1);
    expect(p.semColuna).toEqual(["Triagem"]);
    expect(issues.filter((i) => passaNoFiltro(i, "sem_backlog"))).toHaveLength(1);
    expect(LIMITE_IMPORTACAO).toBe(500);
  });

  it("revisão 4 do PR #630: a prévia conta cada issue numa coluna só, a mesma em que o card aparece (ADR-162: precisa-humano na coluna do estado)", () => {
    const issues = [
      issue(), issue({ estado: "Implementando", etiquetas: ["precisa-humano"] }), issue({ estado: "QA", etiquetas: ["Precisa-Humano"] }),
      issue({ estado: "Backlog" }), issue({ estado: "Triagem" }),
    ];
    const p = previaDaImportacao(issues, new Map());
    expect(p.colunas.reduce((s, c) => s + c.tarefas, 0)).toBe(p.total);
    expect(p.colunas.find((c) => c.coluna === "fazendo")?.tarefas).toBe(issues.filter((i) => i.estado === "Implementando").length);
    expect(p.colunas.find((c) => c.coluna === "c-qa")?.tarefas).toBe(1);
    expect(p.colunas.some((c) => c.coluna === "voce")).toBe(false);
    expect(p.precisamDeVoce).toBe(2);
    // A mesma coluna em que o card do aplicarImportacao aparece (itemDaIssue): a precisa-humano espera em `voltarPara`.
    const porColuna = new Map<string, number>();
    for (const it of issues.map((i) => itemDaIssue(i))) { const col = it.status === "voce" ? it.voltarPara! : it.status; porColuna.set(col, (porColuna.get(col) ?? 0) + 1); }
    for (const c of p.colunas) expect(c.tarefas).toBe(porColuna.get(c.coluna) ?? 0);
  });

  it("a URL do Linear vira o identificador", () => {
    expect(identificadorDaUrl("https://linear.app/nod/issue/nod-422/trazer-o-trabalho")).toBe("NOD-422");
    expect(identificadorDaUrl("NOD-422")).toBeNull();
    expect(identificadorDaUrl("https://exemplo.com/issue/NOD-1")).toBeNull();
  });
});
