import { palavrasDaFala } from "./ligacao-turno.ts";

/**
 * Aprovação por voz (plano do modo ligação, "Aprovação por voz", passo 4): gramática FECHADA. O modelo nunca decide
 * se a pessoa aprovou; esta função compara a fala inteira, já sem acento, pontuação, caixa e cortesia, com listas
 * fixas por perfil. Na dúvida, não aprova.
 *
 * Perfis: `estrito` (aprovação de itens e acesso), `proposta` (bot, rotina, perfil) e `escolha` (opções numeradas).
 */
export type PerfilComando = "estrito" | "proposta" | "escolha";

export type ResultadoComando =
  | { acao: "aprovar" }
  | { acao: "recusar" }
  | { acao: "repetir" }
  | { acao: "confirmar_de_novo" }
  | { acao: "escolher"; indice: number }
  | { acao: "nenhum" };

/** definido em 2026-10-04: qualquer negação recusa, misturada ou não ("não, pode aprovar" → recusar). */
const NEGACOES = new Set(["nao", "nunca", "nem", "jamais", "negativo"]);

/** Cortesia que sai antes de comparar, em qualquer posição. */
const CORTESIA: readonly (readonly string[])[] = [["por", "favor"], ["por", "gentileza"], ["faz", "favor"], ["entao"], ["nina"]];

/** definido em 2026-10-04: mais de 8 palavras (sem cortesia) não é comando, é conversa. */
export const MAX_PALAVRAS_COMANDO = 8;

const APROVA_ESTRITO = new Set(["eu aprovo", "aprovo", "pode aprovar", "aprovado", "aprovo sim", "eu aprovo sim"]);
const APROVA_PROPOSTA = new Set([
  ...APROVA_ESTRITO,
  "pode criar", "pode ser", "isso", "isso mesmo", "cria", "criar", "pode", "manda ver", "fechado", "sim", "ok", "beleza",
  "claro", "pode fazer", "faz", "aprova", "pode mandar", "bora", "cria sim", "pode criar sim",
]);

/** Tudo o que aprova sozinho em cada perfil (lista para a cobertura de eco da NOD-165, que testa cada um como eco). */
export const COMANDOS_QUE_APROVAM: Readonly<Record<"estrito" | "proposta", readonly string[]>> = {
  estrito: [...APROVA_ESTRITO],
  proposta: [...APROVA_PROPOSTA],
};

/** Afirmativas que no perfil estrito pedem a frase de novo ("diga 'eu aprovo'"). */
const AFIRMATIVAS = new Set([
  "sim", "ok", "okay", "pode", "beleza", "isso", "certo", "claro", "ta", "bom", "uhum", "aham", "manda", "ver", "fechado",
  "bora", "vai", "positivo", "confirmo", "confirmado", "perfeito", "show", "cria", "criar", "ser", "aprova", "aprovar",
  "mandar", "fazer", "faz", "mesmo", "blz", "demorou", "valeu",
]);
/** Backchannel puro: nem no perfil de proposta aprova sozinho. */
const SO_CONCORDANCIA = new Set(["uhum", "aham", "ta", "hum", "certo"]);

const RECUSA = new Set([
  "recuso", "eu recuso", "pode recusar", "recusar", "recusado", "recusa", "cancela", "cancelar", "pode cancelar", "cancelado",
  "rejeito", "rejeita", "rejeitado", "deixa pra la", "esquece", "recuso sim",
]);

const REPETIR = new Set([
  "repete", "repita", "repetir", "pode repetir", "repete ai", "repete de novo", "como e", "como", "o que", "que", "hein", "oi",
  "como assim", "de novo", "fala de novo", "o que voce disse", "como que e", "perdao", "o que foi", "fala de novo ai",
]);

/** Palavras que podem vir antes ou depois do comando sem mudar o sentido ("ok, eu aprovo", "aprovo sim"). */
const ENCHIMENTO_ANTES = new Set(["sim", "ok", "ta", "beleza", "isso", "certo", "ah", "hum", "bom", "olha", "ai", "e", "eh", "pode", "entao"]);
const ENCHIMENTO_DEPOIS = new Set(["sim", "ai", "ja", "agora", "entao"]);

const ORDINAIS: Record<string, number> = {
  primeira: 0, primeiro: 0, um: 0, uma: 0, "1": 0,
  segunda: 1, segundo: 1, dois: 1, duas: 1, "2": 1,
  terceira: 2, terceiro: 2, tres: 2, "3": 2,
  quarta: 3, quarto: 3, quatro: 3, "4": 3,
  quinta: 4, quinto: 4, cinco: 4, "5": 4,
};
const ANTES_DA_ESCOLHA = new Set(["a", "o", "quero", "escolho", "vou", "de", "fico", "com", "pode", "ser", "eu", "prefiro", "e", "opcao", "numero", "pela", "pelo", "na", "no"]);
const DEPOIS_DA_ESCOLHA = new Set(["opcao", "mesmo", "ai", "sim"]);

