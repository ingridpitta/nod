import { describe, expect, it } from "vitest";
import {
  COLUNAS_PADRAO, colunaDeAndamento, colunaDeEspera, colunasDe, colunasDto, criarColuna, idNovo, moverColuna, papelDe, podeTerPrazo,
  prazoLegivelMin, removerColuna, renomearColuna, resolverColuna, saoPadrao, substituirColunas, validarColunas,
} from "../../../src/domain/colunas.ts";
import type { ColunaQuadro } from "../../../src/contracts/quadro.ts";
import { lerOp, progresso } from "../../../src/domain/quadro.ts";

const ok = <T,>(r: T | { erro: string }): T => {
  if (r && typeof r === "object" && "erro" in r) throw new Error((r as { erro: string }).erro);
  return r as T;
};
const ids = (cs: readonly ColunaQuadro[]) => cs.map((c) => c.id);

// O quadro dos doces (o e2e da NOD-448): Pedido → Compras → Produção → Finalização → Embalagem → Entrega → Pago.
const DOCES = [
  { nome: "Pedido", grupo: "nao_iniciado" as const },
  { nome: "Compras", grupo: "iniciado" as const },
  { nome: "Produção", grupo: "iniciado" as const },
  { nome: "Finalização", grupo: "iniciado" as const },
  { nome: "Embalagem", grupo: "iniciado" as const },
  { nome: "Entrega", grupo: "iniciado" as const },
  { nome: "Pago", grupo: "feito" as const },
];

describe("colunas: padrão", () => {
  it("quadro sem colunas gravadas usa o padrão, que é válido e reconhecido como padrão", () => {
    expect(colunasDe({ colunas: null })).toEqual(COLUNAS_PADRAO);
    expect(validarColunas(COLUNAS_PADRAO)).toBeNull();
    expect(saoPadrao(COLUNAS_PADRAO)).toBe(true);
    expect(ids(COLUNAS_PADRAO).at(-3)).toBe("voce");
  });

  it("DTO marca fixas, da pessoa e recolhidas", () => {
    const c = ok(criarColuna(COLUNAS_PADRAO, { nome: "Teste", grupo: "iniciado" }));
    const dto = colunasDto(c.colunas);
    expect(dto.find((x) => x.id === "voce")).toMatchObject({ fixa: true, daPessoa: false, recolhida: false });
    expect(dto.find((x) => x.id === c.id)).toMatchObject({ fixa: false, daPessoa: true, recolhida: false });
    expect(dto.find((x) => x.id === "feito")!.recolhida).toBe(true);
    expect(dto.find((x) => x.id === "backlog")!.recolhida).toBe(true);
  });
});

describe("colunas: criar", () => {
  it("exige grupo e nasce no fim do grupo, antes de Precisa de você", () => {
    expect(criarColuna(COLUNAS_PADRAO, { nome: "X", grupo: "qualquer" as never })).toMatchObject({ erro: expect.stringContaining("grupo") });
    const c = ok(criarColuna(COLUNAS_PADRAO, { nome: "Testes", grupo: "iniciado" }));
    expect(c.id).toBe("c-testes");
    expect(ids(c.colunas).slice(-4)).toEqual(["c-testes", "voce", "feito", "cancelado"]);
    expect(c.ajustada).toBe(false);
  });

  it("depois_de do mesmo grupo entra ao lado; de outro grupo, ajusta", () => {
    const c = ok(criarColuna(COLUNAS_PADRAO, { nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }));
    expect(ids(c.colunas).indexOf("c-testes")).toBe(ids(c.colunas).indexOf("fazendo") + 1);
    const d = ok(criarColuna(COLUNAS_PADRAO, { nome: "Testes", grupo: "iniciado", depois_de: "feito" }));
    expect(d.ajustada).toBe(true);
    expect(validarColunas(d.colunas)).toBeNull();
  });

  it("nome repetido (sem acento/caixa) é recusado; id não colide", () => {
    expect(criarColuna(COLUNAS_PADRAO, { nome: "a fazer", grupo: "nao_iniciado" })).toMatchObject({ erro: expect.stringContaining("Já existe") });
    expect(idNovo("Produção", ["c-producao"])).toBe("c-producao-2");
  });
});

