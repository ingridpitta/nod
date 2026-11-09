import type { MotivoAtualizacao, OrigemDoBinario } from "../contracts/estado-ia.ts";

/**
 * Quando o nod atualiza o CLI de uma IA sozinho (definido em 2026-10-23, NOD-9, plano do Arquiteto de 20/10, passo 4′).
 * Puro: quem chama lê a versão, os turnos e o registro do dia e passa `agora`; o comparador de versões vem de fora
 * (flag-floors.ts mora nos adaptadores). A regra:
 *  - o alvo é o maior entre o piso testado (PISO_CLI) e a mínima do modelo que um turno pediu;
 *  - binário de NOD_*_BIN (`configurado`) não é do nod: nada;
 *  - o clique roda agora (a pessoa escolheu); o automático só na brecha — sem turno daquele provedor e sem ligação;
 *  - uma tentativa automática por alvo por dia (o dia local de quem chama); o clique não conta para o limite;
 *  - sem brecha: espera; 23 h depois de precisar, avisa (`aviso`, 1 h antes); com 24 h, segura os pedidos novos daquele
 *    provedor (`segurar`) até a brecha; segurando há mais de 10 min (o teto), roda com o turno aberto — o turno que já
 *    roda continua no processo que abriu.
 */
export const ATUALIZACAO_AUTOMATICA = {
  avisoAntesMs: 60 * 60 * 1000,
  segurarDepoisMs: 24 * 60 * 60 * 1000,
  tetoSegurandoMs: 10 * 60 * 1000,
} as const;

export type AcaoAtualizacao = "agora" | "esperar" | "aviso" | "segurar" | "limite_do_dia" | "nada";

export type RegistroDoDia = {
  /** O alvo da última tentativa automática e o dia local (AAAA-MM-DD) em que ela rodou. */
  alvo: string;
  dia: string;
};

export type EntradaAtualizacao = {
  /** A versão lida do binário escolhido; null = não instalado ou ilegível (quem cuida é o instalador). */
  versao: string | null;
  piso: string;
  /** A mínima do modelo pedido (versaoMinimaDoModelo), quando um turno pediu mais que o piso. */
  minimaPedida: string | null;
  origem: OrigemDoBinario | null;
  gatilho: "auto" | "clique";
  /** Há turno DESTE provedor rodando no Mac (um provedor não espera pelo outro). */
  ocupado: boolean;
  emLigacao: boolean;
  /** O dia local de `agora` (AAAA-MM-DD). */
  hoje: string;
  /** A última tentativa automática (null = nenhuma). */
  registro: RegistroDoDia | null;
  /** Desde quando a IA precisa da atualização e não achou brecha (null = acabou de precisar). */
  precisaDesde: number | null;
  /** Desde quando os pedidos novos estão segurados (null = não estão). */
  seguraDesde: number | null;
  agora: number;
  comparar: (a: string, b: string) => -1 | 0 | 1;
};

export type DecisaoAtualizacao = {
  acao: AcaoAtualizacao;
  /** null só quando não há o que atualizar (sem versão). */
  alvo: string | null;
  motivo?: MotivoAtualizacao;
  /** No aviso: quando os pedidos novos passam a ser segurados. */
  seguraEm?: number;
};

/** O alvo: o maior entre o piso e a mínima pedida. */
export function alvoDaAtualizacao(piso: string, minimaPedida: string | null, comparar: EntradaAtualizacao["comparar"]): string {
  return minimaPedida && comparar(minimaPedida, piso) > 0 ? minimaPedida : piso;
}

export function decidirAtualizacao(e: EntradaAtualizacao): DecisaoAtualizacao {
  if (e.versao === null) return { acao: "nada", alvo: null };
  const alvo = alvoDaAtualizacao(e.piso, e.minimaPedida, e.comparar);
  if (e.comparar(e.versao, alvo) >= 0) return { acao: "nada", alvo };
  if (e.origem === "configurado") return { acao: "nada", alvo, motivo: "configurado" };
  if (e.gatilho === "clique") return { acao: "agora", alvo };
  if (e.registro && e.registro.dia === e.hoje && e.registro.alvo === alvo) return { acao: "limite_do_dia", alvo };
  if (!e.ocupado && !e.emLigacao) return { acao: "agora", alvo };
  if (e.seguraDesde !== null) {
    // A ligação nunca é interrompida: segurar só vale contra os turnos.
    if (!e.emLigacao && e.agora - e.seguraDesde >= ATUALIZACAO_AUTOMATICA.tetoSegurandoMs) return { acao: "agora", alvo };
    return { acao: "segurar", alvo };
  }
  const desde = e.precisaDesde ?? e.agora;
  const seguraEm = desde + ATUALIZACAO_AUTOMATICA.segurarDepoisMs;
  if (e.agora >= seguraEm) return { acao: "segurar", alvo };
  if (e.agora >= seguraEm - ATUALIZACAO_AUTOMATICA.avisoAntesMs) return { acao: "aviso", alvo, seguraEm };
  return { acao: "esperar", alvo };
}
