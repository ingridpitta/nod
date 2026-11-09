/**
 * Sonda de rede (revisão NOD-215, definido em 2026-10-13). O "Reconectando…" some quando o SSE volta a `aberto` ou quando
 * a próxima chamada REST dá certo. Mas há o caso em que nenhum dos dois acontece: o SSE nunca caiu (só o REST passou pelo
 * proxy fora) ou a última tentativa falhou DEPOIS de o SSE já ter reaberto — o aviso ficaria preso até alguém clicar.
 * Enquanto o aviso de rede estiver na tela, a sonda faz uma leitura leve a cada `intervaloMs`; a resposta passa pelo
 * observador de rede de api.ts, que apaga o aviso. Uma sonda por vez; para sozinha quando o aviso some.
 *
 * Função pura: relógio e leitura injetados (o teste não dorme).
 */
export const INTERVALO_SONDA_MS = 5_000;

export type OpcoesSonda = {
  /** Uma leitura GET leve (main.ts: `/api/sessao`). Erro é esperado enquanto o servidor estiver fora. */
  sondar: () => Promise<unknown>;
  /** O aviso de rede ainda está na tela? */
  precisa: () => boolean;
  agendar: (fn: () => void, ms: number) => unknown;
  intervaloMs?: number;
};

export function criarSondaDeRede(o: OpcoesSonda): { lembrar(): void; agendada(): boolean } {
  const intervalo = o.intervaloMs ?? INTERVALO_SONDA_MS;
  let agendada = false;
  let emVoo = false;
  const lembrar = (): void => {
    if (agendada || emVoo || !o.precisa()) return;
    agendada = true;
    o.agendar(() => {
      agendada = false;
      if (!o.precisa()) return;
      emVoo = true;
      void o
        .sondar()
        .catch(() => undefined)
        .finally(() => {
          emVoo = false;
          lembrar();
        });
    }, intervalo);
  };
  return { lembrar, agendada: () => agendada || emVoo };
}
