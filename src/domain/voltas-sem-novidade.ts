import { VOLTAS_SEM_NOVIDADE } from "../contracts/ferramentas-trabalho.ts";
import type { EstadoTurno } from "../contracts/turno.ts";

/**
 * Sem progresso, o bot para e pergunta (definido em 2026-10-12, ADR-099 §5, parte 1). Uma volta marcada (`me_chame_as`,
 * ADR-086) que volta, confere e marca outra, três vezes seguidas sem nada novo, não marca a quarta: vira pergunta à pessoa.
 * Mede-se novidade, não tempo ("só o Parar freia", ADR-067). Puro: quem lê o banco é `turnos.ultimasVoltas`.
 */

/** O que se sabe de uma volta da cadeia (as voltas que apontam para a mesma origem, `origemDaVolta`). */
export type VoltaDaCadeia = {
  estado: EstadoTurno;
  /** A volta chamou `me_chame_as` de novo: o que ela esperava ainda não tinha chegado. */
  marcouVolta: boolean;
  /** A volta abriu uma decisão (pergunta, aprovação, acesso): pediu algo à pessoa. */
  perguntou: boolean;
  /** A volta pediu algo a um colega (`pedir_a_bot`, mensagem `handoff` do turno). */
  pediuAColega: boolean;
  /**
   * definido em 2026-10-12 (ADR-099 §7, na integração com a parte 1): a volta nasceu da cota no limite (a task parou no
   * meio e voltou quando a janela renovou), não de uma volta que o bot marcou. Não conta como sem novidade: quebra a
   * sequência, como a volta que caiu.
   */
  porCota?: boolean;
};

/**
 * definido em 2026-10-12 (ADR-099 §5, parte 1): "nada novo" é a volta que terminou bem e só marcou outra volta — sem
 * pedir nada à pessoa nem a um colega. Medido pelo que o banco já tem, sem ler o texto do bot (Regra 9, como o
 * `sem_novidade`). A fala final da volta NÃO conta como novidade: toda volta deixa uma ("o CI ainda está rodando, volto às
 * 16:30") e vira balão da task, então "falou" não separa a volta que avançou da que só conferiu. Conservadora no outro
 * sentido: a volta que pediu algo a alguém nunca conta como sem novidade, e a que caiu ou foi parada também não (essas já
 * têm o caminho delas — o "Retomar" e o Parar).
 */
export function voltaSemNovidade(v: VoltaDaCadeia): boolean {
  return v.estado === "concluido" && v.marcouVolta && !v.perguntou && !v.pediuAColega && v.porCota !== true;
}

/**
 * `ultimas`: as voltas da cadeia, da mais nova para a mais antiga (a primeira é a que acabou de terminar). Alarme quando
 * as `limite` mais novas existem e nenhuma trouxe nada novo.
 */
export function alarmeDeVoltas(ultimas: readonly VoltaDaCadeia[], limite: number = VOLTAS_SEM_NOVIDADE): boolean {
  return limite > 0 && ultimas.length >= limite && ultimas.slice(0, limite).every(voltaSemNovidade);
}

/**
 * O balão na conversa: a pergunta na voz do bot, com as respostas prontas (`pedido_a_pessoa`). revisto em 2026-10-18
 * (plano "pergunta com botões", Parte 1): o `texto` também é a frase da decisão (a fila "Sua vez" e o motivo legível da
 * task em "Precisa de você") — saiu o molde "voltou N vezes sem novidade esperando: …".
 */
export function perguntaDoAlarme(voltas: number, motivo: string): { texto: string; opcoes: string[] } {
  return {
    texto: `Voltei ${voltas} vezes para conferir e nada mudou: ${motivo}. Sigo esperando ou paro por aqui?`,
    opcoes: ["Pode seguir esperando", "Pode parar de esperar"],
  };
}
