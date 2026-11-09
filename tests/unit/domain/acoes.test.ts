import { describe, expect, it } from "vitest";
import type { DefinicaoAcao } from "../../../src/contracts/acoes.ts";
import { MODOS_APROVACAO } from "../../../src/contracts/agente.ts";
import type { MotivoCardDoLote } from "../../../src/contracts/conversa.ts";
import { TIPOS_ACAO_LOTE, type AcaoLote } from "../../../src/contracts/ferramentas-do-nod.ts";
import { acaoDoTipoDoLote, buscarAcao, REGISTRO_DE_ACOES, tiposDoLoteNoRegistro, validarRegistro } from "../../../src/domain/acoes/index.ts";
import { riscoDaAcao } from "../../../src/domain/lote-bots.ts";

/** NOD-391 (ADR-135): o registro único de ações — formato, ids únicos, estados completos e o lote derivado dele. */

const valida: DefinicaoAcao = { id: "bots.teste", titulo: "Teste", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } };

describe("registro de ações", () => {
  it("o registro real está limpo", () => {
    expect(validarRegistro(REGISTRO_DE_ACOES)).toEqual([]);
  });

  it("id repetido falha", () => {
    expect(validarRegistro([valida, { ...valida }])).toEqual(["bots.teste: id repetido"]);
  });

  it.each(["bots", "Bots.criar", "bots.criar.agora", "bots-x.criar", ".criar", "bots.", "bots.Criar", "1bots.criar"])("id fora de dominio.verbo falha: %s", (id) => {
    expect(validarRegistro([{ ...valida, id }])).toEqual([`${id}: fora do formato dominio.verbo`]);
  });

  it("vivo exige schema, contrato e executor; parcial exige schema e o que falta; falta exige onda conhecida; nunca exige motivo", () => {
    const via = { ferramenta: "gerir_bots" };
    expect(validarRegistro([{ ...valida, chat: { estado: "vivo", via, contrato: "" } }])).toEqual(["bots.teste: vivo sem schema", "bots.teste: vivo sem teste de contrato", "bots.teste: vivo sem executor único (casoDeUso)"]);
    expect(validarRegistro([{ ...valida, chat: { estado: "parcial", via, falta: " " } }])).toEqual(["bots.teste: parcial sem schema", "bots.teste: parcial sem dizer o que falta"]);
    expect(validarRegistro([{ ...valida, chat: { estado: "falta", onda: "NOD-999" as never } }])).toEqual(["bots.teste: onda NOD-999 desconhecida"]);
    expect(validarRegistro([{ ...valida, chat: { estado: "nunca", motivo: "" } }])).toEqual(["bots.teste: nunca sem motivo"]);
  });

  it("um tipo do lote em dois ids falha, e a via do chat tem de ser o tipo do lote", () => {
    const a: DefinicaoAcao = { ...valida, lote: { tipo: "criar" } };
    expect(validarRegistro([a, { ...a, id: "bots.outro" }])).toEqual(["bots.outro: tipo do lote criar em dois ids"]);
    expect(validarRegistro([{ ...a, schema: { type: "object" }, chat: { estado: "parcial", via: { ferramenta: "gerir_bots", tipoNoLote: "mover" }, falta: "x" } }])).toEqual(["bots.teste: a via do chat não é o tipo do lote"]);
  });

  it("o piloto bots.* é vivo pelo gerir_bots, com o executor único do próprio id", () => {
    for (const id of ["bots.criar", "bots.duplicar", "bots.editar", "bots.mover", "bots.excluir", "bots.mudar_modo"]) {
      const a = buscarAcao(id);
      expect(a?.chat, id).toMatchObject({ estado: "vivo", via: { ferramenta: "gerir_bots" } });
      expect(a?.casoDeUso, id).toBe(id);
    }
  });
});

