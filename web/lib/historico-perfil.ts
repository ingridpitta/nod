import type { DetalheVersaoPerfil, ListaVersoesPerfil } from "../../src/contracts/versoes-perfil.ts";

/** definido em 2026-10-30 (NOD-20): o estado do histórico de versões do perfil de um bot (render em web/telas/historico-perfil.ts). */
/** Onde o Desfazer aparece: embaixo do cartão Perfil (missão e voz), no topo do Histórico (restaurar), embaixo do nome. */
export type OndeDesfazer = "ajustes" | "historico" | "identidade";

export type HistoricoDoBot = {
  lista: ListaVersoesPerfil | null;
  carregando: boolean;
  erro: boolean;
  carregandoMais: boolean;
  /** O detalhe da versão aberta (o número dele está em detalhe.versao.versao). */
  detalhe: DetalheVersaoPerfil | null;
  erroDetalhe: boolean;
  /** A versão cuja confirmação está aberta no rodapé. */
  confirmando: number | null;
  restaurando: boolean;
  erroRestaurar: boolean;
  /** O Desfazer logo depois de salvar ou restaurar: restaurar `versao` desfaz. Some quando a gaveta fecha. */
  desfazer: { versao: number; criada: number; rotulo: string; aria: string; onde: OndeDesfazer; desfeito: string } | null;
  /** O que o leitor de tela ouve (role=status); a tela não mostra frase de sucesso. */
  anuncio: string;
};

export const HISTORICO_INICIAL: HistoricoDoBot = {
  lista: null,
  carregando: false,
  erro: false,
  carregandoMais: false,
  detalhe: null,
  erroDetalhe: false,
  confirmando: null,
  restaurando: false,
  erroRestaurar: false,
  desfazer: null,
  anuncio: "",
};

/**
 * definido em 2026-10-30 (NOD-20, revisão 4 M1): o detalhe relido (uma mudança de fora com a confirmação aberta) traz outro
 * perfil de agora? Então a confirmação que a pessoa leu caducou: a guarda (`esperada`) e o aviso de segredo eram do perfil
 * de antes. Fechar a confirmação é o que impede o clique seguinte de desfazer a mudança de fora sem aviso.
 */
export function confirmacaoCaducou(h: HistoricoDoBot, numero: number, novo: DetalheVersaoPerfil): boolean {
  const d = h.detalhe;
  return h.confirmando === numero && d !== null && d.versao.versao === numero
    && (d.numeroAtual !== novo.numeroAtual || d.perdeSegredo !== novo.perdeSegredo);
}
