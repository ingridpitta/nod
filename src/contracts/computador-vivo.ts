import type { MotivoFalhaComputador } from "./motivos.ts";

/**
 * NOD-95 (definido em 2026-10-29, ADR-138): a sessão da tela ao vivo que o servidor dá ao motor no comando `vivo`.
 * `sessao` é o id que o servidor deu à sessão; `token` é o segredo de uso único com que o motor abre o WebSocket de
 * volta ao servidor (`/api/maquina/computador/vivo/:sessao?t=`), de onde os bytes do VNC seguem ao navegador da pessoa.
 */
export type SessaoVivo = { sessao: string; token: string };

/** Códigos de fechamento do WebSocket da tela ao vivo (os 4xxx são da aplicação). */
export const FECHAMENTOS_VIVO = { recusado: 4403, sem_maquina: 4408, trocou: 4409, sessao: 4401 } as const;

/**
 * NOD-95 (ADR-138): a resposta ao `vivo` numa conexão só dela. Depois do `ok` a conexão deixa de ser JSON por linha e
 * vira o fluxo cru do VNC (RFB) da tela, nos dois sentidos, até alguém fechar. Sem `ok`, a conexão fecha.
 */
export type RespostaVivo = { tipo: "vivo"; ok: true } | { tipo: "vivo"; ok: false; motivo: MotivoFalhaComputador };