describe("colunas: renomear e mover", () => {
  it("renomeia qualquer uma, inclusive Precisa de você e Cancelado", () => {
    const r = ok(renomearColuna(COLUNAS_PADRAO, { coluna: "Precisa de você", nome: "Comigo" }));
    expect(r.colunas.find((c) => c.id === "voce")!.nome).toBe("Comigo");
    expect(r.antes).toBe("Precisa de você");
    expect(ok(renomearColuna(COLUNAS_PADRAO, { coluna: "cancelado", nome: "Arquivado" })).id).toBe("cancelado");
  });

  it("move só dentro do grupo; fixas não se movem", () => {
    const m = ok(moverColuna(COLUNAS_PADRAO, { coluna: "bloqueado", antes_de: "fazendo" }));
    expect(ids(m.colunas).indexOf("bloqueado")).toBeLessThan(ids(m.colunas).indexOf("fazendo"));
    expect(m.ajustada).toBe(false);
    const fora = ok(moverColuna(COLUNAS_PADRAO, { coluna: "fazendo", depois_de: "feito" }));
    expect(fora.ajustada).toBe(true);
    expect(validarColunas(fora.colunas)).toBeNull();
    expect(moverColuna(COLUNAS_PADRAO, { coluna: "voce", antes_de: "fazendo" })).toMatchObject({ erro: expect.stringContaining("não muda de lugar") });
    expect(moverColuna(COLUNAS_PADRAO, { coluna: "fazendo" })).toMatchObject({ erro: expect.any(String) });
  });
});

describe("colunas: remover", () => {
  it("vazia sai na hora; fixas não saem", () => {
    const r = ok(removerColuna(COLUNAS_PADRAO, { coluna: "revisao" }, []));
    expect(ids(r.colunas)).not.toContain("revisao");
    expect(r.movidas).toBe(0);
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "voce" }, [])).toMatchObject({ erro: expect.stringContaining("não sai") });
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "cancelado" }, [])).toMatchObject({ erro: expect.stringContaining("não sai") });
  });

  it("com tarefas pede destino (e lista os possíveis), sem Precisa de você nem ela mesma", () => {
    const tarefas = [{ status: "revisao" }, { status: "revisao" }, { status: "afazer" }];
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "revisao" }, tarefas)).toMatchObject({ erro: expect.stringMatching(/^coluna_com_tarefas: .*2 tarefas.*Destinos:/) });
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "revisao", destino: "voce" }, tarefas)).toMatchObject({ erro: expect.any(String) });
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "revisao", destino: "revisao" }, tarefas)).toMatchObject({ erro: expect.any(String) });
    const r = ok(removerColuna(COLUNAS_PADRAO, { coluna: "revisao", destino: "fazendo" }, tarefas));
    expect(r).toMatchObject({ destino: "fazendo", movidas: 2 });
  });

  it("não deixa o quadro sem coluna em Feito", () => {
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "feito" }, [])).toMatchObject({ erro: expect.any(String) });
  });

  it("não deixa o quadro sem onde o trabalho anda: Fazendo só sai se há uma coluna de andamento da pessoa (revisão do PR #615)", () => {
    expect(removerColuna(COLUNAS_PADRAO, { coluna: "fazendo" }, [])).toMatchObject({ erro: expect.stringContaining("onde o trabalho anda") });
    const comCompras = ok(criarColuna(COLUNAS_PADRAO, { nome: "Compras", grupo: "iniciado" })).colunas;
    expect(ok(removerColuna(comCompras, { coluna: "fazendo" }, [])).colunas.map((c) => c.id)).toContain("c-compras");
  });
});

