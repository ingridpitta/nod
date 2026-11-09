import { describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import type { DestinoItem } from "../../../src/contracts/item-aprovacao.ts";
import type { MotivoAprovacaoManual } from "../../../src/contracts/motivos.ts";
import type { FerramentaPlano, ModoTurno } from "../../../src/contracts/plano-turno.ts";
import {
  decidirAprovacao,
  decidirLote,
  nuncaPermanente,
  REGRA_APROVACAO_PERMANENTE,
  REGRA_CONSULTA_SEM_DECISAO,
  sempreServe,
  semRevisorNoApp,
  VERSAO_APROVACAO_PERMANENTE,
  type EntradaAprovacao,
} from "../../../src/domain/aprovacao-permanente.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, VERSAO_MODO_AUTOMATICO_COM_REVISOR, VERSAO_MODO_TOTAL } from "../../../src/domain/modo-aprovacao.ts";
import { pedidoDoRevisor, resumoDaAcao, type EntradaRevisor } from "../../../src/domain/revisor.ts";

/**
 * PR 5 do plano dos modos de aprovação (ADR-115): o revisor no caminho dos apps (`decidirAprovacao`, `decidirLote`), a
 * regra "Sempre permitir" diante dele e `sempreServe` (decisão 8 do Marlon). O primeiro bloco é o oráculo do "chave
 * desligada = decisão de hoje" no caminho dos apps, como a matriz do PR 3a para o terminal.
 */

/**
 * A cópia CONGELADA de `decidirAprovacao` como estava antes do PR 5 (main ff0e54ce, src/domain/aprovacao-permanente.ts:
 * 150-170), com a regra do modo de hoje inline (`decidirPeloModo` sem revisor). Não atualize esta cópia junto com a regra.
 * A exceção é a VERSÃO do total, que vem da constante: o PR 6 (Ignorar todas de verdade) a subiu para 2 pela credencial do
 * Mac no terminal e nos arquivos, sem mudar a decisão no caminho dos apps (o total já aprovava tudo ali).
 */
function decidirAprovacaoDeHoje(entrada: EntradaAprovacao):
  | { automatico: true; regra: string; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual } {
  const { plano } = entrada;
  if (!plano) return { automatico: false, motivo: "sem_plano" };
  if (entrada.origemSensivel) return { automatico: false, motivo: "origem_sensivel" };
  if (entrada.destino.conector === "computador") return { automatico: false, motivo: "destino_computador" };
  if (entrada.destino.conector === "terminal") return { automatico: false, motivo: "destino_terminal" };
  const nome = `${entrada.destino.conector}__${entrada.destino.ferramenta}`;
  const ferramenta = plano.catalogo.ferramentas.find((f) => f.nome === nome);
  if (!ferramenta || ferramenta.origem !== "conector") return { automatico: false, motivo: "fora_do_catalogo" };
  if (ferramenta.readOnlyHint) return { automatico: true, regra: "regra:consulta_sem_decisao", versao: 1 };
  const conversa = plano.modoTurno === "conversa" || plano.modoTurno === "criacao";
  const arriscada = entrada.arriscada === true && !conversa;
  const modo = entrada.modo;
  const doModo = !modo || modo === "manual" ? null
    : modo === "total" ? { automatico: true as const, regra: "regra:modo_total", versao: VERSAO_MODO_TOTAL }
    : arriscada ? { automatico: false as const, motivo: "acao_arriscada" as const }
    : { automatico: true as const, regra: "regra:modo_automatico", versao: 2 };
  if (plano.confiancaEntrada === "nao_confiavel" || entrada.contaminado === true) return doModo ?? { automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" };
  if (nuncaPermanente(nome, ferramenta.readOnlyHint)) return doModo ?? { automatico: false, motivo: "sem_regra_permanente" };
  if (plano.semprePermitir.includes(nome)) return { automatico: true, regra: "regra:aprovacao_permanente", versao: 2 };
  return doModo ?? { automatico: false, motivo: "sem_regra_permanente" };
}

const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false };
function ferramenta(nome: string, extra: Partial<FerramentaPlano> = {}): FerramentaPlano {
  return { nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: "c1", readOnlyHint: false, tocaDadoPessoal: false, schema, ...extra };
}
function plano(extra: Partial<NonNullable<EntradaAprovacao["plano"]>> = {}): NonNullable<EntradaAprovacao["plano"]> {
  return {
    catalogo: { ferramentas: [ferramenta("gmail__enviar"), ferramenta("gmail__buscar", { readOnlyHint: true }), ferramenta("gmail__apagar"), ferramenta("github__pr_merge")], servidores: [] },
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 10_000 },
    confiancaEntrada: "confiavel",
    semprePermitir: [],
    ...extra,
  };
}
const enviar: DestinoItem = { conector: "gmail", ferramenta: "enviar", argumentos: {} };
const buscar: DestinoItem = { conector: "gmail", ferramenta: "buscar", argumentos: {} };
const apagar: DestinoItem = { conector: "gmail", ferramenta: "apagar", argumentos: {} };
const merge: DestinoItem = { conector: "github", ferramenta: "pr_merge", argumentos: {} };
const foraDoPlano: DestinoItem = { conector: "gmail", ferramenta: "rotular", argumentos: {} };

