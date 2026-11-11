/** A tabela da regra única de "vai começar" (2026-11-10): o domínio e o espelho da web respondem igual a ela. */
import type { ColunaDoAcionamento } from "../../src/domain/acionamento.ts";

const ZE = "00000000-0000-4000-8000-000000000001";
const DEV = "00000000-0000-4000-8000-000000000002";

/** O quadro padrão, com Em revisão nas mãos do Ze 1 (handoff) e uma coluna de ideias com responsável que não aciona. */
export const COLUNAS_DA_TABELA: ColunaDoAcionamento[] = [
  { id: "backlog", grupo: "nao_iniciado" },
  { id: "c-ideias", grupo: "nao_iniciado", responsavel: ZE },
  { id: "afazer", grupo: "nao_iniciado" },
  { id: "fazendo", grupo: "iniciado" },
  { id: "revisao", grupo: "iniciado", responsavel: ZE },
  { id: "bloqueado", grupo: "iniciado" },
  { id: "feito", grupo: "feito", responsavel: null },
  { id: "cancelado", grupo: "fechado" },
];

export type Linha = { caso: string; de: string; quem: string | null; para: string; autor?: string; viva?: boolean; espera: { agenteId: string | null; passa: boolean; aciona: boolean } };

/** A tabela da regra única (2026-11-10): a mesma que o espelho da web confere. */
export const TABELA: Linha[] = [
  { caso: "Backlog → A fazer aciona o responsável", de: "backlog", quem: DEV, para: "afazer", espera: { agenteId: DEV, passa: false, aciona: true } },
  { caso: "A fazer sem responsável não aciona ninguém", de: "backlog", quem: null, para: "afazer", espera: { agenteId: null, passa: false, aciona: false } },
  { caso: "Backlog → Fazendo (sem responsável na coluna) aciona o responsável da tarefa, como o Multica (sair do Backlog)", de: "backlog", quem: DEV, para: "fazendo", espera: { agenteId: DEV, passa: false, aciona: true } },
  { caso: "Em revisão → Fazendo não reaciona o Dev 1", de: "revisao", quem: DEV, para: "fazendo", espera: { agenteId: DEV, passa: false, aciona: false } },
  { caso: "coluna com responsável passa e aciona", de: "fazendo", quem: DEV, para: "revisao", espera: { agenteId: ZE, passa: true, aciona: true } },
  { caso: "coluna com responsável aciona com turno vivo do anterior", de: "fazendo", quem: DEV, para: "revisao", viva: true, espera: { agenteId: ZE, passa: true, aciona: true } },
  { caso: "o mesmo bot já responsável começa a etapa", de: "fazendo", quem: ZE, para: "revisao", espera: { agenteId: ZE, passa: false, aciona: true } },
  { caso: "o mesmo bot com turno vivo não começa outro", de: "fazendo", quem: ZE, para: "revisao", viva: true, espera: { agenteId: ZE, passa: false, aciona: false } },
  { caso: "o autor é o próprio bot da coluna: não se reinicia", de: "fazendo", quem: ZE, para: "revisao", autor: ZE, espera: { agenteId: ZE, passa: false, aciona: false } },
  { caso: "o autor manda a outro bot: o outro começa", de: "fazendo", quem: DEV, para: "revisao", autor: DEV, espera: { agenteId: ZE, passa: true, aciona: true } },
  { caso: "coluna de espera com responsável passa sem acionar", de: "backlog", quem: DEV, para: "c-ideias", espera: { agenteId: ZE, passa: true, aciona: false } },
  { caso: "Feito não aciona", de: "revisao", quem: ZE, para: "feito", espera: { agenteId: ZE, passa: false, aciona: false } },
  { caso: "Bloqueado não aciona", de: "fazendo", quem: DEV, para: "bloqueado", espera: { agenteId: DEV, passa: false, aciona: false } },
];

