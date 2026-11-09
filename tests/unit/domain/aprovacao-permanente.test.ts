import { describe, expect, it } from "vitest";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import {
  decidirAprovacao,
  decidirLote,
  nuncaPermanente,
  REGRA_APROVACAO_PERMANENTE,
  REGRA_CONSULTA_SEM_DECISAO,
  VERSAO_APROVACAO_PERMANENTE,
  type EntradaAprovacao,
} from "../../../src/domain/aprovacao-permanente.ts";

const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false };

function ferramenta(nome: string, extra: Partial<FerramentaPlano> = {}): FerramentaPlano {
  return { nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: "c1", readOnlyHint: false, tocaDadoPessoal: false, schema, ...extra };
}

function plano(extra: Partial<EntradaAprovacao["plano"] & object> = {}): NonNullable<EntradaAprovacao["plano"]> {
  return {
    catalogo: { ferramentas: [ferramenta("slack__send_message"), ferramenta("slack__search", { readOnlyHint: true })], servidores: [] },
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 10_000 },
    confiancaEntrada: "confiavel",
    semprePermitir: [],
    ...extra,
  };
}

const enviar = { conector: "slack", ferramenta: "send_message", argumentos: {} };
const buscar = { conector: "slack", ferramenta: "search", argumentos: {} };