const MODOS: readonly (ModoAprovacao | undefined)[] = [undefined, "manual", "automatico", "total"];
const MODOS_TURNO: readonly (ModoTurno | undefined)[] = [undefined, "conversa", "criacao", "rotina", "peer", "delegacao", "sala"];
const BOOLS = [false, true] as const;
/** O destino, se é arriscado (apagar) e se manda para fora (enviar), como o caso de uso calcula do catálogo. */
const DESTINOS: readonly { destino: DestinoItem; arriscada: boolean; envioParaFora: boolean }[] = [
  { destino: enviar, arriscada: false, envioParaFora: true },
  { destino: apagar, arriscada: true, envioParaFora: false },
  { destino: buscar, arriscada: false, envioParaFora: false },
  { destino: merge, arriscada: false, envioParaFora: false },
  { destino: foraDoPlano, arriscada: false, envioParaFora: true },
];

function* matriz(): Generator<EntradaAprovacao & { envioParaFora: boolean }> {
  for (const modo of MODOS) for (const modoTurno of MODOS_TURNO) for (const d of DESTINOS) for (const contaminado of BOOLS) for (const deFora of BOOLS) for (const sempre of BOOLS) {
    yield {
      plano: plano({ modoTurno, confiancaEntrada: deFora ? "nao_confiavel" : "confiavel", semprePermitir: sempre ? ["gmail__enviar", "gmail__apagar", "github__pr_merge"] : [] }),
      destino: d.destino,
      origemSensivel: false,
      modo,
      arriscada: d.arriscada,
      contaminado,
      envioParaFora: d.envioParaFora,
    };
  }
}

describe("decidirAprovacao, chave DESLIGADA (PR 5): a decisão de hoje no caminho dos apps", () => {
  it("a matriz inteira (4 modos × 7 origens × 5 destinos × contaminado × entrada de fora × Sempre permitir) é igual à regra de hoje", () => {
    let n = 0;
    for (const e of matriz()) {
      const onde = JSON.stringify({ modo: e.modo, modoTurno: e.plano?.modoTurno, destino: e.destino.ferramenta, contaminado: e.contaminado, confianca: e.plano?.confiancaEntrada, sempre: e.plano?.semprePermitir.length });
      const esperado = decidirAprovacaoDeHoje(e);
      // Sem os campos novos, com `revisor: false` e até com os campos do revisor preenchidos: só a chave liga.
      expect(decidirAprovacao({ ...e, envioParaFora: undefined }), onde).toEqual(esperado);
      expect(decidirAprovacao({ ...e, revisor: false }), onde).toEqual(esperado);
      expect(decidirAprovacao({ ...e, revisor: false, contaminadoParaRevisor: true }), onde).toEqual(esperado);
      n += 1;
    }
    expect(n).toBe(4 * 7 * 5 * 2 * 2 * 2);
  });

  it("decidirLote desligado: os lotes de dois itens da matriz decidem como hoje e nunca pedem revisão", () => {
    const entradas = [...matriz()].filter((_, i) => i % 7 === 0);
    for (let i = 0; i + 1 < entradas.length; i += 2) {
      const lote = [entradas[i]!, entradas[i + 1]!];
      const r = decidirLote(lote);
      const hoje = lote.map(decidirAprovacaoDeHoje);
      expect(r.revisar).toBeNull();
      expect(r.porItem).toEqual(hoje);
      expect(r.automatico).toBe(hoje.every((d) => d.automatico));
    }
  });
});

