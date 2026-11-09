import type { EstadoOrcamento } from "../contracts/sala.ts";

export type DecisaoOrcamento = "permitir" | "recusar" | "resfriar";

/**
 * definido em 2026-09-16: três remetentes distintos em sequência = anel A→B→C (portado do room-post-budget
 * do openmausbot). Reconciliação registrada pela L9 (EMENDA-L9 §6): a spec E5.5 dizia "anel de 3 → resfriar
 * no quarto post"; o domínio detecta o anel no TERCEIRO remetente distinto (o candidato que fecharia A→B→C)
 * e devolve 'recusar' — a tentativa é encerrada com negação escrita (terminal) em vez de resfriada, porque o
 * anel é ricochete estrutural, não ritmo: esperar o quarto post seria deixar o anel fechar uma vez.
 * O critério vale como está; tests/unit/domain/canal-orcamento.test.ts nomeia os dois lados.
 */
export const TAMANHO_ANEL = 3;
/** definido em 2026-09-16: 6 posts de bot sem fala humana viram decisão em "Sua vez" (core-features §2). */
export const TETO_POSTS_SEM_HUMANO = 6;
/** definido em 2026-09-16: 8 s entre posts de bot na mesma sala — abaixo disso é ricochete, não conversa. */
export const INTERVALO_MIN_MS = 8_000;
/** definido em 2026-09-16: guardar só os últimos 3 remetentes basta para detectar o anel. */
const HISTORICO_POSTS = 3;

export const ORCAMENTO_INICIAL: EstadoOrcamento = {
  ultimosPostsAgenteIds: [],
  postsSemHumano: 0,
  ultimoPostEm: null,
  ultimaFalaHumanaEm: null,
  handoffsNaRodada: 0,
};

/**
 * Quatro regras + quebra-anel sobre o estado PERSISTIDO na sala (GRUPO.orcamento-sala).
 * Rotina é isenta (E12.3). O teto conta posts não respondidos desde a última fala humana.
 */
export function avaliarOrcamento(entrada: {
  estado: EstadoOrcamento;
  candidatoAgenteId: string;
  eRotina: boolean;
  agora: number;
}): DecisaoOrcamento {
  if (entrada.eRotina) return "permitir";
  const anel = [...entrada.estado.ultimosPostsAgenteIds, entrada.candidatoAgenteId].slice(-TAMANHO_ANEL);
  if (anel.length === TAMANHO_ANEL && new Set(anel).size === TAMANHO_ANEL) return "recusar";
  if (entrada.estado.postsSemHumano >= TETO_POSTS_SEM_HUMANO) return "resfriar";
  if (entrada.estado.ultimoPostEm !== null && entrada.agora - entrada.estado.ultimoPostEm < INTERVALO_MIN_MS) return "resfriar";
  return "permitir";
}

/** Fala humana zera o teto e a rodada de handoffs (EMENDA 14); post de bot conta. Lê autor_tipo, nunca infere (ADR-023). */
export function registrarPost(estado: EstadoOrcamento, post: { autorTipo: "pessoa" | "agente"; autorId: string; agora: number }): EstadoOrcamento {
  if (post.autorTipo === "pessoa") {
    return { ...estado, postsSemHumano: 0, handoffsNaRodada: 0, ultimaFalaHumanaEm: post.agora, ultimoPostEm: post.agora };
  }
  return {
    ...estado,
    ultimosPostsAgenteIds: [...estado.ultimosPostsAgenteIds, post.autorId].slice(-HISTORICO_POSTS),
    postsSemHumano: estado.postsSemHumano + 1,
    ultimoPostEm: post.agora,
  };
}
