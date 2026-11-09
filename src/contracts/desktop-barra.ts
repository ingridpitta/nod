/**
 * NOD-119: a barra lateral no app do Mac. Mora fora de desktop.ts pelo gatilho de 200 linhas da EMENDA 26 (revisão 5 do
 * #597): os valores guardados no preferencias.json, as decisões do card do chat e os métodos da ponte. Os canais ficam
 * em CANAIS_DESKTOP, com os outros.
 */
/**
 * A densidade e a largura da barra guardadas por computador (web/lib/densidade.ts; userData no app do Mac). Só estes
 * valores; a Confortável aberta é o padrão e não grava nada (null).
 */
export const VALORES_BARRA_DESKTOP = ["compacta", "compacta:recolhida", "compacta:larga", "confortavel:recolhida"] as const;
export type BarraDesktop = (typeof VALORES_BARRA_DESKTOP)[number];
/**
 * As decisões do card (aplicada ou recusada) por mensagem, guardadas no preferencias.json do app do Mac, que apaga o
 * localStorage a cada conexão (revisão 4 do #597). Só as últimas MAX_DECISOES_BARRA_DESKTOP.
 */
export type DecisaoBarraDesktop = "aplicada" | "recusada";
export type DecisoesBarraDesktop = Record<string, DecisaoBarraDesktop>;
export const MAX_DECISOES_BARRA_DESKTOP = 50;

/** Os métodos da barra na ponte (NodDesktop). Opcionais: o app instalado antes da NOD-119 não tem, a web confere. */
export type PonteBarraDesktop = {
  /** A densidade e a largura da barra; null = o padrão. */
  definirBarra?(barra: BarraDesktop | null): Promise<void>;
  /** A decisão do card do chat, que o preload repõe no localStorage a cada conexão. */
  definirDecisaoBarra?(mensagemId: string, decisao: DecisaoBarraDesktop): Promise<void>;
};
