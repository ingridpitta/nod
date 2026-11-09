import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import type { AcaoLote, AppConectado } from "../../../src/contracts/ferramentas-do-nod.ts";
import { decidirLote, resolverBot, riscoDaAcao, validarLote, type BotDoLote } from "../../../src/domain/lote-bots.ts";
import { FERRAMENTAS_DO_NOD, montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { MANUAL_DO_NOD, manualDoNod, TETO_MANUAL_DO_NOD } from "../../../src/domain/manual-do-nod.ts";

/** ADR-082: o lote do Nod, puro — validar tudo antes, resolver alvos e "@ref", risco e modo. */
const P = "pessoa";
const bot = (id: string, nome: string, extra: Partial<BotDoLote> = {}): BotDoLote => ({ id, nome, ownerId: P, dono: "pessoa", papel: null, excluidoEm: null, ...extra });
const BOTS: BotDoLote[] = [
  bot("b1", "Dev 1"),
  bot("b2", "Dev 2"),
  bot("nod", "Nod", { papel: "nod" }),
  bot("velho", "Dev antigo", { excluidoEm: 1 }),
  bot("outro", "Da Ana", { ownerId: "ana" }),
  bot("emp", "Da empresa", { dono: "empresa" }),
  bot("x1", "Gêmeo"),
  bot("x2", "gêmeo"),
];
const APPS: AppConectado[] = [{ slug: "github", nome: "GitHub", niveis: ["leitura", "escrita"] }, { slug: "agenda", nome: "Agenda", niveis: ["leitura"] }];
const valida = (acoes: AcaoLote[]) => validarLote(acoes, BOTS, APPS, P);

describe("validarLote (ADR-082)", () => {
  it("o pedido do Marlon: duplicar três e criar dois numa seção resolve os alvos por nome e por id", () => {
    const r = valida([
      { tipo: "duplicar", bot: "dev 1" },
      { tipo: "duplicar", bot: "b2" },
      { tipo: "criar", nome: "Revisor de PR", descricao: "Revisa os PRs.", secao: "Engenharia", ref: "rev" },
      { tipo: "dar_acesso", bot: "@rev", app: "github", nivel: "escrita" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acoes.map((a) => [a.alvoId, a.alvoDaAcao, a.alvoNome])).toEqual([["b1", null, "Dev 1"], ["b2", null, "Dev 2"], [null, null, "Revisor de PR"], [null, 2, "Revisor de PR"]]);
  });

  it("qualquer problema recusa o lote inteiro e lista todos, com o índice", () => {
    const r = valida([
      { tipo: "excluir", bot: "Nod" },
      { tipo: "editar", bot: "Da Ana", nome: "x" },
      { tipo: "mover", bot: "Da empresa", secao: "" },
      { tipo: "excluir", bot: "Dev antigo" },
      { tipo: "editar", bot: "Gêmeo", titulo: "x" },
      { tipo: "dar_acesso", bot: "Dev 1", app: "gmail", nivel: "leitura" },
      { tipo: "dar_acesso", bot: "Dev 1", app: "agenda", nivel: "escrita" },
      { tipo: "criar", nome: "nod", descricao: "x" },
      { tipo: "criar", nome: "Sem descrição" },
      { tipo: "editar", bot: "Dev 1" },
      { tipo: "excluir", bot: "@nada" },
      { tipo: "excluir", bot: "Ninguém" },
      { tipo: "criar_rotina", bot: "Dev 1", cron: "0 8 * * *" },
      { tipo: "excluir", bot: "Dev 1", ref: "r" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const por = Object.fromEntries(r.problemas.map((p) => [p.i, p.motivo]));
    expect(por[0]).toContain("o Nod não mexe em si mesmo");
    expect(por[1]).toContain("não é um bot seu");
    expect(por[2]).toContain("não é um bot seu");
    expect(por[3]).toContain("não achei");
    expect(por[4]).toContain("mais de um bot");
    expect(por[5]).toContain("não está conectado");
    expect(por[6]).toContain("não tem ferramentas de escrita");
    expect(por[7]).toContain("o nome Nod é do bot fixo");
    expect(por[8]).toContain("descrição");
    expect(por[9]).toContain("sem nada para mudar");
    expect(por[10]).toContain("não é o ref de uma ação anterior");
    expect(por[11]).toContain("não achei");
    expect(por[12]).toContain("cron, fuso_iana e instrucao");
    expect(por[13]).toContain("ref só vale em criar e duplicar");
  });

  it("o bot excluído não é achado por nome, mas pelo id diz que foi excluído; @ref à frente ou a si mesmo não vale", () => {
    expect(resolverBot("velho", BOTS, P)).toEqual({ motivo: '"Dev antigo" foi excluído' });
    const r = valida([{ tipo: "duplicar", bot: "@a", ref: "a" }, { tipo: "excluir", bot: "@b" }, { tipo: "criar", nome: "B", descricao: "x", ref: "b" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.i)).toEqual([0, 1]);
  });

  it("QA independente do PR #706: acesso em lote, padrão do app e Desfazer não entram pelo gerir_bots (só pelo gerir_acessos, que monta o card)", () => {
    // Pelo gerir_bots o executor rodaria com a regra do modo do Nod; a confirmação de Ler e alterar só vem do card.
    for (const tipo of ["acessos_em_lote", "padrao_acesso", "desfazer_acessos"]) {
      const r = valida([{ tipo, app: "github", nivel_lote: "escrita", todos: true, lote_id: "x" } as unknown as AcaoLote]);
      expect(r.ok, tipo).toBe(false);
      if (!r.ok) expect(r.problemas[0]?.motivo, tipo).toContain("gerir_acessos");
    }
  });

  it("ADA-245 (merge com a ADA-241): remover_computador pelo gerir_bots recusa com UM motivo só, apontando o remover_computador", () => {
    // O merge deixou o case cair no dos acessos (sem break): saíam dois motivos, o segundo mandando para o gerir_acessos.
    const r = valida([{ tipo: "remover_computador", maquina_id: "m1" } as unknown as AcaoLote]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.motivo)).toEqual(["remover um computador é com remover_computador"]);
  });

  it("mais de 20 ações, ou nenhuma, recusa", () => {
    const muitas = Array.from({ length: 21 }, (): AcaoLote => ({ tipo: "excluir", bot: "Dev 1" }));
    expect(valida(muitas).ok).toBe(false);
    expect(valida([]).ok).toBe(false);
  });
});

describe("risco e modo (ADR-082)", () => {
  it("excluir e mudar o modo são arriscados sempre; dar acesso e duplicar com acessos, só depois de conteúdo de fora", () => {
    const limpo = { contaminado: false, alvoTemAcessos: true };
    const sujo = { contaminado: true, alvoTemAcessos: true };
    expect(riscoDaAcao({ tipo: "excluir" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo", modo: "automatico" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo", modo: "total" }, limpo)).toBe("ligar_total");
    expect(riscoDaAcao({ tipo: "mudar_modo", modo: "total" }, sujo)).toBe("ligar_total");
    expect(riscoDaAcao({ tipo: "dar_acesso" }, limpo)).toBeNull();
    expect(riscoDaAcao({ tipo: "dar_acesso" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "duplicar" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "duplicar" }, { contaminado: true, alvoTemAcessos: false })).toBeNull();
    for (const tipo of ["criar", "editar", "mover"] as const) expect(riscoDaAcao({ tipo }, sujo)).toBeNull();
    // Revisão de 2026-10-07: o que grava instrução que um bot segue depois também espera, depois de conteúdo de fora.
    expect(riscoDaAcao({ tipo: "criar_rotina" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "editar", descricao: "faça X" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "editar", titulo: "Novo" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "criar_rotina" }, limpo)).toBeNull();
  });

  it("manual espera tudo; automático faz o seguro e espera o arriscado; total faz tudo; quem depende de quem espera, espera", () => {
    const r = valida([{ tipo: "criar", nome: "Novo", descricao: "x", ref: "n" }, { tipo: "excluir", bot: "Dev 2" }, { tipo: "dar_acesso", bot: "@n", app: "github", nivel: "leitura" }]);
    if (!r.ok) throw new Error("lote inválido");
    const riscos = [null, "arriscada" as const, null];
    expect(decidirLote(r.acoes, "manual", riscos)).toEqual(["manual", "arriscada", "manual"]);
    expect(decidirLote(r.acoes, "automatico", riscos)).toEqual([null, "arriscada", null]);
    expect(decidirLote(r.acoes, "total", riscos)).toEqual([null, null, null]);
    // O criar espera (conteúdo de fora não pesa no criar, mas um card manual sim) → o acesso ao bot que ele cria espera junto.
    expect(decidirLote(r.acoes, "automatico", ["arriscada", null, null])).toEqual(["arriscada", null, "arriscada"]);
  });

  it("2026-10-18: ligar o total espera a pessoa em todo modo do Nod, inclusive no total; quem depende dele espera junto", () => {
    const r = valida([{ tipo: "mudar_modo", bot: "Dev 2", modo: "total" }, { tipo: "mudar_modo", bot: "Dev 2", modo: "automatico" }]);
    if (!r.ok) throw new Error("lote inválido");
    const limpo = { contaminado: false, alvoTemAcessos: false };
    const riscos = r.acoes.map((a) => riscoDaAcao(a, limpo));
    expect(riscos).toEqual(["ligar_total", "arriscada"]);
    expect(decidirLote(r.acoes, "manual", riscos)).toEqual(["ligar_total", "arriscada"]);
    expect(decidirLote(r.acoes, "automatico", riscos)).toEqual(["ligar_total", "arriscada"]);
    expect(decidirLote(r.acoes, "total", riscos)).toEqual(["ligar_total", null]);
    const ref = valida([{ tipo: "criar", nome: "Novo", descricao: "x", ref: "n" }, { tipo: "mudar_modo", bot: "@n", modo: "total" }]);
    if (!ref.ok) throw new Error("lote inválido");
    expect(decidirLote(ref.acoes, "total", ref.acoes.map((a) => riscoDaAcao(a, limpo)))).toEqual([null, "ligar_total"]);
  });
});

describe("catálogo e prompt do Nod (ADR-081/082)", () => {
  const agora = 1_000_000;
  const agente: Agente = { tenantId: "t", id: "nod", ownerId: "p", visibility: "privado", nome: "Nod", titulo: "Ajudante", descricao: "o bot fixo", dono: "pessoa", forma: "shape-square", cor: "c-black", fixado: true, oculto: false, confirmado: true, modelo: "auto", duplicadoDe: null, criadoEm: 0, papel: "nod" };
  const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "nod", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 1, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "auto", criadoEm: agora, mensagemOrigemId: "m0" };
  const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.290", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
  const nomes = (e: EntradaPlano) => montarPlano(e).catalogo.ferramentas.map((f) => f.nome);

  it("as ferramentas do Nod entram só no turno DELE com a pessoa (conversa, criação); nunca em rotina, sala, ligação nem delegação", () => {
    for (const modo of ["conversa", "criacao"] as const) expect(nomes({ ...base, modo })).toEqual(expect.arrayContaining([...FERRAMENTAS_DO_NOD]));
    for (const modo of ["rotina", "sala", "ligacao", "delegacao", "peer"] as const) {
      const n = nomes({ ...base, modo, ...(modo === "delegacao" ? { delegacao: { pessoaNome: "Marlon", remetenteNome: "Vera" } } : {}) });
      for (const f of FERRAMENTAS_DO_NOD) expect(n).not.toContain(f);
    }
    // Outro bot, mesmo na conversa: nada.
    const comum = nomes({ ...base, agente: { ...agente, id: "a1", nome: "Vera", papel: null } });
    for (const f of FERRAMENTAS_DO_NOD) expect(comum).not.toContain(f);
    // NOD_GERIR_BOTS=0: o interruptor tira as três.
    for (const f of FERRAMENTAS_DO_NOD) expect(nomes({ ...base, semFerramentasDoNod: true })).not.toContain(f);
  });

  it("revisão do PR #401: o manual diz ao Nod todo tipo que vira card depois de conteúdo de fora (riscoDaAcao, cerca 3)", () => {
    const linha = MANUAL_DO_NOD.split("\n").find((l) => l.includes("O seu modo de aprovação decide")) ?? "";
    const sujo = { contaminado: true, alvoTemAcessos: true };
    const limpo = { contaminado: false, alvoTemAcessos: false };
    const termo: Record<string, string> = { dar_acesso: "dar acesso", criar_rotina: "criar rotina", duplicar: "duplicar um bot que tem acessos", editar: "mudar a descrição ou o título" };
    for (const a of [{ tipo: "dar_acesso" }, { tipo: "criar_rotina" }, { tipo: "duplicar" }, { tipo: "editar", descricao: "x" }] as const) {
      expect(riscoDaAcao(a, sujo)).toBe("conteudo_de_fora");
      expect(riscoDaAcao(a, limpo)).toBeNull();
      expect(linha).toContain(termo[a.tipo]);
    }
    expect(linha).toContain("excluir e mudar o modo de um bot viram card sempre");
    expect(linha).toContain("Pôr um bot em Sem aprovações é sempre card, em qualquer modo seu.");
  });

  it("PR 4 dos modos de aprovação: com o revisor ligado, o manual diz o Automático com o revisor do nod (e não 'na sua IA'); desligado, o de hoje", () => {
    const com = manualDoNod(true);
    expect(manualDoNod(false)).toBe(MANUAL_DO_NOD);
    expect(com).toContain("Automático roda o que a pessoa pediu, e um revisor do nod confere cada ação arriscada");
    expect(com).toContain('"Devia ter perguntado"');
    expect(com).not.toContain("Automático faz sozinho o que não for arriscado");
    expect(com).not.toMatch(/sua IA|sua conta/);
    expect(com.length).toBeLessThanOrEqual(TETO_MANUAL_DO_NOD);
    expect(montarPlano({ ...base, revisor: true }).promptSistemaPartes?.estavel).toContain(com);
  });

  it("o manual do Nod vai na parte estável só do Nod, e cabe no teto", () => {
    expect(MANUAL_DO_NOD.length).toBeLessThanOrEqual(TETO_MANUAL_DO_NOD);
    const doNod = montarPlano(base);
    expect(doNod.promptSistemaPartes?.estavel).toContain(MANUAL_DO_NOD);
    expect(doNod.promptSistemaPartes?.volatil ?? "").not.toContain("gerir_bots (");
    const comum = montarPlano({ ...base, agente: { ...agente, id: "a1", nome: "Vera", papel: null } });
    expect(comum.promptSistema).not.toContain("Você é o Nod");
  });
});

describe("mudar_modo com modo fora da lista (NOD-398, achado do fuzz, FUZZ_SEMENTE=261899740)", () => {
  it("recusa na validação, antes de virar cartão: o modo com byte nulo ou surrogate solto estourava no JSON do Postgres", () => {
    for (const modo of ["a\u0000b", "\ud800", "Total", ""]) {
      const r = valida([{ tipo: "mudar_modo", bot: "Dev 2", modo } as unknown as AcaoLote]);
      expect(r.ok, JSON.stringify(modo)).toBe(false);
    }
    expect(valida([{ tipo: "mudar_modo", bot: "Dev 2", modo: "automatico" }]).ok).toBe(true);
  });
});

describe("texto mal formado em qualquer campo do lote (NOD-398, revisão 6)", () => {
  it("surrogate solto ou byte nulo em nome, descrição, instrução: recusa na validação, antes de virar cartão no jsonb", () => {
    for (const ruim of ["\ud800", "a\udc00", "x\u0000y"]) {
      for (const acao of [
        { tipo: "editar", bot: "Dev 2", nome: ruim },
        { tipo: "editar", bot: "Dev 2", descricao: ruim },
        { tipo: "criar_rotina", bot: "Dev 2", cron: "0 9 * * *", fuso_iana: "America/Sao_Paulo", instrucao: ruim },
      ]) {
        const r = valida([acao as unknown as AcaoLote]);
        expect(r.ok, `${acao.tipo} ${JSON.stringify(ruim)}`).toBe(false);
      }
    }
    expect(valida([{ tipo: "editar", bot: "Dev 2", nome: "Dev 😀" }]).ok).toBe(true);
  });

  it("o resumo do lote (vai ao cartão e à frase da decisão) também: recusa com problema geral (revisão 8)", () => {
    const acao = [{ tipo: "editar", bot: "Dev 2", nome: "Dev 3" }] as AcaoLote[];
    for (const ruim of ["\ud800", "a\udc00", "x\u0000y"]) {
      const r = validarLote(acao, BOTS, APPS, P, ruim);
      expect(r.ok, JSON.stringify(ruim)).toBe(false);
      if (!r.ok) expect(r.problemas).toEqual([{ i: -1, motivo: expect.stringMatching(/resumo/) }]);
    }
    expect(validarLote(acao, BOTS, APPS, P, "Renomeia 😀").ok).toBe(true);
  });

  it("modo mal formado sai uma vez, sem o texto ruim no motivo (revisão 9)", () => {
    const r = validarLote([{ tipo: "mudar_modo", bot: "Dev 2", modo: "\u0000" } as unknown as AcaoLote], BOTS, APPS, P);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0]!.motivo).toMatch(/texto inválido/);
      expect(r.problemas[0]!.motivo).not.toContain("\u0000");
    }
  });
});


describe("restaurar_versao no lote (NOD-20)", () => {
  it("exige a versão inteira a partir de 1 e um bot alvo", () => {
    expect(valida([{ tipo: "restaurar_versao", bot: "Dev 2", versao: 3 }]).ok).toBe(true);
    for (const versao of [undefined, 0, -1, 1.5, "2"] as unknown[]) {
      const r = valida([{ tipo: "restaurar_versao", bot: "Dev 2", versao } as unknown as AcaoLote]);
      expect(r).toEqual({ ok: false, problemas: [{ i: 0, motivo: "restaurar_versao precisa da versao (inteiro a partir de 1)" }] });
    }
    expect(valida([{ tipo: "restaurar_versao", versao: 2 }]).ok).toBe(false);
  });
});