describe("colunas: substituir (o quadro dos doces)", () => {
  it("troca o conjunto, mantém as fixas e leva cada tarefa ao destino do grupo, sem perder nenhuma", () => {
    const tarefas = [
      { id: "t1", status: "afazer" }, { id: "t2", status: "fazendo" }, { id: "t3", status: "feito" },
      { id: "t4", status: "voce" }, { id: "t5", status: "revisao" }, { id: "t6", status: "backlog" },
    ];
    const s = ok(substituirColunas(COLUNAS_PADRAO, { colunas: DOCES }, tarefas));
    expect(s.colunas.map((c) => c.nome)).toEqual(["Pedido", "Compras", "Produção", "Finalização", "Embalagem", "Entrega", "Precisa de você", "Pago", "Cancelado"]);
    expect(validarColunas(s.colunas)).toBeNull();
    expect(s.ajustada).toBe(true);
    const para = Object.fromEntries(s.movidas.map((m) => [m.tarefa, m.para]));
    expect(para).toEqual({ t1: "c-pedido", t2: "c-compras", t3: "c-pago", t5: "c-compras", t6: "c-pedido" });
    // nenhuma some: quem não foi movida está numa coluna que ficou
    const finais = new Set(ids(s.colunas));
    for (const t of tarefas) expect(finais.has(para[t.id] ?? t.status)).toBe(true);
  });

  it("destinos explícitos valem, mas nunca para Precisa de você", () => {
    const tarefas = [{ id: "t2", status: "fazendo" }];
    const s = ok(substituirColunas(COLUNAS_PADRAO, { colunas: DOCES, destinos: [{ de: "fazendo", para: "Produção" }] }, tarefas));
    expect(s.movidas).toEqual([{ tarefa: "t2", de: "fazendo", para: "c-producao" }]);
    expect(substituirColunas(COLUNAS_PADRAO, { colunas: DOCES, destinos: [{ de: "fazendo", para: "voce" }] }, tarefas)).toMatchObject({ erro: expect.any(String) });
  });

  it("grupo não muda e é obrigatório; precisa de uma coluna em Feito", () => {
    expect(substituirColunas(COLUNAS_PADRAO, { colunas: [{ id: "feito", nome: "Feito", grupo: "iniciado" }] }, [])).toMatchObject({ erro: expect.stringContaining("grupo") });
    expect(substituirColunas(COLUNAS_PADRAO, { colunas: [{ nome: "Só", grupo: "iniciado" }] }, [])).toMatchObject({ erro: expect.any(String) });
  });

  it("papel, andamento e espera nas colunas dos doces; progresso = Feito ÷ (total − Fechado)", () => {
    const s = ok(substituirColunas(COLUNAS_PADRAO, { colunas: DOCES }, []));
    expect(colunaDeEspera(s.colunas)).toBe("c-pedido");
    expect(colunaDeAndamento(s.colunas)).toBe("c-compras");
    expect(papelDe(s.colunas, "c-entrega")).toBe("fazendo");
    expect(papelDe(s.colunas, "c-pago")).toBe("feito");
    expect(resolverColuna(s.colunas, "produção")).toBe("c-producao");
    expect(resolverColuna(s.colunas, "nada")).toMatchObject({ erro: expect.stringContaining("não existe") });
    const p = progresso([{ status: "c-pago" }, { status: "c-entrega" }, { status: "cancelado" }, { status: "c-pedido" }] as never, s.colunas);
    expect(p).toMatchObject({ feitas: 1, total: 3 });
  });
});

