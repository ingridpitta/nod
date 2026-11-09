import { JANELA_TRECHO, LIMITE_BUSCA, MAXIMO_BUSCA, MINIMO_BUSCA, TAMANHO_TRECHO } from "../contracts/busca.ts";

/**
 * NOD-380: as regras puras da busca de mensagens. O cursor é o da Biblioteca (`codificarCursor`/`lerCursor` de
 * ./biblioteca.ts): o instante com microssegundos e o id, que desempata.
 */

/** O termo da query: espaços das pontas fora e os do meio juntados; null quando não é um termo que a rota aceita. */
export function termoDaBusca(texto: string | null): string | null {
  if (texto === null) return null;
  // Revisão 6 do PR #551: o Postgres recusa o NUL (22021) e o erro virava 500; caractere de controle não é termo de busca.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(texto)) return null;
  const t = texto.replace(/\s+/gu, " ").trim();
  const n = [...t].length;
  return n >= MINIMO_BUSCA && n <= MAXIMO_BUSCA ? t : null;
}

/** O limite pedido na query: ausente → 20; fora de 1..20 ou não inteiro → null (entrada inválida). */
export function limiteDaBusca(texto: string | null): number | null {
  if (texto === null || texto === "") return LIMITE_BUSCA;
  if (!/^\d{1,3}$/u.test(texto)) return null;
  const n = Number(texto);
  return n >= 1 && n <= LIMITE_BUSCA ? n : null;
}

/**
 * Sem acento e em minúsculas, como `nod_sem_acento` (0116) faz no banco para o que a busca compara. O unaccent do Postgres
 * cobre mais que o NFD (ß → ss, æ → ae); onde os dois discordam o trecho só perde o ponto do acerto e começa do início.
 */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** O máximo de texto (unidades UTF-16) que o trecho processa: o dobro da janela que o banco manda. */
export const TETO_ENTRADA_TRECHO = JANELA_TRECHO * 2;

/**
 * O trecho em volta do primeiro acerto, com até `tamanho` caracteres: a linha do resultado mostra 2 linhas, e o termo tem
 * de estar nelas. Quebras de linha viram espaço. "…" marca o que ficou de fora de cada lado.
 */
export function trechoEmVolta(texto: string, termo: string, tamanho = TAMANHO_TRECHO, cortado: { inicio: boolean; fim: boolean } = { inicio: false, fim: false }): string {
  // Revisão de segurança do PR #551: o mapeamento abaixo é por caractere; com o texto inteiro (até 1 MB por fala) travava o
  // Node. O banco já manda só a janela do acerto (JANELA_TRECHO); este teto protege qualquer outro chamador.
  let fimCortado = cortado.fim;
  if (texto.length > TETO_ENTRADA_TRECHO) {
    texto = texto.slice(0, TETO_ENTRADA_TRECHO).replace(/[\uD800-\uDBFF]$/u, "");
    fimCortado = true;
  }
  const chars = [...texto.replace(/\s+/gu, " ").trim()];
  if (chars.length <= tamanho) return `${cortado.inicio ? "…" : ""}${chars.join("")}${fimCortado ? "…" : ""}`;
  // Cada caractere do original rende 0 ou mais no normalizado; `origem[i]` diz de qual caractere veio o i-ésimo.
  let normal = "";
  const origem: number[] = [];
  chars.forEach((c, i) => {
    const n = semAcento(c);
    normal += n;
    for (let k = 0; k < n.length; k++) origem.push(i);
  });
  const achou = normal.indexOf(semAcento(termo.trim()));
  const inicioDoAcerto = achou < 0 ? 0 : (origem[achou] ?? 0);
  // O acerto fica no primeiro terço do trecho: o que vem antes dá contexto, e as 2 linhas ainda o mostram.
  let inicio = Math.max(0, inicioDoAcerto - Math.floor(tamanho / 3));
  inicio = Math.min(inicio, chars.length - tamanho);
  // Começa numa palavra inteira quando o espaço anterior está perto.
  if (inicio > 0) {
    const espaco = chars.slice(inicio, inicioDoAcerto).indexOf(" ");
    if (espaco >= 0 && espaco < 16) inicio += espaco + 1;
  }
  const fim = Math.min(chars.length, inicio + tamanho);
  return `${inicio > 0 || cortado.inicio ? "…" : ""}${chars.slice(inicio, fim).join("").trim()}${fim < chars.length || fimCortado ? "…" : ""}`;
}
