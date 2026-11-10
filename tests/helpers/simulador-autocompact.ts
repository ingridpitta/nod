import { limiarDeCompactacao, RESUMO_E_ANEXOS_TOKENS } from "../../src/domain/orcamento-contexto.ts";

/**
 * NOD-480: o autocompact do Claude Code 2.1.309 em miniatura, para o teste de regressão rodar sem gastar assinatura.
 * Lido no binário e medido no #718: compacta acima do limiar (`limiarDeCompactacao`); depois do resumo voltam a parte fixa
 * (prompt, ferramentas, base do harness) mais o resumo e os anexos; o disjuntor (`rapid_refill_breaker`) para o turno na
 * 4ª compactação seguida em que o contexto voltou ao limiar em menos de 3 voltas (`autocompact_thrashing`). O repro real
 * (haiku, prompt fixo de 65k, `--autocompact 100000`) deu 3 compactações e o erro; o QA o roda com o CLI de verdade.
 */
export type Simulacao = { compactacoes: number; voltas: number; thrashing: boolean };

export function simularAutocompact(p: { janela: number; parteFixa: number; saidas: readonly number[]; voltasRapidas?: number; seguidasParaDisparar?: number }): Simulacao {
  const limiar = limiarDeCompactacao(p.janela);
  const rapidas = p.voltasRapidas ?? 3;
  const disparo = p.seguidasParaDisparar ?? 4;
  // Antes do primeiro resumo ainda não há resumo nem anexos reanexados.
  let contexto = Math.max(0, p.parteFixa - RESUMO_E_ANEXOS_TOKENS);
  let compactacoes = 0;
  let seguidasRapidas = 0;
  let voltasDesdeResumo = 0;
  for (let i = 0; i < p.saidas.length; i++) {
    contexto += p.saidas[i]!;
    voltasDesdeResumo++;
    if (contexto <= limiar) continue;
    // Voltou ao limiar logo depois do resumo anterior: mais uma seguida rápida; senão a conta recomeça.
    seguidasRapidas = compactacoes > 0 && voltasDesdeResumo < rapidas ? seguidasRapidas + 1 : 0;
    if (seguidasRapidas + 1 >= disparo) return { compactacoes, voltas: i + 1, thrashing: true };
    compactacoes++;
    contexto = p.parteFixa;
    voltasDesdeResumo = 0;
  }
  return { compactacoes, voltas: p.saidas.length, thrashing: false };
}
