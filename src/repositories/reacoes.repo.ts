import type { EmojiDeReacao, ReacaoNaFala } from "../contracts/reacao.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * Reações a uma fala (0090, ADR-113). A dona da linha é quem reagiu; a RLS só deixa pôr e tirar a própria e deixa quem é
 * da sala ler as das falas dela (a mesma perna de `mensagens`).
 */
export function reacoesRepo(conn: Conn, escopo: Escopo) {
  return {
    /** Põe a reação da pessoa; de novo, não duplica (`reacoes_uma_por_pessoa`). Devolve se gravou agora. */
    async por(p: { conversaId: string; mensagemId: string; emoji: EmojiDeReacao }): Promise<boolean> {
      const linhas = await conn`
        insert into reacoes (tenant_id, owner_id, conversa_id, mensagem_id, emoji)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.conversaId}, ${p.mensagemId}, ${p.emoji})
        on conflict (tenant_id, mensagem_id, owner_id, emoji) do nothing
        returning id`;
      return linhas.length > 0;
    },

    /** Tira a reação da própria pessoa (a de outra pessoa não é tocada: a policy de DELETE é da dona). */
    async tirar(p: { mensagemId: string; emoji: EmojiDeReacao }): Promise<boolean> {
      const linhas = await conn`
        delete from reacoes
        where tenant_id = ${escopo.tenantId} and mensagem_id = ${p.mensagemId} and owner_id = ${escopo.pessoaId} and emoji = ${p.emoji}
        returning id`;
      return linhas.length > 0;
    },

    /**
     * As reações das falas pedidas, agrupadas por emoji, numa consulta (a janela carregada da conversa, no índice
     * `reacoes_uma_por_pessoa`). Ordem: fala, depois a primeira vez que o emoji apareceu nela.
     */
    async dasMensagens(mensagemIds: readonly string[]): Promise<ReacaoNaFala[]> {
      if (mensagemIds.length === 0) return [];
      const linhas = await conn<{ mensagem_id: string; emoji: EmojiDeReacao; total: number; minha: boolean }[]>`
        select mensagem_id, emoji, count(*)::int as total, bool_or(owner_id = ${escopo.pessoaId}) as minha
        from reacoes
        where tenant_id = ${escopo.tenantId} and mensagem_id = any(${mensagemIds as string[]}::uuid[])
        group by mensagem_id, emoji
        order by mensagem_id, min(criado_em), emoji`;
      return linhas.map((l) => ({ mensagemId: l.mensagem_id, emoji: l.emoji, total: l.total, minha: l.minha }));
    },
  };
}
