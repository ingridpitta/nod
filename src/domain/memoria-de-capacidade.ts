/**
 * O que o bot TEM depende do turno (ADR-065): terminal, arquivos, pastas, skills, computador e pedir a um colega
 * entram ou saem conforme o modo, a confiança da entrada e a corrente de colegas. Gravado na memória, isso vira
 * fato velho no turno seguinte. Medido em 2026-10-01: às 22:50 de 30/09 a Clarice gravou "Dev 3/Dev 4 não têm
 * terminal nem permissão de push no GitHub" — falso numa conversa com o Marlon, onde os dois tinham o terminal.
 *
 * Só capacidades POR TURNO. Acesso a app (concessão) é do bot, não do turno: "não tenho acesso ao Supabase" continua
 * podendo ser memória. A regra é conservadora para o lado de deixar gravar: precisa de uma negação seguida, na
 * mesma frase, de uma capacidade do turno — ou da menção explícita ao turno ou ao catálogo.
 */

/** Minúsculas e sem acento: "não têm" e "nao tem" casam igual. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const NEGACAO = String.raw`(?:nao (?:tem|tenho|temos|ha|existe|existem|consigo|consegue|conseguem|pode|posso|podem)|sem|falta|faltam|indisponive(?:l|is)|caiu|cairam)`;
const CAPACIDADE_DO_TURNO = String.raw`(?:terminal|bash|shell|ferramentas? de arquivo|read\/edit|edit\/write|workspace|pasta(?:s)? (?:local|locais|autorizada|autorizadas|do projeto)|computador|skills?|pedir_a_bot|delegar|encaminhar)`;
// A capacidade vem até 60 caracteres depois da negação, sem atravessar o fim da frase.
const NEGA_CAPACIDADE = new RegExp(String.raw`\b${NEGACAO}\b[^.!?\n]{0,60}?\b${CAPACIDADE_DO_TURNO}\b`);
const FALA_DO_TURNO = /\bneste turno\b|\b(?:meu|no|do) catalogo\b|\bfora do catalogo\b/;

/** O texto afirma que falta uma capacidade que muda de turno para turno? Se sim, não é memória. */
export function falaDeCapacidadeDoTurno(texto: string): boolean {
  const t = normalizar(texto);
  return FALA_DO_TURNO.test(t) || NEGA_CAPACIDADE.test(t);
}

/** O que o bot lê quando `lembrar` recusa: por que não gravou e o que fazer no lugar. */
export const RECUSA_CAPACIDADE_DO_TURNO = "não gravei: o que você tem (terminal, arquivos, pastas, skills, computador, pedir a um colega) depende do tipo de turno e muda no próximo. Diga isso na resposta deste turno; não guarde como fato.";