const ligado = (e: Omit<EntradaAprovacao, "origemSensivel" | "revisor">) => decidirAprovacao({ origemSensivel: false, revisor: true, ...e });

describe("decidirAprovacao, chave LIGADA (PR 5, ADR-115)", () => {
  it("A4: apagar pedido NA CONVERSA vai ao revisor (o alívio da conversa sai), como apagar numa rotina ou num pedido de colega", () => {
    for (const modoTurno of MODOS_TURNO) {
      expect(ligado({ plano: plano({ modoTurno }), destino: apagar, modo: "automatico", arriscada: true }), String(modoTurno)).toEqual({ revisar: true, gatilho: "arriscado" });
    }
  });

  it("A3: enviar para fora num turno limpo roda (versão 3); depois de conteúdo de fora (turno, entrada ou conversa em 24 h) vai ao revisor", () => {
    expect(ligado({ plano: plano(), destino: enviar, modo: "automatico", envioParaFora: true })).toEqual({ automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO_COM_REVISOR });
    expect(ligado({ plano: plano(), destino: enviar, modo: "automatico", envioParaFora: true, contaminado: true })).toEqual({ revisar: true, gatilho: "envio_apos_fora" });
    expect(ligado({ plano: plano({ confiancaEntrada: "nao_confiavel" }), destino: enviar, modo: "automatico", envioParaFora: true })).toEqual({ revisar: true, gatilho: "envio_apos_fora" });
    // A conversa nas últimas 24 h: quem chama manda a marca; o turno limpo não basta.
    expect(ligado({ plano: plano(), destino: enviar, modo: "automatico", envioParaFora: true, contaminadoParaRevisor: true })).toEqual({ revisar: true, gatilho: "envio_apos_fora" });
  });

  it("'Sempre permitir' num turno limpo pula o revisor (a regra da pessoa vem antes do modo); num turno contaminado não", () => {
    const comRegra = plano({ semprePermitir: ["gmail__apagar", "gmail__enviar"] });
    expect(ligado({ plano: comRegra, destino: apagar, modo: "automatico", arriscada: true })).toEqual({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE });
    expect(ligado({ plano: comRegra, destino: apagar, modo: "automatico", arriscada: true, contaminado: true })).toEqual({ revisar: true, gatilho: "arriscado" });
    expect(ligado({ plano: comRegra, destino: enviar, modo: "automatico", envioParaFora: true, contaminado: true })).toEqual({ revisar: true, gatilho: "envio_apos_fora" });
    // Revisão do PR 5: a marca da conversa em 24 h também derruba a regra da pessoa NO ENVIO (o A3 com uma regra antiga
    // no envio, de um cartão do manual); o apagar num turno limpo segue com a regra (é onde `sempreServe` diz que serve).
    expect(ligado({ plano: comRegra, destino: enviar, modo: "automatico", envioParaFora: true, contaminadoParaRevisor: true })).toEqual({ revisar: true, gatilho: "envio_apos_fora" });
    expect(ligado({ plano: comRegra, destino: apagar, modo: "automatico", arriscada: true, contaminadoParaRevisor: true })).toMatchObject({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE });
    // Num envio de conversa limpa a regra segue valendo (e a chave desligada nunca muda: a matriz acima).
    expect(ligado({ plano: comRegra, destino: enviar, modo: "automatico", envioParaFora: true, contaminadoParaRevisor: false })).toMatchObject({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE });
  });

  it("o manual e o total não mudam com a chave; leitura, fora do catálogo e merge de PR também não", () => {
    for (const e of matriz()) {
      if (e.modo === "automatico") continue;
      const onde = JSON.stringify({ modo: e.modo, modoTurno: e.plano?.modoTurno, destino: e.destino.ferramenta, contaminado: e.contaminado });
      expect(decidirAprovacao({ ...e, revisor: true, contaminadoParaRevisor: e.contaminado }), onde).toEqual(decidirAprovacaoDeHoje(e));
    }
    expect(ligado({ plano: plano({ confiancaEntrada: "nao_confiavel" }), destino: buscar, modo: "automatico" })).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
    expect(ligado({ plano: plano(), destino: foraDoPlano, modo: "automatico", envioParaFora: true, contaminado: true })).toEqual({ automatico: false, motivo: "fora_do_catalogo" });
    expect(ligado({ plano: plano({ modoTurno: "rotina" }), destino: merge, modo: "automatico", contaminado: true })).toMatchObject({ automatico: true, regra: REGRA_MODO_AUTOMATICO });
    expect(ligado({ plano: plano(), destino: apagar, modo: "total", arriscada: true })).toMatchObject({ automatico: true, regra: REGRA_MODO_TOTAL });
  });

  it("ligada, a mudança contra hoje é só no automático, e só no apagar e no envio contaminado", () => {
    for (const e of matriz()) {
      const contaminadoParaRevisor = e.contaminado === true || e.plano?.confiancaEntrada === "nao_confiavel";
      const novo = decidirAprovacao({ ...e, revisor: true, contaminadoParaRevisor });
      if (JSON.stringify(novo) === JSON.stringify(decidirAprovacaoDeHoje(e))) continue;
      const onde = JSON.stringify({ modo: e.modo, destino: e.destino.ferramenta, contaminado: contaminadoParaRevisor, modoTurno: e.plano?.modoTurno });
      expect(e.modo, onde).toBe("automatico");
      if ("revisar" in novo) expect(e.arriscada || (e.envioParaFora && contaminadoParaRevisor), onde).toBe(true);
      else expect(novo, onde).toMatchObject({ automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO_COM_REVISOR });
    }
  });
});

