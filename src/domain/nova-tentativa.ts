import {
  ESPERAS_NOVA_TENTATIVA_MS,
  JITTER_NOVA_TENTATIVA,
  RETRY_AFTER_MAX_MS,
  TENTATIVAS_MAX_CONECTOR,
} from "../shared/constantes.ts";

/**
 * Política única de nova tentativa para chamadas a provedores por HTTP (emenda à ADR-009): classifica
 * por status HTTP e erro de transporte, NUNCA por texto, e só repete o que é seguro repetir. Pura:
 * relógio e aleatório entram por parâmetro.
 */
export type FalhaHttp = number | "rede" | "timeout";

/**
 * transitoria = 429, 5xx e corte de rede; autenticacao = 401/403; pedido = qualquer outro 4xx (o pedido
 * está errado, repetir dá o mesmo); timeout = já esperou o prazo inteiro e o desfecho é desconhecido.
 */
export type ClasseFalha = "transitoria" | "autenticacao" | "pedido" | "timeout";

/**
 * Limitação conhecida: 403 com `Retry-After` (alguns provedores limitam taxa assim, como o GitHub no
 * limite secundário) é autenticação e não repete; o modelo vê "acesso recusado". Só 429 é recusa do
 * limitador para esta política.
 */
export function classificarFalhaHttp(falha: FalhaHttp): ClasseFalha {
  if (falha === "timeout") return "timeout";
  if (falha === "rede") return "transitoria";
  if (falha === 429 || (falha >= 500 && falha <= 599)) return "transitoria";
  if (falha === 401 || falha === 403) return "autenticacao";
  return "pedido";
}

export type PedidoNovaTentativa = {
  classe: ClasseFalha;
  /** Status HTTP da falha; ausente em erro de rede. */
  status?: number;
  /** Leitura repete em 429, 5xx e rede; escrita só em 429. Sem saber, o chamador passa false. */
  somenteLeitura: boolean;
  /** Número (a partir de 1) da tentativa que acabou de falhar. */
  tentativa: number;
  /** Orçamento que sobra, em ms, desde o começo da chamada. */
  restanteMs: number;
  /** Prazo de uma requisição do chamador (o `timeoutMs` do cliente), não uma constante: a próxima tentativa pode levá-lo inteiro. */
  prazoMs: number;
  retryAfterMs?: number;
};

/**
 * Escrita só repete em 429: é a recusa do limitador ANTES de executar. Em 5xx ou rede o desfecho é
 * desconhecido e repetir pode duplicar o efeito (ADR-009). A próxima tentativa só vale se a espera
 * mais um prazo inteiro de requisição cabem no orçamento que sobra.
 */
export function podeRepetir(p: PedidoNovaTentativa): boolean {
  if (p.classe !== "transitoria") return false;
  if (p.tentativa >= TENTATIVAS_MAX_CONECTOR) return false;
  if (p.status !== 429 && !p.somenteLeitura) return false;
  if (p.retryAfterMs !== undefined && p.retryAfterMs > RETRY_AFTER_MAX_MS) return false;
  const pior = p.retryAfterMs ?? esperaBase(p.tentativa) * (1 + JITTER_NOVA_TENTATIVA);
  return p.restanteMs >= pior + p.prazoMs;
}

/**
 * Prazo de UMA tentativa: o teto da requisição, mas nunca além do que sobra do orçamento — o laço inteiro
 * (tentativas, esperas e páginas) termina em ORCAMENTO_CONECTOR_MS. Orçamento esgotado vira prazo de 1 ms
 * (o transporte aborta e o chamador vê timeout, que não repete).
 */
export function prazoDaTentativa(tetoMs: number, restanteMs: number): number {
  return Math.max(1, Math.min(tetoMs, restanteMs));
}

/**
 * `redirect: "error"` recusado pelo fetch do Node: TypeError "fetch failed" com causa "unexpected redirect",
 * sem código (o undici não dá outro sinal). Redirecionar é resposta do servidor, não queda: repetir dá o
 * mesmo, então não é "rede".
 */
export function ehRedirecionamentoRecusado(e: unknown): boolean {
  return e instanceof TypeError && e.cause instanceof Error && e.cause.message === "unexpected redirect";
}

function esperaBase(tentativa: number): number {
  return ESPERAS_NOVA_TENTATIVA_MS[Math.min(Math.max(tentativa, 1), ESPERAS_NOVA_TENTATIVA_MS.length) - 1] ?? 0;
}

/**
 * Espera antes da próxima tentativa, dada a que acabou de falhar: ~1 s depois da primeira, ~3 s depois
 * da segunda, com jitter de ±25% (`aleatorio` em [0, 1)). O `Retry-After` do servidor, quando veio e
 * cabe no limite, substitui a base.
 */
export function esperaAntes(tentativa: number, aleatorio: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
  return comJitter(esperaBase(tentativa), aleatorio);
}

/** `baseMs` com jitter de ±25% (`aleatorio` em [0, 1), fora disso é preso nas pontas). Também o backoff do fundo (NOD-309). */
export function comJitter(baseMs: number, aleatorio: number): number {
  const fator = 1 - JITTER_NOVA_TENTATIVA + 2 * JITTER_NOVA_TENTATIVA * Math.min(Math.max(aleatorio, 0), 1);
  return Math.round(baseMs * fator);
}

/**
 * `Retry-After` é segundos inteiros ou data HTTP; o que não der para entender volta undefined (usa a base).
 * Data só no formato HTTP (começa pelo dia da semana): o `Date.parse` do V8 aceita "1.5" e "-1" como datas
 * de 2001, que virariam espera 0. Data HTTP é sempre GMT; o formato asctime não traz fuso e o `Date.parse`
 * o leria no fuso da máquina, então ganha " GMT".
 */
export function lerRetryAfterMs(valor: string | null | undefined, agora: number): number | undefined {
  const v = valor?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v) * 1_000;
  if (!/^(mon|tue|wed|thu|fri|sat|sun)/i.test(v)) return undefined;
  const data = Date.parse(/\bGMT$/i.test(v) ? v : `${v} GMT`);
  return Number.isNaN(data) ? undefined : Math.max(0, data - agora);
}