describe("aprovação automática: o que NEGA vem antes do que PERMITE", () => {
  it("sem plano não é automático, nem com tudo o mais permissivo (fail-closed)", () => {
    expect(decidirAprovacao({ plano: null, destino: buscar, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_plano" });
  });

  it("origem sensível perde para readOnly E para regra da pessoa ao mesmo tempo", () => {
    // Os três insumos mais permissivos juntos: só-leitura, na lista, turno confiável.
    const d = decidirAprovacao({ plano: plano({ semprePermitir: ["slack__search"] }), destino: buscar, origemSensivel: true });
    expect(d).toEqual({ automatico: false, motivo: "origem_sensivel" });
  });

  it("ADR-066: a rotina não tem gate — no manual, readOnly passa pela regra do conector e a escrita, pela regra da pessoa ou pela pergunta de sempre", () => {
    const p = plano({ modoTurno: "rotina", semprePermitir: ["slack__search", "slack__send_message"] });
    expect(decidirAprovacao({ plano: p, destino: buscar, origemSensivel: false })).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
    expect(decidirAprovacao({ plano: p, destino: enviar, origemSensivel: false })).toEqual({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE });
    expect(decidirAprovacao({ plano: plano({ modoTurno: "rotina" }), destino: enviar, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("conteúdo de fora suspende a regra da PESSOA e diz por quê: entrada não confiável ou turno contaminado (ADR-066)", () => {
    const p = plano({ confiancaEntrada: "nao_confiavel", semprePermitir: ["slack__send_message"] });
    expect(decidirAprovacao({ plano: p, destino: enviar, origemSensivel: false })).toEqual({ automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" });
    const contaminado = plano({ semprePermitir: ["slack__send_message"] });
    expect(decidirAprovacao({ plano: contaminado, destino: enviar, origemSensivel: false, contaminado: true })).toEqual({ automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" });
    expect(decidirAprovacao({ plano: contaminado, destino: enviar, origemSensivel: false, contaminado: false })).toMatchObject({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE });
  });

  it("conteúdo de fora NÃO suspende a regra do CONECTOR: readOnly passa (o catálogo não encolhe mais, ADR-066)", () => {
    const p = plano({ confiancaEntrada: "nao_confiavel" });
    expect(decidirAprovacao({ plano: p, destino: buscar, origemSensivel: false })).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
    expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false, contaminado: true })).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
  });

  it("destino computador nunca é automático (ADR-037: aprovação vinculada à ação cifrada)", () => {
    const p = plano({ semprePermitir: ["computador__executar"] });
    const d = decidirAprovacao({ plano: p, destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: "x" } }, origemSensivel: false });
    expect(d).toEqual({ automatico: false, motivo: "destino_computador" });
  });

  it("ferramenta fora do catálogo do plano pergunta, mesmo nomeada na regra", () => {
    const p = plano({ semprePermitir: ["gmail__send"] });
    expect(decidirAprovacao({ plano: p, destino: { conector: "gmail", ferramenta: "send", argumentos: {} }, origemSensivel: false })).toEqual({ automatico: false, motivo: "fora_do_catalogo" });
  });

  it("readOnlyHint de ferramenta que NÃO é de conector nunca auto-aprova", () => {
    // Lista escrita no código (computador/workspace) e ferramenta nod não passam pela sonda:
    // a declaração tem que ser do conector, senão o critério deixa de ser verificável.
    for (const origem of ["nod", "computador", "workspace"] as const) {
      const p = plano({ catalogo: { ferramentas: [ferramenta("x__y", { origem, readOnlyHint: true })], servidores: [] } });
      expect(decidirAprovacao({ plano: p, destino: { conector: "x", ferramenta: "y", argumentos: {} }, origemSensivel: false })).toEqual({ automatico: false, motivo: "fora_do_catalogo" });
    }
  });
});

describe("aprovação automática: o que PERMITE", () => {
  it("readOnlyHint do conector dispensa a pergunta desde o dia um, sem regra nenhuma", () => {
    expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false })).toEqual({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO, versao: 1 });
  });

  it("ferramenta de escrita na lista da pessoa dispensa a pergunta", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    expect(decidirAprovacao({ plano: p, destino: enviar, origemSensivel: false })).toEqual({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE });
  });

  it("escrita sem regra continua perguntando", () => {
    expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("regra é por FERRAMENTA, não por destino: o mesmo nome vale para qualquer argumento", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    for (const argumentos of [{ channel: "#vendas" }, { channel: "#diretoria" }, {}]) {
      expect(decidirAprovacao({ plano: p, destino: { ...enviar, argumentos }, origemSensivel: false })).toMatchObject({ automatico: true });
    }
  });
});

describe("lote misto", () => {
  it("se UM item precisa de pessoa, o lote inteiro pergunta — mas cada item guarda seu motivo", () => {
    const p = plano({ semprePermitir: [] });
    const r = decidirLote([
      { plano: p, destino: buscar, origemSensivel: false },
      { plano: p, destino: enviar, origemSensivel: false },
    ]);
    expect(r.automatico).toBe(false);
    expect(r.porItem[0]).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
    expect(r.porItem[1]).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("lote todo automático quando cada item passa por si", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    const r = decidirLote([
      { plano: p, destino: buscar, origemSensivel: false },
      { plano: p, destino: enviar, origemSensivel: false },
    ]);
    expect(r.automatico).toBe(true);
  });

  it("lote vazio não é automático (nada a executar não é permissão)", () => {
    expect(decidirLote([]).automatico).toBe(false);
  });
});

describe("ações que nunca são permanentes (ADR-047)", () => {
  it("aprovar PR e merge nunca viram regra; comentar vira", () => {
    for (const nome of ["github__pr_revisar", "github__pr_merge", "pr_merge", "github__GITHUB_MERGE_A_PULL_REQUEST", "github__GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST", "x__aprovar_despesa", "x__approve"]) expect(nuncaPermanente(nome), nome).toBe(true);
    for (const nome of ["github__pr_comentar", "github__pr_ver", "slack__send_message", "pr_comentar"]) expect(nuncaPermanente(nome), nome).toBe(false);
  });

  it("revisão: variantes de review do Composio entram; leitura só fica livre pelo readOnlyHint do catálogo, nunca pelo nome", () => {
    for (const nome of ["github__GITHUB_SUBMIT_A_REVIEW_FOR_A_PULL_REQUEST", "github__GITHUB_UPDATE_A_REVIEW_FOR_A_PULL_REQUEST", "github__GITHUB_DISMISS_A_REVIEW_FOR_A_PULL_REQUEST", "GITHUB_PELO_COMPOSIO__pr_revisar"]) expect(nuncaPermanente(nome), nome).toBe(true);
    // Sem a declaração, nome que casa é escrita (fail-closed) — verbo de leitura no nome não libera.
    expect(nuncaPermanente("github__GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED")).toBe(true);
    expect(nuncaPermanente("github__GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST", false)).toBe(true);
    // Com readOnlyHint: true (o que o catálogo sondado declara), fica livre.
    expect(nuncaPermanente("github__GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED", true)).toBe(false);
    expect(nuncaPermanente("github__GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST", true)).toBe(false);
  });

  it("mesmo com a linha na lista da pessoa, aprovar PR pergunta — a regra gravada antes da lista não vale", () => {
    const p = plano({ catalogo: { ferramentas: [ferramenta("github__pr_revisar"), ferramenta("github__pr_comentar")], servidores: [] }, semprePermitir: ["github__pr_revisar", "github__pr_comentar"] });
    expect(decidirAprovacao({ plano: p, destino: { conector: "github", ferramenta: "pr_revisar", argumentos: { evento: "APPROVE" } }, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
    expect(decidirAprovacao({ plano: p, destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {} }, origemSensivel: false })).toMatchObject({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE });
  });
});