describe("colunas: prazo (NOD-420)", () => {
  it("só onde o trabalho anda: Fazendo, Em revisão e as da pessoa no Iniciado; nunca Bloqueado, Precisa de você ou fora do Iniciado", () => {
    expect(COLUNAS_PADRAO.filter(podeTerPrazo).map((c) => c.id)).toEqual(["fazendo", "revisao"]);
    expect(ok(renomearColuna(COLUNAS_PADRAO, { coluna: "revisao", prazo_min: 30 })).colunas.find((c) => c.id === "revisao")).toMatchObject({ nome: "Em revisão", prazoMin: 30 });
    for (const coluna of ["bloqueado", "voce", "afazer", "feito"]) {
      expect(renomearColuna(COLUNAS_PADRAO, { coluna, prazo_min: 30 })).toMatchObject({ erro: expect.stringContaining("prazo só vale") });
    }
    const nova = ok(criarColuna(COLUNAS_PADRAO, { nome: "QA", grupo: "iniciado", prazo_min: 120 }));
    expect(nova.colunas.find((c) => c.id === nova.id)).toMatchObject({ prazoMin: 120 });
  });

  it("a coluna 'só a pessoa tira daqui' (NOD-419) não aceita prazo; o gravado antes da trava fica dormente (revisão 4 do PR #624)", () => {
    const trava = { soPessoa: true };
    const travada = COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, trava } as ColunaQuadro : c));
    expect(podeTerPrazo({ id: "revisao", grupo: "iniciado", trava })).toBe(false);
    expect(podeTerPrazo({ id: "revisao", grupo: "iniciado", trava: { soPessoa: false } })).toBe(true);
    expect(travada.filter(podeTerPrazo).map((c) => c.id)).toEqual(["fazendo"]);
    expect(renomearColuna(travada, { coluna: "revisao", prazo_min: 30 })).toMatchObject({ erro: expect.stringContaining("só a pessoa tira a tarefa") });
    // Tirar segue valendo; e o prazo que já estava (a trava veio depois) não derruba a validação do conjunto.
    const dormente = travada.map((c) => (c.id === "revisao" ? { ...c, prazoMin: 30 } : c));
    expect(validarColunas(dormente)).toBeNull();
    expect(ok(renomearColuna(dormente, { coluna: "revisao", nome: "Revisão" })).colunas.find((c) => c.id === "revisao")).toMatchObject({ prazoMin: 30 });
    expect(ok(renomearColuna(dormente, { coluna: "revisao", prazo_min: null })).colunas.find((c) => c.id === "revisao")?.prazoMin).toBeUndefined();
  });

  it("null tira, ausente não mexe; coluna com prazo não é padrão; o limite vale no domínio", () => {
    const com = ok(renomearColuna(COLUNAS_PADRAO, { coluna: "fazendo", prazo_min: 60 })).colunas;
    expect(saoPadrao(com)).toBe(false);
    expect(ok(renomearColuna(com, { coluna: "fazendo", nome: "Fazendo agora" })).colunas[2]).toMatchObject({ prazoMin: 60 });
    const sem = ok(renomearColuna(com, { coluna: "fazendo", prazo_min: null })).colunas;
    expect(sem.find((c) => c.id === "fazendo")?.prazoMin).toBeUndefined();
    expect(saoPadrao(sem)).toBe(true);
    expect(validarColunas(COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, prazoMin: 0 } : c)))).toMatchObject({ erro: expect.stringContaining("inválido") });
    expect(validarColunas(COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, prazoMin: 30 * 24 * 60 + 1 } : c)))).toMatchObject({ erro: expect.stringContaining("inválido") });
  });

  it("substituir guarda o prazo da coluna que fica", () => {
    const com = ok(renomearColuna(COLUNAS_PADRAO, { coluna: "fazendo", prazo_min: 45 })).colunas;
    const r = ok(substituirColunas(com, { colunas: [{ id: "afazer", nome: "A fazer", grupo: "nao_iniciado" }, { id: "fazendo", nome: "Fazendo", grupo: "iniciado" }, { id: "feito", nome: "Feito", grupo: "feito" }] }, []));
    expect(r.colunas.find((c) => c.id === "fazendo")?.prazoMin).toBe(45);
  });

  it("lerOp: renomear aceita só o prazo, null tira, e pede nome ou prazo; prazo fora do limite volta erro com o limite", () => {
    expect(lerOp({ tipo: "renomear_coluna", coluna: "fazendo", prazo_min: 30 })).toEqual({ tipo: "renomear_coluna", coluna: "fazendo", prazo_min: 30 });
    expect(lerOp({ tipo: "renomear_coluna", coluna: "fazendo", prazo_min: null })).toEqual({ tipo: "renomear_coluna", coluna: "fazendo", prazo_min: null });
    expect(lerOp({ tipo: "renomear_coluna", coluna: "fazendo" })).toEqual({ erro: "renomear_coluna precisa de nome ou prazo_min" });
    expect(lerOp({ tipo: "criar_coluna", nome: "QA", grupo: "iniciado", prazo_min: 1.5 })).toMatchObject({ erro: expect.stringContaining("43200") });
  });

  it("o prazo em palavras", () => {
    expect([30, 60, 90, 120, 1440, 4320].map(prazoLegivelMin)).toEqual(["30 min", "1 h", "1 h 30 min", "2 h", "1 dia", "3 dias"]);
  });
});
