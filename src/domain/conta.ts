/**
 * Regras puras da conta do nod (NOD-345, ADR-124). Sem node:*, sem banco: só forma, prazos e textos.
 */

/** ADR-124 §4: 12 a 128 caracteres, sem outra regra de composição (NIST 800-63B). */
export const SENHA_MIN = 12;
export const SENHA_MAX = 128;
/** ADR-124 §3: código de verificação de 6 dígitos, 15 min, 5 tentativas. */
export const CODIGO_VERIFICACAO_MS = 15 * 60_000;
export const TENTATIVAS_CODIGO = 5;
/** ADR-124 §4: token de recuperação de 30 min, uso único. */
export const TOKEN_RECUPERACAO_MS = 30 * 60_000;
/** v3 #j5-8: o código de pareamento vale 5 min e funciona uma vez. */
export const CODIGO_PAREAMENTO_MS = 5 * 60_000;
/** A troca do app do Mac para outra pessoa (depois de importar, outra conta ou parear): 60 s, uso único. */
export const CODIGO_TROCA_APP_MS = 60_000;
/** A escolha importar/outra/cancelar fica aberta por 30 min; depois a pessoa recomeça a entrada. */
export const ENTRADA_PENDENTE_MS = 30 * 60_000;

export const EMAIL_MAX = 254;

/** E-mail na forma canônica (minúsculas, sem espaço nas pontas) ou null quando não tem forma de e-mail. */
export function normalizarEmail(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const e = bruto.trim().toLowerCase();
  if (e.length < 3 || e.length > EMAIL_MAX) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export type ProblemaSenha = "curta" | "longa" | "tipo";

export function problemaDaSenha(senha: unknown): ProblemaSenha | null {
  if (typeof senha !== "string") return "tipo";
  // Conta por ponto de código, não por unidade UTF-16: um emoji é um caractere para quem digita.
  const n = [...senha].length;
  if (n < SENHA_MIN) return "curta";
  if (n > SENHA_MAX) return "longa";
  return null;
}

/** Código de 6 dígitos digitado: aceita espaços e hífen no meio (colado do e-mail), devolve só os dígitos. */
export function lerCodigo(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const d = bruto.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(d) ? d : null;
}

/**
 * Os 3 símbolos com nome do pareamento (v3 #j5-5): as duas telas mostram os mesmos, derivados do código, para a pessoa
 * conferir que é o computador dela. 12 símbolos ⇒ 1.728 combinações: é confirmação visual, não segredo.
 */
export const SIMBOLOS_PAREAMENTO = ["sol", "lua", "estrela", "folha", "onda", "montanha", "chave", "barco", "flor", "nuvem", "raio", "peixe"] as const;
export type SimboloPareamento = (typeof SIMBOLOS_PAREAMENTO)[number];

/** Três símbolos a partir de três bytes quaisquer (o serviço passa bytes do HMAC do código). */
export function simbolosDe(bytes: readonly number[]): [SimboloPareamento, SimboloPareamento, SimboloPareamento] {
  const n = SIMBOLOS_PAREAMENTO.length;
  const s = (i: number) => SIMBOLOS_PAREAMENTO[(bytes[i] ?? 0) % n] as SimboloPareamento;
  return [s(0), s(1), s(2)];
}

/** Rótulo curto do aparelho para a lista de sessões ("macOS · Chrome"). Nada de versão nem IP: só o que ajuda a reconhecer. */
export function rotuloDoAparelho(userAgent: unknown): string {
  if (typeof userAgent !== "string" || userAgent === "") return "Aparelho desconhecido";
  const ua = userAgent;
  const so = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const app = /\bnod\//i.test(ua) || /Electron/.test(ua) ? "app do nod" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const partes = [so, app].filter((x): x is string => x !== null);
  return partes.length > 0 ? partes.join(" · ") : "Aparelho desconhecido";
}

/** Nome do espaço provisório quando o app não manda nenhum: a pessoa ainda não disse quem é. */
export const NOME_PROVISORIO_PADRAO = "Você";

/** Nome e iniciais aceitáveis pela função do dono (1–80 e 1–3); o app manda o nome do usuário do Mac. */
export function nomeDoProvisorio(bruto: unknown): { nome: string; iniciais: string } {
  const nome = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const efetivo = nome === "" ? NOME_PROVISORIO_PADRAO : nome;
  const palavras = efetivo.split(" ").filter(Boolean);
  const iniciais = (palavras.length > 1 ? `${palavras[0]?.[0] ?? ""}${palavras[palavras.length - 1]?.[0] ?? ""}` : efetivo.slice(0, 2)).toUpperCase() || "VC";
  return { nome: efetivo, iniciais: [...iniciais].slice(0, 3).join("") };
}
