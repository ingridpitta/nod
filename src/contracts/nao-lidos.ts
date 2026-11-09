import type { EpochMs } from "./ids.ts";
import type { Mensagem } from "./mensagem.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039): cada conversa com fala nova de quem não é a pessoa, a mais recente
 * primeiro. `primeiraId` é onde a linha "Novas" entra; `mensagens` são as últimas não lidas (até 3), em ordem
 * de criação; `daRotina` = alguma delas veio de um turno de rotina. Conta só texto e artefato: aviso do sistema,
 * execução de rotina e a troca interna entre bots não são "mensagem nova".
 */
export type ConversaNaoLida = {
  conversaId: string;
  tipo: "propria" | "sala";
  agenteId: string | null;
  salaId: string | null;
  total: number;
  primeiraId: string;
  desde: EpochMs;
  ultimaEm: EpochMs;
  mensagens: Mensagem[];
  /** NOD-114: os avisos não lidos (avisar_pessoa, rotina que não rodou) que ficaram antes das `mensagens` (até 10). */
  avisos?: Mensagem[];
  daRotina: boolean;
};
export type NaoLidosDto = { conversas: ConversaNaoLida[] };

/**
 * NOD-449: o "lido até" de antes e de depois de uma marcação como lida, em texto exato (AAAA-MM-DDTHH:MM:SS.ffffff, UTC;
 * null = sem leitura). É a chave do Desfazer: volta ao `antes` só onde o "lido até" ainda é o `depois`.
 */
export type LeituraMarcada = { conversaId: string; antes: string | null; depois: string | null };
/** A resposta de marcar como lida (uma ou todas): as leituras para o Desfazer. */
export type RespostaLeitura = { ok: true; leituras: LeituraMarcada[] };
/** Quantas o Desfazer cabe de uma vez (o "Marcar tudo" de uma pessoa com muitos bots e salas). */
export const MAX_LEITURAS_DESFAZER = 5000;
