/**
 * NOD-119 (C5, revisão 8): o que a barra mostra no lugar de "Meus agentes" quando não há bots próprios.
 * - A frota falhou: o aviso com "Tentar de novo", com classe própria (`falha-frota`) para seguir visível na recolhida,
 *   onde ele vira o botão ↻ com etiqueta.
 * - A frota ainda não chegou: as silhuetas.
 * - "Nenhum agente visível" só quando não há bot nenhum, nem da equipe.
 */
export function listaVaziaDaBarra(s: { falhou: boolean; temFrota: boolean; botsDaEquipe: number }, silhuetas: string): string {
  if (s.falhou) {
    return '<p class="mudo falha-frota" role="status">Não deu para carregar seus bots · <button type="button" class="inicio-link" data-act="tentar-frota" aria-label="Não deu para carregar seus bots · Tentar de novo">Tentar de novo</button></p>';
  }
  if (!s.temFrota) return silhuetas;
  return s.botsDaEquipe > 0 ? "" : '<p class="mudo">Nenhum agente visível.</p>';
}
