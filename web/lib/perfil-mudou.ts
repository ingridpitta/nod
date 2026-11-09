/**
 * definido em 2026-10-30 (NOD-20, revisão 2 M6): o perfil versionável de um bot mudou entre duas leituras da frota? Uma
 * mudança de fora (a proposta confirmada na conversa, a voz numa ligação, o Nod pelo chat) chega à tela pela frota relida;
 * com o Histórico aberto, a lista e o detalhe precisam reler, senão a tela compara com um "agora" velho. Puro.
 */
export type PerfilDaFrota = { nome: string; titulo: string | null; descricao: string | null; forma: string; cor: string; voz?: string | null; vozVelocidade?: number | null };

export function perfilMudou(antes: PerfilDaFrota | undefined, depois: PerfilDaFrota | undefined): boolean {
  if (!antes || !depois) return false;
  return antes.nome !== depois.nome
    || (antes.titulo ?? "") !== (depois.titulo ?? "")
    || (antes.descricao ?? "") !== (depois.descricao ?? "")
    || antes.forma !== depois.forma
    || antes.cor !== depois.cor
    || (antes.voz ?? null) !== (depois.voz ?? null)
    || (antes.vozVelocidade ?? 1) !== (depois.vozVelocidade ?? 1);
}