describe("o lote do Nod sai do registro", () => {
  it("lista fechada: TIPOS_ACAO_LOTE é exatamente o conjunto de tipos do lote no registro", () => {
    expect(tiposDoLoteNoRegistro().sort()).toEqual([...TIPOS_ACAO_LOTE].sort());
    for (const t of TIPOS_ACAO_LOTE) expect(acaoDoTipoDoLote(t).lote?.tipo).toBe(t);
  });

  /** O riscoDaAcao de antes do registro (main @ 8b0b494f), copiado como oráculo: o derivado tem de bater em toda combinação. */
  function riscoDeAntes(a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo">, s: { contaminado: boolean; alvoTemAcessos: boolean }): MotivoCardDoLote | null {
    if (a.tipo === "mudar_modo" && a.modo === "total") return "ligar_total";
    if (a.tipo === "excluir" || a.tipo === "mudar_modo") return "arriscada";
    // NOD-437 (revisão 1, A2; emenda da ADR-135): excluir um time é arriscado (card no manual e no automático).
    if (a.tipo === "excluir_time") return "arriscada";
    // ADA-245 (tipo novo, depois do oráculo): remover um computador é pessoa_confirma, espera a pessoa em todo modo.
    if (a.tipo === "remover_computador") return "ligar_total";
    if (!s.contaminado) return null;
    if (a.tipo === "dar_acesso" || a.tipo === "criar_rotina" || (a.tipo === "duplicar" && s.alvoTemAcessos)) return "conteudo_de_fora";
    if (a.tipo === "editar" && (a.descricao !== undefined || a.titulo !== undefined)) return "conteudo_de_fora";
    // NOD-20 (tipo novo, depois do oráculo): restaurar pode trazer de volta a descrição, como o editar com descrição.
    if (a.tipo === "restaurar_versao") return "conteudo_de_fora";
    // ADA-241 (tipos novos): sem nível (o caso do laço) conta como dar acesso; o Desfazer pode devolver acesso.
    if (a.tipo === "acessos_em_lote" || a.tipo === "padrao_acesso" || a.tipo === "desfazer_acessos") return "conteudo_de_fora";
    return null;
  }

  it("o risco de cada tipo bate com o comportamento de antes (toda combinação de modo, descrição, título, contaminação e acessos)", () => {
    let casos = 0;
    for (const tipo of TIPOS_ACAO_LOTE)
      for (const modo of [undefined, ...MODOS_APROVACAO])
        for (const descricao of [undefined, "faz"])
          for (const titulo of [undefined, "Revisor"])
            for (const contaminado of [false, true])
              for (const alvoTemAcessos of [false, true]) {
                const a = { tipo, modo, descricao, titulo };
                const s = { contaminado, alvoTemAcessos };
                expect(riscoDaAcao(a, s), JSON.stringify({ a, s })).toBe(riscoDeAntes(a, s));
                casos++;
              }
    expect(casos).toBe(TIPOS_ACAO_LOTE.length * (MODOS_APROVACAO.length + 1) * 16);
  });

  it("o mapa risco → cartão do piloto: excluir e mudar_modo arriscados; ligar o total é da pessoa; o resto segue o modo", () => {
    const limpo = { contaminado: false, alvoTemAcessos: false };
    expect(riscoDaAcao({ tipo: "excluir" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo", modo: "automatico" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo", modo: "total" }, limpo)).toBe("ligar_total");
    for (const tipo of ["criar", "duplicar", "editar", "mover"] as const) expect(riscoDaAcao({ tipo, descricao: "x" }, limpo), tipo).toBeNull();
  });

  it("ADA-241: Ler e alterar em lote ou no padrão espera a pessoa em todo modo; Nenhum nunca vira card de conteúdo de fora", () => {
    const limpo = { contaminado: false, alvoTemAcessos: false };
    const sujo = { contaminado: true, alvoTemAcessos: false };
    for (const tipo of ["acessos_em_lote", "padrao_acesso"] as const) {
      expect(riscoDaAcao({ tipo, nivel_lote: "escrita" }, limpo), tipo).toBe("ligar_total");
      expect(riscoDaAcao({ tipo, nivel_lote: "leitura" }, limpo), tipo).toBeNull();
      expect(riscoDaAcao({ tipo, nivel_lote: "leitura" }, sujo), tipo).toBe("conteudo_de_fora");
      expect(riscoDaAcao({ tipo, nivel_lote: "nenhum" }, sujo), tipo).toBeNull();
    }
    expect(riscoDaAcao({ tipo: "desfazer_acessos" }, limpo)).toBeNull();
    expect(riscoDaAcao({ tipo: "desfazer_acessos" }, sujo)).toBe("conteudo_de_fora");
  });
});