describe("decidirLote com o revisor (PR 5): o lote inteiro numa revisão só; lote misto pergunta tudo (ADR-042)", () => {
  const item = (destino: DestinoItem, extra: Partial<EntradaAprovacao> = {}): EntradaAprovacao => ({ plano: plano(), destino, origemSensivel: false, modo: "automatico", revisor: true, ...extra });

  it("um item arriscado e um comum: o lote vai ao revisor com o gatilho arriscado (nada roda antes do veredito)", () => {
    const r = decidirLote([item(apagar, { arriscada: true }), item(enviar, { envioParaFora: true })]);
    expect(r).toMatchObject({ automatico: false, revisar: "arriscado" });
    expect(r.porItem[0]).toEqual({ automatico: false, motivo: "acao_arriscada" });
    expect(r.porItem[1]).toMatchObject({ automatico: true });
  });

  it("só envios depois de conteúdo de fora: envio_apos_fora; tudo limpo: automático, sem revisor", () => {
    expect(decidirLote([item(enviar, { envioParaFora: true, contaminado: true }), item(enviar, { envioParaFora: true, contaminado: true })]).revisar).toBe("envio_apos_fora");
    expect(decidirLote([item(enviar, { envioParaFora: true }), item(buscar)])).toMatchObject({ automatico: true, revisar: null });
  });

  it("lote misto com um item que já pede a pessoa (fora do catálogo): cartão do lote inteiro, sem revisor; o arriscado leva o motivo de hoje", () => {
    const r = decidirLote([item(apagar, { arriscada: true }), item(foraDoPlano, { envioParaFora: true })]);
    expect(r).toEqual({ automatico: false, revisar: null, porItem: [{ automatico: false, motivo: "acao_arriscada" }, { automatico: false, motivo: "fora_do_catalogo" }] });
  });

  it("semRevisorNoApp: 'revisar' vira o cartão de hoje; o resto passa igual", () => {
    expect(semRevisorNoApp({ revisar: true, gatilho: "envio_apos_fora" })).toEqual({ automatico: false, motivo: "acao_arriscada" });
    const aprova = { automatico: true as const, regra: REGRA_MODO_AUTOMATICO, versao: 3 };
    expect(semRevisorNoApp(aprova)).toBe(aprova);
  });
});

