import type { AnexoMeta } from "../contracts/anexo.ts";
import { motorLe, tipoDoAnexo } from "./anexo.ts";

/**
 * O histórico que vai no plano de um turno sem sessão retomada (emitir-plano-turno.ts) e a chave "Memória longa"
 * (ADR-111). Sem sessão — Codex, rotina, delegação, troca de IA, /nova-sessao —, o modelo só sabe da conversa por este
 * histórico; com sessão retomada, ele já viu tudo e o histórico nem vai.
 */

/** definido em 2026-09-16: cada fala do histórico vai cortada em 1 mil caracteres (o de sempre, chave desligada). */
export const FALA_NO_HISTORICO = 1000;
/**
 * definido em 2026-10-16 (ADR-111): com a memória longa, as falas mais recentes vão até 8 mil caracteres — o mesmo teto
 * do que chegou depois da sessão (TEXTO_DESDE_A_SESSAO, 0030) — enquanto o total couber em HISTORICO_LONGO_MAX; as mais
 * antigas voltam ao corte de 1 mil. Motivo medido: em 15/10, 15:46, a Frida 2 disse que a própria tabela da resposta
 * anterior "só chega inteira até a linha do Copy" (a resposta tinha ~4 mil caracteres).
 */
export const FALA_NO_HISTORICO_LONGO = 8000;
export const HISTORICO_LONGO_MAX = 40_000;
/**
 * definido em 2026-10-16 (ADR-111): com a memória longa, até 3 anexos de falas anteriores da pessoa voltam ao turno sem
 * sessão (os mais recentes). Motivo medido: em 15/10, 15:46, a Frida 2 respondeu que o playbook "não ficou salvo nesta
 * máquina" no turno seguinte ao envio, e a pessoa teve de mandar o arquivo de novo.
 */
export const ANEXOS_ANTERIORES_MAX = 3;

/**
 * Corta cada fala do histórico (na ordem da conversa). Desligada: 1 mil caracteres cada, sem marca (como antes da
 * ADR-111). Ligada: da mais recente para trás, a fala vai até 8 mil enquanto o total couber em 40 mil; a que não couber
 * volta a 1 mil. A fala cortada no modo longo leva a marca de quanto ficou de fora, para o modelo não tomar o pedaço
 * pelo todo.
 */
export function cortarFalas(textos: readonly string[], longa: boolean): string[] {
  if (!longa) return textos.map((t) => t.slice(0, FALA_NO_HISTORICO));
  const marcar = (t: string, teto: number) => (t.length > teto ? `${t.slice(0, teto)} [cortado pelo nod: ${t.length - teto} caracteres ficaram de fora]` : t);
  let resta = HISTORICO_LONGO_MAX;
  const saida: string[] = [];
  for (let i = textos.length - 1; i >= 0; i--) {
    const t = textos[i] ?? "";
    const longo = Math.min(t.length, FALA_NO_HISTORICO_LONGO);
    if (longo <= resta) {
      resta -= longo;
      saida.unshift(marcar(t, FALA_NO_HISTORICO_LONGO));
    } else {
      saida.unshift(marcar(t, FALA_NO_HISTORICO));
    }
  }
  return saida;
}

/**
 * Os anexos das falas anteriores que voltam ao turno com a memória longa: das falas da janela (na ordem da conversa), os
 * que a IA do turno lê (`harness` null = sem IA escolhida, o catcher: todos), fora os que o turno já leva, os
 * ANEXOS_ANTERIORES_MAX mais recentes, em ordem cronológica e marcados `anterior` (o driver diz ao modelo que vieram de
 * antes).
 */
export function anexosAnteriores(p: { falas: readonly string[]; anexosPorFala: ReadonlyMap<string, readonly AnexoMeta[]>; jaNoTurno: readonly string[]; harness: string | null }): AnexoMeta[] {
  const ja = new Set(p.jaNoTurno);
  const todos = p.falas.flatMap((id) => p.anexosPorFala.get(id) ?? []);
  const lidos = todos.filter((a) => !ja.has(a.id) && (p.harness === null || motorLe(p.harness, tipoDoAnexo(a.mime))));
  const unicos = lidos.filter((a, i) => lidos.findIndex((b) => b.id === a.id) === i);
  return unicos.slice(-ANEXOS_ANTERIORES_MAX).map((a) => ({ ...a, anterior: true }));
}
