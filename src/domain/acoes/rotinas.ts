import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { FERRAMENTAS_DO_NOD } from "../../contracts/ferramentas-do-nod.ts";

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
  { id: "rotinas.executar", titulo: "Rodar uma rotina agora", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.pausar", titulo: "Pausar uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.ativar", titulo: "Ativar uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.mudar_ritmo", titulo: "Mudar o ritmo de uma rotina", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.gerar_endereco", titulo: "Gerar novo endereço do webhook", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
  { id: "rotinas.enviar_teste", titulo: "Enviar teste ao webhook", risco: "muda", cartaoNoChat: false, chat: { estado: "falta", onda: "NOD-393" } },
] as const satisfies readonly DefinicaoAcao[];
