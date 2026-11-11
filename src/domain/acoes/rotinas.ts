import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_DO_NOD } from "../../contracts/ferramentas-do-nod.ts";
import { FERRAMENTAS_ROTINA } from "../../contracts/ferramentas-rotina.ts";

/** As rotinas dos bots (NOD-391, ADR-135). Criar já existe no lote do Nod, mas por outro executor que o da tela. */

const P = FERRAMENTAS_DO_NOD.gerir_bots.properties.acoes.items.properties;

export const ACOES_ROTINAS = [
  {
    id: "rotinas.criar",
    titulo: "Criar uma rotina num bot",
    schema: { type: "object", properties: { bot: P.bot, cron: P.cron, fuso_iana: P.fuso_iana, instrucao: P.instrucao, entregavel: P.entregavel }, required: ["bot", "cron", "fuso_iana", "instrucao"], additionalProperties: false },
    risco: "muda",
    cartaoNoChat: false,
    chat: { estado: "parcial", via: { ferramenta: "gerir_bots", tipoNoLote: "criar_rotina" }, falta: "a tela manda fonte, limites e política sem dado; o lote preenche com padrões e não tem teste de contrato" },
    lote: { tipo: "criar_rotina", deFora: () => true },
  },
  // NOD-413: o "Testar agora" da tela e o executar_rotina do chat passam pelo mesmo executor (EXECUTORES_ROTINAS). O chat
  // só propõe: o card "Rodar agora · Agora não" é sempre da pessoa (pessoa_confirma), também em "Ignorar todas as
  // aprovações", porque o critério da issue é "só executa depois do clique". Só a rotina do próprio bot; a de colega é
  // da NOD-393.
  {
    id: "rotinas.executar",
    titulo: "Rodar uma rotina agora",
    schema: { type: "object", properties: { rotina_id: FERRAMENTAS_ROTINA.executar_rotina.properties.rotina_id }, required: ["rotina_id"], additionalProperties: false },
    risco: "pessoa_confirma",
    cartaoNoChat: true,
    chat: { estado: "vivo", via: { ferramenta: "executar_rotina" }, contrato: "tests/integration/paridade-rotinas.test.ts" },
    casoDeUso: "rotinas.executar",
  },
  { id: "rotinas.pausar", titulo: "Pausar uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.ativar", titulo: "Ativar uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.mudar_ritmo", titulo: "Mudar o ritmo de uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.gerar_endereco", titulo: "Gerar novo endereço do webhook", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.enviar_teste", titulo: "Enviar teste ao webhook", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
] as const satisfies readonly DefinicaoAcao[];
