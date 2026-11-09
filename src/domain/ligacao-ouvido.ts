/**
 * "Ouviu até" (plano do modo ligação, "Interrupção", passo 4): quando a pessoa interrompe, o cérebro precisa saber até
 * onde ela ouviu. O cliente diz quantos ms da fala tocaram; aqui isso vira texto.
 */

/**
 * As frases que tocaram inteiras mais a parte da frase interrompida, estimada pela proporção do tempo sobre os
 * caracteres. definido em 2026-10-04: a parcial é cortada numa fronteira de palavra — palavra pela metade não entra.
 */
export function ouvidoAte(p: { frases: readonly { texto: string; duracaoMs: number }[]; tocadoMs: number }): string {
  const ouvidas: string[] = [];
  let acumulado = 0;
  for (const frase of p.frases) {
    const texto = frase.texto.trim();
    if (acumulado + frase.duracaoMs <= p.tocadoMs) {
      if (texto !== "") ouvidas.push(texto);
      acumulado += frase.duracaoMs;
      continue;
    }
    const proporcao = frase.duracaoMs > 0 ? Math.max(0, (p.tocadoMs - acumulado) / frase.duracaoMs) : 0;
    const parcial = parcialNaPalavra(texto, Math.floor(proporcao * texto.length));
    if (parcial !== "") ouvidas.push(parcial);
    break;
  }
  return ouvidas.join(" ");
}

/** Os primeiros `chars` caracteres, recuando até o fim da última palavra inteira; sem vírgula pendurada no fim. */
function parcialNaPalavra(texto: string, chars: number): string {
  if (chars <= 0) return "";
  if (chars >= texto.length) return texto;
  // Pontuação só fecha a palavra seguida de espaço: "1.000" e "index.ts" não se partem no ponto.
  const prox = texto[chars] ?? "";
  const depois = texto[chars + 1];
  const palavraInteira = /\s/u.test(prox) || (/[,.;:!?…]/u.test(prox) && (depois === undefined || /\s/u.test(depois)));
  const corte = palavraInteira ? texto.slice(0, chars) : texto.slice(0, Math.max(0, texto.lastIndexOf(" ", chars)));
  return corte.trim().replace(/[\s,;:–—-]+$/u, "");
}