describe("sempreServe (decisão 8 do Marlon, PR 5): 'Sempre permitir' só onde funciona", () => {
  it("verdadeiro só no apagar de um app num turno limpo", () => {
    expect(sempreServe({ destino: apagar, arriscada: true }, false)).toBe(true);
    expect(sempreServe({ destino: apagar, arriscada: true }, true)).toBe(false);
    expect(sempreServe({ destino: enviar, arriscada: false }, false)).toBe(false);
    expect(sempreServe({ destino: enviar, arriscada: false }, true)).toBe(false);
    expect(sempreServe({ destino: { conector: "terminal", ferramenta: "bash", argumentos: {} }, arriscada: true }, false)).toBe(false);
    expect(sempreServe({ destino: { conector: "computador", ferramenta: "executar", argumentos: {} }, arriscada: true }, false)).toBe(false);
  });

  it("onde ele diz que serve, a regra de fato pula o revisor na próxima vez; onde não serve, a regra não pularia", () => {
    for (const contaminado of BOOLS) for (const d of DESTINOS.slice(0, 2)) {
      const comRegra = plano({ semprePermitir: [`${d.destino.conector}__${d.destino.ferramenta}`] });
      const proxima = decidirAprovacao({ plano: comRegra, destino: d.destino, origemSensivel: false, modo: "automatico", revisor: true, arriscada: d.arriscada, envioParaFora: d.envioParaFora, contaminado });
      const semRegra = decidirAprovacao({ plano: plano(), destino: d.destino, origemSensivel: false, modo: "automatico", revisor: true, arriscada: d.arriscada, envioParaFora: d.envioParaFora, contaminado });
      // Só conta onde o revisor seria chamado sem a regra (o cartão do revisor existe).
      if (!("revisar" in semRegra)) continue;
      const pula = !("revisar" in proxima);
      expect(sempreServe(d, contaminado), JSON.stringify({ destino: d.destino.ferramenta, contaminado })).toBe(pula);
    }
  });
});

describe("pedidoDoRevisor com o lote de apps (PR 5)", () => {
  const base: EntradaRevisor = {
    acao: { tipo: "comando", comando: "x" },
    gatilho: "arriscado",
    risco: "apaga ou arquiva num app",
    origem: "conversa",
    contaminado: false,
    mensagensDaPessoa: ["apaga as 14 planilhas velhas"],
    bot: { nome: "Ada", titulo: "", descricao: "" },
    jaPediuNoTurno: 0,
    marca: "MarcaDeTesteDoLote_0123456",
  };

  it("todos os itens e o resumo do bot vão na parte não confiável, com os argumentos redigidos", () => {
    const p = pedidoDoRevisor({ ...base, acao: { tipo: "apps", resumo: "Apagar 14 planilhas; 2 editadas esta semana", itens: [
      { app: "gsheets", ferramenta: "APAGAR", argumentos: { id: "a1", token: "segredo-123" }, textoDoItem: "Planilha Vendas 2023" },
      { app: "gsheets", ferramenta: "APAGAR", argumentos: { id: "a2" }, textoDoItem: "Planilha Metas (editada ontem)" },
    ] } });
    if (p.tipo !== "pedido") throw new Error("pedido");
    const [confiavel, naoConfiavel] = p.entrada.split("NÃO CONFIÁVEL");
    expect(confiavel).toContain("apaga as 14 planilhas velhas");
    expect(confiavel).not.toContain("editadas esta semana");
    expect(naoConfiavel).toContain("Resumo que o bot escreveu: Apagar 14 planilhas; 2 editadas esta semana");
    expect(naoConfiavel).toContain("2 ações, que rodam juntas ou nenhuma");
    expect(naoConfiavel).toContain("1. App gsheets, ferramenta APAGAR");
    expect(naoConfiavel).toContain("2. App gsheets, ferramenta APAGAR");
    expect(naoConfiavel).toContain("Planilha Metas (editada ontem)");
    expect(naoConfiavel).not.toContain("segredo-123");
    expect(resumoDaAcao({ tipo: "apps", itens: [{ app: "gsheets", ferramenta: "APAGAR", argumentos: {} }, { app: "gmail", ferramenta: "ENVIAR", argumentos: {} }] })).toBe("gsheets · APAGAR, gmail · ENVIAR");
  });

  it("o lote acima de 4.000 caracteres é longo (cartão, sem revisor)", () => {
    const itens = Array.from({ length: 12 }, (_, i) => ({ app: "gmail", ferramenta: "ENVIAR", argumentos: { corpo: "c".repeat(399), i } }));
    expect(pedidoDoRevisor({ ...base, acao: { tipo: "apps", itens } }).tipo).toBe("longo");
  });
});
