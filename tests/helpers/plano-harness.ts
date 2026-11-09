import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";

export function planoHarness(parcial: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno {
  return {
    tenantId: "t",
    turnoId: "turno-1",
    conversaId: "c",
    agenteId: "a",
    localidade: "local",
    machineId: "m",
    executor: "local",
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: {
      ferramentas: [
        { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
        { nome: "ex__somar", nomeMcp: "mcp__nod__ex__somar", origem: "conector", conectorId: "k", readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } },
      ],
      servidores: [],
    },
    promptSistema: "Você é a Vera. Responda em português.",
    entrada: { texto: "oi", sessaoCli: null, modelo: "gpt-5.6-sol", ...parcial },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 3_600_000, orcamentoResultadoChars: 8000 },
    tokenDeTurno: "tok",
    expiraEm: 1,
  };
}
