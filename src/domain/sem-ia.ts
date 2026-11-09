/**
 * Jornada C do onboarding (spec docs/specs/onboarding-jornada-c.md, flag NOD_ONBOARDING_TEXTO=1): a pessoa pulou sem IA e
 * mandou uma mensagem. O bot responde como bot, com uma fala fixa gerada sem modelo, e a mensagem fica guardada: o turno
 * nasce `pendente` (não `interrompido`) e roda sozinho quando uma IA conectar neste computador.
 *
 * Domínio puro: nada de banco, rede ou relógio. Quem chama passa o que já leu.
 */
import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno } from "../contracts/turno.ts";

/**
 * A mensagem guardada vale 7 dias: é o `prazo_em` do turno (o da fila, que só vira observação `turno_velho_na_fila`) e o
 * prazo do varredor de órfãos para a máquina-alvo sem contato (domain/turno-orfao.ts; o de sempre é 24 h).
 */
export const PRAZO_SEM_IA_MS = 7 * 24 * 60 * 60 * 1000;

/** A primeira fala do bot sem IA na conversa (tela C da prancha). */
export const FALA_SEM_IA_PRIMEIRA = "Recebi. Estou sem IA neste computador, então ainda não consigo pensar nisso. Conecte uma e eu começo na hora; a mensagem fica guardada.";

/** As seguintes, enquanto já houver mensagem guardada: uma linha, sem card novo. */
export const FALA_SEM_IA_SEGUINTE = "Ainda sem IA aqui. A mensagem fica guardada; é só conectar no card acima.";

export function falaSemIa(p: { jaHaGuardada: boolean }): string {
  return p.jaHaGuardada ? FALA_SEM_IA_SEGUINTE : FALA_SEM_IA_PRIMEIRA;
}

/**
 * O turno recusado por falta de IA espera (fica guardado) ou cai como hoje? Só a fala da pessoa numa conversa própria
 * espera: rotina, pedido entre bots, sala, ligação e retomada seguem o caminho de sempre (a negação `plano_ausente`), porque
 * ninguém está olhando a conversa para conectar e a fila deles tem prazo próprio.
 */
export function aguardaIa(p: { ligado: boolean; origem: OrigemTurno; daPessoa: boolean; trabalho: boolean }): boolean {
  return p.ligado && p.origem === "conversa" && p.daPessoa && !p.trabalho;
}

/** A fala fixa do bot sem IA (negação `aguardaIa`): fica fora do histórico que vai ao modelo. */
export function ehFalaSemIa(m: Pick<Mensagem, "payload">): boolean {
  return m.payload?.kind === "negacao" && m.payload.aguardaIa === true;
}
