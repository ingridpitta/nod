import { describe, expect, it } from "vitest";
import { MOTIVOS_APROVACAO_MANUAL, MOTIVOS_NEGACAO } from "../../../src/contracts/motivos.ts";
import {
  ehDecisao,
  ehLinhaDeItemDeAprovacao,
  MOTIVOS_COM_FRASE,
  appEAcao,
  BOM,
  cabecalhoCsv,
  celulaCsv,
  dataEHora,
  desfechoDoKind,
  diasNoPeriodo,
  faixaDoPeriodo,
  FRASE_REGRA_NAO_REGISTRADA,
  fraseDaDecisao,
  inicioDoDia,
  linhaCsv,
  nomeDoCsv,
  somarDias,
  validarCursor,
  REGRA_CARTAO_DISPENSADO,
  REGRA_CLIQUE,
  REGRAS_COM_FRASE,
  type LinhaDecisao,
} from "../../../src/domain/decisoes.ts";
import { REGRA_TRABALHO_PARADO } from "../../../src/use-cases/trabalhos.ts";
import { REGRAS_GRAVADAS_NA_AUTORIZACAO } from "../../../src/use-cases/trilha-decisoes.ts";

const linha = (p: Partial<LinhaDecisao> = {}): LinhaDecisao => ({
  id: "6f1d2c3b-0000-4000-8000-000000000001",
  em: "2026-10-29T15:04:05.000Z",
  ferramenta: "github__create_issue",
  conectorId: "c1",
  kind: "tool_call",
  motivo: null,
  regra: "regra:modo_automatico",
  regraVersao: 3,
  ...p,
});