function semCortesia(palavras: readonly string[], nomeBot: string | undefined): string[] {
  const sequencias = [...CORTESIA];
  const nome = nomeBot ? palavrasDaFala(nomeBot) : [];
  if (nome.length > 0) sequencias.push(nome);
  const r: string[] = [];
  let i = 0;
  while (i < palavras.length) {
    const seq = sequencias.find((s) => s.every((w, k) => palavras[i + k] === w));
    if (seq) i += seq.length;
    else r.push(palavras[i++]!);
  }
  return r;
}

/** "aprovo aprovo" → "aprovo"; "eu aprovo eu aprovo" → "eu aprovo". */
function semRepeticao(palavras: readonly string[]): string[] {
  let r = palavras.filter((p, i) => i === 0 || palavras[i - 1] !== p);
  while (r.length % 2 === 0 && r.length > 0 && r.slice(0, r.length / 2).join(" ") === r.slice(r.length / 2).join(" ")) r = r.slice(0, r.length / 2);
  return r;
}

/** A fala e as versões sem o enchimento do começo e do fim, da mais longa para a mais curta. */
function candidatas(palavras: readonly string[]): string[] {
  const r: string[] = [];
  for (let i = 0; i <= palavras.length; i++) {
    for (let j = palavras.length; j > i; j--) {
      r.push(palavras.slice(i, j).join(" "));
      if (!ENCHIMENTO_DEPOIS.has(palavras[j - 1] ?? "")) break;
    }
    if (!ENCHIMENTO_ANTES.has(palavras[i] ?? "")) break;
  }
  return r;
}

function indiceDeEscolha(palavras: readonly string[]): number | null {
  let i = 0;
  let j = palavras.length;
  while (i < j && ANTES_DA_ESCOLHA.has(palavras[i] ?? "") && ORDINAIS[palavras[i] ?? ""] === undefined) i++;
  while (j > i && DEPOIS_DA_ESCOLHA.has(palavras[j - 1] ?? "")) j--;
  if (j - i !== 1) return null;
  return ORDINAIS[palavras[i] ?? ""] ?? null;
}

const NENHUM: ResultadoComando = { acao: "nenhum" };

/**
 * Interpreta a fala da pessoa na janela de aprovação.
 * definido em 2026-10-04: negação > tamanho > repetir > recusar > escolha/aprovação > confirmar de novo. "sim", "ok",
 * "pode", "beleza" no estrito pedem a frase de novo; "uhum", "tá" nunca aprovam; `nomeBot` sai como cortesia.
 */
export function interpretarComando(texto: string, perfil: PerfilComando, nomeBot?: string): ResultadoComando {
  const bruto = palavrasDaFala(texto);
  if (bruto.length === 0) return NENHUM;
  if (bruto.some((p) => NEGACOES.has(p))) return { acao: "recusar" };
  const palavras = semRepeticao(semCortesia(bruto, nomeBot));
  if (palavras.length === 0 || palavras.length > MAX_PALAVRAS_COMANDO) return NENHUM;
  const formas = candidatas(palavras);
  const casa = (conjunto: ReadonlySet<string>) => formas.some((f) => conjunto.has(f));
  if (casa(REPETIR)) return { acao: "repetir" };
  if (casa(RECUSA)) return { acao: "recusar" };
  if (perfil === "escolha") {
    const indice = indiceDeEscolha(palavras);
    return indice === null ? NENHUM : { acao: "escolher", indice };
  }
  if (casa(APROVA_ESTRITO)) return { acao: "aprovar" };
  const soConcordancia = palavras.every((p) => SO_CONCORDANCIA.has(p));
  if (perfil === "proposta" && !soConcordancia && casa(APROVA_PROPOSTA)) return { acao: "aprovar" };
  if (palavras.every((p) => AFIRMATIVAS.has(p))) return { acao: "confirmar_de_novo" };
  return NENHUM;
}

/** definido em 2026-10-04: o comando de voz é opaco, de uso único e vale 10 s. */
export const VALIDADE_COMANDO_MS = 10_000;

export function validarComando(c: { criadoEm: number; usado: boolean }, agora: number): boolean {
  return !c.usado && agora >= c.criadoEm && agora - c.criadoEm <= VALIDADE_COMANDO_MS;
}
