import type { CausaSemIa } from "../contracts/inventario.ts";
import type { ResultadoTurno } from "../contracts/turno.ts";

/**
 * A conta da IA responde? (definido em 2026-10-05, emenda da ADR-019.)
 *
 * Medido em produção em 2026-10-05: uma conta do Claude Code LOGADA, de uma organização que desativou o uso por
 * assinatura. `claude auth status` dizia `loggedIn: true`, o nod marcava a IA como pronta, e todo turno voltava com
 * esta frase no lugar da resposta: "Your organization has disabled Claude subscription access for Claude Code · Use an
 * Anthropic API key instead, or ask your admin to enable access". A ligação de boas-vindas ficou muda e a conversa
 * mostrou a frase em inglês como se fosse fala do bot.
 *
 * Exceção deliberada à regra de não ler texto do fornecedor (ADR-009): aqui o texto é a ÚNICA pista, e ele só escolhe
 * entre dois códigos fechados. O que não casa com nada conhecido fica `teste_falhou`, nunca um palpite.
 */
const SEM_ACESSO: readonly RegExp[] = [
  /organization has disabled .{0,40}subscription access/i,
  /disabled claude subscription access/i,
];

/** `conta_sem_acesso` quando o texto é a recusa da organização; null quando não dá para afirmar isso. */
export function causaDaFalhaDeConta(texto: string | null | undefined): Extract<CausaSemIa, "conta_sem_acesso"> | null {
  if (!texto) return null;
  return SEM_ACESSO.some((r) => r.test(texto)) ? "conta_sem_acesso" : null;
}

/** definido em 2026-10-05: o nome entra numa pergunta ao modelo; só o que parece nome passa (sem quebra de linha nem pontuação de comando). */
const FORMA_NOME = /^[\p{L}][\p{L} .'-]{0,39}$/u;
/** definido em 2026-10-05: nome e sobrenomes; uma frase inteira não é nome. */
const PALAVRAS_NOME_MAX = 4;

export function nomeParaOTeste(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Só espaço comum é normalizado: quebra de linha e tabulação reprovam o nome (antes de virarem espaço).
  const nome = v.trim().replace(/ +/g, " ");
  if (!FORMA_NOME.test(nome) || nome.split(" ").length > PALAVRAS_NOME_MAX) return null;
  return nome;
}

/** A pergunta do teste: uma frase, para a resposta caber na tela do onboarding e custar o mínimo. */
export function perguntaDoTeste(nome: string | null): string {
  return nome ? `Diga oi para ${nome} em uma frase curta, em português. Só a frase.` : "Diga oi em uma frase curta, em português. Só a frase.";
}

/** O que a IA respondeu, pronto para a tela: a primeira linha com texto, sem aspas em volta, cortada no teto. */
export function respostaDoTeste(texto: string | null | undefined, max: number): string | null {
  const linha = (texto ?? "").split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (!linha) return null;
  const semAspas = linha.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  if (semAspas === "") return null;
  return semAspas.length > max ? `${semAspas.slice(0, max - 1).trimEnd()}…` : semAspas;
}

/**
 * O turno que NÃO deu certo e cujo texto é a recusa da conta vira falha por `nao_autenticado`, com a causa em código e
 * SEM a frase do fornecedor como fala do bot (em produção ela entrava na conversa, em inglês, como se o bot a tivesse
 * dito). Turno bem-sucedido nunca é reclassificado: um bot pode citar a frase numa resposta de verdade.
 */
export function comContaSemAcesso(r: ResultadoTurno): ResultadoTurno {
  if (r.desfecho === "sucesso") return r;
  const causa = causaDaFalhaDeConta(r.erroCru) ?? causaDaFalhaDeConta(r.texto);
  if (!causa) return r;
  const { motivoInterrupcao: _fora, ...resto } = r;
  return { ...resto, desfecho: "falha", motivoFalha: "nao_autenticado", causaSemIa: causa, texto: "" };
}