describe("NOD-70: decisões de autorização (domínio puro)", () => {
  it("o desfecho vem do kind; o resto da trilha não é decisão", () => {
    expect(desfechoDoKind("tool_call")).toBe("permitida");
    expect(desfechoDoKind("negacao")).toBe("negada");
    expect(desfechoDoKind("cartao")).toBe("cartao");
    expect(desfechoDoKind("conector_recuperado")).toBeNull();
  });

  it("a frase: regra para a permitida, motivo para o cartão e a negada; a linha antiga diz 'regra não registrada'", () => {
    expect(fraseDaDecisao(linha())).toBe("Modo Automático");
    expect(fraseDaDecisao(linha({ regra: "regra:clique" }))).toBe("Você aprovou no cartão");
    expect(fraseDaDecisao(linha({ kind: "cartao", regra: "regra:cartao", motivo: "acao_arriscada" }))).toBe("Ação arriscada");
    expect(fraseDaDecisao(linha({ kind: "negacao", regra: "regra:clique", motivo: "retirado_pela_pessoa" }))).toBe("Você recusou no cartão");
    expect(fraseDaDecisao(linha({ regra: "regra:chamar_ferramenta" }))).toBe(FRASE_REGRA_NAO_REGISTRADA);
    // Motivo desconhecido não some: vira texto legível.
    expect(fraseDaDecisao(linha({ kind: "negacao", regra: "regra:x", motivo: "algo_novo" }))).toBe("algo novo");
  });

  it("o motivo ganha da regra na negada e no cartão; todo motivo de negação e de cartão tem frase", () => {
    // A parada de alçada nega por vários motivos com a mesma regra: a frase é a do motivo.
    expect(fraseDaDecisao(linha({ kind: "negacao", regra: "regra:parada_de_alcada", motivo: "parada_ativa" }))).toBe("Você mandou parar");
    expect(fraseDaDecisao(linha({ kind: "negacao", regra: "regra:clique", motivo: "falhou_na_execucao" }))).toBe("Falhou ao executar");
    expect(fraseDaDecisao(linha({ kind: "cartao", regra: "regra:cartao", motivo: "lote_misto" }))).toBe("Pedido junto com outra ação que precisa de você");
    for (const m of [...MOTIVOS_NEGACAO, ...MOTIVOS_APROVACAO_MANUAL]) expect(MOTIVOS_COM_FRASE, m).toContain(m);
  });

  it("toda regra que a trilha de itens grava tem frase (nenhuma linha nova vira 'regra não registrada')", () => {
    for (const r of [...REGRAS_GRAVADAS_NA_AUTORIZACAO, REGRA_CLIQUE, REGRA_CARTAO_DISPENSADO, REGRA_TRABALHO_PARADO]) expect(REGRAS_COM_FRASE, r).toContain(r);
    expect(fraseDaDecisao(linha({ regra: REGRA_CARTAO_DISPENSADO, motivo: "item_de_aprovacao" }))).toBe("Rodou depois de você dispensar o cartão");
  });

  it("o recorte da decisão: sem a chamada legada sem conector e sem o plano ausente", () => {
    const base = { kind: "tool_call", conectorId: "c1", regra: "regra:modo_automatico", motivo: null };
    expect(ehDecisao(base)).toBe(true);
    expect(ehDecisao({ ...base, kind: "conector_recuperado" })).toBe(false);
    expect(ehDecisao({ ...base, conectorId: null, regra: "regra:chamar_ferramenta" })).toBe(false);
    expect(ehDecisao({ ...base, conectorId: null, regra: "regra:modo_automatico" })).toBe(true);
    expect(ehDecisao({ ...base, kind: "negacao", motivo: "plano_ausente" })).toBe(false);
    // Revisão 2: o "peça aprovação" do manual vira o cartão; a falha do app vem depois da permitida. Nenhuma é decisão.
    for (const motivo of ["alcance_insuficiente", "conector_indisponivel", "timeout_transporte", "falha_tecnica"]) expect(ehDecisao({ ...base, kind: "negacao", motivo }), motivo).toBe(false);
    expect(ehDecisao({ ...base, kind: "negacao", motivo: "capacidade_desligada" })).toBe(true);
    expect(ehDecisao({ ...base, kind: "negacao", motivo: "parada_ativa" })).toBe(true);
  });

  it("a linha que veio de um item de aprovação fica fora do contexto do bot", () => {
    expect(ehLinhaDeItemDeAprovacao({ kind: "cartao", regra: "regra:cartao", motivo: "acao_arriscada" })).toBe(true);
    expect(ehLinhaDeItemDeAprovacao({ kind: "negacao", regra: "regra:clique", motivo: "retirado_pela_pessoa" })).toBe(true);
    expect(ehLinhaDeItemDeAprovacao({ kind: "tool_call", regra: "regra:modo_automatico", motivo: "item_de_aprovacao" })).toBe(true);
    expect(ehLinhaDeItemDeAprovacao({ kind: "tool_call", regra: "regra:modo_automatico", motivo: null })).toBe(false);
    expect(ehLinhaDeItemDeAprovacao({ kind: "negacao", regra: "regra:parada_de_alcada", motivo: "parada_ativa" })).toBe(false);
  });

  it("app e ação saem do nome da ferramenta", () => {
    expect(appEAcao("github__create_issue")).toEqual({ app: "github", acao: "create_issue" });
    expect(appEAcao("nativa__Bash")).toEqual({ app: "nativa", acao: "Bash" });
    expect(appEAcao("solta")).toEqual({ app: "", acao: "solta" });
  });

  it("o dia no fuso: meia-noite de São Paulo é 03:00 UTC; o período é [início, fim) e conta os dias inclusive", () => {
    expect(new Date(inicioDoDia("2026-10-29", "America/Sao_Paulo")).toISOString()).toBe("2026-10-29T03:00:00.000Z");
    expect(new Date(inicioDoDia("2026-03-29", "Europe/Lisbon")).toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(new Date(inicioDoDia("2026-03-30", "Europe/Lisbon")).toISOString()).toBe("2026-03-29T23:00:00.000Z");
    // A meia-noite que não existe (Santiago pula de 00:00 para 01:00): o dia começa às 01:00 locais, não às 23:00 de antes.
    expect(new Date(inicioDoDia("2026-09-06", "America/Santiago")).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(new Date(inicioDoDia("2026-09-07", "America/Santiago")).toISOString()).toBe("2026-09-07T03:00:00.000Z");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(diasNoPeriodo("2026-10-01", "2026-10-31")).toBe(31);
    expect(diasNoPeriodo("2026-10-29", "2026-10-29")).toBe(1);
    const f = faixaDoPeriodo("2026-10-29", "2026-10-29", "America/Sao_Paulo");
    expect(f.ate - f.desde).toBe(86_400_000);
    expect(dataEHora("2026-10-29T02:59:59Z", "America/Sao_Paulo")).toEqual({ data: "2026-10-28", hora: "23:59:59" });
    expect(() => inicioDoDia("29/10/2026", "UTC")).toThrow(RangeError);
  });

  it("cursor: só um uuid; o resto é inválido", () => {
    expect(validarCursor("6F1D2C3B-0000-4000-8000-000000000001")).toBe("6f1d2c3b-0000-4000-8000-000000000001");
    expect(validarCursor("x' or 1=1")).toBeNull();
    expect(validarCursor("")).toBeNull();
  });

  it("CSV: fórmula vira texto com apóstrofo, aspas e vírgula entram entre aspas; BOM e CRLF no cabeçalho", () => {
    expect(celulaCsv("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(celulaCsv("+1")).toBe(`"'+1"`);
    expect(celulaCsv("-1")).toBe(`"'-1"`);
    expect(celulaCsv("@x")).toBe(`"'@x"`);
    expect(celulaCsv('a,"b"')).toBe(`"a,""b"""`);
    expect(celulaCsv("linha\nnova")).toBe(`"linha\nnova"`);
    expect(celulaCsv(3)).toBe("3");
    expect(cabecalhoCsv()).toBe(`${BOM}data,hora,desfecho,app,acao,regra,regra_codigo,regra_versao,motivo\r\n`);
    expect(linhaCsv(linha(), "America/Sao_Paulo")).toBe("2026-10-29,12:04:05,Permitida,github,create_issue,Modo Automático,regra:modo_automatico,3,");
    expect(linhaCsv(linha({ kind: "cartao", regra: "regra:cartao", regraVersao: 1, motivo: "toca_credencial" }), "UTC")).toBe("2026-10-29,15:04:05,Cartão,github,create_issue,Toca uma credencial,regra:cartao,1,toca_credencial");
  });

  it("nome do arquivo: slug do bot sem acento, um dia ou o período", () => {
    expect(nomeDoCsv("Júlio Ação!", "2026-10-29", "2026-10-29")).toBe("decisoes-julio-acao-2026-10-29.csv");
    expect(nomeDoCsv("???", "2026-10-01", "2026-10-31")).toBe("decisoes-bot-2026-10-01_2026-10-31.csv");
  });
});
