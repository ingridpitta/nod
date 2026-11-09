import type { EpochMs } from "./ids.ts";

/**
 * A linha discreta embaixo da fala (definido em 2026-10-19, plano dos modos de aprovação, PR 6; telas Y1 e Y2): o que o
 * "Ignorar todas as aprovações" rodou sem a pessoa e merece estar à vista — a credencial e o arriscado. O resto fica só
 * na Atividade, no filtro "Sem aprovação". A frase vem pronta do servidor (`fraseNaFala`, src/domain/acoes-do-modo.ts):
 * "Usou o token do GitHub do seu Mac". Nada vira mensagem nova no chat. revisto em 2026-10-26 (PR 4): também o que o
 * revisor do Automático liberou, com o motivo dele; desde o PR 4b, com a frase da ação ("Revisor liberou o push forçado na
 * feat/login: você pediu").
 */
export type AcaoDoModoNaFala = {
  id: string;
  turnoId: string;
  em: EpochMs;
  /**
   * A credencial vem antes do arriscado na linha, e leva a chave no ícone. `revisor` (PR 4, telas A1 e A2): o revisor do
   * Automático liberou a ação — a linha leva o escudo e "Revisor liberou … · ver".
   */
  gatilho: "credencial" | "arriscado" | "revisor";
  frase: string;
  /** PR 4b: o comando sem frase, na linha do revisor — o trecho de `frase` em fonte de código, [início, fim). */
  codigo?: readonly [number, number];
};

/**
 * Os turnos da janela da conversa própria que rodaram algo assim, numa consulta à parte (como `pedidosDeColega`).
 * Ausente = servidor de antes do PR 6, ou conversa de sala: nenhuma linha.
 */
export type AcoesDoModoNaConversa = { acoesDoModo?: Record<string, AcaoDoModoNaFala[]> };
